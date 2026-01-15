/**
 * Recall Memory Decider
 * Uses AI to determine if a query needs to access conversation history
 */

import { GoogleGenAI } from '@google/genai';

export enum RecallDecision {
  RECALL = 'recall', // Query needs memory access
  CONTINUE = 'continue', // Continue to vision decider
}

const RECALL_DECISION_PROMPT = `You are a query classifier for a smart assistant with conversation memory.

Determine if the user's query is asking about or referring to something from a PREVIOUS CONVERSATION.

CRITICAL - VISION QUERIES SHOULD NEVER RECALL (respond "CONTINUE"):
- Any query with "this" or "that" referring to something PHYSICAL the user is looking at
- "solve this equation", "read this", "what is this", "identify that" = CONTINUE (needs camera)
- "how do I use this", "fix this", "translate that sign" = CONTINUE (needs camera)
- If "this"/"that" refers to a visible object, equation, sign, text, etc. = CONTINUE
- Queries about CURRENT physical environment: "what am I working on", "what am I looking at", "what's in front of me" = CONTINUE
- These are asking about WHAT THEY SEE RIGHT NOW, not about past conversation = CONTINUE

DEFINITELY NEEDS MEMORY RECALL (respond "RECALL"):
- Asking about previous question/response: "what did I ask", "what did you say", "my last question"
- Asking to repeat/remind: "remind me", "repeat that", "say that again"
- Referencing past conversation: "what were we talking about", "earlier you mentioned", "you said before"
- Going back to previous topic: "back to the X we discussed", "the thing I previously asked about"
- Using "previously" or "earlier" with conversation reference: "I previously asked", "we talked about earlier"
- Referencing something mentioned before: "the equation I mentioned", "that thing we discussed"
- Any query with "previously talked about", "we discussed", "I mentioned", "you told me"
- Questions about "the previous", "my last", "what I said/asked"
- Follow-up on earlier topic using words like "back to", "returning to", "about that X"

DOES NOT NEED MEMORY RECALL (respond "CONTINUE"):
- Questions about something visible/physical: "what is this", "read this sign", "identify that", "solve this"
- General knowledge questions: "what is photosynthesis", "who was Einstein"
- Current tasks: "set a timer", "what's the weather", "play music"
- Greetings: "hi", "hello", "what's up"
- Questions that don't reference past conversation
- "tell me more" without clear reference to conversation (ambiguous, continue)

IMPORTANT CONTEXT CLUES:
- "previously", "earlier", "before" + conversation verb (asked, said, mentioned, discussed) = RECALL
- "back to the [noun]" when referring to conversation topic = RECALL
- "that [noun] I/we" when referencing past discussion = RECALL
- "this/that" + physical object (equation, sign, item, food, plant) = CONTINUE (vision query)

{conversationContext}

Query: "{query}"

Respond with ONLY one word: "RECALL" or "CONTINUE".`;

