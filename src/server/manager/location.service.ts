import { logger as _logger } from '@mentra/sdk';
import { reverseGeocode, getTimezone } from '../utils/map.util';
import { getWeather, WeatherCondition } from '../utils/weather.util';

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

// Timezone cache
interface TimezoneCache {
  timezone: {
    name: string;
    shortName: string;
    fullName: string;
    offsetSec: number;
    isDst: boolean;
  };
  timestamp: number;
  lat: number;
  lng: number;
}

// Cache instances (module-level for persistence across calls)
let geocodingCache: GeocodingCache | null = null;
let timezoneCache: TimezoneCache | null = null;

// Cache durations
const GEOCODING_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const TIMEZONE_CACHE_DURATION_MS = 12 * 60 * 60 * 1000;  // 12 hours (timezones rarely change)

// Location thresholds (in degrees, ~111m per 0.001 degree at equator)
const GEOCODING_LOCATION_THRESHOLD = 0.001; // ~100 meters
const TIMEZONE_LOCATION_THRESHOLD = 0.1;    // ~10km (timezones are large)

// API call statistics for monitoring
const apiCallStats = {
  googleMapsGeocoding: 0,
  locationIQGeocoding: 0,
  googleMapsTimezone: 0,
  locationIQTimezone: 0,
  geocodingCacheHits: 0,
  timezoneCacheHits: 0
};

// Helper: Check if geocoding cache is valid
function isGeocodingCacheValid(lat: number, lng: number): boolean {
  if (!geocodingCache) return false;

  const now = Date.now();
  const isExpired = (now - geocodingCache.timestamp) > GEOCODING_CACHE_DURATION_MS;
  const locationChanged = Math.abs(geocodingCache.lat - lat) > GEOCODING_LOCATION_THRESHOLD ||
                          Math.abs(geocodingCache.lng - lng) > GEOCODING_LOCATION_THRESHOLD;

  return !isExpired && !locationChanged;
}

// Helper: Check if timezone cache is valid
function isTimezoneCacheValid(lat: number, lng: number): boolean {
  if (!timezoneCache) return false;

  const now = Date.now();
  const isExpired = (now - timezoneCache.timestamp) > TIMEZONE_CACHE_DURATION_MS;
  const locationChanged = Math.abs(timezoneCache.lat - lat) > TIMEZONE_LOCATION_THRESHOLD ||
                          Math.abs(timezoneCache.lng - lng) > TIMEZONE_LOCATION_THRESHOLD;

  return !isExpired && !locationChanged;
}

// Export stats for monitoring
export function getApiCallStats() {
  return { ...apiCallStats };
}

