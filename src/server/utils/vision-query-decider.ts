/**
 * Vision Query Decider
 * Uses AI to determine if a query requires camera/vision capabilities
 */

import { GoogleGenAI } from '@google/genai';

export enum VisionDecision {
  YES = 'yes',
  NO = 'no',
  UNSURE = 'unsure',
}

const VISION_DECISION_PROMPT = `You are a query classifier for smart glasses with a camera.

Determine if the user's query requires looking at something through the camera.

DEFINITELY REQUIRES CAMERA (respond "YES"):
- Asking about something they're looking at: "what is this", "tell me about this", "what am i looking at"
- Asking to read/translate visible text: "read this", "translate that sign", "what does it say"
- Asking to identify something: "identify this", "what brand is this", "who is this"
- Asking to fix/diagnose something visible: "what's wrong with this", "how do i fix this", "why isn't this working"
- Asking how to use something they're looking at: "how do i use this", "how does this work"
- Asking about colors, counts, sizes of visible things: "what color is this", "how many are there"
- Asking to identify visible surroundings/landmarks: "what building is this", "what store is that", "what restaurant is this"
- Asking for price, name, or info about "this" or "that" object: "what's the price of this", "tell me the plant", "the price of this"
- ANY query containing "this" or "that" when asking about physical properties (price, name, type, brand, color, size) = YES

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

AMBIGUOUS - COULD GO EITHER WAY (respond "UNSURE"):
- Vague questions that MIGHT refer to something visible: "what am I working on"
- "where am I" - could want GPS location OR want to identify visible surroundings
- ONLY use UNSURE when truly ambiguous - when in doubt and query mentions "this"/"that", prefer YES

IMPORTANT: If query asks about price, name, type, brand, identification of "this" or "that" - respond YES, not UNSURE

CRITICAL - Detecting follow-up questions:
- If conversation context is provided, check if the query references topics from previous messages
- Pronouns like "it", "they", "that", "those" may refer to something mentioned in conversation, NOT something visible
- Example: If previous conversation discussed "Nike shoes", then "what else do they make?" refers to Nike, not something visible
- Incomplete fragments like "with X", "about Y", "and what else" are follow-ups needing conversation context, NOT camera
- Questions asking about "the previous", "my last", "what I said/asked" need conversation context

{conversationContext}

Query: "{query}"

Respond with ONLY one word: "YES", "NO", or "UNSURE".`;

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
   * Determine if a query requires camera/vision
   * Returns YES, NO, or UNSURE
   * @param query - The user's query
   * @param conversationHistory - Optional recent conversation for context
   */
  async checkIfNeedsCamera(query: string, conversationHistory?: ConversationMessage[]): Promise<VisionDecision> {
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
      } else if (result === 'UNSURE' || result.startsWith('UNSURE')) {
        return VisionDecision.UNSURE;
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
        // Has demonstrative but no clear vision action - could be ambiguous
        return VisionDecision.UNSURE;
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
