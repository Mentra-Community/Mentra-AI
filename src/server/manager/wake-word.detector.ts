import { explicitWakeWords, cancellationPhrases } from '../constant/wakeWords';

/**
 * Handles wake word detection and text cleaning
 */
export class WakeWordDetector {
  /**
   * Clean text by lowercasing and removing punctuation
   */
  cleanText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[.,!?;:]/g, '') // remove all punctuation
      .replace(/\s+/g, ' ')     // normalize whitespace
      .trim();
  }

  /**
   * Check if text contains a wake word
   */
  hasWakeWord(text: string): boolean {
    const cleanedText = this.cleanText(text);
    return explicitWakeWords.some(word => cleanedText.includes(word));
  }

  /**
   * Check if text contains a cancellation phrase
   */
  isCancellation(text: string): boolean {
    const cleanedText = this.cleanText(text);
    return cancellationPhrases.some(phrase => cleanedText.includes(phrase));
  }

  /**
   * Check if text ends with a wake word
   */
  endsWithWakeWord(text: string): boolean {
    const cleanedText = this.cleanText(text);
    return explicitWakeWords.some(word => {
      // Build a regex to match the wake word at the end, allowing for punctuation/whitespace
      const pattern = new RegExp(`${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');
      return pattern.test(cleanedText);
    });
  }

  /**
   * Remove wake word from the input text
   */
  removeWakeWord(text: string): string {
    // Escape each wake word for regex special characters
    const escapedWakeWords = explicitWakeWords.map(word =>
      word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    // Build patterns that allow for spaces, commas, or periods between the words
    // IMPORTANT: Use word boundary (\b) to prevent matching partial words like "the" as "he"
    const wakePatterns = escapedWakeWords.map(word =>
      '\\b' + word.split(' ').join('[\\s,\\.]*') + '\\b'
    );
    // Create a regex that removes everything from the start until (and including) a wake word
    const wakeRegex = new RegExp(`.*?(?:${wakePatterns.join('|')})[\\s,\\.!]*`, 'i');
    return text.replace(wakeRegex, '').trim();
  }
}
