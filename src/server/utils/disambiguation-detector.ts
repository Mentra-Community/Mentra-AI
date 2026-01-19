/**
 * AI-Powered Disambiguation Detector
 * Uses AI to determine if a response is asking the user to choose between multiple options
 * (e.g., multiple apps with similar names)
 */

import { GoogleGenAI } from '@google/genai';

export interface DisambiguationCandidate {
  name: string;
  packageName?: string;
  description?: string;
}

export interface DisambiguationResult {
  isDisambiguation: boolean;
  candidates: DisambiguationCandidate[];
  reasoning: string;
}

const DISAMBIGUATION_DETECTION_PROMPT = `You are analyzing an AI assistant's response to determine if it's asking the user to choose between multiple similar options (disambiguation).

EXAMPLES OF DISAMBIGUATION RESPONSES (should return isDisambiguation: true):
- "I found multiple apps with similar names. Which one would you like: 'Mentra Notes' or 'Mentra Notes [Dev Aryan]'?"
- "Please choose between 'App A' or 'App B' so I can open the correct one."
- "Which version would you like to use: the regular 'Camera' app or 'Camera Pro'?"
- "There are two options: 'Spotify' and 'Spotify Lite'. Which one?"
- "Did you mean 'Instagram' or 'Instagram Lite'?"

EXAMPLES OF NON-DISAMBIGUATION RESPONSES (should return isDisambiguation: false):
- "I've opened Mentra Notes for you."
- "Sorry, I couldn't find an app matching your request."
- "The weather today is sunny with a high of 75°F."
- "I don't have access to that feature."
- "Sure, I can help you with that. What would you like to know?"

Analyze the following AI response and determine:
1. Is this a disambiguation response asking the user to choose between options?
2. If yes, extract ALL the option names mentioned (app names, versions, etc.)

AI Response to analyze:
"{response}"

Respond with ONLY valid JSON in this exact format (no extra text):
{
  "isDisambiguation": true/false,
  "candidates": ["Name 1", "Name 2", ...],
  "reasoning": "Brief explanation"
}

If not a disambiguation, use empty candidates array: {"isDisambiguation": false, "candidates": [], "reasoning": "..."}`;

export class DisambiguationDetector {
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
   * Detect if a response is asking for disambiguation and extract candidates
   * @param response - The AI assistant's response text
   * @returns DisambiguationResult with isDisambiguation flag and candidate names
   */
  async detectDisambiguation(response: string): Promise<DisambiguationResult> {
    // Quick pre-check: if response is very short or doesn't contain question-like patterns, skip AI
    if (response.length < 30 || (!response.includes('?') && !response.includes('which') && !response.includes('choose'))) {
      return {
        isDisambiguation: false,
        candidates: [],
        reasoning: 'Response too short or lacks question patterns'
      };
    }

    try {
      const prompt = DISAMBIGUATION_DETECTION_PROMPT.replace('{response}', response);

      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          maxOutputTokens: 200,
          temperature: 0,
        },
      });

      const responseText = result.text?.trim() || '';
      console.log(`🔍 [DisambiguationDetector] Raw AI response: ${responseText}`);

      // Parse the JSON response
      try {
        // Clean up the response - sometimes AI adds markdown code blocks
        let cleanedResponse = responseText;
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanedResponse = jsonMatch[0];
        }

        const parsed = JSON.parse(cleanedResponse);

        // Convert string array to DisambiguationCandidate array
        const candidates: DisambiguationCandidate[] = (parsed.candidates || []).map((name: string) => ({
          name: name.trim(),
          packageName: '', // Will be filled later by MiraAgent
        }));

        const result: DisambiguationResult = {
          isDisambiguation: Boolean(parsed.isDisambiguation),
          candidates,
          reasoning: parsed.reasoning || ''
        };

        console.log(`🔍 [DisambiguationDetector] Result: isDisambiguation=${result.isDisambiguation}, candidates=${result.candidates.map(c => c.name).join(', ')}`);
        return result;
      } catch (parseError) {
        console.error('🔍 [DisambiguationDetector] Failed to parse AI response:', parseError);
        return {
          isDisambiguation: false,
          candidates: [],
          reasoning: 'Failed to parse AI response'
        };
      }
    } catch (error) {
      console.error('🔍 [DisambiguationDetector] Error:', error);
      // Fallback to simple pattern matching on error
      return this.fallbackPatternCheck(response);
    }
  }

  /**
   * Fallback pattern-based check if AI fails
   */
  private fallbackPatternCheck(response: string): DisambiguationResult {
    const responseLower = response.toLowerCase();

    // Check for disambiguation indicators
    const hasDisambiguationIndicator =
      responseLower.includes('which one') ||
      responseLower.includes('which would you') ||
      responseLower.includes('choose between') ||
      responseLower.includes('multiple apps') ||
      responseLower.includes('did you mean');

    if (!hasDisambiguationIndicator) {
      return {
        isDisambiguation: false,
        candidates: [],
        reasoning: 'Fallback: No disambiguation indicators found'
      };
    }

    // Try to extract quoted names
    const quotedNames = response.match(/'([^']+)'/g);
    if (quotedNames && quotedNames.length >= 2) {
      const candidates = quotedNames.map(q => ({
        name: q.replace(/'/g, ''),
        packageName: ''
      }));
      return {
        isDisambiguation: true,
        candidates,
        reasoning: 'Fallback: Extracted quoted names'
      };
    }

    return {
      isDisambiguation: false,
      candidates: [],
      reasoning: 'Fallback: Could not extract candidates'
    };
  }
}

// Singleton instance for reuse
let detectorInstance: DisambiguationDetector | null = null;

export function getDisambiguationDetector(): DisambiguationDetector {
  if (!detectorInstance) {
    detectorInstance = new DisambiguationDetector();
  }
  return detectorInstance;
}
