/**
 * Cancellation Decider
 * Determines if the user wants to cancel their current prompt/query
 * Uses fast keyword matching with fuzzy detection for noisy transcriptions
 * Plus AI-powered affirmative phrase detection for better accuracy
 */

import { LLMProvider } from '../manager/llm.manager';

export enum CancellationDecision {
  CANCEL = 'cancel',     // User wants to cancel
  CONTINUE = 'continue', // Continue processing
}

/**
 * Result from cancellation check with additional context
 */
export interface CancellationResult {
  decision: CancellationDecision;
  isAffirmative: boolean; // True if the phrase was detected as an affirmative acknowledgment
}


/**
 * Phrases that should NOT be considered cancellation even if they contain cancel words
 * These are legitimate queries that happen to contain cancel-like words
 */
const nonCancellationPatterns = [
  /how (do i|to|can i) cancel/i,           // "how do I cancel my subscription"
  /cancel my (subscription|order|booking)/i,
  /what does .* cancel/i,                   // "what does the cancel button do"
  /stop (the|my|a) (timer|alarm|music)/i,  // "stop the timer"
  /stop playing/i,                          // "stop playing music"
  /ignore (the|my|this|that) (error|warning|notification)/i,
  /never mind (the|my|this|that)/i,        // "never mind the details" - asking to skip something specific

  // Affirmative acknowledgment phrases - natural responses that should NOT cancel
  // These are common after Mira provides information, especially in follow-up mode
  /^(ok|okay|alright|thanks|thank you|thanx|thx|ty)$/i,
  /^(ok|okay|alright)\s+(thanks|thank you|thanx|thx|ty)$/i,
  /^(thank you|thanks|thanx|thx)\s+(so much|very much)$/i,
  /^sounds (good|great|perfect|nice)$/i,
  /^(got it|understood|i understand|makes sense|that works|perfect)$/i,
  /^(yes|yeah|yep|yup|sure|of course|absolutely)\s+(thank you|thanks|thanx|thx)$/i,
];

export class CancellationDecider {
  /**
   * Clean and normalize text for matching
   */
  private cleanText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[.,!?;:'"-]/g, '') // remove punctuation
      .replace(/\s+/g, ' ')        // normalize whitespace
      .trim();
  }

