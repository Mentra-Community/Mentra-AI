/**
 * Weather API Integration using Open-Meteo (Free, no API key required)
 * Provides accurate real-time weather data for any location
 * API Docs: https://open-meteo.com/en/docs
 */

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
 * WMO Weather interpretation codes to human-readable conditions
 * https://open-meteo.com/en/docs#weathervariables
 */
function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return conditions[code] || 'Unknown';
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
 * Get weather data for a location using Open-Meteo API
 * This is a free API with no key required and accurate real-time data
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param locationName - Optional location name (for display purposes)
 * @returns Weather data including current conditions
 */
export async function getWeather(
  lat: number,
  lng: number,
  locationName?: string
): Promise<WeatherResponse> {
  try {
    console.log(`[Weather] Fetching weather from Open-Meteo for: ${locationName || `${lat}, ${lng}`}`);

    // Open-Meteo API - free, no key required
    // Request current weather with all relevant fields
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toString());
    url.searchParams.set('longitude', lng.toString());
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation');
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[Weather] Open-Meteo API responded with status ${response.status}`);
      return {
        success: false,
        error: `API error: ${response.status}`
      };
    }

    const data = await response.json();

    if (!data.current) {
      return {
        success: false,
        error: 'No current weather data available'
      };
    }

    const current = data.current;
    const tempCelsius = Math.round(current.temperature_2m);
    const tempFahrenheit = celsiusToFahrenheit(current.temperature_2m);
    const condition = getWeatherCondition(current.weather_code);
    const humidity = current.relative_humidity_2m;
    const windSpeed = Math.round(current.wind_speed_10m);
    const windDir = getWindDirection(current.wind_direction_10m);
    const precipitation = current.precipitation;

    const weatherCondition: WeatherCondition = {
      temperature: tempFahrenheit,
      temperatureCelsius: tempCelsius,
      condition: condition,
      humidity: humidity,
      wind: `${windSpeed} mph ${windDir}`,
      precipitation: precipitation > 0 ? `${precipitation} mm` : undefined,
    };

    console.log(`[Weather] Success: ${tempFahrenheit}°F (${tempCelsius}°C), ${condition}, Humidity: ${humidity}%, Wind: ${windSpeed} mph ${windDir}`);

    return {
      success: true,
      location: locationName,
      current: weatherCondition,
    };

  } catch (error) {
    console.error('[Weather] Error fetching weather:', error);
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
