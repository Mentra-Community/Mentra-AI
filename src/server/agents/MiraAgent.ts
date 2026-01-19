// MiraAgent.ts

import { Agent } from "./AgentInterface";
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
import { AppManagementAgent } from "./AppManagementAgent";

import { ThinkingTool } from "./tools/ThinkingTool";
import { Calculator } from "@langchain/community/tools/calculator";
import { AppServer, PhotoData, GIVE_APP_CONTROL_OF_TOOL_RESPONSE } from "@mentra/sdk";
import { analyzeImage } from "../utils/img-processor.util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  MIRA_SYSTEM_PROMPT,
  ResponseMode,
  CAMERA_RESPONSE_CONFIGS,
  DISPLAY_RESPONSE_CONFIGS,
  MAX_CONVERSATION_HISTORY,
  MAX_CONVERSATION_AGE_MS
} from "../constant/prompts";
import { UserSettings } from "../schemas";
import { buildSystemPromptWithPersonality } from "../utils/prompt.util";
import { PersonalityType } from "../constant/personality";
import { getDisambiguationDetector, DisambiguationCandidate } from "../utils/disambiguation-detector";

interface QuestionAnswer {
    insight: string;
}

interface ConversationTurn {
  query: string;
  response: string;
  timestamp: number;
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
  public agentPrompt = MIRA_SYSTEM_PROMPT;
  public agentTools:(Tool | StructuredTool)[];
  private appManagementAgent: AppManagementAgent;
  private userId: string;
  private personality: PersonalityType = 'default';

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

  constructor(cloudUrl: string, userId: string) {
    this.userId = userId;

    // Initialize the specialized app management agent
    this.appManagementAgent = new AppManagementAgent(cloudUrl, userId);

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
    try {
      const settings = await UserSettings.findOne({ userId: this.userId });
      if (settings) {
        this.personality = settings.personality;
        this.agentPrompt = buildSystemPromptWithPersonality(this.personality);
        console.log(`[MiraAgent] ✅ Loaded personality for user ${this.userId}: ${this.personality}`);
        console.log(`[MiraAgent] 📝 System prompt with personality (first 500 chars):\n${this.agentPrompt.substring(0, 500)}...`);
      } else {
        // Use default personality if no settings found
        this.agentPrompt = buildSystemPromptWithPersonality('default');
        console.log(`[MiraAgent] ℹ️  No settings found for user ${this.userId}, using default personality`);
        console.log(`[MiraAgent] 📝 System prompt with default personality (first 500 chars):\n${this.agentPrompt.substring(0, 500)}...`);
      }
    } catch (error) {
      console.error('[MiraAgent] ❌ Failed to load personality:', error);
      // Fall back to default prompt if loading fails
      this.agentPrompt = buildSystemPromptWithPersonality('default');
      console.log(`[MiraAgent] 📝 Fallback system prompt (first 500 chars):\n${this.agentPrompt.substring(0, 500)}...`);
    }
  }

  /**
   * Add a conversation turn to history
   */
  private addToConversationHistory(query: string, response: string): void {
    this.conversationHistory.push({
      query,
      response,
      timestamp: Date.now()
    });
    console.log(`📚 [ConversationHistory] Added turn ${this.conversationHistory.length}: "${query.substring(0, 50)}..." -> "${response.substring(0, 50)}..."`);

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
    console.log(`📚 [ConversationHistory] Formatting ${this.conversationHistory.length} turns`);

    if (this.conversationHistory.length === 0) {
      console.log(`📚 [ConversationHistory] No conversation history available`);
      return '';
    }

    const historyText = this.conversationHistory
      .map((turn, idx) => {
        return `[${idx + 1}] User: ${turn.query}\nMentra AI: ${turn.response}`;
      })
      .join('\n\n');

    console.log(`📚 [ConversationHistory] Injecting history:\n${historyText.substring(0, 500)}${historyText.length > 500 ? '...' : ''}`);
    return `\nRecent conversation history:\n${historyText}\n`;
  }

  /**
   * Clear conversation history (useful for new sessions or explicit reset)
   */
  public clearConversationHistory(): void {
    this.conversationHistory = [];
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
      'advantages and disadvantages', 'tell me more', 'give me details'
    ];