  /**
   * Check if query is a legitimate non-cancellation query
   */
  private isNonCancellationQuery(text: string): boolean {
    for (const pattern of nonCancellationPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if text is an affirmative/acknowledgment phrase
   * These should never be treated as cancellation
   */
  public isAffirmativePhrase(text: string): boolean {
    const cleanedText = this.cleanText(text);

    // CRITICAL: Check for negation words that invalidate affirmative phrases
    // "no thank you", "nah thanks", etc. are NOT affirmative
    const negationPatterns = [
      /^(no|nope|nah|naw)\s+(thank|thanks|thank you|thanx|thx)/i,
      /^(uh|um|uhh|umm)?\s*(no|nope|nah|naw)\s+(thank|thanks|thank you|thanx|thx)/i,
    ];

    for (const pattern of negationPatterns) {
      if (pattern.test(cleanedText)) {
        console.log(`❌ isAffirmativePhrase: "${text}" contains negation - NOT affirmative`);
        return false;
      }
    }

    // Exact match phrases (must be the entire transcription)
    const exactMatchPhrases = [
      'ok', 'okay', 'alright', 'thanks', 'thank you', 'thanx', 'thx', 'ty',
      'got it', 'understood', 'perfect',
    ];

    // Phrases that can appear at the start or anywhere in the text
    const flexiblePhrases = [
      'ok thanks', 'ok thank you', 'okay thanks', 'okay thank you',
      'alright thanks', 'alright thank you',
      'thank you so much', 'thanks so much', 'thank you very much', 'thanks very much',
      'sounds good', 'sounds great', 'sounds perfect', 'sounds nice',
      'i understand', 'makes sense', 'that works',
      'yes thank you', 'yeah thanks', 'yep thanks', 'sure thanks',
      'yes thanks', 'yeah thank you', 'sure thank you',
    ];

    // Check exact matches first
    for (const phrase of exactMatchPhrases) {
      if (cleanedText === phrase) {
        return true;
      }
    }

    // Check flexible matches (can be at start or contained)
    for (const phrase of flexiblePhrases) {
      if (cleanedText.includes(phrase)) {
        return true;
      }
    }

    return false;
  }

  /**
   * AI-powered affirmative phrase detection
   * Uses LLM to determine if a phrase is a conversational acknowledgment
   * that indicates the user wants to END the conversation
   */
  public async isAffirmativePhraseAI(text: string): Promise<boolean> {
    try {
      const llm = LLMProvider.getLLM(50);

      const prompt = `Analyze if this user phrase is a conversational acknowledgment/affirmative response (like "thank you", "okay", "got it") that indicates they want to END the conversation.

User phrase: "${text}"

Return ONLY "yes" or "no".

Examples:
- "thank you" → yes
- "okay" → yes
- "got it" → yes
- "sounds good" → yes
- "perfect" → yes
- "no thank you" → no (polite decline, not acknowledgment)
- "uh no thanks" → no (decline)
- "nah thanks" → no (decline)
- "not really" → no (decline)
- "what time is it" → no (new query)
- "how do I cancel" → no (new query)
- "cancel that" → no (cancellation command)
- "stop" → no (cancellation command)

Answer:`;

      const response = await llm.invoke(prompt);
      const answer = response.content.toString().toLowerCase().trim();

      const isAffirmative = answer === 'yes';
      console.log(`🤖 AI affirmative detection: "${text}" → ${isAffirmative ? 'YES' : 'NO'} (raw: "${answer}")`);

      return isAffirmative;
    } catch (error) {
      console.error(`❌ AI affirmative detection failed, falling back to regex:`, error);
      // Fallback to regex-based detection
      return this.isAffirmativePhrase(text);
    }
  }



  /**
   * Determine if the user wants to cancel their query
   * @param query - The user's transcription
   * @returns CancellationDecision.CANCEL or CancellationDecision.CONTINUE
   *
   * Note: This is the synchronous version for wake-word mode.
   * For better accuracy in follow-up mode, use checkIfWantsToCancelInFollowUpMode()
   */
  checkIfWantsToCancel(query: string): CancellationDecision {
    // First check if this is an affirmative phrase (highest priority)
    if (this.isAffirmativePhrase(query)) {
      console.log(`✅ CancellationDecider: "${query}" -> CONTINUE (affirmative phrase)`);
      return CancellationDecision.CONTINUE;
    }

    // Check if this is a legitimate query that contains cancel words
    if (this.isNonCancellationQuery(query)) {
      console.log(`🚫 CancellationDecider: "${query}" -> CONTINUE (non-cancellation pattern)`);
      return CancellationDecision.CONTINUE;
    }

    // Check for OBVIOUS cancellation phrases only
    // We use a stricter check to avoid false positives with words like "sure", "ok", etc.
    if (this.isObviousCancellation(query)) {
      console.log(`🚫 CancellationDecider: "${query}" -> CANCEL (obvious)`);
      return CancellationDecision.CANCEL;
    }

    console.log(`🚫 CancellationDecider: "${query}" -> CONTINUE`);
    return CancellationDecision.CONTINUE;
  }

  /**
   * Quick check for obvious cancellation - used for immediate response
   * Only returns true for very clear cancellation phrases
   */
  isObviousCancellation(query: string): boolean {
    const cleanedText = this.cleanText(query);

    const obviousPhrases = [
      'stop', 'cancel', 'never mind', 'nevermind', 'quit',
      'abort', 'no no', 'stop stop', 'forget it', 'shut up',
    ];

    for (const phrase of obviousPhrases) {
      if (cleanedText === phrase || cleanedText.startsWith(phrase + ' ')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Context-aware cancellation check for follow-up mode
   * More lenient than checkIfWantsToCancel - only detects obvious cancellations
   * Use this in follow-up mode to avoid false positives from affirmative responses
   * Uses AI-powered affirmative phrase detection for better accuracy
   * Returns both the decision and whether it was an affirmative phrase
   */
  async checkIfWantsToCancelInFollowUpMode(query: string): Promise<CancellationResult> {
    // Use AI-powered affirmative detection in follow-up mode
    const isAffirmative = await this.isAffirmativePhraseAI(query);
    if (isAffirmative) {
      console.log(`✅ CancellationDecider (follow-up): "${query}" -> CONTINUE (AI detected affirmative)`);
      return {
        decision: CancellationDecision.CONTINUE,
        isAffirmative: true,
      };
    }

    // Non-cancellation queries are safe
    if (this.isNonCancellationQuery(query)) {
      console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CONTINUE (non-cancellation)`);
      return {
        decision: CancellationDecision.CONTINUE,
        isAffirmative: false,
      };
    }

    // In follow-up mode, only flag OBVIOUS cancellations (no fuzzy matching)
    // This prevents false positives from natural responses
    if (this.isObviousCancellation(query)) {
      console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CANCEL (obvious)`);
      return {
        decision: CancellationDecision.CANCEL,
        isAffirmative: false,
      };
    }

    // Default to CONTINUE in follow-up mode (more lenient)
    console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CONTINUE (default)`);
    return {
      decision: CancellationDecision.CONTINUE,
      isAffirmative: false,
    };
  }
}

// Singleton instance for reuse
let deciderInstance: CancellationDecider | null = null;

export function getCancellationDecider(): CancellationDecider {
  if (!deciderInstance) {
    deciderInstance = new CancellationDecider();
  }
  return deciderInstance;
}
