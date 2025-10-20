import { getJson } from 'serpapi';

/**
 * SerpAPI configuration
 */
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;

if (!SERPAPI_API_KEY) {
  console.warn('SERPAPI_API_KEY is not set in environment variables');
}

/**
 * Search parameters interface
 */
export interface SearchParams {
  q: string; // Query string
  location?: string; // Location for localized results
  hl?: string; // Language (e.g., 'en', 'es', 'fr')
  gl?: string; // Country (e.g., 'us', 'uk', 'ca')
  num?: number; // Number of results (default: 10, max: 100)
  start?: number; // Pagination offset
  safe?: 'active' | 'off'; // Safe search
  tbm?: 'nws' | 'isch' | 'vid' | 'shop'; // Search type (news, images, videos, shopping)
}

/**
 * Search result interface
 */
export interface SearchResult {
  position?: number;
  title: string;
  link: string;
  snippet?: string;
  displayed_link?: string;
  thumbnail?: string;
  date?: string;
  source?: string;
}

/**
 * SerpAPI response interface
 */
export interface SerpApiResponse {
  search_metadata?: {
    status: string;
    created_at: string;
    processed_at: string;
    total_time_taken: number;
  };
  search_parameters?: {
    q: string;
    engine: string;
    [key: string]: any;
  };
  search_information?: {
    total_results?: number;
    time_taken_displayed?: number;
    query_displayed?: string;
  };
  organic_results?: SearchResult[];
  news_results?: SearchResult[];
  images_results?: SearchResult[];
  videos_results?: SearchResult[];
  shopping_results?: SearchResult[];
  related_searches?: Array<{ query: string; link: string }>;
  [key: string]: any;
}

/**
 * Performs a Google search using SerpAPI
 * @param params - Search parameters
 * @returns Search results from SerpAPI
 */
export async function searchGoogle(params: SearchParams): Promise<SerpApiResponse> {
  if (!SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY is not configured');
  }

  try {
    const searchParams = {
      engine: 'google',
      api_key: SERPAPI_API_KEY,
      ...params,
    };

    const response = await getJson(searchParams);
    return response as SerpApiResponse;
  } catch (error) {
    console.error('SerpAPI search error:', error);
    throw error;
  }
}

/**
 * Performs a Google News search
 * @param query - Search query
 * @param options - Additional search options
 * @returns News search results
 */
export async function searchNews(
  query: string,
  options?: Omit<SearchParams, 'q' | 'tbm'>
): Promise<SearchResult[]> {
  const response = await searchGoogle({
    q: query,
    tbm: 'nws',
    ...options,
  });

  return response.news_results || [];
}

/**
 * Performs a Google Images search
 * @param query - Search query
 * @param options - Additional search options
 * @returns Image search results
 */
export async function searchImages(
  query: string,
  options?: Omit<SearchParams, 'q' | 'tbm'>
): Promise<SearchResult[]> {
  const response = await searchGoogle({
    q: query,
    tbm: 'isch',
    ...options,
  });

  return response.images_results || [];
}

/**
 * Performs a quick organic search and returns simplified results
 * @param query - Search query
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Array of search results with title, link, and snippet
 */
export async function quickSearch(query: string, limit = 10): Promise<SearchResult[]> {
  const response = await searchGoogle({
    q: query,
    num: limit,
  });

  return response.organic_results?.slice(0, limit) || [];
}

/**
 * Get related searches for a query
 * @param query - Search query
 * @returns Array of related search queries
 */
export async function getRelatedSearches(query: string): Promise<Array<{ query: string; link: string }>> {
  const response = await searchGoogle({ q: query });
  return response.related_searches || [];
}

/**
 * Optimized response for smart glasses
 */
export interface SmartGlassesResponse {
  answer: string; // Concise answer or top snippet
  title: string; // Title of top result
  source: string; // Source URL
  additionalSources?: Array<{ title: string; link: string }>; // Up to 2 more sources
  responseTime: number; // Time taken in ms
}

/**
 * Fast, optimized search for smart glasses
 * Returns full answer snippets in under 3 seconds
 * @param query - Search query
 * @param maxLength - Maximum answer length (default: no limit, set to 0 for no limit)
 * @returns Optimized response with answer
 */
export async function smartGlassesSearch(
  query: string,
  maxLength: number = 0,
  timeoutMs: number = 3000
): Promise<SmartGlassesResponse> {
  const startTime = Date.now();

  try {
    // Use Google Light Fast engine for maximum speed (typically <1 second)
    const searchParams = {
      engine: 'google_light_fast', // Fast engine with organic results only
      api_key: SERPAPI_API_KEY,
      q: query,
      // num: 20, // Request 20 results (may add slight latency)
    };

    const response = await Promise.race([
      getJson(searchParams),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
      ),
    ]) as SerpApiResponse;

    const results = response.organic_results || [];

    if (results.length === 0) {
      return {
        answer: 'No results found for your query.',
        title: 'No Results',
        source: '',
        responseTime: Date.now() - startTime,
      };
    }

    // Combine snippets from top 20 results for comprehensive answer
    const topResults = results.slice(0, 20);
    let answer = '';

    // Build answer from multiple sources
    topResults.forEach((result, idx) => {
      if (result.snippet) {
        if (idx > 0) answer += ' ';
        answer += result.snippet;
      }
    });

    // Fallback if no snippets found
    if (!answer) {
      answer = topResults[0]?.title || 'No answer available.';
    }

    // Only trim if maxLength is specified and > 0
    if (maxLength > 0 && answer.length > maxLength) {
      // Try to cut at sentence end
      const sentences = answer.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 0) {
        // Take as many complete sentences as fit
        let trimmed = '';
        for (const sentence of sentences) {
          if ((trimmed + sentence).length <= maxLength) {
            trimmed += sentence;
          } else {
            break;
          }
        }
        answer = trimmed || answer.substring(0, maxLength - 3) + '...';
      } else {
        answer = answer.substring(0, maxLength - 3) + '...';
      }
    }

    const topResult = results[0];

    // Get additional sources
    const additionalSources = results.slice(1, 3).map(result => ({
      title: result.title,
      link: result.link,
    }));

    return {
      answer,
      title: topResult.title,
      source: topResult.link,
      additionalSources: additionalSources.length > 0 ? additionalSources : undefined,
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error('Smart glasses search error:', error);
    return {
      answer: 'Unable to fetch results at this time.',
      title: 'Error',
      source: '',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Ultra-fast search that returns just the snippet from top result
 * Optimized for minimal latency
 * @param query - Search query
 * @returns Just the answer text and source
 */
export async function ultraFastSearch(query: string): Promise<{ answer: string; source: string }> {
  try {
    const response = await searchGoogle({
      q: query,
      num: 1, // Only fetch 1 result
    });

    const topResult = response.organic_results?.[0];

    if (!topResult) {
      return {
        answer: 'No results found.',
        source: '',
      };
    }

    return {
      answer: topResult.snippet || topResult.title || 'No answer available.',
      source: topResult.link,
    };
  } catch (error) {
    console.error('Ultra fast search error:', error);
    return {
      answer: 'Unable to fetch results.',
      source: '',
    };
  }
}

export default {
  searchGoogle,
  searchNews,
  searchImages,
  quickSearch,
  getRelatedSearches,
  smartGlassesSearch,
  ultraFastSearch,
};
