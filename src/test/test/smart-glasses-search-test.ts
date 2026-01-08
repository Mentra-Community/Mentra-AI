/**
 * Smart Glasses Search Test
 *
 * Tests the optimized search functions for smart glasses
 * Run with: bun src/test/smart-glasses-search-test.ts
 */

import { smartGlassesSearch, ultraFastSearch } from '../server/utils/serpapi';

/**
 * Simple function to search and profile timing
 * @param query - The search query
 * @returns Object with answer, source, and time taken
 */
async function searchAndProfile(query: string) {
  const startTime = Date.now();

  try {
    // Call without maxLength to get full snippet
    const result = await smartGlassesSearch(query);
    const totalTime = Date.now() - startTime;

    console.log('\n🔍 Query:', query);
    console.log('─'.repeat(60));
    console.log('📝 Answer:', result.answer);
    console.log('🔗 Source:', result.source);
    console.log('⏱️  Search API Time:', result.responseTime + 'ms');
    console.log('⏱️  Total Time:', totalTime + 'ms');
    console.log('─'.repeat(60));

    return {
      query,
      answer: result.answer,
      source: result.source,
      apiTime: result.responseTime,
      totalTime,
    };
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function testSmartGlassesSearch() {
  console.log('\n=== Smart Glasses Search Test ===\n');

  const queries = [
    'What is the weather in San Francisco',
    'Who won the latest Super Bowl',
    'What time does Apple store close',
    'How tall is Mount Everest',
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    console.log('─'.repeat(50));

    try {
      const result = await smartGlassesSearch(query, 150);

      console.log(`Answer: ${result.answer}`);
      console.log(`Source: ${result.title}`);
      console.log(`Link: ${result.source}`);
      console.log(`Response Time: ${result.responseTime}ms`);

      if (result.additionalSources && result.additionalSources.length > 0) {
        console.log('\nAdditional Sources:');
        result.additionalSources.forEach((src, idx) => {
          console.log(`  ${idx + 1}. ${src.title}`);
        });
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

async function testUltraFastSearch() {
  console.log('\n\n=== Ultra Fast Search Test ===\n');

  const queries = [
    'OpenAI GPT',
    'Python programming',
    'Machine learning basics',
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    console.log('─'.repeat(50));

    try {
      const startTime = Date.now();
      const result = await ultraFastSearch(query);
      const duration = Date.now() - startTime;

      console.log(`Answer: ${result.answer}`);
      console.log(`Source: ${result.source}`);
      console.log(`Response Time: ${duration}ms`);
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

async function benchmarkSpeeds() {
  console.log('\n\n=== Speed Benchmark ===\n');

  const testQuery = 'artificial intelligence';
  const iterations = 3;

  console.log(`Testing with query: "${testQuery}"`);
  console.log(`Running ${iterations} iterations...\n`);

  // Test Smart Glasses Search
  const smartTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const result = await smartGlassesSearch(testQuery);
    smartTimes.push(result.responseTime);
    console.log(`Smart Search #${i + 1}: ${result.responseTime}ms`);
  }

  const avgSmart = smartTimes.reduce((a, b) => a + b, 0) / smartTimes.length;
  console.log(`\nSmart Glasses Search Average: ${avgSmart.toFixed(2)}ms`);

  // Test Ultra Fast Search
  console.log('\n');
  const ultraTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    await ultraFastSearch(testQuery);
    const duration = Date.now() - startTime;
    ultraTimes.push(duration);
    console.log(`Ultra Fast #${i + 1}: ${duration}ms`);
  }

  const avgUltra = ultraTimes.reduce((a, b) => a + b, 0) / ultraTimes.length;
  console.log(`\nUltra Fast Search Average: ${avgUltra.toFixed(2)}ms`);

  console.log('\n' + '='.repeat(50));
  console.log(`Speed Improvement: ${((avgSmart - avgUltra) / avgSmart * 100).toFixed(1)}%`);
}

async function interactiveSearch() {
  console.log('\n=== Interactive Search ===\n');
  console.log('Enter your query (or leave empty to skip):');

  // For demo purposes, we'll use a sample query
  const sampleQuery = 'latest news on AI';

  if (sampleQuery) {
    console.log(`\nSearching for: "${sampleQuery}"`);
    console.log('─'.repeat(50));

    const result = await smartGlassesSearch(sampleQuery, 200);

    console.log('\n📱 SMART GLASSES DISPLAY:');
    console.log('┌' + '─'.repeat(48) + '┐');
    console.log('│ ' + result.answer.substring(0, 46).padEnd(46) + ' │');
    if (result.answer.length > 46) {
      const remaining = result.answer.substring(46);
      const chunks = remaining.match(/.{1,46}/g) || [];
      chunks.forEach(chunk => {
        console.log('│ ' + chunk.padEnd(46) + ' │');
      });
    }
    console.log('└' + '─'.repeat(48) + '┘');
    console.log(`\n📊 Response time: ${result.responseTime}ms`);
    console.log(`🔗 Source: ${result.title}`);
  }
}

// Main execution
async function runTests() {
  console.log('🔍 Starting Smart Glasses Search Tests\n');
  console.log('Make sure SERPAPI_API_KEY is set in your .env file!');

  try {
    await testSmartGlassesSearch();
    await testUltraFastSearch();
    await benchmarkSpeeds();
    await interactiveSearch();

    console.log('\n\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

// Run the tests
// runTests();

// Or run just the simple search and profile function:
searchAndProfile('who is dondol tyr');
