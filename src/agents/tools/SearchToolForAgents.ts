// SearchTool.ts

import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  logger as _logger
} from '@mentra/sdk';

// Get Jina API key from environment
// Get your Jina AI API key for free: https://jina.ai/?sui=apikey
export const JINA_API_KEY = process.env.JINA_API_KEY || "";
const PACKAGE_NAME = process.env.PACKAGE_NAME;

// Define the input schema using zod
const SearchInputSchema = z.object({
  searchKeyword: z.string().describe('The search query or keywords to search for'),
  location: z.string().optional().describe('Optional city-level location context for the search, if known, as "city, state code"'),
  numResults: z.number().optional().describe('Number of search results to return (default: 10)'),
  maxChars: z.number().optional().describe('Maximum characters in response (default: 3000)'),
});

// Type for the search input based on the schema
type SearchInput = z.infer<typeof SearchInputSchema>;

/**
 * SearchToolForAgents is a StructuredTool that searches the web using Jina AI's search API.
 * It provides LLM-friendly search results for any query.
 *
 * To call this tool, pass an object with the following format:
 * {
 *   "searchKeyword": "your search query",
 *   "location": "San Francisco, CA"  // optional
 * }
 *
 * The tool returns LLM-friendly search results as a text string.
 */
export class SearchToolForAgents extends StructuredTool {
  name = 'Search_Engine';
  description = 'Searches the web for information about a given query using Jina AI. Pass specific queries and/or keywords to quickly search the web and retrieve information on any topic like academic research, history, entertainment, current events. This tool does NOT work for personal information and does NOT work for math. Input: { "searchKeyword": string, "location"?: string }';
  schema = SearchInputSchema;

  constructor() {
    super();
    if (!JINA_API_KEY) {
      console.warn('JINA_API_KEY is not set. Search functionality may not work.');
    }
  }

  /**
   * Searches the web using Jina AI's search API (optimized for speed)
   * @param input - Object with searchKeyword (required), location, numResults, and maxChars (optional)
   * @returns Promise<string> - The LLM-friendly search results from Jina
   */
  async _call(input: SearchInput): Promise<string> {
    const startTime = Date.now();
    const { searchKeyword, location, numResults = 10, maxChars = 3000 } = input;

    console.log("JINA IS WORKING")
    const logger = _logger.child({app: PACKAGE_NAME});
    logger.debug("[SearchToolForAgents.ts] Running...")

    // Validate that we have an API key
    if (!JINA_API_KEY) {
      return 'Error: JINA_API_KEY is not configured. Please set the JINA_API_KEY environment variable. Get your Jina AI API key for free: https://jina.ai/?sui=apikey';
    }

    try {
      // Build the search URL
      const searchParams = new URLSearchParams();
      searchParams.append('q', searchKeyword);

      // Add location if provided
      if (location && location.trim() !== '') {
        searchParams.append('location', location.trim());
      }

      const searchUrl = `https://s.jina.ai/?${searchParams.toString()}`;

      console.log(`[SearchToolForAgents] Searching: ${searchUrl}`);

      // Build optimized headers for speed
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${JINA_API_KEY}`,
        'X-Retain-Images': 'none', // Skip images for speed
        'X-Timeout': '1', // 1 second timeout for fast results
        'X-Respond-With': 'no-content', // Fast mode - just snippets
      };

      // Limit number of results if specified
      if (numResults && numResults > 0) {
        headers['X-Max-Results'] = String(numResults);
      }

      // Make the API call with optimized settings
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Jina API responded with status ${response.status}: ${response.statusText}`);
      }

      // Get the response text (Jina returns LLM-friendly content)
      let responseText = await response.text();

      if (!responseText || responseText.trim() === '') {
        return `No search results found for "${searchKeyword}".`;
      }

      // Truncate if needed for smart glasses optimization
      if (maxChars && responseText.length > maxChars) {
        responseText = responseText.substring(0, maxChars) + '\n\n... [Results truncated for brevity]';
      }

      const elapsed = Date.now() - startTime;

      // Performance profiling
      console.log(`\n╔════════════════════════════════════════════════════════╗`);
      console.log(`║         JINA SEARCH PERFORMANCE                      ║`);
      console.log(`╚════════════════════════════════════════════════════════╝`);
      console.log(`🔍 Query: "${searchKeyword}"`);
      console.log(`⏱️  Time: ${elapsed}ms`);
      console.log(`📊 Results: ${numResults} requested`);
      console.log(`📝 Length: ${responseText.length} characters`);
      console.log(`🚀 Speed: ${(responseText.length / elapsed * 1000).toFixed(0)} chars/second`);

      if (elapsed < 1000) {
        console.log(`✅ STATUS: EXCELLENT (< 1 second)`);
      } else if (elapsed < 2000) {
        console.log(`✅ STATUS: GOOD (< 2 seconds)`);
      } else if (elapsed < 3000) {
        console.log(`⚠️  STATUS: ACCEPTABLE (< 3 seconds)`);
      } else {
        console.log(`❌ STATUS: SLOW (> 3 seconds)`);
      }
      console.log(`${'─'.repeat(60)}\n`);

      logger.debug(`[SearchToolForAgents] Search completed in ${elapsed}ms, ${responseText.length} chars`);

      // Return the response from Jina (already LLM-friendly)
      return responseText;

    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`Error during Jina search for "${searchKeyword}" after ${elapsed}ms:`, error);
      return `Error occurred while searching for "${searchKeyword}": ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}
