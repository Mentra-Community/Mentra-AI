/**
 * Weather API Integration using Google Weather API
 * Provides accurate real-time weather data for any location
 * API Docs: https://developers.google.com/maps/documentation/weather
 */

import { logger as _logger } from "@mentra/sdk";
import type { Logger } from "pino";

/**
 * Weather condition information
 */
export interface WeatherCondition {
  temperature: number;        // Temperature in Fahrenheit
  temperatureCelsius: number; // Temperature in Celsius
  condition: string;          // e.g., "Sunny", "Cloudy", "Rain"
  humidity?: number;          // Humidity percentage
  wind?: string;              // Wind speed and direction
  precipitation?: string;     // Precipitation chance/amount
}

/**
 * Complete weather response
 */
export interface WeatherResponse {
  success: boolean;
  location?: string;          // Location name
  current?: WeatherCondition;
  error?: string;
}

/**
 * Convert Celsius to Fahrenheit
 */
function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

/**
 * Convert wind direction degrees to cardinal direction
 */
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Weather cache to avoid hitting API on every prompt
 */
interface WeatherCache {
  data: WeatherResponse;
  timestamp: number;
  lat: number;
  lng: number;
}

let weatherCache: WeatherCache | null = null;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const LOCATION_THRESHOLD = 0.01; // ~1km difference triggers new fetch

/**
 * Check if cached weather is still valid
 */
function isCacheValid(lat: number, lng: number): boolean {
  if (!weatherCache) return false;

  const now = Date.now();
  const isExpired = (now - weatherCache.timestamp) > CACHE_DURATION_MS;
  const locationChanged = Math.abs(weatherCache.lat - lat) > LOCATION_THRESHOLD ||
                          Math.abs(weatherCache.lng - lng) > LOCATION_THRESHOLD;

  return !isExpired && !locationChanged;
}

/**
 * Get weather data for a location using Google Weather API
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param locationName - Optional location name (for display purposes)
 * @returns Weather data including current conditions
 */
export async function getWeather(
  lat: number,
  lng: number,
  locationName?: string,
  logger?: Logger
): Promise<WeatherResponse> {
  const log = logger || _logger.child({ service: "GoogleWeatherAPI" });

  try {
    // Check cache first
    if (isCacheValid(lat, lng)) {
      const cacheAgeSeconds = Math.round((Date.now() - weatherCache!.timestamp) / 1000);
      log.info(
        { lat, lng, cacheAgeSeconds, locationName, fromCache: true, apiType: 'GoogleWeather', operation: 'getWeather', success: true },
        `📦 Weather data retrieved from cache (${cacheAgeSeconds}s old)`
      );
      return weatherCache!.data;
    }

    const apiKey = process.env.GOOGLE_WEATHER_API_KEY;

    if (!apiKey) {
      log.error(
        { lat, lng, apiType: 'GoogleWeather', operation: 'getWeather', success: false },
        'GOOGLE_WEATHER_API_KEY is not configured'
      );
      return {
        success: false,
        error: 'Weather API key is not configured'
      };
    }

    log.info(
      { lat, lng, locationName, fromCache: false, apiType: 'GoogleWeather', operation: 'getWeather' },
      `🌐 Calling Google Weather API for: ${locationName || `${lat}, ${lng}`}`
    );

    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${apiKey}&location.latitude=${lat}&location.longitude=${lng}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        { lat, lng, status: response.status, error: errorText, apiType: 'GoogleWeather', operation: 'getWeather', success: false },
        `❌ Google Weather API responded with status ${response.status}`
      );
      return {
        success: false,
        error: `API error: ${response.status}`
      };
    }

    const data = await response.json();

    // Google Weather API response structure
    const tempCelsius = Math.round(data.temperature?.degrees ?? 0);
    const tempFahrenheit = celsiusToFahrenheit(tempCelsius);
    const condition = data.condition?.description || 'Unknown';
    const humidity = data.humidity;
    const windSpeed = data.wind?.speed?.value ? Math.round(data.wind.speed.value * 2.237) : undefined; // Convert m/s to mph
    const windDir = data.wind?.direction?.degrees ? getWindDirection(data.wind.direction.degrees) : undefined;
    const precipitation = data.precipitation?.probability?.percent;

    const weatherCondition: WeatherCondition = {
      temperature: tempFahrenheit,
      temperatureCelsius: tempCelsius,
      condition: condition,
      humidity: humidity,
      wind: windSpeed && windDir ? `${windSpeed} mph ${windDir}` : undefined,
      precipitation: precipitation ? `${precipitation}% chance` : undefined,
    };

    log.info(
      { tempF: tempFahrenheit, tempC: tempCelsius, condition, lat, lng, apiType: 'GoogleWeather', operation: 'getWeather', success: true },
      `✅ Google Weather API successful: ${tempFahrenheit}°F (${tempCelsius}°C), ${condition}`
    );

    const result: WeatherResponse = {
      success: true,
      location: locationName,
      current: weatherCondition,
    };

    // Update cache
    weatherCache = {
      data: result,
      timestamp: Date.now(),
      lat,
      lng,
    };

    return result;

  } catch (error) {
    log.error(
      { lat, lng, locationName, error: error instanceof Error ? error.message : String(error), apiType: 'GoogleWeather', operation: 'getWeather', success: false },
      `❌ Error fetching weather`
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get a simple weather summary string suitable for voice/display
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param locationName - Optional location name
 * @returns Simple weather summary string
 */
export async function getWeatherSummary(
  lat: number,
  lng: number,
  locationName?: string
): Promise<string> {
  const weather = await getWeather(lat, lng, locationName);

  if (!weather.success || !weather.current) {
    return 'Weather information is currently unavailable.';
  }

  const { current } = weather;
  let summary = `It's currently ${current.temperature}°F (${current.temperatureCelsius}°C) and ${current.condition.toLowerCase()}`;

  if (current.humidity) {
    summary += ` with ${current.humidity}% humidity`;
  }

  if (current.wind) {
    summary += `. Wind: ${current.wind}`;
  }

  return summary + '.';
}

export default {
  getWeather,
  getWeatherSummary,
};
