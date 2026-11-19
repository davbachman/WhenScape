// Plain-language readouts of the conditions. Inputs use the weather module's
// units: Celsius, metres per second, degrees the wind comes FROM.

const WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const LETTERS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const sector = degrees => Math.round((((degrees % 360) + 360) % 360) / 45) % 8;

/** Everyday units for a locale such as "en-US": Fahrenheit and mph in the US, mph in the UK, otherwise Celsius and km/h. */
export function unitsFor(locale) {
  let region = '';
  try { region = new Intl.Locale(locale).maximize().region ?? ''; } catch { region = ''; }
  if (['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'].includes(region)) return { temperature: 'F', speed: 'mph' };
  if (region === 'GB') return { temperature: 'C', speed: 'mph' };
  return { temperature: 'C', speed: 'km/h' };
}

export function formatTemperature(celsius, units) {
  if (celsius == null) return null;
  return `${Math.round(units.temperature === 'F' ? celsius * 9 / 5 + 32 : celsius)}°`;
}

export function formatSpeed(metresPerSecond, units) {
  if (metresPerSecond == null) return null;
  return `${Math.round(metresPerSecond * (units.speed === 'mph' ? 2.23694 : 3.6))} ${units.speed}`;
}

export function conditionName(weather) {
  if (weather.renderPrecipitation && weather.snowfall > 0) return 'Snow';
  if (weather.renderPrecipitation && weather.rain > 0) return 'Rain';
  if (weather.visibility != null && weather.visibility < 1000) return 'Fog';
  if (weather.cloudCover == null) return 'Cloud cover unavailable';
  return weather.cloudCover > 80 ? 'Overcast' : weather.cloudCover > 20 ? 'Partly cloudy' : 'Mostly clear';
}

/** Gusts worth mentioning: clearly stronger than the steady wind and strong in themselves. */
export function notableGust(weather) {
  const { windSpeed, windGust } = weather;
  return windGust != null && windSpeed != null && windGust >= 8 && windGust >= windSpeed * 1.4 ? windGust : null;
}

/** "Wind W 12 mph · gusts 25 mph", "Calm", or null when the wind is unknown. */
export function windReadout(weather, units) {
  if (weather.windSpeed == null) return null;
  if (weather.windSpeed <= 0.25) return 'Calm';
  const from = weather.windDirection == null ? '' : `${LETTERS[sector(weather.windDirection)]} `;
  const gust = notableGust(weather);
  return `Wind ${from}${formatSpeed(weather.windSpeed, units)}${gust ? ` · gusts ${formatSpeed(gust, units)}` : ''}`;
}

function windPhrase(weather, units) {
  if (weather.windSpeed == null) return null;
  if (weather.windSpeed <= 0.25) return 'calm';
  const strength = weather.windSpeed < 4 ? 'light ' : weather.windSpeed < 8 ? '' : weather.windSpeed < 13 ? 'strong ' : 'very strong ';
  const from = weather.windDirection == null ? '' : `${WORDS[sector(weather.windDirection)]} `;
  const gust = notableGust(weather);
  return `${strength}${from}wind${gust ? ` gusting ${formatSpeed(gust, units)}` : ''}`;
}

/** "40 minutes", "1 hour", "2 h 10 min". */
export function durationPhrase(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!rest) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} h ${rest} min`;
}

/**
 * What the Sun does that matters for the selection. With an event range it
 * says whether sunset or sunrise falls inside it; otherwise how long until
 * the next one. `sunUp` is whether the Sun is above the horizon at `time`.
 */
export function sunPhrase({ time, start, end, rangeEnabled, sunrise, sunset, sunUpAtStart, sunUp }) {
  const inside = t => t != null && t > start && t < end;
  if (rangeEnabled && start != null && end != null) {
    if (inside(sunset)) return `sunset ${durationPhrase(sunset - start)} into the event`;
    if (inside(sunrise)) return `sunrise ${durationPhrase(sunrise - start)} into the event`;
    return sunUpAtStart ? 'daylight throughout' : 'dark throughout';
  }
  if (sunUp && sunset != null && sunset > time) return `sunset in ${durationPhrase(sunset - time)}`;
  if (!sunUp && sunrise != null && sunrise > time) return `sunrise in ${durationPhrase(sunrise - time)}`;
  return sunUp ? null : 'after dark';
}

/** One sentence for the whole picture, e.g. "Partly cloudy, 62°, light west wind; sunset 40 minutes into the event." */
export function summaryLine({ weather, units, sun }) {
  const parts = [];
  if (weather && weather.kind !== 'missing') {
    parts.push(conditionName(weather));
    const temperature = formatTemperature(weather.temperature, units);
    if (temperature) parts.push(temperature);
    const wind = windPhrase(weather, units);
    if (wind) parts.push(wind);
  }
  const weatherText = parts.join(', ');
  const prefix = weather?.kind === 'seasonal' && weatherText ? 'Typically ' + weatherText[0].toLowerCase() + weatherText.slice(1) : weatherText;
  const sunText = sun ? sunPhrase(sun) : null;
  const joined = [prefix, sunText].filter(Boolean).join('; ');
  return joined ? joined[0].toUpperCase() + joined.slice(1) + '.' : '';
}
