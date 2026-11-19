// A small strip chart of the selected interval: daylight and darkness behind,
// cloud along the top, chance of rain rising from the bottom, the temperature
// as a line, sunrise and sunset as marks, and the current instant as a cursor.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = value => Number(value.toFixed(1));

/**
 * @param start,end,now   epoch milliseconds
 * @param series          hourly samples: { time, temperature, cloudCover, precipitationProbability, precipitation }
 * @param sunAltitude     function of epoch milliseconds returning degrees
 * @param sunEvents       [{ time, label }] to mark, e.g. sunset
 * @param formatTemperature  function of Celsius returning text
 * @param startLabel,endLabel  optional clock labels for the ends
 * @returns SVG markup built only from numbers and the supplied labels
 */
export function timelineMarkup({ start, end, now, series = [], sunAltitude, sunEvents = [], formatTemperature, startLabel = '', endLabel = '',
  width = 340, height = 78 }) {
  if (!(end > start)) return '';
  const top = 9, bottom = height - 14, x = time => number(clamp((time - start) / (end - start), 0, 1) * width);
  const text = value => String(value).replace(/[&<>"']/g, '');
  const out = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Conditions across the selected time">`];
  const slices = 48;
  for (let i = 0; i < slices; i++) {
    const altitude = sunAltitude(start + (i + 0.5) * (end - start) / slices);
    const fill = altitude > 6 ? 'rgba(120,170,230,0.38)' : altitude > -6 ? 'rgba(240,150,90,0.40)' : 'rgba(8,13,30,0.55)';
    out.push(`<rect x="${number(i * width / slices)}" y="0" width="${number(width / slices + 0.3)}" height="${bottom}" fill="${fill}"/>`);
  }
  const inside = series.filter(s => s.time >= start - 3600000 && s.time <= end);
  const span = number(3600000 / (end - start) * width);
  for (const sample of inside) {
    if (sample.cloudCover != null) out.push(`<rect x="${x(sample.time)}" y="0" width="${span}" height="${top - 2}" fill="rgba(235,240,245,${number(sample.cloudCover / 100 * 0.85)})"/>`);
    const chance = sample.precipitationProbability != null ? sample.precipitationProbability / 100
      : sample.precipitation != null ? clamp(sample.precipitation / 4, 0, 1) : 0;
    if (chance > 0.02) {
      const tall = number(chance * 24);
      out.push(`<rect x="${number(x(sample.time) + 0.5)}" y="${number(bottom - tall)}" width="${number(Math.max(span - 1, 1))}" height="${tall}" fill="rgba(110,180,255,0.75)"/>`);
    }
  }
  const warm = inside.filter(s => s.temperature != null);
  if (warm.length > 1) {
    const low = Math.min(...warm.map(s => s.temperature)), high = Math.max(...warm.map(s => s.temperature));
    const y = value => number(bottom - 6 - (high === low ? 0.5 : (value - low) / (high - low)) * (bottom - top - 16));
    // Samples describe the hour that starts at their time; plot them mid-hour.
    const points = warm.map(s => `${x(s.time + 1800000)},${y(s.temperature)}`).join(' ');
    out.push(`<polyline points="${points}" fill="none" stroke="#ffd9a0" stroke-width="1.8" stroke-linejoin="round"/>`);
    const hottest = warm.find(s => s.temperature === high), coolest = warm.find(s => s.temperature === low);
    const mark = (sample, above) => {
      const px = clamp(x(sample.time + 1800000), 12, width - 12);
      out.push(`<text x="${px}" y="${number(y(sample.temperature) + (above ? -4 : 10))}" class="temp">${text(formatTemperature(sample.temperature))}</text>`);
    };
    mark(hottest, true);
    if (high - low >= 1) mark(coolest, false);
  }
  for (const event of sunEvents) {
    if (event.time <= start || event.time >= end) continue;
    const px = x(event.time);
    out.push(`<line x1="${px}" y1="0" x2="${px}" y2="${bottom}" class="sun"/>`);
    out.push(`<text x="${clamp(px, 30, width - 30)}" y="${height - 3}" class="sun-label">${text(event.label)}</text>`);
  }
  if (now >= start && now <= end) {
    const px = x(now);
    out.push(`<line x1="${px}" y1="0" x2="${px}" y2="${bottom}" class="now"/><circle cx="${px}" cy="${bottom}" r="2.6" class="now-dot"/>`);
  }
  if (startLabel) out.push(`<text x="0" y="${height - 3}" class="end start">${text(startLabel)}</text>`);
  if (endLabel) out.push(`<text x="${width}" y="${height - 3}" class="end finish">${text(endLabel)}</text>`);
  out.push('</svg>');
  return out.join('');
}
