// MiraAgent.ts

export interface Agent {
  agentId: string;
  agentName: string;
  agentDescription: string;
  agentPrompt: string;
  agentTools: any[];
  handleContext(inputData: any): Promise<{ [key: string]: any }>;
}

import { AgentExecutor, createReactAgent } from "langchain/agents";
import { SearchToolForAgents } from "./tools/SearchToolForAgents";
import { PromptTemplate } from "@langchain/core/prompts";
import { LLMProvider } from "../utils";
import { wrapText } from "../utils";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Tool, StructuredTool } from "langchain/tools";
import { TpaCommandsTool, TpaListAppsTool, TpaListAppsWithToolsTool } from "./tools/TpaCommandsTool";
import { SmartAppControlTool } from "./tools/SmartAppControlTool";
import { TpaToolInvokeTool } from "./tools/TpaToolInvokeTool";
import { ThinkingTool } from "./tools/ThinkingTool";
import { Calculator } from "@langchain/community/tools/calculator";
import { AppServer, PhotoData, GIVE_APP_CONTROL_OF_TOOL_RESPONSE, logger as _logger } from "@mentra/sdk";
import type { Logger } from "pino";
import {
  ResponseMode,
  CAMERA_RESPONSE_CONFIGS,
  DISPLAY_RESPONSE_CONFIGS,
  MAX_CONVERSATION_HISTORY,
  MAX_CONVERSATION_AGE_MS,
  MAX_TOOL_TURNS,
  buildUnifiedPrompt,
  PERSONALITY_INSTRUCTIONS,
  PersonalityType,
} from "../constant/unifiedPrompt";
import { getDisambiguationDetector, DisambiguationCandidate } from "../utils/disambiguation-detector.util";

interface QuestionAnswer {
    insight: string;
}

interface ConversationTurn {
  query: string;
  response: string;
  timestamp: number;
  hadImage?: boolean;
}

interface PendingDisambiguation {
  originalRequest: string;  // e.g., "open Mentra Notes"
  candidates: Array<{ packageName: string; name: string; description?: string }>;
  action: 'start' | 'stop';
  timestamp: number;
}

export class MiraAgent implements Agent {
  public agentId = "mira_agent";
  public agentName = "MiraAgent";
  public agentDescription =
    "Answers user queries from smart glasses using conversation context and history.";
  public agentPrompt = "Mentra AI - smart glasses assistant";
  public agentTools:(Tool | StructuredTool)[];
  private userId: string;
  private personality: PersonalityType = 'default';
  private logger: Logger;

  public messages: BaseMessage[] = [];
  private conversationHistory: ConversationTurn[] = [];
  private pendingDisambiguation: PendingDisambiguation | null = null;

  private locationContext: {
    city: string;
    state: string;
    country: string;
    lat: number | null;
    lng: number | null;
    streetAddress?: string;
    neighborhood?: string;
    timezone: {
      name: string;
      shortName: string;
      fullName: string;
      offsetSec: number;
      isDst: boolean;
    };
    weather?: {
      temperature: number;
      temperatureCelsius: number;
      condition: string;
      humidity?: number;
      wind?: string;
    };
  } = {
    city: 'Unknown',
    state: 'Unknown',
    country: 'Unknown',
    lat: null,
    lng: null,
    streetAddress: undefined,
    neighborhood: undefined,
    timezone: {
      name: 'Unknown',
      shortName: 'Unknown',
      fullName: 'Unknown',
      offsetSec: 0,
      isDst: false
    },
    weather: undefined
  };

  constructor(cloudUrl: string, userId: string, logger?: Logger) {
    this.userId = userId;
    this.logger = logger || _logger.child({ service: 'MiraAgent' });

    this.agentTools = [
      new SearchToolForAgents(),
      new SmartAppControlTool(cloudUrl, userId),
      // Keep these for backward compatibility or advanced use cases
      new TpaListAppsTool(cloudUrl, userId),
      new TpaCommandsTool(cloudUrl, userId),
      // Tool to list apps with their tools and parameter requirements
      new TpaListAppsWithToolsTool(cloudUrl, userId),
      // Tool to invoke TPA tools (e.g., add_reminder, take_note on Mentra Notes)
      new TpaToolInvokeTool(cloudUrl, userId),

      new ThinkingTool(),
      new Calculator(),
    ];

    // Initialize with system timezone as fallback
    this.initializeSystemTimezone();

    // Load user personality asynchronously
    this.loadUserPersonality();
  }

  /**
   * Initialize location context with system timezone as fallback
   * This ensures we at least have correct time information even if GPS location is unavailable
   */
  private initializeSystemTimezone(): void {
    try {
      // Get system timezone using Intl API
      const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      if (systemTimezone && systemTimezone !== 'Unknown') {
        // Calculate offset in seconds
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset(); // getTimezoneOffset returns opposite sign
        const offsetSec = offsetMinutes * 60;

        // Determine if DST is active (approximation based on offset changes)
        const januaryOffset = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
        const julyOffset = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
        const isDst = offsetMinutes > Math.max(januaryOffset, julyOffset) * -1;

        // Get short timezone name (e.g., "PST", "EST")
        const shortName = now.toLocaleTimeString('en-US', { timeZoneName: 'short' })
          .split(' ')
          .pop() || 'Unknown';

        this.locationContext.timezone = {
          name: systemTimezone,
          shortName: shortName,
          fullName: systemTimezone,
          offsetSec: offsetSec,
          isDst: isDst
        };

        console.log(`[MiraAgent] Initialized with system timezone: ${systemTimezone} (${shortName})`);
      }
    } catch (error) {
      console.warn('[MiraAgent] Failed to initialize system timezone:', error);
      // Keep default "Unknown" values
    }
  }

  /**
   * Load user personality from database and update system prompt
   * This runs asynchronously during initialization
   */
  private async loadUserPersonality(): Promise<void> {
    this.personality = 'default';
    console.log(`[MiraAgent] ✅ Personality: ${this.personality}`);
  }

