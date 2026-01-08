/**
 * Example usage of SerpAPI utility
 *
 * Run this file with: bun src/test/serpapi-example.ts
 */

import {
  searchGoogle,
  searchNews,
  searchImages,
  quickSearch,
  getRelatedSearches,
} from '../server/utils/serpapi';

async function exampleBasicSearch() {
  console.log('\n=== Basic Search Example ===');
  try {
    const results = await quickSearch('artificial intelligence', 5);
    console.log(`Found ${results.length} results:`);
    results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.title}`);
      console.log(`   Link: ${result.link}`);
      console.log(`   Snippet: ${result.snippet}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function exampleNewsSearch() {
  console.log('\n=== News Search Example ===');
  try {
    const news = await searchNews('technology', { num: 3 });
    console.log(`Found ${news.length} news articles:`);
    news.forEach((article, index) => {
      console.log(`\n${index + 1}. ${article.title}`);
      console.log(`   Source: ${article.source || 'Unknown'}`);
      console.log(`   Date: ${article.date || 'Unknown'}`);
      console.log(`   Link: ${article.link}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function exampleImageSearch() {
  console.log('\n=== Image Search Example ===');
  try {
    const images = await searchImages('cute cats', { num: 5 });
    console.log(`Found ${images.length} images:`);
    images.forEach((image, index) => {
      console.log(`\n${index + 1}. ${image.title}`);
      console.log(`   Thumbnail: ${image.thumbnail}`);
      console.log(`   Link: ${image.link}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function exampleAdvancedSearch() {
  console.log('\n=== Advanced Search Example ===');
  try {
    const response = await searchGoogle({
      q: 'OpenAI GPT',
      num: 5,
      hl: 'en',
      gl: 'us',
      location: 'San Francisco, California',
    });

    console.log('Search Metadata:');
    console.log(`  Status: ${response.search_metadata?.status}`);
    console.log(`  Time taken: ${response.search_metadata?.total_time_taken}s`);

    console.log('\nSearch Information:');
    console.log(`  Total results: ${response.search_information?.total_results}`);
    console.log(`  Query: ${response.search_information?.query_displayed}`);

    console.log(`\nOrganic Results (${response.organic_results?.length || 0}):`);
    response.organic_results?.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.title}`);
      console.log(`   Link: ${result.link}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function exampleRelatedSearches() {
  console.log('\n=== Related Searches Example ===');
  try {
    const related = await getRelatedSearches('machine learning');
    console.log('Related searches:');
    related.forEach((item, index) => {
      console.log(`${index + 1}. ${item.query}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run all examples
async function runExamples() {
  console.log('Starting SerpAPI Examples...\n');
  console.log('Make sure SERPAPI_API_KEY is set in your .env file!\n');

  await exampleBasicSearch();
  await exampleNewsSearch();
  await exampleImageSearch();
  await exampleAdvancedSearch();
  await exampleRelatedSearches();

  console.log('\n=== All examples completed ===');
}

// Uncomment to run the examples
runExamples();

// Export for use in other files
export {
  exampleBasicSearch,
  exampleNewsSearch,
  exampleImageSearch,
  exampleAdvancedSearch,
  exampleRelatedSearches,
  runExamples,
};
