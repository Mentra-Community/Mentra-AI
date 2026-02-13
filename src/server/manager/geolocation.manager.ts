import { logger as _logger } from '@mentra/sdk';
import type { Logger } from 'pino';
import { reverseGeocode } from '../utils/geocoding-utils/map.util';
import { getWeather, WeatherCondition } from '../utils/geocoding-utils/weather.util';

const logger = _logger.child({ service: 'LocationService' });

const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;

// ============================================
// CACHING CONFIGURATION - Prevents excessive API calls
// ============================================

// Geocoding cache (Google Maps + LocationIQ combined)
interface GeocodingCache {
  googleMaps: { streetAddress?: string; neighborhood?: string } | null;
  locationIQ: { city: string; state: string; country: string } | null;
  timestamp: number;
  lat: number;
  lng: number;
}

// Cache instances (per-session to prevent cache collisions between concurrent users)
const geocodingCacheBySession = new Map<string, GeocodingCache>();

// Cache durations
const GEOCODING_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Location thresholds (in degrees, ~111m per 0.001 degree at equator)
const GEOCODING_LOCATION_THRESHOLD = 0.001; // ~100 meters

// API call statistics for monitoring
const apiCallStats = {
  googleMapsGeocoding: 0,
  locationIQGeocoding: 0,
  geocodingCacheHits: 0,
};

// Helper: Check if geocoding cache is valid for a specific session
function isGeocodingCacheValid(sessionId: string, lat: number, lng: number): boolean {
  const cache = geocodingCacheBySession.get(sessionId);
  if (!cache) return false;

  const now = Date.now();
  const isExpired = (now - cache.timestamp) > GEOCODING_CACHE_DURATION_MS;
  const locationChanged = Math.abs(cache.lat - lat) > GEOCODING_LOCATION_THRESHOLD ||
                          Math.abs(cache.lng - lng) > GEOCODING_LOCATION_THRESHOLD;

  return !isExpired && !locationChanged;
}

// Export stats for monitoring
export function getApiCallStats() {
  return {
    ...apiCallStats,
    geocodingCacheSize: geocodingCacheBySession.size,
  };
}

// Clean up cache entries for a specific session (call on session end to prevent memory leaks)
export function clearLocationCacheForSession(sessionId: string): void {
  geocodingCacheBySession.delete(sessionId);
  console.log(`[LocationCache] 🗑️ Cleared cache for session ${sessionId} - Remaining: geocoding=${geocodingCacheBySession.size}`);
}

export function resetApiCallStats() {
  apiCallStats.googleMapsGeocoding = 0;
  apiCallStats.locationIQGeocoding = 0;
  apiCallStats.geocodingCacheHits = 0;
}

// ============================================

export interface LocationContext {
  city: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  timezone: {
    name: string;
    shortName: string;
    fullName: string;
    offsetSec: number;
    isDst: boolean;
  };
  streetAddress?: string;
  neighborhood?: string;
  weather?: WeatherCondition;
}

/**
 * Handles location updates and geocoding with robust error handling
 */
export class LocationService {
  private sessionId: string;
  private logger: Logger;

  constructor(sessionId: string, logger?: Logger) {
    this.sessionId = sessionId;
    this.logger = logger || _logger.child({ service: 'LocationService' });
  }

  /**
   * Process location data and return enriched location context
   * Gracefully falls back to default values if location services fail
   */
  async processLocation(locationData: any): Promise<LocationContext> {
    this.logger.debug({ locationData }, "$$$$$ Location data:");

    // Default fallback location context
    const fallbackLocationContext: LocationContext = {
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown',
      lat: locationData.lat as number | null,
      lng: locationData.lng as number | null,
      timezone: {
        name: 'Unknown',
        shortName: 'Unknown',
        fullName: 'Unknown',
        offsetSec: 0,
        isDst: false
      }
    };

    try {
      const { lat, lng } = locationData;

      if (!lat || !lng) {
        this.logger.debug('Invalid location data received, using fallback');
        return fallbackLocationContext;
      }

      let locationInfo: LocationContext = {
        ...fallbackLocationContext,
        lat: lat,
        lng: lng,
        streetAddress: undefined,
        neighborhood: undefined
      };

      // Try Google Maps first, then fallback to LocationIQ
      await this.enrichWithGeocoding(lat, lng, locationInfo);

      // Timezone is now provided by the SDK's userTimezone setting (via Time class)
      // No need to make geocoding API calls to determine timezone

      // Get weather information
      await this.enrichWithWeather(lat, lng, locationInfo);

      this.logger.debug(`User location: ${locationInfo.city}, ${locationInfo.state}, ${locationInfo.country} (${locationInfo.lat}, ${locationInfo.lng}), Weather: ${locationInfo.weather?.condition || 'Unknown'}`);

      return locationInfo;
    } catch (error) {
      this.logger.error(error, 'Error processing location:');
      return fallbackLocationContext;
    }
  }

