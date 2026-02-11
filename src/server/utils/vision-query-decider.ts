/**
 * Vision Query Decider
 * Uses AI to determine if a query requires camera/vision capabilities
 */

import { GoogleGenAI } from '@google/genai';

export enum VisionDecision {
  YES = 'yes',
  NO = 'no',
}

const VISION_DECISION_PROMPT = `You are a query classifier for smart glasses with a camera.

Determine if the user's query requires looking at something through the camera.

DEFINITELY REQUIRES CAMERA (respond "YES"):
- Asking about something they're looking at: "what is this", "tell me about this", "what am i looking at"
- Asking what something looks like: "what does this look like", "what does the food look like", "what does X look like", "how does this look", "how does X look"
- Asking to read/translate visible text: "read this", "translate that sign", "what does it say"
- Asking to identify something: "identify this", "what brand is this", "who is this"
- Asking to fix/diagnose something visible: "what's wrong with this", "how do i fix this", "why isn't this working"
- Asking how to use something they're looking at: "how do i use this", "how does this work"
- Asking about colors, counts, sizes of visible things: "what color is this", "how many are there"
- Asking to identify visible surroundings/landmarks using "this"/"that": "what building is this", "what store is that", "what restaurant is this" (NOT "what is restaurant X" which asks about a named place)
- Asking for price, name, or info about "this" or "that" object: "what's the price of this", "tell me the plant", "the price of this"
- ANY query containing "this" or "that" when asking about physical properties (price, name, type, brand, color, size, appearance) = YES
- "what am I working on", "what am I doing" - user is wearing smart glasses, so they likely mean what's visible = YES
- "where am I" - could want to identify visible surroundings = YES
- When in doubt and the query COULD be about something physical in the user's environment = YES

DEFINITELY DOES NOT REQUIRE CAMERA (respond "NO"):
- Greetings and casual conversation: "hi", "hello", "hey", "what's up", "how are you", "good morning", "yo", "sup"
- General knowledge questions: "what is photosynthesis", "who was Einstein"
- Personal assistant tasks: "set a timer", "what's the weather", "play music"
- Questions about the AI itself: "what can you do", "who are you"
- Abstract discussions: "tell me a joke", "what do you think about..."
- Calendar/reminder tasks: "remind me to...", "what's on my schedule"
- Chitchat and small talk: "how's it going", "what's new", "thanks", "thank you", "bye", "goodbye"
- Questions about conversation history or memory: "what did I just ask", "what did I say", "what was my last question", "repeat that", "say that again", "what were we talking about", "remind me what I asked"
- GPS/location questions (NOT about visible surroundings): "what's my current location", "where am I right now", "what city am I in", "what's my address", "give me my coordinates"
- Follow-up questions that clearly reference previous conversation topics (see conversation context below)
- Questions about NAMED/SPECIFIC entities: "what is restaurant X", "tell me about place Y", "where is store Z located" - these are asking about a known business/place BY NAME, not asking to identify something visible
- Questions asking for info about a specific named business/place: "what is Starbucks", "where is Papito's", "what is restaurant Rapido" = NO (they're asking about something by name, not looking at it)

IMPORTANT: If query asks about price, name, type, brand, identification of "this" or "that" - respond YES
IMPORTANT: When in doubt, prefer YES. The user is wearing smart glasses with a camera - if there's any reasonable chance they're asking about something in their environment, use the camera.

CRITICAL - Detecting follow-up questions:
- If conversation context is provided, check if the query references topics from previous messages
- Pronouns like "it", "they", "that", "those" may refer to something mentioned in conversation, NOT something visible
- Example: If previous conversation discussed "Nike shoes", then "what else do they make?" refers to Nike, not something visible
- Incomplete fragments like "with X", "about Y", "and what else" are follow-ups needing conversation context, NOT camera
- Questions asking about "the previous", "my last", "what I said/asked" need conversation context

{conversationContext}

Query: "{query}"

Respond with ONLY one word: "YES" or "NO".`;