    // Keywords for standard responses (moderate complexity)
    const standardKeywords = [
      'how to', 'what are', 'which', 'where can', 'when should',
      'recommend', 'suggest', 'best way', 'options for', 'ways to',
      'process of', 'steps to', 'guide', 'tutorial', 'instructions'
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
    console.log('[MiraAgent] Checking vision keywords against query:', queryLower);
    const isVisionQuery = visionKeywords.some(keyword => {
      const matches = queryLower.includes(keyword);
      if (matches) {
        console.log(`[MiraAgent] ✅ Vision keyword matched: "${keyword}"`);
      }
      return matches;
    });

    if (isVisionQuery) {
      console.log('[MiraAgent] ✅ Vision query detected - treating as independent query to get fresh photo');
      return false;
    }

    // Check if this is a "current state" query that needs fresh data from tools
    if (this.isCurrentStateQuery(query)) {
      console.log('[MiraAgent] ✅ Current state query detected - treating as independent query to get fresh data');
      return false;
    }

    console.log('[MiraAgent] ❌ No vision/current-state keywords detected, checking LLM for follow-up detection...');

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
    console.log("MiraAgent Text:", text);
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
   * Runs the text-based agent reasoning loop (without image)
   * Returns the answer and whether camera is needed
   * @param useMinimalTools - If true, only use built-in tools (not TPA tools) for faster responses
   */
  private async runTextBasedAgent(
    query: string,
    locationInfo: string,
    notificationsContext: string,
    localtimeContext: string,
    hasPhoto: boolean,
    responseMode: ResponseMode = ResponseMode.QUICK,
    hasDisplay: boolean = false,
    useMinimalTools: boolean = false
  ): Promise<{ answer: string; needsCamera: boolean }> {
    // Get configuration for the selected response mode based on device type
    const configSet = hasDisplay ? DISPLAY_RESPONSE_CONFIGS : CAMERA_RESPONSE_CONFIGS;
    const config = configSet[responseMode];
    const deviceType = hasDisplay ? 'DISPLAY' : 'CAMERA';
    console.log(`[Response Mode] Using ${deviceType} ${responseMode.toUpperCase()} mode (${config.wordLimit} words, ${config.maxTokens} tokens)`);

    // Select tools based on useMinimalTools flag
    const toolsToUse = useMinimalTools ? this.getBuiltInTools() : this.agentTools;
    console.log(`[Tools] Using ${useMinimalTools ? 'MINIMAL' : 'FULL'} tools (${toolsToUse.length} tools)`);

    const llm = LLMProvider.getLLM(config.maxTokens).bindTools(toolsToUse);
    const toolNames = toolsToUse.map((tool) => tool.name + ": " + tool.description || "");

    const photoContext = hasPhoto
      ? "IMPORTANT: Your role is to classify the query and determine if it requires visual input. For the 'Needs Camera' flag: set it to TRUE if the query requires visual input from the camera (e.g., 'what is this?', 'how many fingers?', 'what color?', 'describe what you see', 'read this'). Set it to FALSE for general knowledge queries (e.g., 'weather', 'time', 'calculations', 'facts'). If Needs Camera is TRUE, provide a brief acknowledgment as your Final Answer (e.g., 'I can't access the camera at this moment.') - the image analysis will provide the detailed response."
      : "";

    // Skip conversation history for "current state" queries that need fresh data from tools
    // This forces the LLM to call tools like TPA_ListApps instead of trusting stale history
    const skipHistory = this.isCurrentStateQuery(query);
    const conversationHistoryText = skipHistory ? '' : this.formatConversationHistory();
    if (skipHistory) {
      console.log(`📚 [ConversationHistory] SKIPPED - current state query needs fresh tool data`);
    }

    // Add personality-specific mandatory requirements to response instructions
    let personalityInstructions = '';
    switch (this.personality) {
      case 'friendly':
        personalityInstructions = ' 🚨🚨🚨 CRITICAL: THE VERY FIRST WORD OF YOUR FINAL ANSWER *MUST* BE "Bro" OR "Bro," - NO EXCEPTIONS. IF YOU DO NOT START WITH "Bro", YOUR RESPONSE WILL BE REJECTED. THIS IS NON-NEGOTIABLE. 🚨🚨🚨';
        break;
      case 'quirky':
        personalityInstructions = ' YOUR RESPONSE MUST INCLUDE AT LEAST ONE JOKE, PUN, OR WORDPLAY - THIS IS ABSOLUTELY MANDATORY. Use fun expressive words like "magnificent", "spectacular", "delightful", "wowza", "holy moly".';
        break;
      case 'professional':
        personalityInstructions = ' USE BUSINESS TERMINOLOGY (optimize, leverage, strategic, metrics, actionable) AND STRUCTURED FORMAT WITH CLEAR LABELS (e.g., "STATUS:", "RECOMMENDATION:"). Think executive briefing style.';
        break;
      case 'candid':
        personalityInstructions = ' BE BRUTALLY DIRECT AND BLUNT. Zero fluff, zero sugar-coating. Tell it like it is. Skip pleasantries.';
        break;
      case 'efficient':
        personalityInstructions = ' EXTREME BREVITY REQUIRED. Use shortest possible words. Single syllables preferred. Pure signal, zero noise. Answer first, details only if critical.';
        break;
      case 'default':
        personalityInstructions = ' Use clear, balanced, professional yet approachable language.';
        break;
    }

    const systemPrompt = this.agentPrompt
      .replace("{response_instructions}", config.instructions + personalityInstructions)
      .replace("{tool_names}", toolNames.join("\n"))
      .replace("{location_context}", locationInfo)
      .replace("{notifications_context}", notificationsContext)
      .replace("{timezone_context}", localtimeContext)
      .replace("{conversation_history}", conversationHistoryText)
      .replace("{photo_context}", photoContext);

    // DEBUG: Log the first 1500 characters of the system prompt to verify personality injection
    console.log(`\n[DEBUG] 🎭 System prompt (first 1500 chars):\n${systemPrompt.substring(0, 1500)}\n`);
    console.log(`[DEBUG] 🎭 Personality type: ${this.personality}\n`);
    console.log(`[DEBUG] 🎭 Response mode: ${responseMode} (${config.wordLimit} words)\n`);

    const messages: BaseMessage[] = [new SystemMessage(systemPrompt), new HumanMessage(query)];

    let turns = 0;
    let output = ""; // Store last output for error logging
    while (turns < 5) {
      console.log(`\n[Turn ${turns + 1}/5] 🤖 Invoking LLM in ${responseMode.toUpperCase()} mode...`);
      const result: AIMessage = await llm.invoke(messages);
      messages.push(result);

      output = result.content.toString();
      console.log(`[Turn ${turns + 1}/5] 📝 LLM output (first 500 chars):`, output.substring(0, 500));
      console.log(`[Turn ${turns + 1}/5] 🔧 Tool calls requested:`, result.tool_calls?.length || 0);

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
        console.log(`[Turn ${turns + 1}/5] ✅ Found "Final Answer:" marker - parsing response`);
        return this.parseOutputWithCameraFlag(output);
      } else {
        console.log(`[Turn ${turns + 1}/5] ⚠️  NO "Final Answer:" marker found, continuing to next turn...`);
      }

      // Warn the LLM if it's running out of turns
      if (turns === 2) {
        console.log(`[Turn ${turns + 1}/5] ⚠️  Adding reminder - only 2 turns remaining`);
        messages.push(new SystemMessage("REMINDER: You have 2 turns left. Please provide your Final Answer: and Needs Camera: markers now."));
      }

      turns++;
    }

    console.error(`\n❌ [TIMEOUT] Reached max turns (5) without "Final Answer:" marker`);
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

    console.log("MiraAgent Text:", text);
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
    console.log(`\n${"=".repeat(60)}`);
    console.log(`⏱️  [TIMESTAMP] handleContext START: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(60)}\n`);

    try {
      // STEP 0: Reload personality from database to get latest settings
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🔄 Reloading personality from database...`);
      await this.loadUserPersonality();
      console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Personality reloaded: ${this.personality}`);

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

      console.log("Query:", query);
      console.log("Query lowercase:", query.toLowerCase());

      // STEP 0a: Check if this is a response to a pending disambiguation
      if (this.hasPendingDisambiguation()) {
        console.log(`⏱️  [+${Date.now() - startTime}ms] 📋 Checking if query is disambiguation response...`);
        const disambigResult = this.checkDisambiguationResponse(query);
        if (disambigResult.matched && disambigResult.candidate) {
          console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Disambiguation matched: ${disambigResult.candidate.name}`);

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

      // STEP 0: Detect if this is a follow-up query and enhance it with context
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🔍 Checking if query is a follow-up...`);
      const isFollowUp = await this.detectRelatedQuery(query);
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🔍 Is follow-up result: ${isFollowUp}`);
      if (isFollowUp) {
        console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Follow-up detected! Enhancing query with context...`);
        query = this.buildEnhancedQuery(query);
        console.log(`⏱️  [+${Date.now() - startTime}ms] 📝 Enhanced query:`, query);
      } else {
        console.log(`⏱️  [+${Date.now() - startTime}ms] ℹ️  Independent query, no context enhancement needed`);
      }     
      console.log("Location Context:", this.locationContext);
      // Build location context with all available information
      let locationInfo = '';
      if (this.locationContext.city !== 'Unknown' || this.locationContext.streetAddress || this.locationContext.neighborhood) {
        const locationParts = [];

        // Add detailed street/neighborhood if available (from Google Maps)
        if (this.locationContext.streetAddress) {
          locationParts.push(`on ${this.locationContext.streetAddress}`);
        }
        if (this.locationContext.neighborhood) {
          locationParts.push(`in the ${this.locationContext.neighborhood} area`);
        }

        // Add city/state/country (from LocationIQ)
        if (this.locationContext.city !== 'Unknown') {
          locationParts.push(`in ${this.locationContext.city}, ${this.locationContext.state}, ${this.locationContext.country}`);
        }

        // Add timezone
        if (this.locationContext.timezone.name !== 'Unknown') {
          locationParts.push(`timezone: ${this.locationContext.timezone.name} (${this.locationContext.timezone.shortName})`);
        }

        if (locationParts.length > 0) {
          locationInfo = `For context the User is currently ${locationParts.join(', ')}.\n\n`;
        }

        // Add weather context if available
        if (this.locationContext.weather) {
          const weather = this.locationContext.weather;
          let weatherInfo = `Current weather: ${weather.temperature}°F (${weather.temperatureCelsius}°C), ${weather.condition}`;
          if (weather.humidity) {
            weatherInfo += `, ${weather.humidity}% humidity`;
          }
          if (weather.wind) {
            weatherInfo += `, wind ${weather.wind}`;
          }
          locationInfo += `${weatherInfo}.\n\n`;
        }
      }