export function resetApiCallStats() {
  apiCallStats.googleMapsGeocoding = 0;
  apiCallStats.locationIQGeocoding = 0;
  apiCallStats.googleMapsTimezone = 0;
  apiCallStats.locationIQTimezone = 0;
  apiCallStats.geocodingCacheHits = 0;
  apiCallStats.timezoneCacheHits = 0;
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

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Process location data and return enriched location context
   * Gracefully falls back to default values if location services fail
   */
  async processLocation(locationData: any): Promise<LocationContext> {
    logger.debug({ locationData }, "$$$$$ Location data:");

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
        logger.debug('Invalid location data received, using fallback');
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

      // Get timezone information
      await this.enrichWithTimezone(lat, lng, locationInfo);

      // Get weather information
      await this.enrichWithWeather(lat, lng, locationInfo);

      logger.debug(`User location: ${locationInfo.city}, ${locationInfo.state}, ${locationInfo.country} (${locationInfo.lat}, ${locationInfo.lng}), Timezone: ${locationInfo.timezone.name}, Weather: ${locationInfo.weather?.condition || 'Unknown'}`);

      return locationInfo;
    } catch (error) {
      logger.error(error, 'Error processing location:');
      return fallbackLocationContext;
    }
  }

  /**
   * Enrich location with geocoding data from Google Maps and LocationIQ
   * Uses caching to prevent excessive API calls
   */
  private async enrichWithGeocoding(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    // Check cache first
    if (isGeocodingCacheValid(lat, lng)) {
      apiCallStats.geocodingCacheHits++;
      const cacheAge = Math.round((Date.now() - geocodingCache!.timestamp) / 1000);
      console.log(`[Geocoding] 📦 CACHED - Using cached geocoding data (${cacheAge}s old)`);

      // Apply cached Google Maps data
      if (geocodingCache!.googleMaps) {
        locationInfo.streetAddress = geocodingCache!.googleMaps.streetAddress;
        locationInfo.neighborhood = geocodingCache!.googleMaps.neighborhood;
      }

      // Apply cached LocationIQ data
      if (geocodingCache!.locationIQ) {
        locationInfo.city = geocodingCache!.locationIQ.city;
        locationInfo.state = geocodingCache!.locationIQ.state;
        locationInfo.country = geocodingCache!.locationIQ.country;
      }
      return;
    }

    console.log(`[Geocoding] 🌐 FETCHING FROM API - ${!geocodingCache ? 'No cache exists' : 'Cache expired or location changed'}`);

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
      const googleResult = await reverseGeocode(lat, lng);

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

    // Update the cache
    geocodingCache = newCache;
    console.log(`[Geocoding] 💾 Cache updated - API calls: Google=${apiCallStats.googleMapsGeocoding}, LocationIQ=${apiCallStats.locationIQGeocoding}, CacheHits=${apiCallStats.geocodingCacheHits}`);
  }

  /**
   * Enrich location with timezone data
   * Uses caching to prevent excessive API calls (timezones rarely change)
   */
  private async enrichWithTimezone(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    // Check cache first - timezones are very stable, use longer cache
    if (isTimezoneCacheValid(lat, lng)) {
      apiCallStats.timezoneCacheHits++;
      const cacheAge = Math.round((Date.now() - timezoneCache!.timestamp) / 1000);
      console.log(`[Timezone] 📦 CACHED - Using cached timezone data (${cacheAge}s old)`);
      locationInfo.timezone = timezoneCache!.timezone;
      return;
    }

    console.log(`[Timezone] 🌐 FETCHING FROM API - ${!timezoneCache ? 'No cache exists' : 'Cache expired or location changed significantly'}`);

    let timezoneSuccess = false;

    // Try LocationIQ first (cheaper)
    try {
      console.log(`[Timezone] Attempting LocationIQ timezone lookup`);
      apiCallStats.locationIQTimezone++;
      const timezoneResponse = await fetch(
        `https://us1.locationiq.com/v1/timezone?key=${LOCATIONIQ_TOKEN}&lat=${lat}&lon=${lng}&format=json`
      );

      if (timezoneResponse.ok) {
        const timezoneData = await timezoneResponse.json();

        if (timezoneData.timezone) {
          locationInfo.timezone = {
            name: timezoneData.timezone.name || 'Unknown',
            shortName: timezoneData.timezone.short_name || 'Unknown',
            fullName: timezoneData.timezone.full_name || 'Unknown',
            offsetSec: timezoneData.timezone.offset_sec || 0,
            isDst: !!timezoneData.timezone.now_in_dst
          };
          timezoneSuccess = true;
          console.log(`[Timezone] LocationIQ success: ${locationInfo.timezone.name}`);
        }
      } else {
        console.warn(`[Timezone] LocationIQ failed with status: ${timezoneResponse.status}, trying Google Maps`);
      }
    } catch (timezoneError) {
      console.warn('[Timezone] LocationIQ lookup failed:', timezoneError);
    }

    // Fallback to Google Maps TimeZone API if LocationIQ failed
    if (!timezoneSuccess) {
      try {
        console.log(`[Timezone] Attempting Google Maps timezone lookup`);
        apiCallStats.googleMapsTimezone++;
        const googleTimezone = await getTimezone(lat, lng);

        if (googleTimezone.success && googleTimezone.timezone) {
          locationInfo.timezone = googleTimezone.timezone;
          timezoneSuccess = true;
          console.log(`[Timezone] Google Maps success: ${googleTimezone.timezone.name}`);
        } else {
          console.warn(`[Timezone] Google Maps failed: ${googleTimezone.error}`);
        }
      } catch (googleTimezoneError) {
        console.warn('[Timezone] Google Maps lookup failed:', googleTimezoneError);
      }
    }

    // Update cache if we got a valid timezone
    if (timezoneSuccess) {
      timezoneCache = {
        timezone: locationInfo.timezone,
        timestamp: Date.now(),
        lat,
        lng
      };
      console.log(`[Timezone] 💾 Cache updated - API calls: LocationIQ=${apiCallStats.locationIQTimezone}, Google=${apiCallStats.googleMapsTimezone}, CacheHits=${apiCallStats.timezoneCacheHits}`);
    }
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
      const weatherResult = await getWeather(lat, lng, locationName);

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