  /**
   * Add a conversation turn to history
   */
  private addToConversationHistory(query: string, response: string, hadImage?: boolean): void {
    this.conversationHistory.push({
      query,
      response,
      timestamp: Date.now(),
      hadImage,
    });
    // Clean up old conversations
    this.cleanupConversationHistory();
  }

  /**
   * Clean up old conversation history based on age and count limits
   */
  private cleanupConversationHistory(): void {
    const now = Date.now();

    // Remove conversations older than MAX_CONVERSATION_AGE_MS
    this.conversationHistory = this.conversationHistory.filter(
      turn => now - turn.timestamp < MAX_CONVERSATION_AGE_MS
    );

    // Keep only the last MAX_CONVERSATION_HISTORY turns
    if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
    }
  }

  /**
   * Format conversation history for context in prompts
   */
  private formatConversationHistory(): string {
    if (this.conversationHistory.length === 0) {
      return '';
    }

    const historyText = this.conversationHistory
      .map((turn, idx) => {
        return `[${idx + 1}] User: ${turn.query}\nMentra AI: ${turn.response}`;
      })
      .join('\n\n');
    return `\nRecent conversation history:\n${historyText}\n`;
  }

  /**
   * Clear conversation history (useful for new sessions or explicit reset)
   */
  public clearConversationHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Set the logger instance for this agent (called when session is established)
   */
  public setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Set pending disambiguation when SmartAppControl asks user to choose
   */
  public setPendingDisambiguation(
    originalRequest: string,
    candidates: Array<{ packageName: string; name: string; description?: string }>,
    action: 'start' | 'stop'
  ): void {
    this.pendingDisambiguation = {
      originalRequest,
      candidates,
      action,
      timestamp: Date.now()
    };
    console.log(`📋 [Disambiguation] Stored pending disambiguation for "${originalRequest}" with ${candidates.length} candidates`);
  }

  /**
   * Check if there's a pending disambiguation and if the user's response matches a candidate
   * Returns the matched candidate or null if no match
   */
  public checkDisambiguationResponse(userResponse: string): {
    matched: boolean;
    candidate?: { packageName: string; name: string };
    action?: 'start' | 'stop';
    originalRequest?: string;
  } {
    if (!this.pendingDisambiguation) {
      return { matched: false };
    }

    // Expire disambiguation after 2 minutes
    if (Date.now() - this.pendingDisambiguation.timestamp > 2 * 60 * 1000) {
      console.log(`📋 [Disambiguation] Expired - clearing pending disambiguation`);
      this.pendingDisambiguation = null;
      return { matched: false };
    }

    const responseLower = userResponse.toLowerCase().trim();
    const { candidates, action, originalRequest } = this.pendingDisambiguation;

    // Check for ordinal responses like "first one", "second one", "the first", etc.
    const ordinalPatterns = [
      { pattern: /\b(first|1st|one|1)\b/i, index: 0 },
      { pattern: /\b(second|2nd|two|2)\b/i, index: 1 },
      { pattern: /\b(third|3rd|three|3)\b/i, index: 2 },
      { pattern: /\b(fourth|4th|four|4)\b/i, index: 3 },
    ];

    for (const { pattern, index } of ordinalPatterns) {
      if (pattern.test(responseLower) && candidates[index]) {
        console.log(`📋 [Disambiguation] Matched by ordinal: "${userResponse}" -> ${candidates[index].name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate: candidates[index], action, originalRequest };
      }
    }

    // Check for "regular" which typically means the non-dev/non-test version
    if (/\bregular\b/i.test(responseLower)) {
      // Find the candidate without [Dev], [Test], [Beta], etc. in the name
      const regularCandidate = candidates.find(c =>
        !c.name.includes('[') && !c.name.toLowerCase().includes('dev') && !c.name.toLowerCase().includes('test')
      ) || candidates[0]; // Fall back to first if no "regular" version found

      console.log(`📋 [Disambiguation] Matched "regular": "${userResponse}" -> ${regularCandidate.name}`);
      this.pendingDisambiguation = null;
      return { matched: true, candidate: regularCandidate, action, originalRequest };
    }

    // FIRST PASS: Check for bracketed qualifiers like [Dev], [Beta], [Test], etc.
    // This must come first to ensure "Mentra Stream beta" matches "Mentra Stream [BETA]"
    // instead of just "Mentra Stream"
    for (const candidate of candidates) {
      const bracketMatch = candidate.name.match(/\[([^\]]+)\]/);
      if (bracketMatch && responseLower.includes(bracketMatch[1].toLowerCase())) {
        console.log(`📋 [Disambiguation] Matched by qualifier: "${userResponse}" -> ${candidate.name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate, action, originalRequest };
      }
    }

    // SECOND PASS: Check if user said "dev" and there's a [Dev ...] candidate
    // This handles speech-to-text errors like "Dev Aryan" -> "Dev Area"
    const responseWords = responseLower.replace(/[.,!?]/g, '').split(/\s+/);
    if (responseWords.includes('dev') || responseWords.includes('development')) {
      const devCandidate = candidates.find(c => c.name.toLowerCase().includes('[dev'));
      if (devCandidate) {
        console.log(`📋 [Disambiguation] Matched by "dev" keyword: "${userResponse}" -> ${devCandidate.name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate: devCandidate, action, originalRequest };
      }
    }
    if (responseWords.includes('beta') || responseWords.includes('test')) {
      const betaCandidate = candidates.find(c =>
        c.name.toLowerCase().includes('[beta') || c.name.toLowerCase().includes('[test')
      );
      if (betaCandidate) {
        console.log(`📋 [Disambiguation] Matched by "beta/test" keyword: "${userResponse}" -> ${betaCandidate.name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate: betaCandidate, action, originalRequest };
      }
    }

    // THIRD PASS: Check for exact name match (response matches candidate name exactly)
    const responseClean = responseLower.replace(/[.,!?]/g, '').trim();
    for (const candidate of candidates) {
      const nameLower = candidate.name.toLowerCase();
      const nameClean = nameLower.replace(/\[.*?\]/g, '').trim(); // Remove bracketed parts for comparison

      // Exact match (ignoring brackets on the candidate side)
      if (responseClean === nameLower || responseClean === nameClean) {
        console.log(`📋 [Disambiguation] Matched by exact name: "${userResponse}" -> ${candidate.name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate, action, originalRequest };
      }
    }

    // FOURTH PASS: Check for partial name match, but prefer MORE SPECIFIC matches
    // If user says something that contains "dev", "beta", etc., prefer candidates with brackets
    const hasQualifierWord = responseWords.some(w =>
      ['dev', 'beta', 'test', 'alpha', 'prod', 'staging', 'debug'].includes(w)
    );

    // Sort candidates: bracketed ones first if user used qualifier words
    const sortedCandidates = hasQualifierWord
      ? [...candidates].sort((a, b) => {
          const aHasBracket = a.name.includes('[') ? 0 : 1;
          const bHasBracket = b.name.includes('[') ? 0 : 1;
          return aHasBracket - bHasBracket;
        })
      : candidates;

    for (const candidate of sortedCandidates) {
      const nameLower = candidate.name.toLowerCase();
      // Only match if response contains the FULL candidate name (not partial)
      if (responseLower.includes(nameLower)) {
        console.log(`📋 [Disambiguation] Matched by name contains: "${userResponse}" -> ${candidate.name}`);
        this.pendingDisambiguation = null;
        return { matched: true, candidate, action, originalRequest };
      }
    }

    console.log(`📋 [Disambiguation] No match found for "${userResponse}"`);
    return { matched: false };
  }

  /**
   * Clear pending disambiguation
   */
  public clearPendingDisambiguation(): void {
    this.pendingDisambiguation = null;
  }

  /**
   * Check if there's a pending disambiguation
   */
  public hasPendingDisambiguation(): boolean {
    if (!this.pendingDisambiguation) return false;
    // Expire after 2 minutes
    if (Date.now() - this.pendingDisambiguation.timestamp > 2 * 60 * 1000) {
      this.pendingDisambiguation = null;
      return false;
    }
    return true;
  }

  /**
   * AI-powered detection of disambiguation responses
   * Uses an LLM to intelligently detect if a response is asking the user to choose between options
   * and extracts the candidate names
   */
  private async detectAndStoreDisambiguationAI(response: string, originalQuery: string): Promise<void> {
    try {
      const detector = getDisambiguationDetector();
      const result = await detector.detectDisambiguation(response);

      console.log(`📋 [Disambiguation AI] isDisambiguation: ${result.isDisambiguation}, reasoning: ${result.reasoning}`);

      if (!result.isDisambiguation || result.candidates.length < 2) {
        console.log(`📋 [Disambiguation AI] Not a disambiguation response or insufficient candidates`);
        return;
      }

      console.log(`📋 [Disambiguation AI] Detected ${result.candidates.length} candidates: ${result.candidates.map(c => c.name).join(', ')}`);

      // Determine action from original query
      const queryLower = originalQuery.toLowerCase();
      const action: 'start' | 'stop' =
        queryLower.includes('close') || queryLower.includes('stop') || queryLower.includes('quit') ||
        queryLower.includes('turn off') || queryLower.includes('shut down') || queryLower.includes('exit') ||
        queryLower.includes('kill') || queryLower.includes('end') || queryLower.includes('terminate')
          ? 'stop' : 'start';

      // Convert to the format expected by setPendingDisambiguationWithLookup
      const candidates = result.candidates.map(c => ({
        packageName: c.packageName || '',
        name: c.name
      }));

      // Look up package names and store disambiguation
      await this.setPendingDisambiguationWithLookup(originalQuery, candidates, action);
    } catch (error) {
      console.error(`📋 [Disambiguation AI] Error detecting disambiguation:`, error);
      // Silently fail - worst case is disambiguation isn't stored and user has to be more explicit
    }
  }

  /**
   * Store disambiguation with async lookup of package names
   */
  private async setPendingDisambiguationWithLookup(
    originalRequest: string,
    candidates: Array<{ packageName: string; name: string }>,
    action: 'start' | 'stop'
  ): Promise<void> {
    console.log(`📋 [Disambiguation Lookup] Starting lookup for ${candidates.length} candidates: ${candidates.map(c => c.name).join(', ')}`);

    // Try to get package names from TPA_ListApps
    const tpaListAppsTool = this.agentTools.find(t => t.name === 'TPA_ListApps') as any;
    if (tpaListAppsTool) {
      try {
        const appsResult = await tpaListAppsTool._call({ includeRunning: false });
        const apps = JSON.parse(appsResult);
        console.log(`📋 [Disambiguation Lookup] Found ${apps.length} apps to search through`);

        if (Array.isArray(apps)) {
          // IMPORTANT: First, try to find EXACT matches for each candidate
          // This prevents the AI from making up app names that don't exist
          // and ensures we match the actual apps in the database

          for (const candidate of candidates) {
            const candidateLower = candidate.name.toLowerCase().trim();

            console.log(`📋 [Disambiguation Lookup] Searching for candidate: "${candidate.name}"`);

            // FIRST: Try exact name match (case-insensitive)
            let matchedApp = apps.find((app: any) => {
              const appNameLower = app.name.toLowerCase().trim();
              return appNameLower === candidateLower;
            });

            if (matchedApp) {
              console.log(`📋 [Disambiguation Lookup] ✅ Exact match found: "${matchedApp.name}" (${matchedApp.packageName})`);
              candidate.packageName = matchedApp.packageName;
              candidate.name = matchedApp.name;
              continue;
            }

            // SECOND: Try to find app where candidate's bracketed qualifier matches
            // e.g., "Mentra Stream [BETA]" should find an app with [BETA] in its name
            const candidateBracket = candidate.name.match(/\[([^\]]+)\]/);
            if (candidateBracket) {
              const qualifier = candidateBracket[1].toLowerCase();
              matchedApp = apps.find((app: any) => {
                const appBracket = app.name.match(/\[([^\]]+)\]/);
                if (appBracket && appBracket[1].toLowerCase() === qualifier) {
                  // Also check that base names are similar
                  const candidateBase = candidate.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
                  const appBase = app.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
                  return candidateBase === appBase || appBase.includes(candidateBase) || candidateBase.includes(appBase);
                }
                return false;
              });

              if (matchedApp) {
                console.log(`📋 [Disambiguation Lookup] ✅ Qualifier match found: "${matchedApp.name}" (${matchedApp.packageName})`);
                candidate.packageName = matchedApp.packageName;
                candidate.name = matchedApp.name;
                continue;
              }
            }

            // THIRD: Fallback - fuzzy match only if no exact or qualifier match
            const candidateClean = candidateLower
              .replace(/\[.*?\]/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            matchedApp = apps.find((app: any) => {
              const appNameLower = app.name.toLowerCase().trim();
              const appNameClean = appNameLower
                .replace(/\[.*?\]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

              // Only match if base names are identical (after removing brackets)
              return appNameClean === candidateClean;
            });

            if (matchedApp) {
              console.log(`📋 [Disambiguation Lookup] ✅ Base name match found: "${matchedApp.name}" (${matchedApp.packageName})`);
              candidate.packageName = matchedApp.packageName;
              candidate.name = matchedApp.name;
            } else {
              console.log(`📋 [Disambiguation Lookup] ❌ No match found for "${candidate.name}"`);
            }
          }
        }
      } catch (error) {
        console.error('📋 [Disambiguation Lookup] Error looking up package names:', error);
      }
    } else {
      console.log(`📋 [Disambiguation Lookup] TPA_ListApps tool not found!`);
    }

    // Filter out candidates without package names (couldn't be matched)
    const validCandidates = candidates.filter(c => c.packageName);
    console.log(`📋 [Disambiguation Lookup] Valid candidates after lookup: ${validCandidates.length} - ${validCandidates.map(c => `${c.name} (${c.packageName})`).join(', ')}`);

    if (validCandidates.length >= 2) {
      this.setPendingDisambiguation(originalRequest, validCandidates, action);
      console.log(`📋 [Disambiguation] ✅ Successfully stored disambiguation with ${validCandidates.length} candidates`);
    } else {
      console.log(`📋 [Disambiguation] ❌ Could not find package names for enough candidates (need 2+, got ${validCandidates.length})`);
    }
  }

  /**
   * Get conversation history formatted for the VisionQueryDecider
   * Returns last N turns as user/assistant message pairs
   */
  public getConversationHistoryForDecider(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const turn of this.conversationHistory) {
      messages.push({ role: 'user', content: turn.query });
      messages.push({ role: 'assistant', content: turn.response });
    }
    return messages;
  }

  /**
   * Get full conversation history for memory recall queries
   * Returns a copy of the entire conversation history array
   */
  public getFullConversationHistory(): Array<{ query: string; response: string; timestamp: number }> {
    return this.conversationHistory.map((turn) => ({
      query: turn.query,
      response: turn.response,
      timestamp: turn.timestamp,
    }));
  }

  /**
   * Add a conversation turn from an external source (e.g., CameraQuestionAgent)
   * This ensures conversation history is maintained across different agents
   */
  public addExternalConversationTurn(query: string, response: string): void {
    console.log(`📚 [ConversationHistory] Adding external turn from another agent`);
    this.addToConversationHistory(query, response);
  }

  /**
   * Get information about available tools for the AppToolQueryDecider
   * Returns tool name, description, and activation phrases
   */
  public getToolInfo(): Array<{ name: string; description: string; activationPhrases?: string[] }> {
    return this.agentTools.map(tool => {
      // Extract activation phrases from description if present
      // Tools compiled from TPA have "Possibly activated by phrases like: ..." appended
      let activationPhrases: string[] | undefined;
      const phrasesMatch = tool.description.match(/Possibly activated by phrases like: (.+)$/);
      if (phrasesMatch) {
        activationPhrases = phrasesMatch[1].split(', ').map(p => p.trim());
      }

      return {
        name: tool.name,
        description: tool.description.replace(/\nPossibly activated by phrases like: .+$/, '').trim(),
        activationPhrases
      };
    });
  }

  /**
   * Get only the built-in tools (not TPA tools)
   * Used when useMinimalTools is true to speed up non-tool queries
   */
  private getBuiltInTools(): (Tool | StructuredTool)[] {
    const builtInToolNames = [
      'Search_Engine',
      'SmartAppControl',
      'TPA_ListApps',
      'TPA_Commands',
      'TPA_InvokeTool',  // For invoking TPA tools like add_reminder, take_note
      'Internal_Thinking',
      'calculator'  // LangChain Calculator
    ];
    return this.agentTools.filter(tool => builtInToolNames.includes(tool.name));
  }

  /**
   * Classifies query complexity to determine appropriate response mode
   * Uses heuristics and pattern matching for fast classification
   *
   * @param query - The user's query text
   * @param forceQuick - If true, always return QUICK mode (used for display glasses with limited screen space)
   */
  private classifyQueryComplexity(query: string, forceQuick: boolean = false): ResponseMode {
    // For display glasses with limited screen space, always use QUICK mode
    if (forceQuick) {
      console.log(`[Complexity] QUICK mode FORCED for display glasses`);
      return ResponseMode.QUICK;
    }

    const lowerQuery = query.toLowerCase();

    // Keywords indicating need for detailed responses
    const detailedKeywords = [
      'explain', 'how does', 'how do', 'why does', 'why do', 'why is', 'why are',
      'what is the difference', 'compare', 'contrast', 'tell me about',
      'describe', 'elaborate', 'in detail', 'comprehensive', 'understand',
      'breakdown', 'walk me through', 'teach me', 'help me understand',
      'what are the implications', 'analyze', 'evaluation', 'pros and cons',
      'advantages and disadvantages', 'tell me more', 'give me details',
      'solve', 'equation', 'calculate', 'compute', 'formula', 'math',
    ];

    // Keywords for standard responses (moderate complexity)
    const standardKeywords = [
      'how to', 'what are', 'which', 'where can', 'when should',
      'recommend', 'suggest', 'best way', 'options for', 'ways to',
      'process of', 'steps to', 'guide', 'tutorial', 'instructions',
      'should i', 'should we', 'what should',
      'recite', 'list the', 'list all', 'name the', 'name all',
      'what is the full', 'give me the', 'sing', 'quote',
    ];

    // Check for detailed response triggers
    for (const keyword of detailedKeywords) {
      if (lowerQuery.includes(keyword)) {
        console.log(`[Complexity] DETAILED mode triggered by keyword: "${keyword}"`);
        return ResponseMode.DETAILED;
      }
    }

    // Check for standard response triggers
    for (const keyword of standardKeywords) {
      if (lowerQuery.includes(keyword)) {
        console.log(`[Complexity] STANDARD mode triggered by keyword: "${keyword}"`);
        return ResponseMode.STANDARD;
      }
    }

    // Check query length (longer queries often need more detailed responses)
    const wordCount = query.trim().split(/\s+/).length;
    if (wordCount > 15) {
      console.log(`[Complexity] STANDARD mode triggered by word count: ${wordCount}`);
      return ResponseMode.STANDARD;
    }

    // Check for question marks indicating complex questions
    const questionMarks = (query.match(/\?/g) || []).length;
    if (questionMarks > 1) {
      console.log(`[Complexity] STANDARD mode triggered by multiple questions: ${questionMarks}`);
      return ResponseMode.STANDARD;
    }

    // Default to quick mode for simple queries
    console.log(`[Complexity] QUICK mode (default) for query`);
    return ResponseMode.QUICK;
  }

  /**
   * Check if a query is asking about "current state" that needs fresh data from tools
   * These queries should NOT use conversation history because the state may have changed
   */
  private isCurrentStateQuery(query: string): boolean {
    const queryLower = query.toLowerCase();
    const currentStatePatterns = [
      /what apps? (am i|are|is) running/i,        // "what app am I running" or "what apps are running"
      /which apps? (am i|are|is) running/i,       // "which app am I running" or "which apps are running"
      /what am i running/i,                        // "what am I running" (without "apps")
      /what('s| is| are) running (right )?now/i,
      /which apps? are (running|active|open|on)/i,
      /list (my |the )?(running |active )?(apps?|applications?)/i,
      /show (me )?(my |the )?(running |active )?(apps?|applications?)/i,
      /what (apps?|applications?) (do i have |are |is )(running|active|open|on)/i,
      /are there any apps? running/i,
      /is .+ (app )?(running|active|open|on)( right now)?/i,
      /what('s| is) (currently )?running/i,
      /get (me )?(the |my )?(current |running |active )?(apps?|app list)/i,
    ];
    return currentStatePatterns.some(pattern => pattern.test(queryLower));
  }


  /**
   * Detects if the current query is related to recent conversation history
   * Uses the LLM to determine if this is a follow-up question
   */
  private async detectRelatedQuery(query: string): Promise<boolean> {
    // Don't check for relatedness if there's no conversation history
    if (this.conversationHistory.length === 0) {
      return false;
    }

    // Check if this is a vision-related query - these should NOT be treated as follow-ups
    // because the user might be looking at something new
    const visionKeywords = [
      'what am i looking at',
      'what is this',
      'what is that',
      'identify this',
      'what do you see',
      'describe what',
      'tell me about this',
      'what\'s in front of me',
      'can you see',
      'look at this'
    ];

    const queryLower = query.toLowerCase();
    const isVisionQuery = visionKeywords.some(keyword => queryLower.includes(keyword));

    if (isVisionQuery) {
      return false;
    }

    // Check if this is a "current state" query that needs fresh data from tools
    if (this.isCurrentStateQuery(query)) {
      return false;
    }

    // Get the most recent conversation turn
    const recentTurn = this.conversationHistory[this.conversationHistory.length - 1];

    // Check if the conversation is still recent (within 30 minutes)
    const timeSinceLastQuery = Date.now() - recentTurn.timestamp;
    if (timeSinceLastQuery > MAX_CONVERSATION_AGE_MS) {
      return false;
    }

    // Use a simple, fast LLM to detect if this is a follow-up query
    const llm = LLMProvider.getLLM();

    const detectionPrompt = `You are analyzing whether a user's current query is a follow-up to their previous conversation.

Previous conversation:
User: "${recentTurn.query}"
Assistant: "${recentTurn.response}"

Current query: "${query}"

Determine if the current query is a follow-up that references or relates to the previous conversation.

Follow-up indicators (answer YES):
- Pronouns referring to previous content (it, that, those, this, them, he, she, they)
- Continuation words (also, too, as well, and, additionally, furthermore)
- Questions about "what about", "how about"
- Implicit context that only makes sense with previous conversation
- References to entities or topics from the previous exchange

NOT a follow-up (answer NO):
- CURRENT STATE queries asking about live/real-time status: "what am I running", "what apps are running", "what's running now", "which apps are active"
- Even if the user asked the SAME question before, if it's asking about CURRENT STATE, it needs FRESH data, not cached conversation
- The user asking "what am I running?" twice means they want the CURRENT answer both times, not a reference to the previous answer
- Queries that need real-time/live data from tools should always be treated as independent

Answer with ONLY "YES" if it's a follow-up that needs context from the previous conversation, or "NO" if it's an independent query (including current state queries).`;

    try {
      const result = await llm.invoke([new HumanMessage(detectionPrompt)]);
      const answer = result.content.toString().trim().toUpperCase();
      return answer.includes('YES');
    } catch (error) {
      console.error('[MiraAgent] Error detecting related query:', error);
      // Default to false if detection fails
      return false;
    }
  }

  /**
   * Builds an enhanced query by appending relevant conversation context
   * when a follow-up query is detected
   */
  private buildEnhancedQuery(query: string): string {
    if (this.conversationHistory.length === 0) {
      return query;
    }

    // Get the most recent conversation turn
    const recentTurn = this.conversationHistory[this.conversationHistory.length - 1];

    // Build context string
    const contextNote = `\n\n[CONTEXT FROM PREVIOUS EXCHANGE - User previously asked: "${recentTurn.query}" and you responded: "${recentTurn.response}"]`;

    return query + contextNote;
  }

    /**
   * Get the current location context
   */
  public getLocationContext() {
    return this.locationContext;
  }

  /**
   * Updates the agent's location context including timezone information
   * Gracefully handles invalid or incomplete location data
   * Preserves existing known values when new values are "Unknown"
   */
  public updateLocationContext(locationInfo: {
    city: string;
    state: string;
    country: string;
    lat?: number | null;
    lng?: number | null;
    streetAddress?: string;
    neighborhood?: string;
    timezone: {
      name: string;
      shortName: string;
      fullName: string;
      offsetSec: number;
      isDst: boolean;
    };
  }): void {
    try {
      // Helper function to preserve known values
      const preserveKnownValue = (newValue: any, currentValue: any, defaultValue: any, isUnknown: (val: any) => boolean) => {
        const safeNewValue = typeof newValue === typeof defaultValue ? newValue : defaultValue;

        // If we don't have existing context, use the new value
        if (!this.locationContext) {
          return safeNewValue;
        }

        // If new value is not "Unknown", use it
        if (!isUnknown(safeNewValue)) {
          return safeNewValue;
        }

        // If new value is "Unknown" but current value is not "Unknown", keep current
        if (isUnknown(safeNewValue) && !isUnknown(currentValue)) {
          return currentValue;
        }

        // Otherwise use the new value (both are "Unknown" or current doesn't exist)
        return safeNewValue;
      };

      const isStringUnknown = (val: string) => val === 'Unknown';
      const isNumberUnknown = (val: number) => val === 0; // For offsetSec, 0 might indicate unknown
      const isNumberNull = (val: number | null) => val === null; // For lat/lng, null indicates unknown
      const isBooleanDefault = (val: boolean) => val === false; // For isDst, false is default

      // Helper to check if string is undefined/empty
      const isStringUndefined = (val: string | undefined) => !val || val === '';

      // Validate and sanitize location data, preserving known values
      const safeLocationInfo = {
        city: preserveKnownValue(locationInfo?.city, this.locationContext?.city, 'Unknown', isStringUnknown),
        state: preserveKnownValue(locationInfo?.state, this.locationContext?.state, 'Unknown', isStringUnknown),
        country: preserveKnownValue(locationInfo?.country, this.locationContext?.country, 'Unknown', isStringUnknown),
        lat: preserveKnownValue(locationInfo?.lat, this.locationContext?.lat, null, isNumberNull),
        lng: preserveKnownValue(locationInfo?.lng, this.locationContext?.lng, null, isNumberNull),
        streetAddress: locationInfo?.streetAddress || this.locationContext?.streetAddress,
        neighborhood: locationInfo?.neighborhood || this.locationContext?.neighborhood,
        timezone: {
          name: preserveKnownValue(locationInfo?.timezone?.name, this.locationContext?.timezone?.name, 'Unknown', isStringUnknown),
          shortName: preserveKnownValue(locationInfo?.timezone?.shortName, this.locationContext?.timezone?.shortName, 'Unknown', isStringUnknown),
          fullName: preserveKnownValue(locationInfo?.timezone?.fullName, this.locationContext?.timezone?.fullName, 'Unknown', isStringUnknown),
          offsetSec: preserveKnownValue(locationInfo?.timezone?.offsetSec, this.locationContext?.timezone?.offsetSec, 0, isNumberUnknown),
          isDst: typeof locationInfo?.timezone?.isDst === 'boolean' ? locationInfo.timezone.isDst : (this.locationContext?.timezone?.isDst || false)
        },
        weather: (locationInfo as any)?.weather || this.locationContext?.weather
      };

      this.locationContext = safeLocationInfo;
    } catch (error) {
      console.error('Error updating location context:', error);
      // Keep existing context or use default if not set
      if (!this.locationContext || this.locationContext.city === undefined) {
        this.locationContext = {
          city: 'Unknown',
          state: 'Unknown',
          country: 'Unknown',
          lat: null,
          lng: null,
          streetAddress: undefined,
          neighborhood: undefined,
          timezone: {
            name: 'Unknown',
            shortName: 'Unknown',
            fullName: 'Unknown',
            offsetSec: 0,
            isDst: false
          }
        };
      }
    }
  }

  /**
   * Parses the final LLM output and extracts both the answer and camera flag.
   * Returns the answer text and whether camera is needed.
   */
  private parseOutputWithCameraFlag(text: string): { answer: string; needsCamera: boolean } {
    // console.log("MiraAgent Text:", text);
    const finalMarker = "Final Answer:";
    const cameraMarker = "Needs Camera:";

    let answer = "Error processing query.";
    let needsCamera = false;

    if (text.includes(finalMarker)) {
      const afterFinal = text.split(finalMarker)[1];

      if (afterFinal.includes(cameraMarker)) {
        // Split by camera marker to get both parts
        const parts = afterFinal.split(cameraMarker);
        answer = parts[0].trim();
        const cameraValue = parts[1].trim().toLowerCase();
        needsCamera = cameraValue.includes('true');
      } else {
        // No camera marker, just get the answer
        answer = afterFinal.trim();
      }
    }

    // Remove any remaining "Needs Camera:" text that might be in the answer
    answer = answer.replace(/Needs Camera:\s*(true|false)/gi, '').trim();

    return { answer, needsCamera };
  }

  /**
   * Runs the single-pass agent reasoning loop with image included in the user message.
   * The LLM sees the photo alongside the query and can use tools in the same pass.
   */
  private async runTextBasedAgent(
    query: string,
    locationInfo: string,
    notificationsContext: string,
    localtimeContext: string,
    photo: PhotoData | null,
    responseMode: ResponseMode = ResponseMode.QUICK,
    hasDisplay: boolean = false,
  ): Promise<{ answer: string; needsCamera: boolean }> {
    const configSet = hasDisplay ? DISPLAY_RESPONSE_CONFIGS : CAMERA_RESPONSE_CONFIGS;
    const config = configSet[responseMode];
    // console.log(`[Response Mode] Using ${hasDisplay ? 'DISPLAY' : 'CAMERA'} ${responseMode.toUpperCase()} mode (${config.wordLimit} words, ${config.maxTokens} tokens)`);

    const toolsToUse = this.agentTools;

    const llm = LLMProvider.getLLM(config.maxTokens).bindTools(toolsToUse);
    const toolNames = toolsToUse.map((tool) => tool.name + ": " + tool.description || "");

    const skipHistory = this.isCurrentStateQuery(query);
    const conversationHistoryText = skipHistory ? '' : this.formatConversationHistory();
    if (skipHistory) {
      console.log(`📚 [ConversationHistory] SKIPPED - current state query needs fresh tool data`);
    }

    const systemPrompt = buildUnifiedPrompt({
      personality: this.personality,
      hasDisplay,
      responseMode,
      locationInfo,
      notificationsContext,
      localtimeContext,
      conversationHistoryText,
      toolNames,
    });

    // console.log(`\n[DEBUG] 🎭 System prompt (first 1500 chars):\n${systemPrompt.substring(0, 1500)}\n`);
    // console.log(`[DEBUG] 🎭 Personality type: ${this.personality}\n`);
    // console.log(`[DEBUG] 🎭 Response mode: ${responseMode} (${config.wordLimit} words)\n`);

    // Build multimodal user message with image if available
    const humanMessageContent: any[] = [{ type: "text", text: query }];
    if (photo) {
      humanMessageContent.push({
        type: "image_url",
        image_url: { url: `data:${photo.mimeType};base64,${photo.buffer.toString('base64')}` }
      });
    }

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage({ content: humanMessageContent }),
    ];

    let turns = 0;
    let output = "";
    while (turns < MAX_TOOL_TURNS) {
      // console.log(`\n[Turn ${turns + 1}/${MAX_TOOL_TURNS}] 🤖 Invoking LLM in ${responseMode.toUpperCase()} mode...`);
      const result: AIMessage = await llm.invoke(messages);
      messages.push(result);

      output = result.content.toString();
      // console.log(`[Turn ${turns + 1}/${MAX_TOOL_TURNS}] 📝 LLM output (first 500 chars):`, output.substring(0, 500));
      // console.log(`[Turn ${turns + 1}/${MAX_TOOL_TURNS}] 🔧 Tool calls requested:`, result.tool_calls?.length || 0);

      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          const selectedTool = toolsToUse.find(tool => tool.name === toolCall.name);
          if (selectedTool) {
            let toolInput: any;
            if (selectedTool instanceof StructuredTool) {
              toolInput = toolCall.args;
            } else {
              toolInput = JSON.stringify(toolCall.args);
            }

            let toolResult: any;
            try {
              toolResult = await selectedTool.invoke(toolInput, {
                configurable: { runId: toolCall.id }
              });
              if (toolResult === GIVE_APP_CONTROL_OF_TOOL_RESPONSE) {
                return { answer: "App control requested", needsCamera: false };
              }
            } catch (error) {
              console.error(`[TextAgent] Error invoking tool ${toolCall.name}:`, error);
              toolResult = `Error executing tool: ${error}`;
            }

            let toolMessage: ToolMessage;
            if (toolResult instanceof ToolMessage) {
              toolMessage = toolResult;
            } else {
              const content = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
              toolMessage = new ToolMessage({
                content: content,
                tool_call_id: toolCall.id || `fallback_${Date.now()}`,
                name: toolCall.name
              });
            }

            if (toolMessage.content == "" || toolMessage.content == null || toolMessage.id == null) {
              toolMessage = new ToolMessage({
                content: toolMessage.content || "Tool executed successfully but did not return any information.",
                tool_call_id: toolMessage.id || toolCall.id || `fallback_${Date.now()}`,
                name: toolCall.name
              });
            }
            messages.push(toolMessage);
          } else {
            const unavailableToolMessage = new ToolMessage({
              content: `Tool ${toolCall.name} unavailable`,
              tool_call_id: toolCall.id || `unknown_${Date.now()}`,
              status: "error"
            });
            messages.push(unavailableToolMessage);
          }
        }
      }

      const finalMarker = "Final Answer:";
      if (output.includes(finalMarker)) {
        return this.parseOutputWithCameraFlag(output);
      }

      if (turns === MAX_TOOL_TURNS - 3) {
        messages.push(new HumanMessage("REMINDER: You have 2 turns left. Please provide your Final Answer: marker now."));
      }

      turns++;
    }

    console.error(`\n❌ [TIMEOUT] Reached max turns (${MAX_TOOL_TURNS}) without "Final Answer:" marker`);
    console.error(`❌ [TIMEOUT] Last LLM output was:`, output.substring(0, 1000));
    console.error(`❌ [TIMEOUT] Query: "${query}"`);
    console.error(`❌ [TIMEOUT] Response mode: ${responseMode.toUpperCase()}`);
    return { answer: "Error processing query.", needsCamera: false };
  }

  /**
   * Parses the final LLM output.
   * If the output contains a "Final Answer:" marker, the text after that marker is parsed as JSON.
   * Expects a JSON object with an "insight" key.
   */
  private parseOutput(text: string): QuestionAnswer {

    // console.log("MiraAgent Text:", text);
    const finalMarker = "Final Answer:";
    if (text.includes(finalMarker)) {
      text = text.split(finalMarker)[1].trim();
      return { insight: text };
    }
    try {
      const parsed = JSON.parse(text);
      // If the object has an "insight" key, return it.
      if (typeof parsed.insight === "string") {
        return { insight: parsed.insight };
      }
      // If the output is a tool call (e.g. has searchKeyword) or missing insight, return a null insight.
      if (parsed.searchKeyword) {
        return { insight: "null" };
      }
    } catch (e) {
      // Fallback attempt to extract an "insight" value from a string
      const match = text.match(/"insight"\s*:\s*"([^"]+)"/);
      if (match) {
        return { insight: match[1] };
      }
    }
    return { insight: "Error processing query." };
  }

  public async handleContext(userContext: Record<string, any>): Promise<any> {
    const startTime = Date.now();

    try {
      await this.loadUserPersonality();

      // Extract required fields from the userContext.
      const transcriptHistory = userContext.transcript_history || "";
      const insightHistory = userContext.insight_history || "";
      let query = userContext.query || "";
      // originalQuery is used for conversation history - stores the clean query without injected context
      const originalQuery = userContext.originalQuery || query;
      let photo = userContext.photo as PhotoData | null;
      const getPhotoCallback = userContext.getPhotoCallback as (() => Promise<PhotoData | null>) | undefined;

      let turns = 0;

      // If query is empty, return default response.
      if (!query.trim()) {
        return { answer: "No query provided.", needsCamera: false };
      }

      // console.log("Query:", query);

      // STEP 0a: Check if this is a response to a pending disambiguation
      if (this.hasPendingDisambiguation()) {
        const disambigResult = this.checkDisambiguationResponse(query);
        if (disambigResult.matched && disambigResult.candidate) {

          // Execute the app action directly using TpaCommandsTool
          const tpaCommandsTool = this.agentTools.find(t => t.name === 'TPA_Commands') as any;
          if (tpaCommandsTool) {
            try {
              const actionResult = await tpaCommandsTool._call({
                action: disambigResult.action,
                packageName: disambigResult.candidate.packageName
              });
              const finalAnswer = actionResult || `I've ${disambigResult.action === 'start' ? 'opened' : 'closed'} ${disambigResult.candidate.name} for you.`;
              this.addToConversationHistory(originalQuery, finalAnswer);
              return { answer: finalAnswer, needsCamera: false };
            } catch (error) {
              console.error(`⏱️  [+${Date.now() - startTime}ms] ❌ Error executing disambiguation action:`, error);
              const errorAnswer = `Sorry, I had trouble ${disambigResult.action === 'start' ? 'opening' : 'closing'} ${disambigResult.candidate.name}.`;
              this.addToConversationHistory(originalQuery, errorAnswer);
              return { answer: errorAnswer, needsCamera: false };
            }
          }
        }
      }

      // ── Single-pass pipeline: build context, run agent with image ──

      // console.log("Location Context:", this.locationContext);
      let locationInfo = '';
      if (this.locationContext.city !== 'Unknown' || this.locationContext.streetAddress || this.locationContext.neighborhood) {
        const locationParts = [];
        if (this.locationContext.streetAddress) locationParts.push(`on ${this.locationContext.streetAddress}`);
        if (this.locationContext.neighborhood) locationParts.push(`in the ${this.locationContext.neighborhood} area`);
        if (this.locationContext.city !== 'Unknown') locationParts.push(`in ${this.locationContext.city}, ${this.locationContext.state}, ${this.locationContext.country}`);
        if (this.locationContext.timezone.name !== 'Unknown') locationParts.push(`timezone: ${this.locationContext.timezone.name} (${this.locationContext.timezone.shortName})`);
        if (locationParts.length > 0) locationInfo = `For context the User is currently ${locationParts.join(', ')}.\n\n`;
        if (this.locationContext.weather) {
          const weather = this.locationContext.weather;
          let weatherInfo = `Current weather: ${weather.temperature}°F (${weather.temperatureCelsius}°C), ${weather.condition}`;
          if (weather.humidity) weatherInfo += `, ${weather.humidity}% humidity`;
          if (weather.wind) weatherInfo += `, wind ${weather.wind}`;
          locationInfo += `${weatherInfo}.\n\n`;
        }
      }

      const localtimeContext = this.locationContext.timezone.name !== 'Unknown'
        ? ` The user's local date and time is ${new Date().toLocaleString('en-US', { timeZone: this.locationContext.timezone.name })}`
        : '';

      let notificationsContext = '';
      if (userContext.notifications && Array.isArray(userContext.notifications) && userContext.notifications.length > 0) {
        const notifs = userContext.notifications.map((n: any, idx: number) => {
          if (n.summary) return `- ${n.summary}`;
          if (n.title && n.text) return `- ${n.title}: ${n.text}`;
          if (n.title) return `- ${n.title}`;
          if (n.text) return `- ${n.text}`;
          return `- Notification ${idx+1}`;
        }).join('\n');
        notificationsContext = `Recent notifications:\n${notifs}\n\n`;
      }

      const hasDisplay = userContext.hasDisplay === true;
      const responseMode = this.classifyQueryComplexity(query, hasDisplay);

      // Always include the photo — the system prompt already instructs the model to
      // only analyze the image when the query is visual and ignore it otherwise.
      const result = await this.runTextBasedAgent(query, locationInfo, notificationsContext, localtimeContext, photo, responseMode, hasDisplay);
      await this.detectAndStoreDisambiguationAI(result.answer, originalQuery);
      this.addToConversationHistory(originalQuery, result.answer, !!photo);
      return { answer: result.answer, needsCamera: false };
    } catch (err) {
      console.error("[MiraAgent] Error:", err);
      const errString = String(err);
      return errString.match(/LLM output:\s*(.*)$/)?.[1] || "Error processing query.";
    }
  }
}