      const localtimeContext = this.locationContext.timezone.name !== 'Unknown'
        ? ` The user's local date and time is ${new Date().toLocaleString('en-US', { timeZone: this.locationContext.timezone.name })}`
        : '';

      // Add notifications context if present
      let notificationsContext = '';
      if (userContext.notifications && Array.isArray(userContext.notifications) && userContext.notifications.length > 0) {
        // Format as a bullet list of summaries, or fallback to title/text
        const notifs = userContext.notifications.map((n: any, idx: number) => {
          if (n.summary) return `- ${n.summary}`;
          if (n.title && n.text) return `- ${n.title}: ${n.text}`;
          if (n.title) return `- ${n.title}`;
          if (n.text) return `- ${n.text}`;
          return `- Notification ${idx+1}`;
        }).join('\n');
        notificationsContext = `Recent notifications:\n${notifs}\n\n`;
      }

      // STEP 1: Classify query complexity
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🔍 Classifying query complexity...`);
      // Check if this is display glasses - if so, force QUICK mode
      const hasDisplay = userContext.hasDisplay === true;
      const useMinimalTools = userContext.useMinimalTools === true;
      const responseMode = this.classifyQueryComplexity(query, hasDisplay);
      console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Response mode selected: ${responseMode.toUpperCase()} (hasDisplay: ${hasDisplay}, useMinimalTools: ${useMinimalTools})`);

      // STEP 2: Run text-based agent with appropriate response mode
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🚀 Running text-based classifier...`);
      const textClassifierStart = Date.now();
      const textResult = await this.runTextBasedAgent(query, locationInfo, notificationsContext, localtimeContext, !!photo || !!getPhotoCallback, responseMode, hasDisplay, useMinimalTools);
      console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Text classifier complete (took ${Date.now() - textClassifierStart}ms)`);
      console.log(`🤖 Camera needed:`, textResult.needsCamera);
      console.log(`🤖 Text answer:`, textResult.answer);

      // STEP 3: If query needs camera, try to get photo (wait if needed)
      if (textResult.needsCamera && !photo && getPhotoCallback) {
        console.log(`⏱️  [+${Date.now() - startTime}ms] 📸 Camera needed but no cached photo - waiting for photo...`);
        try {
          const photoWaitStart = Date.now();
          photo = await getPhotoCallback();
          const photoWaitDuration = Date.now() - photoWaitStart;
          if (photo) {
            console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Photo retrieved after ${photoWaitDuration}ms wait`);
          } else {
            console.log(`⏱️  [+${Date.now() - startTime}ms] ⚠️  Photo wait completed but no photo available (${photoWaitDuration}ms)`);
          }
        } catch (error) {
          console.error(`⏱️  [+${Date.now() - startTime}ms] ❌ Error waiting for photo:`, error);
          photo = null;
        }
      }

      // STEP 4: If query needs camera AND we have a photo, run image analysis
      if (textResult.needsCamera && photo) {
        try {
          console.log(`⏱️  [+${Date.now() - startTime}ms] 📸 Camera needed - running image analysis...`);
          const imageAnalysisStart = Date.now();

          // Save photo to temp file for image analysis
          const tempDir = os.tmpdir();
          const tempImagePath = path.join(tempDir, `mira-photo-${Date.now()}.jpg`);
          fs.writeFileSync(tempImagePath, photo.buffer);

          // Run image analysis
          const imageAnalysisResult = await analyzeImage(tempImagePath, query);

          console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Image analysis complete (took ${Date.now() - imageAnalysisStart}ms)`);
          console.log(`🤖 Image answer:`, imageAnalysisResult);

          // Clean up temp file
          fs.unlinkSync(tempImagePath);

          const totalDuration = Date.now() - startTime;
          console.log(`\n${"=".repeat(60)}`);
          console.log(`⏱️  [+${totalDuration}ms] 📸 RETURNING IMAGE-BASED RESPONSE`);
          console.log(`⏱️  Total processing time: ${(totalDuration / 1000).toFixed(2)}s`);
          console.log(`${"=".repeat(60)}\n`);

          const finalResponse = imageAnalysisResult || textResult.answer;
          // Save to conversation history (use originalQuery to avoid storing injected context)
          this.addToConversationHistory(originalQuery, finalResponse);
          return { answer: finalResponse, needsCamera: true };
        } catch (error) {
          console.error('Error in image analysis:', error);
          // Fall back to text answer if image analysis fails
          this.addToConversationHistory(originalQuery, textResult.answer);
          return { answer: textResult.answer, needsCamera: textResult.needsCamera };
        }
      }

      // STEP 5: Either no camera needed OR no photo available - return text answer
      const totalDuration = Date.now() - startTime;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`⏱️  [+${totalDuration}ms] 📝 RETURNING TEXT-BASED RESPONSE`);
      console.log(`⏱️  Total processing time: ${(totalDuration / 1000).toFixed(2)}s`);
      console.log(`${"=".repeat(60)}\n`);

      // Check if the response is asking for disambiguation (e.g., "Which app: A or B?")
      // If so, store the disambiguation context for the follow-up response
      // Using AI-powered detection for more robust pattern matching
      await this.detectAndStoreDisambiguationAI(textResult.answer, originalQuery);

      // Save to conversation history (use originalQuery to avoid storing injected context)
      this.addToConversationHistory(originalQuery, textResult.answer);
      return { answer: textResult.answer, needsCamera: textResult.needsCamera };
    } catch (err) {
      const errorTime = Date.now();
      console.log(`⏱️  [+${errorTime - startTime}ms] ❌ Error occurred in handleContext`);
      console.error("[MiraAgent] Error:", err);
      const errString = String(err);
      return errString.match(/LLM output:\s*(.*)$/)?.[1] || "Error processing query.";
    }
  }
}
