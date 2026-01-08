import { logger as _logger } from '@mentra/sdk';
import { reverseGeocode, getTimezone } from '../utils/map.util';

const logger = _logger.child({ service: 'LocationService' });

const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;

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

      logger.debug(`User location: ${locationInfo.city}, ${locationInfo.state}, ${locationInfo.country} (${locationInfo.lat}, ${locationInfo.lng}), Timezone: ${locationInfo.timezone.name}`);

      return locationInfo;
    } catch (error) {
      logger.error(error, 'Error processing location:');
      return fallbackLocationContext;
    }
  }

  /**
   * Enrich location with geocoding data from Google Maps and LocationIQ
   */
  private async enrichWithGeocoding(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    // Try Google Maps first for street and neighborhood data
    try {
      console.log(`[Geocoding] Attempting Google Maps for (${lat}, ${lng})`);
      const googleResult = await reverseGeocode(lat, lng);

      if (googleResult.success && googleResult.address) {
        const addr = googleResult.address;

        // Store Google Maps street and neighborhood data
        locationInfo.streetAddress = addr.streetAddress;
        locationInfo.neighborhood = addr.neighborhood;

        // Log detailed address info
        const details = [
          addr.streetAddress,
          addr.neighborhood
        ].filter(Boolean).join(', ');

        console.log(`[Geocoding] Google Maps success: ${details}`);
        if (addr.neighborhood) console.log(`[Geocoding] Neighborhood: ${addr.neighborhood}`);
        if (addr.streetAddress) console.log(`[Geocoding] Street: ${addr.streetAddress}`);

        // Still need LocationIQ for city/state/country, so throw to use fallback
        throw new Error('Google Maps only provided street/neighborhood, using LocationIQ for city/state');
      } else {
        console.log(`[Geocoding] Google Maps failed: ${googleResult.error}, using LocationIQ`);
        throw new Error('Google Maps unavailable, using fallback');
      }
    } catch (googleError) {
      // Fallback to LocationIQ for city/state/country
      await this.enrichWithLocationIQ(lat, lng, locationInfo);
    }
  }

  /**
   * Enrich location with LocationIQ data
   */
  private async enrichWithLocationIQ(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    try {
      console.log(`[Geocoding] Using LocationIQ for reverse geocoding`);
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
          console.log(`[Geocoding] LocationIQ success: ${locationInfo.city}, ${locationInfo.state}`);
        }
      } else {
        console.warn(`[Geocoding] LocationIQ failed with status: ${response.status}`);
      }
    } catch (geocodingError) {
      console.warn('[Geocoding] LocationIQ failed:', geocodingError);
    }
  }

  /**
   * Enrich location with timezone data
   */
  private async enrichWithTimezone(lat: number, lng: number, locationInfo: LocationContext): Promise<void> {
    let timezoneSuccess = false;

    // Try LocationIQ first
    try {
      console.log(`[Geocoding] Attempting LocationIQ timezone lookup`);
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
          console.log(`[Geocoding] LocationIQ timezone success: ${locationInfo.timezone.name}`);
        }
      } else {
        console.warn(`[Geocoding] LocationIQ timezone API failed with status: ${timezoneResponse.status}, trying Google Maps`);
      }
    } catch (timezoneError) {
      console.warn('[Geocoding] LocationIQ timezone lookup failed:', timezoneError);
    }

    // Fallback to Google Maps TimeZone API if LocationIQ failed
    if (!timezoneSuccess) {
      try {
        console.log(`[Geocoding] Attempting Google Maps timezone lookup`);
        const googleTimezone = await getTimezone(lat, lng);

        if (googleTimezone.success && googleTimezone.timezone) {
          locationInfo.timezone = googleTimezone.timezone;
          console.log(`[Geocoding] Google Maps timezone success: ${googleTimezone.timezone.name}`);
        } else {
          console.warn(`[Geocoding] Google Maps timezone failed: ${googleTimezone.error}`);
        }
      } catch (googleTimezoneError) {
        console.warn('[Geocoding] Google Maps timezone lookup failed:', googleTimezoneError);
      }
    }
  }
}