  /**
   * Enrich location with geocoding data from Google Maps and LocationIQ
   * Uses caching to prevent excessive API calls
   */
  private async enrichWithGeocoding(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    // Check cache first (per-session cache)
    const cachedGeocoding = geocodingCacheBySession.get(this.sessionId);
    if (isGeocodingCacheValid(this.sessionId, lat, lng)) {
      apiCallStats.geocodingCacheHits++;
      const cacheAge = Math.round((Date.now() - cachedGeocoding!.timestamp) / 1000);
      console.log(`[Geocoding] 📦 CACHED - Using cached geocoding data (${cacheAge}s old) for session ${this.sessionId}`);

      // Apply cached Google Maps data
      if (cachedGeocoding!.googleMaps) {
        locationInfo.streetAddress = cachedGeocoding!.googleMaps.streetAddress;
        locationInfo.neighborhood = cachedGeocoding!.googleMaps.neighborhood;
      }

      // Apply cached LocationIQ data
      if (cachedGeocoding!.locationIQ) {
        locationInfo.city = cachedGeocoding!.locationIQ.city;
        locationInfo.state = cachedGeocoding!.locationIQ.state;
        locationInfo.country = cachedGeocoding!.locationIQ.country;
      }
      return;
    }

    console.log(`[Geocoding] 🌐 FETCHING FROM API - ${!cachedGeocoding ? 'No cache exists' : 'Cache expired or location changed'} for session ${this.sessionId}`);

    // Initialize cache entry
    const newCache: GeocodingCache = {
      googleMaps: null,
      locationIQ: null,
      timestamp: Date.now(),
      lat,
      lng
    };

    // Try Google Maps for street and neighborhood data
    try {
      console.log(`[Geocoding] Attempting Google Maps for (${lat}, ${lng})`);
      apiCallStats.googleMapsGeocoding++;
      const googleResult = await reverseGeocode(lat, lng, this.logger);

      if (googleResult.success && googleResult.address) {
        const addr = googleResult.address;

        // Store Google Maps street and neighborhood data
        locationInfo.streetAddress = addr.streetAddress;
        locationInfo.neighborhood = addr.neighborhood;

        // Cache the Google Maps result
        newCache.googleMaps = {
          streetAddress: addr.streetAddress,
          neighborhood: addr.neighborhood
        };

        const details = [addr.streetAddress, addr.neighborhood].filter(Boolean).join(', ');
        console.log(`[Geocoding] Google Maps success: ${details}`);
      } else {
        console.log(`[Geocoding] Google Maps failed: ${googleResult.error}`);
      }
    } catch (googleError) {
      console.warn('[Geocoding] Google Maps error:', googleError);
    }

    // Always call LocationIQ for city/state/country (Google Maps doesn't return this reliably)
    try {
      console.log(`[Geocoding] Using LocationIQ for city/state/country`);
      apiCallStats.locationIQGeocoding++;
      const response = await fetch(
        `https://us1.locationiq.com/v1/reverse.php?key=${LOCATIONIQ_TOKEN}&lat=${lat}&lon=${lng}&format=json`
      );

      if (response.ok) {
        const data = await response.json();
        const address = data.address;

        if (address) {
          locationInfo.city = address.city || address.town || address.village || 'Unknown city';
          locationInfo.state = address.state || 'Unknown state';
          locationInfo.country = address.country || 'Unknown country';

          // Cache the LocationIQ result
          newCache.locationIQ = {
            city: locationInfo.city,
            state: locationInfo.state,
            country: locationInfo.country
          };

          console.log(`[Geocoding] LocationIQ success: ${locationInfo.city}, ${locationInfo.state}`);
        }
      } else {
        console.warn(`[Geocoding] LocationIQ failed with status: ${response.status}`);
      }
    } catch (geocodingError) {
      console.warn('[Geocoding] LocationIQ failed:', geocodingError);
    }

    // Update the cache (per-session)
    geocodingCacheBySession.set(this.sessionId, newCache);
    console.log(`[Geocoding] 💾 Cache updated for session ${this.sessionId} - API calls: Google=${apiCallStats.googleMapsGeocoding}, LocationIQ=${apiCallStats.locationIQGeocoding}, CacheHits=${apiCallStats.geocodingCacheHits}`);
  }

  /**
   * Enrich location with weather data
   */
  private async enrichWithWeather(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    try {
      // Build location name for better weather results
      const locationName = locationInfo.city !== 'Unknown'
        ? `${locationInfo.city}, ${locationInfo.state}`
        : undefined;

      console.log(`[Weather] Fetching weather for ${locationName || `${lat}, ${lng}`}`);
      const weatherResult = await getWeather(lat, lng, locationName, this.logger);

      if (weatherResult.success && weatherResult.current) {
        locationInfo.weather = weatherResult.current;
        console.log(`[Weather] Success: ${weatherResult.current.temperature}°F, ${weatherResult.current.condition}`);
      } else {
        console.warn(`[Weather] Failed to fetch weather: ${weatherResult.error}`);
      }
    } catch (weatherError) {
      console.warn('[Weather] Weather lookup failed:', weatherError);
    }
  }
}
