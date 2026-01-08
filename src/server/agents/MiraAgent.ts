// MiraAgent.ts

import { Agent } from "./AgentInterface";
import { AgentExecutor, createReactAgent } from "langchain/agents";
import { SearchToolForAgents } from "../tools/SearchToolForAgents";
import { PromptTemplate } from "@langchain/core/prompts";
import { LLMProvider } from "../utils";
import { wrapText } from "../utils";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Tool, StructuredTool } from "langchain/tools";
import { TpaCommandsTool, TpaListAppsTool } from "../tools/TpaCommandsTool";
import { SmartAppControlTool } from "../tools/SmartAppControlTool";
import { AppManagementAgent } from "./AppManagementAgent";

import { ThinkingTool } from "../tools/ThinkingTool";
import { Calculator } from "@langchain/community/tools/calculator";
import { AppServer, PhotoData, GIVE_APP_CONTROL_OF_TOOL_RESPONSE } from "@mentra/sdk";
import { analyzeImage } from "../utils/img-processor.util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  MIRA_SYSTEM_PROMPT,
  ResponseMode,
  RESPONSE_CONFIGS,
  MAX_CONVERSATION_HISTORY,
  MAX_CONVERSATION_AGE_MS
} from "../constant/prompts";

interface QuestionAnswer {
    insight: string;
}

interface ConversationTurn {
  query: string;
  response: string;
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

  public messages: BaseMessage[] = [];
  private conversationHistory: ConversationTurn[] = [];

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
    }
  };

  constructor(cloudUrl: string, userId: string) {
    // Initialize the specialized app management agent
    this.appManagementAgent = new AppManagementAgent(cloudUrl, userId);

    this.agentTools = [
      new SearchToolForAgents(),
      new SmartAppControlTool(cloudUrl, userId),
      // Keep these for backward compatibility or advanced use cases
      new TpaListAppsTool(cloudUrl, userId),
      new TpaCommandsTool(cloudUrl, userId),

      new ThinkingTool(),
      new Calculator(),
    ];

    // Initialize with system timezone as fallback
    this.initializeSystemTimezone();
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
   * Add a conversation turn to history
   */
  private addToConversationHistory(query: string, response: string): void {
    this.conversationHistory.push({
      query,
      response,
      timestamp: Date.now()
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
    } else {
      console.log('[MiraAgent] ❌ No vision keywords detected, checking LLM for follow-up detection...');
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
Follow-up indicators include:
- Pronouns referring to previous content (it, that, those, this, them, he, she, they)
- Temporal references (yesterday, today, tomorrow, later, earlier, before, after, now, then)
- Continuation words (also, too, as well, and, additionally, furthermore)
- Questions about "what about", "how about"
- Implicit context that only makes sense with previous conversation
- References to entities or topics from the previous exchange

Answer with ONLY "YES" if it's a follow-up question that needs context from the previous conversation, or "NO" if it's an independent query.`;

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
        }
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
   */
  private async runTextBasedAgent(
    query: string,
    locationInfo: string,
    notificationsContext: string,
    localtimeContext: string,
    hasPhoto: boolean,
    responseMode: ResponseMode = ResponseMode.QUICK
  ): Promise<{ answer: string; needsCamera: boolean }> {
    // Get configuration for the selected response mode
    const config = RESPONSE_CONFIGS[responseMode];
    console.log(`[Response Mode] Using ${responseMode.toUpperCase()} mode (${config.wordLimit} words, ${config.maxTokens} tokens)`);

    const llm = LLMProvider.getLLM(config.maxTokens).bindTools(this.agentTools);
    const toolNames = this.agentTools.map((tool) => tool.name + ": " + tool.description || "");

    const photoContext = hasPhoto
      ? "IMPORTANT: Your role is to classify the query and determine if it requires visual input. For the 'Needs Camera' flag: set it to TRUE if the query requires visual input from the camera (e.g., 'what is this?', 'how many fingers?', 'what color?', 'describe what you see', 'read this'). Set it to FALSE for general knowledge queries (e.g., 'weather', 'time', 'calculations', 'facts'). If Needs Camera is TRUE, provide a brief acknowledgment as your Final Answer (e.g., 'I can't access the camera at this moment.') - the image analysis will provide the detailed response."
      : "";

    const conversationHistoryText = this.formatConversationHistory();

    const systemPrompt = MIRA_SYSTEM_PROMPT
      .replace("{response_instructions}", config.instructions)
      .replace("{tool_names}", toolNames.join("\n"))
      .replace("{location_context}", locationInfo)
      .replace("{notifications_context}", notificationsContext)
      .replace("{timezone_context}", localtimeContext)
      .replace("{conversation_history}", conversationHistoryText)
      .replace("{photo_context}", photoContext);

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
          const selectedTool = this.agentTools.find(tool => tool.name === toolCall.name);
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
      // Extract required fields from the userContext.
      const transcriptHistory = userContext.transcript_history || "";
      const insightHistory = userContext.insight_history || "";
      let query = userContext.query || "";
      let photo = userContext.photo as PhotoData | null;
      const getPhotoCallback = userContext.getPhotoCallback as (() => Promise<PhotoData | null>) | undefined;

      let turns = 0;

      // If query is empty, return default response.
      if (!query.trim()) {
        return { answer: "No query provided.", needsCamera: false };
      }

      console.log("Query:", query);
      console.log("Query lowercase:", query.toLowerCase());

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
      const responseMode = this.classifyQueryComplexity(query, hasDisplay);
      console.log(`⏱️  [+${Date.now() - startTime}ms] ✅ Response mode selected: ${responseMode.toUpperCase()} (hasDisplay: ${hasDisplay})`);

      // STEP 2: Run text-based agent with appropriate response mode
      console.log(`⏱️  [+${Date.now() - startTime}ms] 🚀 Running text-based classifier...`);
      const textClassifierStart = Date.now();
      const textResult = await this.runTextBasedAgent(query, locationInfo, notificationsContext, localtimeContext, !!photo || !!getPhotoCallback, responseMode);
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
          // Save to conversation history
          this.addToConversationHistory(query, finalResponse);
          return { answer: finalResponse, needsCamera: true };
        } catch (error) {
          console.error('Error in image analysis:', error);
          // Fall back to text answer if image analysis fails
          this.addToConversationHistory(query, textResult.answer);
          return { answer: textResult.answer, needsCamera: textResult.needsCamera };
        }
      }

      // STEP 5: Either no camera needed OR no photo available - return text answer
      const totalDuration = Date.now() - startTime;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`⏱️  [+${totalDuration}ms] 📝 RETURNING TEXT-BASED RESPONSE`);
      console.log(`⏱️  Total processing time: ${(totalDuration / 1000).toFixed(2)}s`);
      console.log(`${"=".repeat(60)}\n`);

      // Save to conversation history
      this.addToConversationHistory(query, textResult.answer);
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
