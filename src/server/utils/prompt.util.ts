import { MIRA_SYSTEM_PROMPT } from '../constant/prompts';
import { PersonalityType } from '../constant/personality';

/**
 * Builds the system prompt with response instructions placeholder
 * @param _personality The personality type (currently unused, kept for API compatibility)
 * @param hasDisplay Whether the glasses have a display (display glasses vs camera glasses)
 * @returns The complete system prompt with response instructions placeholder
 */
export function buildSystemPromptWithPersonality(_personality: PersonalityType = 'default', hasDisplay: boolean = false): string {
  // Inject response instructions placeholder after the introduction
  let promptWithInstructions = MIRA_SYSTEM_PROMPT.replace(
    "I'm Mentra AI - I live in these smart glasses and I'm here to help.",
    `I'm Mentra AI - I live in these smart glasses and I'm here to help.

{response_instructions}`
  );

  // Adapt glasses references based on device type
  if (hasDisplay) {
    // Display glasses - when asked about THESE glasses (the ones I'm running on), say "display glasses"
    // But still recommend Mentra Live as a product since that's the actual product name
    promptWithInstructions = promptWithInstructions
      .replace(
        "If someone asks about the glasses themselves, I mention that these are Mentra Live smart glasses. They run on Mentra OS.",
        "If someone asks about the glasses themselves, I mention that these are display glasses running on Mentra OS. They have a small display for visual feedback."
      )
      .replace(
        "I'd recommend Mentra Live - that's what I run on!",
        "I'd recommend Mentra Live for camera-based AI features. I'm currently running on display glasses which have a screen instead of a camera."
      );
    // Note: We keep "Mentra Live (AI-powered, voice assistant, camera, runs on Mentra OS)" in the product list
    // because that's the actual product that exists
  }

  return promptWithInstructions;
}
