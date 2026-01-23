import { MIRA_SYSTEM_PROMPT } from '../constant/prompts';
import { PersonalityType } from '../constant/personality';

/**
 * Builds the system prompt with response instructions placeholder
 * @param _personality The personality type (currently unused, kept for API compatibility)
 * @returns The complete system prompt with response instructions placeholder
 */
export function buildSystemPromptWithPersonality(_personality: PersonalityType = 'default'): string {
  // Inject response instructions placeholder after the introduction
  const promptWithInstructions = MIRA_SYSTEM_PROMPT.replace(
    "I'm Mentra AI - I live in these smart glasses and I'm here to help.",
    `I'm Mentra AI - I live in these smart glasses and I'm here to help.

{response_instructions}`
  );

  return promptWithInstructions;
}
