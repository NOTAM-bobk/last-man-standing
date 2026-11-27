// Schedule math, persistence and formatting for the last-man-standing tracker.
// Everything here is pure except loadState/saveState, which touch localStorage.

export const STATE_VERSION = 1;
export const STORAGE_KEY = 'lms.v1';
export const CADENCE_MS = 60 * 60 * 1000;
export const MILES_PER_LAP = 3;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad2(value) {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

// The first event: Saturday 28 November 2026, 05:00 in the device's timezone.
export function firstEventStart() {
  return new Date(2026, 10, 28, 5, 0, 0, 0).getTime();
}

// The next Saturday 05:00 strictly after `fromMs`.
export function nextSaturdayStart(fromMs = Date.now()) {
  const from = new Date(fromMs);
  const daysUntilSaturday = (6 - from.getDay() + 7) % 7;
  const candidate = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + daysUntilSaturday,
    5,
    0,
    0,
    0,
  );
  if (candidate.getTime() <= fromMs) candidate.setDate(candidate.getDate() + 7);
  return candidate.getTime();
}

// First open: the fixed event while it is still ahead, otherwise the next Saturday.
export function defaultStart(fromMs = Date.now()) {
  const first = firstEventStart();
  return first > fromMs ? first : nextSaturdayStart(fromMs);
}

export function createState(startMs, { laps = [], endedAt = null } = {}) {
  return { v: STATE_VERSION, start: startMs, laps, endedAt };
}

export function blankState(fromMs = Date.now()) {
  return createState(defaultStart(fromMs));
}

// Accepts only well-formed saved state, so a corrupt entry can never wedge the app.
export function sanitize(value) {
  if (!value || typeof value !== 'object' || value.v !== STATE_VERSION) return null;
  const start = Number(value.start);
  if (!Number.isFinite(start)) return null;

  const endedAt = value.endedAt === null || value.endedAt === undefined ? null : Number(value.endedAt);
  if (endedAt !== null && !Number.isFinite(endedAt)) return null;

  const seen = new Set();
  const laps = (Array.isArray(value.laps) ? value.laps : [])
    .flatMap((lap) => {
      if (!lap || typeof lap !== 'object') return [];
      const hour = Number(lap.hour);
      const ms = Number(lap.ms);
      const at = Number(lap.at);
      if (!Number.isInteger(hour) || hour < 0 || !Number.isFinite(ms) || ms < 0) return [];
      if (seen.has(hour)) return [];
      seen.add(hour);
      return [
        {
          hour,
          ms: Math.min(ms, CADENCE_MS),
          at: Number.isFinite(at) ? at : start + hour * CADENCE_MS,
        },
      ];
    })
    .sort((a, b) => a.hour - b.hour);

  return { v: STATE_VERSION, start, laps, endedAt };
}

export function loadState(fromMs = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState(fromMs);
    return sanitize(JSON.parse(raw)) ?? blankState(fromMs);
  } catch {
    return blankState(fromMs);
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function derive(state, nowMs = Date.now()) {
  const start = state.start;
  const laps = state.laps;
  const endedAt = state.endedAt;

  const prestart = endedAt === null && nowMs < start;
  const phase = endedAt !== null ? 'ended' : prestart ? 'prestart' : 'running';
  const clock = endedAt !== null ? endedAt : nowMs;
  const elapsed = Math.max(0, clock - start);
  const hourIndex = phase === 'prestart' ? -1 : Math.floor(elapsed / CADENCE_MS);
  const hourStart = hourIndex >= 0 ? start + hourIndex * CADENCE_MS : start;
  const hourEnd = hourStart + CADENCE_MS;
  const lapThisHour = hourIndex >= 0 ? laps.find((lap) => lap.hour === hourIndex) ?? null : null;
  const totalMiles = laps.length * MILES_PER_LAP;
  const runMs = laps.reduce((sum, lap) => sum + lap.ms, 0);
  const totalMs = Math.max(0, clock - start);
  const msToStart = Math.max(0, start - nowMs);
  const msToHourEnd = hourIndex >= 0 ? Math.max(0, hourEnd - clock) : CADENCE_MS;
  const hourProgress =
    hourIndex >= 0 ? Math.min(1, Math.max(0, (clock - hourStart) / CADENCE_MS)) : 0;

  return {
    phase,
    start,
    laps,
    endedAt,
    clock,
    hourIndex,
    hourStart,
    hourEnd,
    lapThisHour,
    lapCount: laps.length,
    totalMiles,
    runMs,
    totalMs,
    msToStart,
    msToHourEnd,
    hourProgress,
    // Rail starts here so a long run stays one comfortable strip.
    firstHour: Math.max(0, hourIndex - 11),
  };
}

export function formatCountdownParts(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function formatMmSs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds === 0) return '0m';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${pad2(minutes % 60)}m`;
  return `${minutes}m ${pad2(seconds % 60)}s`;
}

export function formatDay(ms) {
  const date = new Date(ms);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function formatTime(ms) {
  const date = new Date(ms);
  const hours = date.getHours();
  const suffix = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad2(date.getMinutes())} ${suffix}`;
}

// Rail label: the hour of the day, 24-hour, so the strip scans in order.
export function formatHourShort(ms) {
  return pad2(new Date(ms).getHours());
}

// <input type="datetime-local"> wants a local "YYYY-MM-DDTHH:MM".
export function toInputValue(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

export function fromInputValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
