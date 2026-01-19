/**
 * App Tool Query Decider
 * Uses AI to determine if a query is intended for an app tool
 */

import { GoogleGenAI } from '@google/genai';

export enum AppToolDecision {
  APP_TOOL = 'app_tool',   // User wants to use an app tool
  NO_TOOL = 'no_tool',     // General conversation, no tool needed
  UNSURE = 'unsure',       // Ambiguous - ask user for clarification
}

// Tool info passed to the decider
export interface ToolInfo {
  name: string;
  description: string;
  activationPhrases?: string[];
}

// Simple type for conversation messages
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const APP_TOOL_DECISION_PROMPT = `You are a query classifier for a smart assistant with app tools.

Determine if the user's query is requesting to use one of the available app tools.

{availableToolsSection}

DEFINITELY WANTS APP TOOL (respond "APP_TOOL"):
- Explicitly mentions an action that matches a tool: "start recording", "take a note", "add a reminder"
- Uses activation phrases similar to those listed above
- Clearly wants to perform an app-specific action: "record this conversation", "save this as a note"
- Asks to list/show/get app data: "show my notes", "list reminders", "what notes do I have"
- Wants to manage app data: "delete that note", "remove the reminder"

DEFINITELY NOT FOR APP TOOL (respond "NO_TOOL"):
- Greetings and casual conversation: "hi", "hello", "how are you", "what's up"
- General knowledge questions: "what is photosynthesis", "who was Einstein", "explain quantum physics"
- Questions about the AI itself: "what can you do", "who are you", "what are you"
- Built-in assistant tasks without app tools: "what's the weather", "what time is it"
- Abstract discussions: "tell me a joke", "what do you think about...", "let's chat"
- Vision/camera queries: "what is this", "what am I looking at", "read this"
- Thank you / closings: "thanks", "thank you", "bye", "goodbye"

AMBIGUOUS (respond "UNSURE"):
- Could be interpreted as either an app action or general question
- Mentions something that MIGHT relate to a tool but isn't explicit
- Example: "notes" alone (could be asking about notes concept OR wanting to use notes app)
- Example: "remember" (could be a memory question OR wanting to save something)

{conversationContext}

Query: "{query}"

Respond with ONLY one word: "APP_TOOL", "NO_TOOL", or "UNSURE".`;

export class AppToolQueryDecider {
  private ai: GoogleGenAI;
  private model: string = 'gemini-2.0-flash';

