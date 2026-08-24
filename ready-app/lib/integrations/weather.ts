/**
 * Weather-aware advice — the seam, not the feature.
 *
 * Location is the most sensitive permission this app could ask for, so the
 * rule is strict: with no key configured, nothing here runs, nothing is asked
 * for, and the word "weather" never appears in the interface. When it is
 * configured, the flow is still opt-in from a user gesture.
 */

export interface Forecast {
  tempC: number;
  feelsLikeC: number;
  rainChance: number;
  windKph: number;
  summary: string;
}

export type WeatherState = { status: 'unavailable' } | { status: 'ok'; forecast: Forecast };

export function weatherConfigured(): boolean {
  return Boolean(process.env.OPENWEATHER_API_KEY?.trim());
}

export async function getForecast(_lat: number, _lon: number): Promise<WeatherState> {
  if (!weatherConfigured()) return { status: 'unavailable' };
  throw new Error('Weather key configured but no provider implementation is wired up yet.');
}

/**
 * The kind of line this would produce, kept here so the copy tone is fixed
 * before the feature lands: comfort advice, never a clothing veto.
 *
 *   "Your blazer suits the event, but it is 34° outside — carry it and put it
 *    on before you walk in."
 */
export function comfortNote(forecast: Forecast, outdoor: boolean): string | null {
  if (!outdoor) return null;
  if (forecast.feelsLikeC >= 32) return 'It is hot out — carry the outer layer rather than wearing it there.';
  if (forecast.feelsLikeC <= 10) return 'It is cold out — take a layer you can remove at the door.';
  if (forecast.rainChance >= 0.5) return 'Rain is likely — plan for the shoes getting wet.';
  return null;
}
