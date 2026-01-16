/**
 * Cancellation Decider
 * Determines if the user wants to cancel their current prompt/query
 * Uses fast keyword matching with fuzzy detection for noisy transcriptions
 */

import { cancellationPhrases } from '../constant/wakeWords';

export enum CancellationDecision {
  CANCEL = 'cancel',     // User wants to cancel
  CONTINUE = 'continue', // Continue processing
}

/**
 * Extended cancellation phrases for more comprehensive detection
 * Includes variations and phonetic mishears
 */
const extendedCancellationPhrases = [
  // Original phrases from wakeWords.ts
  ...cancellationPhrases,

  // Additional explicit cancel phrases
  'stop it', 'stop that', 'stop stop', 'stop please',
  'cancel that', 'cancel it', 'cancel please',
  'forget it', 'forget that', 'forget about it',
  'skip it', 'skip that', 'skip this',
  'abort', 'abort that', 'abort it',
  'quit', 'quit it', 'quit that',
  'no no no', 'no no', 'nope', 'no wait',
  'hold on', 'wait wait', 'wait stop',
  'shut up', 'be quiet', 'quiet',
  'enough', 'that\'s enough', 'thats enough',
  'stop listening', 'stop talking',
  'i changed my mind', 'changed my mind',
  'actually no', 'actually never mind', 'actually nevermind',
  'scratch that', 'take that back',
  'oops', 'whoops', 'my bad', 'sorry no',
  'wrong', 'that\'s wrong', 'thats wrong',
  'not what i wanted', 'not what i meant',
  'i didn\'t mean that', 'i didnt mean that',
  'don\'t do that', 'dont do that',
  'please stop', 'just stop',

  // Phonetic variations / mishears
  'never mine', 'never mined', 'ever mind',
  'cancle', 'cancell', 'councell',
  'stopp', 'stahp', 'staph',
  'ignore it', 'ignore this',
  'dismiss', 'dismiss that', 'dismissed',
];

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
   * Calculate similarity between two strings (simple Levenshtein-based)
   * Returns value between 0 and 1
   */
  private similarity(s1: string, s2: string): number {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const costs: number[] = [];
    for (let i = 0; i <= shorter.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= longer.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (shorter[i - 1] !== longer[j - 1]) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[longer.length] = lastValue;
    }

    return (longer.length - costs[longer.length]) / longer.length;
  }

  /**
   * Check if the text contains a cancellation phrase with fuzzy matching
   */
  private hasCancellationPhrase(text: string): boolean {
    const cleanedText = this.cleanText(text);

    // Exact match first
    for (const phrase of extendedCancellationPhrases) {
      const cleanedPhrase = this.cleanText(phrase);
      if (cleanedText.includes(cleanedPhrase)) {
        return true;
      }
    }

    // Fuzzy match for short phrases (to catch transcription errors)
    // Only do fuzzy matching if the text is short (likely just a cancellation phrase)
    if (cleanedText.split(' ').length <= 4) {
      for (const phrase of extendedCancellationPhrases) {
        const cleanedPhrase = this.cleanText(phrase);
        // Check if the entire text is similar to a cancellation phrase
        if (this.similarity(cleanedText, cleanedPhrase) > 0.8) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Determine if the user wants to cancel their query
   * @param query - The user's transcription
   * @returns CancellationDecision.CANCEL or CancellationDecision.CONTINUE
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

    // Check for cancellation phrases
    if (this.hasCancellationPhrase(query)) {
      console.log(`🚫 CancellationDecider: "${query}" -> CANCEL`);
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
   */
  checkIfWantsToCancelInFollowUpMode(query: string): CancellationDecision {
    // Affirmative phrases are ALWAYS safe in follow-up mode
    if (this.isAffirmativePhrase(query)) {
      console.log(`✅ CancellationDecider (follow-up): "${query}" -> CONTINUE (affirmative)`);
      return CancellationDecision.CONTINUE;
    }

    // Non-cancellation queries are safe
    if (this.isNonCancellationQuery(query)) {
      console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CONTINUE (non-cancellation)`);
      return CancellationDecision.CONTINUE;
    }

    // In follow-up mode, only flag OBVIOUS cancellations (no fuzzy matching)
    // This prevents false positives from natural responses
    if (this.isObviousCancellation(query)) {
      console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CANCEL (obvious)`);
      return CancellationDecision.CANCEL;
    }

    // Default to CONTINUE in follow-up mode (more lenient)
    console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CONTINUE (default)`);
    return CancellationDecision.CONTINUE;
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
