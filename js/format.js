/** Formatting helpers. Durations are always passed around as seconds. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export { MONTHS, WEEKDAYS };

/** "4h 20m" · "35m" · "0m" — the default for anything a person reads. */
export function hm(seconds) {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Compact hours for axis ticks and dense labels: "4.3h". */
export function hours(seconds, digits = 1) {
  return `${(seconds / 3600).toFixed(digits)}h`;
}

/** Running-timer readout: "01:23:45". */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function timeOfDay(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Fri, Oct 17" (adds the year when it isn't the current one). */
export function dayLabel(key, { withYear = 'auto' } = {}) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const showYear = withYear === true || (withYear === 'auto' && y !== new Date().getFullYear());
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[m - 1]} ${d}${showYear ? `, ${y}` : ''}`;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shortDay(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Parse "1h30", "90", "1.5h", "90m", "1:30" into minutes. */
export function parseDuration(input) {
  const text = String(input).trim().toLowerCase();
  if (!text) return null;
  const colon = text.match(/^(\d+):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const hAndM = text.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(\d+(?:\.\d+)?)?\s*m?(?:in(?:utes?)?)?$/);
  if (hAndM) return Math.round(Number(hAndM[1]) * 60 + Number(hAndM[2] || 0));
  const mOnly = text.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/);
  if (mOnly) return Math.round(Number(mOnly[1]));
  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(Number(bare[1]));
  return null;
}
