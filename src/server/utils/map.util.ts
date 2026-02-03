/**
 * Google Maps API Integration using official Google Maps Services library
 * Provides reverse geocoding to convert lat/lng coordinates to detailed address information
 */

import { Client } from '@googlemaps/google-maps-services-js';
import { logger as _logger } from "@mentra/sdk";
import type { Logger } from "pino";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Initialize the Google Maps client
const client = new Client({});

/**
 * Detailed address information from reverse geocoding
 */
export interface GoogleMapsAddress {
  formattedAddress: string;     // Full formatted address
  streetAddress?: string;        // e.g., "Hayes Street"
  neighborhood?: string;         // e.g., "Hayes Valley"
  // city: string;                  // e.g., "San Francisco"
  // state: string;                 // e.g., "California"
  // country: string;               // e.g., "United States"
  postalCode?: string;           // e.g., "94102"
  // coordinates: {
  //   lat: number;
  //   lng: number;
  // };
}

export interface GoogleMapsGeocodeResult {
  success: boolean;
  address?: GoogleMapsAddress;
  error?: string;
}

/**
 * Reverse geocode lat/lng coordinates to detailed address information
 *
 * Example input: (37.7768242, -122.4224272)
 * Example output: {
 *   streetAddress: "Hayes Street",
 *   neighborhood: "Hayes Valley",
 *   city: "San Francisco",
 *   state: "California",
 *   country: "United States"
 * }
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Detailed address information including street and neighborhood/area
 */
export async function reverseGeocode(lat: number, lng: number, logger?: Logger): Promise<GoogleMapsGeocodeResult> {
  const log = logger || _logger.child({ service: "GoogleMapsAPI" });

  if (!GOOGLE_MAPS_API_KEY) {
    log.warn({ lat, lng }, 'GOOGLE_MAPS_API_KEY not configured, skipping reverse geocoding');
    return {
      success: false,
      error: 'API key not configured'
    };
  }

  log.info({ lat, lng, apiType: 'GoogleMaps', operation: 'reverseGeocode' }, '📍 Calling Google Maps reverse geocoding API');

  try {
    // Call the reverse geocoding API using the official client
    const response = await client.reverseGeocode({
      params: {
        latlng: { lat, lng },
        key: GOOGLE_MAPS_API_KEY,
      },
      timeout: 5000, // 5 second timeout
    });

    if (response.data.status !== 'OK') {
      log.error(
        { lat, lng, status: response.data.status, apiType: 'GoogleMaps', operation: 'reverseGeocode', success: false },
        `❌ Google Maps reverse geocoding failed with status: ${response.data.status}`
      );
      return {
        success: false,
        error: response.data.status
      };
    }

    if (!response.data.results || response.data.results.length === 0) {
      log.warn({ lat, lng }, '⚠️ No reverse geocoding results found');
      return {
        success: false,
        error: 'No results found'
      };
    }

    // Parse the first result (most accurate)
    const result = response.data.results[0];
    const addressComponents = result.address_components;

    // Extract all address components
    let streetNumber = '';
    let route = '';
    let neighborhood = '';
    let city = '';
    let state = '';
    let country = '';
    let postalCode = '';

    for (const component of addressComponents) {
      const types = component.types as string[];

      if (types.includes('street_number')) {
        streetNumber = component.long_name;
      } else if (types.includes('route')) {
        route = component.long_name;
      } else if (types.includes('neighborhood') || types.includes('sublocality')) {
        // Hayes Valley, Mission District, etc.
        neighborhood = component.long_name;
      } else if (types.includes('locality')) {
        city = component.long_name;
      } else if (types.includes('administrative_area_level_1')) {
        state = component.long_name;
      } else if (types.includes('country')) {
        country = component.long_name;
      } else if (types.includes('postal_code')) {
        postalCode = component.long_name;
      }
    }

    // Build street address (number + street name)
    const streetAddress = [streetNumber, route].filter(Boolean).join(' ') || undefined;

    const address: GoogleMapsAddress = {
      formattedAddress: result.formatted_address,
      streetAddress: streetAddress,
      neighborhood: neighborhood || undefined,
      postalCode: postalCode || undefined,
    };

    log.info(
      {
        lat,
        lng,
        formattedAddress: address.formattedAddress,
        hasStreetAddress: !!address.streetAddress,
        hasNeighborhood: !!address.neighborhood,
        success: true,
        apiType: 'GoogleMaps',
        operation: 'reverseGeocode'
      },
      `✅ Google Maps reverse geocoding successful: ${address.formattedAddress}`
    );

    return {
      success: true,
      address
    };

  } catch (error) {
    log.error(
      { lat, lng, error: error instanceof Error ? error.message : String(error) },
      `❌ Google Maps reverse geocoding error`
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get timezone information for coordinates using Google Maps TimeZone API
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Timezone information including name, offset, and DST status
 */
export async function getTimezone(lat: number, lng: number, logger?: Logger): Promise<{
  success: boolean;
  timezone?: {
    name: string;
    shortName: string;
    fullName: string;
    offsetSec: number;
    isDst: boolean;
  };
  error?: string;
}> {
  const log = logger || _logger.child({ service: "GoogleMapsAPI" });

  if (!GOOGLE_MAPS_API_KEY) {
    log.warn({ lat, lng }, 'GOOGLE_MAPS_API_KEY not configured, skipping timezone lookup');
    return {
      success: false,
      error: 'API key not configured'
    };
  }

  log.info({ lat, lng, apiType: 'GoogleMaps', operation: 'timezone' }, '🕐 Calling Google Maps timezone API');

  try {
    const timestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp
    const response = await client.timezone({
      params: {
        location: { lat, lng },
        timestamp: timestamp,
        key: GOOGLE_MAPS_API_KEY,
      },
      timeout: 5000,
    });

    if (response.data.status !== 'OK') {
      log.error(
        { lat, lng, status: response.data.status, apiType: 'GoogleMaps', operation: 'timezone', success: false },
        `❌ Google Maps timezone API failed with status: ${response.data.status}`
      );
      return {
        success: false,
        error: response.data.status
      };
    }

    const data = response.data;
    const offsetSec = (data.rawOffset || 0) + (data.dstOffset || 0);
    const isDst = (data.dstOffset || 0) !== 0;

    // Format short timezone name (e.g., "PST", "PDT")
    const shortName = data.timeZoneName || data.timeZoneId || 'Unknown';

    const timezone = {
      name: data.timeZoneId || 'Unknown',
      shortName: shortName,
      fullName: data.timeZoneId || 'Unknown',
      offsetSec: offsetSec,
      isDst: isDst
    };

    log.info(
      {
        lat,
        lng,
        timezone: timezone.name,
        offset: timezone.offsetSec,
        isDst: timezone.isDst,
        success: true,
        apiType: 'GoogleMaps',
        operation: 'timezone'
      },
      `✅ Google Maps timezone lookup successful: ${timezone.shortName}`
    );

    return {
      success: true,
      timezone
    };

  } catch (error) {
    log.error(
      { lat, lng, error: error instanceof Error ? error.message : String(error) },
      `❌ Google Maps timezone lookup error`
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================================================
// Future API Functions (Add as needed)
// ============================================================================
//
// Example functions you can add later:
//
// export async function geocode(address: string) { ... }
// export async function getDistanceMatrix(origin, destination) { ... }
// export async function findNearbyPlaces(lat, lng, radius, type) { ... }
//
// ============================================================================
