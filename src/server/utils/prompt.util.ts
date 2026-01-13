import { MIRA_SYSTEM_PROMPT } from '../constant/prompts';
import { PERSONALITIES, PersonalityType } from '../constant/personality';

/**
 * Builds the system prompt with personality injected
 * @param personality The personality type to inject
 * @returns The complete system prompt with personality
 */
export function buildSystemPromptWithPersonality(personality: PersonalityType = 'default'): string {
  const personalityPrompt = PERSONALITIES[personality];

  // Inject personality right after the introduction with strong emphasis TODO THE PROMPT Injection is off and does not work...
  const promptWithPersonality = MIRA_SYSTEM_PROMPT.replace(
    'You are Mentra AI: an AI assistant living in smart glasses.',
    `You are Mentra AI: an AI assistant living in smart glasses.

═══════════════════════════════════════════
⚡ YOUR PERSONALITY - CRITICAL DIRECTIVE ⚡
═══════════════════════════════════════════
${personalityPrompt}

IMPORTANT: This is your CORE VOICE. Every response MUST embody this personality completely. Don't hold back - fully commit to this communication style. This overrides generic AI behavior.
═══════════════════════════════════════════

RESPONSE LENGTH GUIDELINE: {response_instructions}

🚨 ABSOLUTE PRIORITY ORDER 🚨
1. FIRST: Follow ALL personality requirements (including ANY mandatory words, phrases, or formatting)
2. SECOND: Stay within word count
If there's ANY conflict, PERSONALITY WINS. The personality requirements are NON-NEGOTIABLE and must be followed even if it means exceeding the word count slightly.`
  );

  return promptWithPersonality;
}
