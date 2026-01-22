/**
 * Cancellation Decider
 * Determines if the user wants to cancel their current prompt/query
 * Uses AI-powered detection for accurate intent recognition
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

export class CancellationDecider {
  /**
   * AI-powered affirmative phrase detection
   * Uses LLM to determine if a phrase is a conversational acknowledgment
   * that indicates the user wants to END the conversation
   */
  public async isAffirmativePhraseAI(text: string): Promise<boolean> {
    try {
      const llm = LLMProvider.getLLM(50);

      const prompt = `Analyze if this user phrase is a COMPLETE conversational acknowledgment/affirmative response (like "thank you", "okay", "got it") that indicates they want to END the conversation.

CRITICAL: INCOMPLETE PHRASES are NOT affirmative - they are likely the START of a longer sentence.

User phrase: "${text}"

Return ONLY "yes" or "no".

Examples of AFFIRMATIVE (yes):
- "thank you" → yes (complete acknowledgment)
- "okay" → yes (complete acknowledgment)
- "got it" → yes (complete acknowledgment)
- "sounds good" → yes (complete acknowledgment)
- "perfect" → yes (complete acknowledgment)
- "thanks so much" → yes (complete acknowledgment)
- "alright" → yes (complete acknowledgment)
- "ok thanks" → yes (complete acknowledgment)

Examples of NOT AFFIRMATIVE (no):
- "no thank you" → no (polite decline)
- "uh no thanks" → no (decline)
- "nah thanks" → no (decline)
- "not really" → no (decline)
- "what time is it" → no (new query)
- "how do I cancel" → no (new query)
- "cancel that" → no (cancellation command)
- "stop" → no (cancellation command)
- "you got" → no (INCOMPLETE - likely "you got to..." or "you got it wrong")
- "you got to" → no (INCOMPLETE - user is mid-sentence)
- "i got" → no (INCOMPLETE - likely "I got a question" or "I got to...")
- "i want" → no (INCOMPLETE - user is starting a request)
- "you need" → no (INCOMPLETE - user is mid-sentence)
- "let me" → no (INCOMPLETE - user is starting a sentence)
- "i think" → no (INCOMPLETE - user is sharing thoughts)

Answer:`;

      const response = await llm.invoke(prompt);
      const answer = response.content.toString().toLowerCase().trim();

      const isAffirmative = answer === 'yes';
      console.log(`🤖 AI affirmative detection: "${text}" → ${isAffirmative ? 'YES' : 'NO'} (raw: "${answer}")`);

      return isAffirmative;
    } catch (error) {
      console.error(`❌ AI affirmative detection failed:`, error);
      // On error, default to not affirmative (safer to continue processing)
      return false;
    }
  }

  /**
   * AI-powered cancellation detection
   * Uses LLM to determine if a phrase is a cancellation command
   */
  public async isCancellationPhraseAI(text: string): Promise<boolean> {
    try {
      const llm = LLMProvider.getLLM(50);

      const prompt = `Analyze if this user phrase is a CANCELLATION COMMAND that means they want to STOP or CANCEL the current conversation/action with the AI assistant.

IMPORTANT: The user is talking to an AI assistant named "Mentra" or "Mira". A cancellation command means they want to ABORT the current request to the assistant.

User phrase: "${text}"

Return ONLY "yes" or "no".

Examples of CANCELLATION (yes) - user wants to stop/abort the current request:
- "cancel" → yes (clear cancellation command)
- "stop" → yes (clear cancellation command)
- "never mind" → yes (user changed their mind)
- "nevermind" → yes (user changed their mind)
- "forget it" → yes (user wants to abort)
- "um cancel" → yes (cancellation with filler word)
- "uh stop" → yes (cancellation with filler word)
- "no no" → yes (emphatic cancellation)
- "quit" → yes (cancellation)
- "shut up" → yes (rude but clear cancellation)
- "cancel that" → yes (cancellation command)
- "stop that" → yes (cancellation command)
- "abort" → yes (cancellation command)

Examples of NOT CANCELLATION (no) - user is asking a question or making a request:
- "cancer" → no (medical term, NOT cancellation)
- "how do I cancel my subscription" → no (asking for help with a task)
- "can you help me cancel my appointment" → no (asking for assistance)
- "help me cancel my reservation" → no (requesting help with cancellation task)
- "I need to cancel my doctor's appointment" → no (telling assistant about a task)
- "can I cancel this order" → no (asking a question)
- "should I cancel my trip" → no (asking for advice)
- "what is cancer" → no (medical question)
- "tell me about cancellation policies" → no (information request)
- "thank you" → no (affirmative acknowledgment)
- "okay" → no (affirmative acknowledgment)
- "yes" → no (affirmative response)
- "sure" → no (affirmative response)
- "what time is it" → no (new query)
- "stop by the store" → no (request about stopping somewhere, not cancellation)
- "don't forget to remind me" → no (request, not cancellation)

Answer:`;

      const response = await llm.invoke(prompt);
      const answer = response.content.toString().toLowerCase().trim();

      const isCancellation = answer === 'yes';
      console.log(`🤖 AI cancellation detection: "${text}" → ${isCancellation ? 'YES' : 'NO'} (raw: "${answer}")`);

      return isCancellation;
    } catch (error) {
      console.error(`❌ AI cancellation detection failed:`, error);
      // On error, default to not cancellation (safer to continue processing)
      return false;
    }
  }

  /**
   * AI-powered cancellation check for wake-word mode
   * Uses LLM to determine if the user wants to cancel OR if they're asking a legitimate question
   * @param query - The user's transcription (after wake word is removed)
   * @returns CancellationDecision.CANCEL or CancellationDecision.CONTINUE
   */
  async checkIfWantsToCancelAsync(query: string): Promise<CancellationDecision> {
    // First check if this is an affirmative phrase (highest priority)
    const isAffirmative = await this.isAffirmativePhraseAI(query);
    if (isAffirmative) {
      console.log(`✅ CancellationDecider (async): "${query}" -> CONTINUE (AI detected affirmative)`);
      return CancellationDecision.CONTINUE;
    }

    // Use AI to determine if this is a cancellation command
    const isCancellation = await this.isCancellationPhraseAI(query);
    if (isCancellation) {
      console.log(`🚫 CancellationDecider (async): "${query}" -> CANCEL (AI detected)`);
      return CancellationDecision.CANCEL;
    }

    console.log(`✅ CancellationDecider (async): "${query}" -> CONTINUE (AI determined not cancellation)`);
    return CancellationDecision.CONTINUE;
  }

  /**
   * Context-aware cancellation check for follow-up mode
   * Uses AI-powered detection for both affirmative phrases and cancellation commands
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

    // Use AI-powered cancellation detection
    const isCancellation = await this.isCancellationPhraseAI(query);
    if (isCancellation) {
      console.log(`🚫 CancellationDecider (follow-up): "${query}" -> CANCEL (AI detected cancellation)`);
      return {
        decision: CancellationDecision.CANCEL,
        isAffirmative: false,
      };
    }

    // Default to CONTINUE in follow-up mode (more lenient)
    console.log(`✅ CancellationDecider (follow-up): "${query}" -> CONTINUE (default)`);
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
