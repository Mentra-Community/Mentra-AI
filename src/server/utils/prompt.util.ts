import { MIRA_SYSTEM_PROMPT } from '../constant/prompts';
import { PERSONALITIES, PersonalityType } from '../constant/personality';

/**
 * Builds the system prompt with personality injected
 * @param personality The personality type to inject
 * @returns The complete system prompt with personality
 */
export function buildSystemPromptWithPersonality(personality: PersonalityType = 'default'): string {
  const personalityPrompt = PERSONALITIES[personality];

  // Inject personality after the main introduction
  const promptWithPersonality = MIRA_SYSTEM_PROMPT.replace(
    'You are Mentra AI: a helpful, professional, and concise AI assistant living in smart glasses.',
    `You are Mentra AI: a helpful, professional, and concise AI assistant living in smart glasses.

PERSONALITY DIRECTIVE:
${personalityPrompt}

You must adopt this personality style in all your responses while maintaining your core role as Mentra AI.`
  );

  return promptWithPersonality;
}