// Simple type for conversation messages
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class RecallMemoryDecider {
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
   * Fast pre-check for obvious recall patterns before calling LLM
   * Returns RECALL for clear memory queries, CONTINUE for vision queries, null to continue to LLM
   */
  private fastRecallCheck(query: string): RecallDecision | null {
    const queryLower = query.toLowerCase();

    // IMPORTANT: First check if this is clearly a VISION query - these should NEVER go to RECALL
    // Vision queries contain "this"/"that" referring to something physical the user is looking at
    // OR queries about what the user is currently looking at / working on / seeing
    const visionPatterns = [
      /\b(what|solve|read|identify|translate|look at|see|describe)\b.*\b(this|that)\b/i,
      /\b(this|that)\b.*\b(equation|sign|text|object|thing|item|product|plant|food)\b/i,
      /what is (this|that)\b/i,
      /what kind of .* is (this|that)/i,
      /how (do i|to) (use|fix|solve) (this|that)/i,
      // Queries about current physical environment - need camera
      /what am i (working on|looking at|seeing|doing)/i,
      /what('s| is) in front of (me|you)/i,
      /what('s| is) (around me|near me|beside me)/i,
      /tell me what (i'm|i am) (looking at|seeing|working on)/i,
      /could you tell me what (am i|i'm|i am) (working on|looking at)/i,
    ];

    for (const pattern of visionPatterns) {
      if (pattern.test(queryLower)) {
        console.log(`🧠 RecallMemoryDecider: "${query}" -> CONTINUE (fast check: vision pattern detected)`);
        return RecallDecision.CONTINUE;
      }
    }

    // Clear recall patterns
    if (/what did (i|you) (just )?(ask|say|mention)/i.test(queryLower)) {
      console.log(`🧠 RecallMemoryDecider: "${query}" -> RECALL (fast check: what did I/you ask/say)`);
      return RecallDecision.RECALL;
    }

    if (/my (last|previous) (question|query)/i.test(queryLower)) {
      console.log(`🧠 RecallMemoryDecider: "${query}" -> RECALL (fast check: my last/previous question)`);
      return RecallDecision.RECALL;
    }

    if (/repeat that|say that again/i.test(queryLower)) {
      console.log(`🧠 RecallMemoryDecider: "${query}" -> RECALL (fast check: repeat/say again)`);
      return RecallDecision.RECALL;
    }

    if (/previously (talked|asked|mentioned|discussed|said)/i.test(queryLower)) {
      console.log(`🧠 RecallMemoryDecider: "${query}" -> RECALL (fast check: previously + verb)`);
      return RecallDecision.RECALL;
    }

    if (/back to the .+ (i|we) (talked|asked|mentioned|discussed)/i.test(queryLower)) {
      console.log(`🧠 RecallMemoryDecider: "${query}" -> RECALL (fast check: back to the X we discussed)`);
      return RecallDecision.RECALL;
    }

    return null; // Continue to LLM check
  }

  /**
   * Determine if a query needs memory recall
   * Returns RECALL or CONTINUE
   * @param query - The user's query
   * @param conversationHistory - Optional recent conversation for context
   */
  async checkIfNeedsRecall(query: string, conversationHistory?: ConversationMessage[]): Promise<RecallDecision> {
    // Fast pre-check for obvious recall patterns (saves LLM call)
    const fastResult = this.fastRecallCheck(query);
    if (fastResult !== null) {
      return fastResult;
    }

    try {
      const contextString = this.formatConversationContext(conversationHistory);
      const prompt = RECALL_DECISION_PROMPT
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
      console.log(`🧠 RecallMemoryDecider: "${query}" -> ${result}${conversationHistory?.length ? ` (with ${conversationHistory.length} messages context)` : ''}`);

      if (result === 'RECALL' || result.startsWith('RECALL')) {
        return RecallDecision.RECALL;
      } else {
        return RecallDecision.CONTINUE;
      }
    } catch (error) {
      console.error('RecallMemoryDecider error:', error);
      // Fallback to keyword-based detection on error
      return this.fallbackKeywordCheck(query);
    }
  }

  /**
   * Fallback keyword-based check if AI fails
   */
  private fallbackKeywordCheck(query: string): RecallDecision {
    const queryLower = query.toLowerCase();

    const recallPhrases = [
      'what did i ask', 'what did i say', 'what was my question',
      'my last question', 'my previous question', 'remind me',
      'repeat that', 'say that again', 'what did you say',
      'what were we talking about', 'earlier you mentioned',
      'previously talked about', 'we discussed', 'go back to',
    ];

    for (const phrase of recallPhrases) {
      if (queryLower.includes(phrase)) {
        return RecallDecision.RECALL;
      }
    }

    return RecallDecision.CONTINUE;
  }
}

// Singleton instance for reuse
let deciderInstance: RecallMemoryDecider | null = null;

export function getRecallMemoryDecider(): RecallMemoryDecider {
  if (!deciderInstance) {
    deciderInstance = new RecallMemoryDecider();
  }
  return deciderInstance;
}
