/**
 * Jina AI Search Test
 *
 * Tests Jina AI search for smart glasses
 * Run with: bun src/test/jina-search-test.ts
 */

// Get Jina API key from environment
const JINA_API_KEY = process.env.JINA_API_KEY || "";

interface JinaSearchOptions {
  q: string; // Query
  location?: string; // Optional location
  timeout?: number; // Timeout in seconds (default: 1)
  maxChars?: number; // Max characters to return (truncate if longer)
  numResults?: number; // Number of results to return (default: 5)
  includeContent?: boolean; // Include article content preview (default: false)
}

/**
 * Search using Jina AI
 * @param options - Search options
 * @returns Search results as text
 */
async function jinaSearch(options: JinaSearchOptions): Promise<string> {
  const startTime = Date.now();

  if (!JINA_API_KEY) {
    throw new Error('JINA_API_KEY is not configured. Set it in your .env file');
  }

  try {
    // Build the search URL
    const searchParams = new URLSearchParams();
    searchParams.append('q', options.q);

    if (options.location) {
      searchParams.append('location', options.location);
    }

    const searchUrl = `https://s.jina.ai/?${searchParams.toString()}`;

    console.log(`\n🔍 Searching: ${options.q}`);
    console.log('─'.repeat(60));

    // Build headers based on options
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${JINA_API_KEY}`,
      'X-Retain-Images': 'none',
      'X-Timeout': String(options.timeout || 1), // Fast timeout
    };

    // If includeContent is true, fetch full content for articles
    if (options.includeContent) {
      headers['X-Respond-With'] = 'markdown'; // Get full content
      headers['X-With-Generated-Alt'] = 'true';
    } else {
      headers['X-Respond-With'] = 'no-content'; // Just snippets (faster)
    }

    // Limit number of results
    if (options.numResults) {
      headers['X-Max-Results'] = String(options.numResults);
    }

    // Make the API call with optimized settings
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Jina API error: ${response.status} ${response.statusText}`);
    }

    let result = await response.text();
    const elapsed = Date.now() - startTime;

    // Truncate if needed
    if (options.maxChars && result.length > options.maxChars) {
      result = result.substring(0, options.maxChars) + '... [truncated]';
    }

    console.log(`📝 Result length: ${result.length} characters`);
    console.log(`⏱️  Time: ${elapsed}ms`);
    console.log('─'.repeat(60));
    console.log('\n📄 Content:\n');
    console.log(result);
    console.log('\n' + '─'.repeat(60));

    return result;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Error after ${elapsed}ms:`, error);
    throw error;
  }
}

/**
 * Simple search and profile function with detailed timing
 */
async function searchAndProfile(query: string, location?: string) {
  const startTime = Date.now();

  try {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║         JINA AI SEARCH PROFILE                       ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`\n🔍 Query: "${query}"`);
    if (location) {
      console.log(`📍 Location: ${location}`);
    }
    console.log('─'.repeat(60));
    console.log('⏳ Starting search...\n');

    const result = await jinaSearch({
      q: query,
      location,
      timeout: 1, // 1 second timeout for speed
      numResults: 10, // Get 10 results
      includeContent: false, // Just snippets - MUCH faster
      maxChars: 10000 // Reasonable limit for smart glasses
    });

    const totalTime = Date.now() - startTime;

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║         PERFORMANCE SUMMARY                          ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`⏱️  Total Time: ${totalTime}ms`);
    console.log(`📊 Result Length: ${result.length} characters`);
    console.log(`🚀 Speed: ${(result.length / totalTime * 1000).toFixed(0)} chars/second`);

    if (totalTime < 1000) {
      console.log('✅ STATUS: EXCELLENT (< 1 second)');
    } else if (totalTime < 2000) {
      console.log('✅ STATUS: GOOD (< 2 seconds)');
    } else if (totalTime < 3000) {
      console.log('⚠️  STATUS: ACCEPTABLE (< 3 seconds)');
    } else {
      console.log('❌ STATUS: SLOW (> 3 seconds)');
    }
    console.log('─'.repeat(60));

    return {
      query,
      result,
      length: result.length,
      totalTime,
    };
  } catch (error) {
    const failTime = Date.now() - startTime;
    console.error(`\n❌ Search failed after ${failTime}ms:`, error);
    throw error;
  }
}

/**
 * Compare Jina vs SerpAPI speeds
 */
async function compareSearchEngines(query: string) {
  console.log('\n\n=== Comparing Search Engines ===\n');
  console.log(`Query: "${query}"\n`);

  // Test Jina
  console.log('1️⃣  Testing Jina AI...');
  const jinaStart = Date.now();
  try {
    const jinaResult = await jinaSearch({ q: query, timeout: 3 });
    const jinaTime = Date.now() - jinaStart;
    console.log(`✅ Jina completed in ${jinaTime}ms`);
    console.log(`   Result length: ${jinaResult.length} chars\n`);
  } catch (error) {
    console.error('❌ Jina failed:', error);
  }

  // Note: You can add SerpAPI comparison here if needed
  console.log('─'.repeat(60));
}

/**
 * Test different query types
 */
async function testDifferentQueries() {
  console.log('\n=== Testing Different Query Types ===\n');

  const queries = [
    { q: 'What is artificial intelligence?', desc: 'General knowledge' },
    { q: 'Who is the president of USA?', desc: 'Current events' },
    { q: 'weather in San Francisco', desc: 'Location-based', location: 'San Francisco, CA' },
    { q: 'latest news on OpenAI', desc: 'News query' },
  ];

  for (const query of queries) {
    console.log(`\n📌 ${query.desc}`);
    await jinaSearch({
      q: query.q,
      location: query.location,
      timeout: 2
    });

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Test with location context
 */
async function testLocationSearch() {
  console.log('\n=== Testing Location-Based Search ===\n');

  const query = 'best coffee shops near me';
  const location = 'San Francisco, CA';

  await jinaSearch({
    q: query,
    location,
    timeout: 3
  });
}

// Main execution
async function main() {
  console.log('🔍 Starting Jina AI Search Tests');
  console.log('Make sure JINA_API_KEY is set in your .env file!\n');

  try {
    // Simple test
    await searchAndProfile('Which company faced a widespread outage recently that disrupted many major apps worldwide?');

    // Uncomment to run more tests:
    // await testDifferentQueries();
    // await testLocationSearch();
    // await compareSearchEngines('What was the major tech conference that skipped its usual location this year, and why did it move? Politico');

    console.log('\n\n✅ All tests completed!');
  } catch (error) {
    console.error('\n❌ Tests failed:', error);
  }
}

// Run the tests
main();
