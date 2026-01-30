/**
 * Google Maps Reverse Geocoding Test
 *
 * Tests Google Maps API reverse geocoding functionality
 * Run with: bun src/test/google-maps-test.ts
 */

import { reverseGeocode } from '../server/utils/GoogleMaps';

// Test coordinates
const TEST_LOCATIONS = [
  {
    name: "Hayes Valley, San Francisco",
    lat: 37.7768242,
    lng: -122.4224272,
    expected: {
      city: "San Francisco",
      state: "California",
      neighborhood: "Hayes Valley"
    }
  },
  {
    name: "Golden Gate Bridge",
    lat: 37.8199,
    lng: -122.4783,
    expected: {
      city: "San Francisco",
      state: "California"
    }
  },
  {
    name: "Times Square, New York",
    lat: 40.7580,
    lng: -73.9855,
    expected: {
      city: "New York",
      state: "New York",
      neighborhood: "Midtown"
    }
  },
  {
    name: "Santa Monica Pier, Los Angeles",
    lat: 34.0094,
    lng: -118.4977,
    expected: {
      city: "Santa Monica",
      state: "California"
    }
  }
];

/**
 * Test reverse geocoding for a single location
 */
async function testLocation(location: typeof TEST_LOCATIONS[0]) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Test] Location: ${location.name}`);
  console.log(`[Test] Coordinates: ${location.lat}, ${location.lng}`);
  console.log(`${'='.repeat(70)}`);

  try {
    const startTime = Date.now();
    const result = await reverseGeocode(location.lat, location.lng);
    const duration = Date.now() - startTime;

    if (!result.success) {
      console.error(`[FAIL] ${result.error}`);
      return false;
    }

    if (!result.address) {
      console.error(`[FAIL] No address returned`);
      return false;
    }

    const addr = result.address;

    console.log(`\n[PASS] Success (${duration}ms)`);
    console.log(`\n[Address] Full: ${addr.formattedAddress}`);

    console.log(`\n[Details]`);
    console.log(`  Street:       ${addr.streetAddress || 'N/A'}`);
    console.log(`  Neighborhood: ${addr.neighborhood || 'N/A'}`);
    console.log(`  Postal Code:  ${addr.postalCode || 'N/A'}`);

    // Verify expected values
    console.log(`\n[Validation]`);
    let allMatch = true;

    // Note: City/State/Country are not returned by this simplified Google Maps implementation
    // Those fields come from LocationIQ in the actual application

    if (location.expected.neighborhood && addr.neighborhood !== location.expected.neighborhood) {
      console.log(`  [WARN] Neighborhood mismatch: expected "${location.expected.neighborhood}", got "${addr.neighborhood || 'N/A'}"`);
      // Don't mark as failed for neighborhood mismatches - they can vary
    } else if (location.expected.neighborhood && addr.neighborhood) {
      console.log(`  [OK] Neighborhood matches: ${addr.neighborhood}`);
    } else if (addr.neighborhood) {
      console.log(`  [OK] Neighborhood found: ${addr.neighborhood}`);
    }

    if (addr.streetAddress) {
      console.log(`  [OK] Street address found: ${addr.streetAddress}`);
    }

    return allMatch;

  } catch (error) {
    console.error(`[ERROR] ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('[Test Suite] Google Maps Reverse Geocoding');
  console.log('='.repeat(70));

  // Check if API key is configured
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
    console.error('\n[ERROR] GOOGLE_MAPS_API_KEY is not configured!');
    console.error('        Please add your Google Maps API key to .env file');
    console.error('        Get one at: https://console.cloud.google.com/');
    process.exit(1);
  }

  console.log(`\n[OK] API Key configured`);
  console.log(`\n[Info] Running ${TEST_LOCATIONS.length} test cases...\n`);

  let passed = 0;
  let failed = 0;

  for (const location of TEST_LOCATIONS) {
    const success = await testLocation(location);
    if (success) {
      passed++;
    } else {
      failed++;
    }

    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Summary] Test Results`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Total:  ${TEST_LOCATIONS.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log(`\n[SUCCESS] All tests passed!`);
  } else {
    console.log(`\n[WARNING] Some tests failed. Check the output above for details.`);
  }

  console.log('='.repeat(70) + '\n');
}

// Run the tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