  constructor() {
    const apiKey = process.env.GEMENI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMENI_API_KEY environment variable is required');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Format available tools into a string for the prompt
   */
  private formatAvailableTools(tools?: ToolInfo[]): string {
    if (!tools || tools.length === 0) {
      return 'AVAILABLE APP TOOLS: (no app tools currently available)';
    }

    const toolLines = tools.map(tool => {
      const phrases = tool.activationPhrases?.length
        ? ` (phrases: "${tool.activationPhrases.join('", "')}")`
        : '';
      return `- ${tool.name}: ${tool.description}${phrases}`;
    });

    return `AVAILABLE APP TOOLS:\n${toolLines.join('\n')}`;
  }

  /**
   * Format conversation history into a string for the prompt
   * Only includes last 4 messages to keep prompt short
   */
  private formatConversationContext(history?: ConversationMessage[]): string {
    if (!history || history.length === 0) {
      return 'Recent conversation context: (no previous messages)';
    }

    // Take last 4 messages max
    const recentMessages = history.slice(-4);
    const formatted = recentMessages
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.slice(0, 150)}${msg.content.length > 150 ? '...' : ''}`)
      .join('\n');

    return `Recent conversation context:\n${formatted}`;
  }

  /**
   * Fast pre-check for obvious app tool patterns before calling LLM
   * Returns APP_TOOL, NO_TOOL, or null to continue to LLM
   */
  private fastAppToolCheck(query: string): AppToolDecision | null {
    const queryLower = query.toLowerCase().trim();

    // ============ DEFINITELY APP_TOOL ============

    // Recording actions
    if (/\b(start|stop|begin|end|pause|resume) recording\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: recording action)`);
      return AppToolDecision.APP_TOOL;
    }

    // Note actions
    if (/\b(take|make|add|create|save|write) (a )?(note|memo)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: note action)`);
      return AppToolDecision.APP_TOOL;
    }

    // "note that" pattern
    if (/^note that\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: note that)`);
      return AppToolDecision.APP_TOOL;
    }

    // Reminder actions
    if (/\b(add|create|set|make) (a )?(reminder|alert)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: reminder action)`);
      return AppToolDecision.APP_TOOL;
    }

    // "remind me" pattern
    if (/^remind me\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: remind me)`);
      return AppToolDecision.APP_TOOL;
    }

    // List/show app data
    if (/\b(list|show|get|display|what are) (my |all )?(notes|reminders|recordings|memos)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: list app data)`);
      return AppToolDecision.APP_TOOL;
    }

    // Delete/remove app data
    if (/\b(delete|remove|clear) (the |my |that )?(note|reminder|recording|memo)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: delete app data)`);
      return AppToolDecision.APP_TOOL;
    }

    // Mark reminder complete/incomplete
    if (/\b(mark|complete|finish|done|check off) .*(reminder|task)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: mark reminder)`);
      return AppToolDecision.APP_TOOL;
    }

    // New conversation in notes app
    if (/\b(new|start|begin) (a )?(conversation|session)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: new conversation)`);
      return AppToolDecision.APP_TOOL;
    }

    // Search conversation history (notes app)
    if (/\bsearch (my )?(conversation|history|notes)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> APP_TOOL (fast check: search history)`);
      return AppToolDecision.APP_TOOL;
    }

    // ============ DEFINITELY NO_TOOL ============

    // Greetings
    if (/^(hi|hello|hey|yo|sup|what's up|how are you|good morning|good afternoon|good evening|howdy)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: greeting)`);
      return AppToolDecision.NO_TOOL;
    }

    // General knowledge questions
    if (/^(what is|who is|who was|what are|explain|define|tell me about|describe) [a-z]/i.test(queryLower) &&
        !/\b(this|that|my|the)\b.*\b(note|reminder|recording)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: general knowledge)`);
      return AppToolDecision.NO_TOOL;
    }

    // Built-in assistant tasks (not app tools)
    if (/^(what('s| is) the (weather|time|date)|set a timer|play music|what time is it)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: built-in task)`);
      return AppToolDecision.NO_TOOL;
    }

    // Thank you / closings
    if (/^(thanks?|thank you|bye|goodbye|see you|later|good night)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: closing)`);
      return AppToolDecision.NO_TOOL;
    }

    // Questions about the AI
    if (/^(what can you do|who are you|what are you|are you)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: about AI)`);
      return AppToolDecision.NO_TOOL;
    }

    // Vision queries (handled by VisionQueryDecider)
    if (/\b(what is this|what's this|what am i looking at|read this|identify this|what do you see)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: vision query)`);
      return AppToolDecision.NO_TOOL;
    }

    // Jokes and abstract requests
    if (/^(tell me a joke|make me laugh|say something funny|let's chat)\b/i.test(queryLower)) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (fast check: casual request)`);
      return AppToolDecision.NO_TOOL;
    }

    return null; // Continue to LLM check
  }

  /**
   * Determine if a query is requesting an app tool
   * Returns APP_TOOL, NO_TOOL, or UNSURE
   * @param query - The user's query
   * @param availableTools - List of available tools with their info
   * @param conversationHistory - Optional recent conversation for context
   */
  async checkIfNeedsAppTool(
    query: string,
    availableTools?: ToolInfo[],
    conversationHistory?: ConversationMessage[]
  ): Promise<AppToolDecision> {
    // Fast pre-check for obvious patterns (saves LLM call)
    const fastResult = this.fastAppToolCheck(query);
    if (fastResult !== null) {
      return fastResult;
    }

    // If no tools available, definitely no tool needed
    if (!availableTools || availableTools.length === 0) {
      console.log(`🔧 AppToolDecider: "${query}" -> NO_TOOL (no tools available)`);
      return AppToolDecision.NO_TOOL;
    }

    try {
      const toolsSection = this.formatAvailableTools(availableTools);
      const contextString = this.formatConversationContext(conversationHistory);
      const prompt = APP_TOOL_DECISION_PROMPT
        .replace('{availableToolsSection}', toolsSection)
        .replace('{conversationContext}', contextString)
        .replace('{query}', query);

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          maxOutputTokens: 10,
          temperature: 0,
        },
      });

      const result = response.text?.trim().toUpperCase() || '';
      console.log(`🔧 AppToolDecider: "${query}" -> ${result}${conversationHistory?.length ? ` (with ${conversationHistory.length} messages context)` : ''}`);

      if (result === 'APP_TOOL' || result.startsWith('APP_TOOL')) {
        return AppToolDecision.APP_TOOL;
      } else if (result === 'UNSURE' || result.startsWith('UNSURE')) {
        return AppToolDecision.UNSURE;
      } else {
        return AppToolDecision.NO_TOOL;
      }
    } catch (error) {
      console.error('AppToolQueryDecider error:', error);
      // Fallback to keyword-based detection on error
      return this.fallbackKeywordCheck(query);
    }
  }

  /**
   * Fallback keyword-based check if AI fails
   */
  private fallbackKeywordCheck(query: string): AppToolDecision {
    const queryLower = query.toLowerCase();

    // Strong indicators for app tools
    const appToolPhrases = [
      'start recording', 'stop recording', 'take a note', 'take note',
      'add reminder', 'set reminder', 'remind me', 'list notes',
      'show notes', 'my notes', 'my reminders', 'delete note',
      'remove reminder', 'new conversation', 'search conversation'
    ];

    for (const phrase of appToolPhrases) {
      if (queryLower.includes(phrase)) {
        return AppToolDecision.APP_TOOL;
      }
    }

    // Strong indicators for no tool
    const noToolPhrases = [
      'hello', 'hi ', 'hey ', 'what is', 'who is', 'explain',
      'tell me about', 'weather', 'time', 'thank', 'bye',
      'what can you', 'who are you', 'tell me a joke'
    ];

    for (const phrase of noToolPhrases) {
      if (queryLower.includes(phrase) || queryLower.startsWith(phrase)) {
        return AppToolDecision.NO_TOOL;
      }
    }

    // Default to NO_TOOL for safety (don't invoke tools unnecessarily)
    return AppToolDecision.NO_TOOL;
  }
}

// Singleton instance for reuse
let deciderInstance: AppToolQueryDecider | null = null;

export function getAppToolQueryDecider(): AppToolQueryDecider {
  if (!deciderInstance) {
    deciderInstance = new AppToolQueryDecider();
  }
  return deciderInstance;
}