// Simple type for conversation messages
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class VisionQueryDecider {
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
   * Fast pre-check for obvious vision patterns before calling LLM
   * Returns YES for clear vision queries, NO for ambiguous, null to continue to LLM
   */
  private fastVisionCheck(query: string): VisionDecision | null {
    const queryLower = query.toLowerCase();

    // Clear vision patterns - "what is this", "what kind of X is this"
    if (/what\s+(is|kind|type|sort|brand|color|price)\b.*\bthis\b/i.test(queryLower) ||
        /\bthis\b.*what\s+(is|kind|type|sort|brand|color|price)/i.test(queryLower)) {
      console.log(`🤖 VisionQueryDecider: "${query}" -> YES (fast check: what X is this)`);
      return VisionDecision.YES;
    }

    // "read this", "look at this", "see this"
    if (/\b(read|look at|see|identify|translate)\s+(this|that)\b/i.test(queryLower)) {
      console.log(`🤖 VisionQueryDecider: "${query}" -> YES (fast check: action + this/that)`);
      return VisionDecision.YES;
    }

    // CLEAR vision patterns - "what am I looking at", "what am I seeing"
    // These are asking about what's visible through the camera RIGHT NOW
    if (/what am i (looking at|seeing)\b/i.test(queryLower)) {
      console.log(`🤖 VisionQueryDecider: "${query}" -> YES (fast check: what am I looking at/seeing)`);
      return VisionDecision.YES;
    }

    // Ambiguous patterns - "what am I working on", "what am I doing"
    // Could be about visible work or abstract task - default to YES (use camera)
    if (/what am i (working on|doing)\b/i.test(queryLower)) {
      console.log(`🤖 VisionQueryDecider: "${query}" -> YES (fast check: what am I working/doing)`);
      return VisionDecision.YES;
    }

    return null; // Continue to LLM check
  }

  /**
   * Determine if a query requires camera/vision
   * Returns YES or NO
   * @param query - The user's query
   * @param conversationHistory - Optional recent conversation for context
   */
  async checkIfNeedsCamera(query: string, conversationHistory?: ConversationMessage[]): Promise<VisionDecision> {
    // Fast pre-check for obvious vision patterns (saves LLM call)
    const fastResult = this.fastVisionCheck(query);
    if (fastResult !== null) {
      return fastResult;
    }

    try {
      const contextString = this.formatConversationContext(conversationHistory);
      const prompt = VISION_DECISION_PROMPT
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
      console.log(`🤖 VisionQueryDecider: "${query}" -> ${result}${conversationHistory?.length ? ` (with ${conversationHistory.length} messages context)` : ''}`);

      if (result === 'YES' || result.startsWith('YES')) {
        return VisionDecision.YES;
      } else {
        return VisionDecision.NO;
      }
    } catch (error) {
      console.error('VisionQueryDecider error:', error);
      // Fallback to keyword-based detection on error
      return this.fallbackKeywordCheck(query);
    }
  }

  /**
   * Legacy method for backwards compatibility
   * Returns true only for definite YES
   */
  async needsCamera(query: string): Promise<boolean> {
    const decision = await this.checkIfNeedsCamera(query);
    return decision === VisionDecision.YES;
  }

  /**
   * Fallback keyword-based check if AI fails
   */
  private fallbackKeywordCheck(query: string): VisionDecision {
    const queryLower = query.toLowerCase();

    // Strong indicators that definitely need camera
    const strongVisionWords = [
      'look at', 'looking at', 'see this', 'see that', 'read this', 'read that',
      'identify', 'what color', 'what colour', 'translate this', 'translate that'
    ];
    for (const phrase of strongVisionWords) {
      if (queryLower.includes(phrase)) {
        return VisionDecision.YES;
      }
    }

    // "what is this", "what kind of X is this", "what type is this" patterns - always vision
    if (/what\s+(is|kind|type|sort|brand|color|price)\b.*\bthis\b/i.test(queryLower) ||
        /\bthis\b.*what\s+(is|kind|type|sort|brand|color|price)/i.test(queryLower)) {
      return VisionDecision.YES;
    }

    // Check for demonstrative pronouns with vision action words
    const demonstratives = ['this', 'that', 'these', 'those'];
    const visionActions = ['fix', 'solve', 'diagnose', 'wrong', 'broken', 'use', 'work'];

    for (const demo of demonstratives) {
      const demoRegex = new RegExp(`\\b${demo}\\b`, 'i');
      if (demoRegex.test(queryLower)) {
        for (const action of visionActions) {
          if (queryLower.includes(action)) {
            return VisionDecision.YES;
          }
        }
        // Has demonstrative but no clear vision action - default to YES (use camera when in doubt)
        return VisionDecision.YES;
      }
    }

    // No strong indicators
    return VisionDecision.NO;
  }
}

// Singleton instance for reuse
let deciderInstance: VisionQueryDecider | null = null;

export function getVisionQueryDecider(): VisionQueryDecider {
  if (!deciderInstance) {
    deciderInstance = new VisionQueryDecider();
  }
  return deciderInstance;
}
