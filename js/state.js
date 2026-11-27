// Schedule math, shoe rotation, persistence and formatting for the tracker.
// Everything here is pure except loadState/saveState, which touch localStorage.

export const STATE_VERSION = 2;
export const STORAGE_KEY = 'lms.v2';
export const LEGACY_KEY = 'lms.v1';
export const CADENCE_MS = 60 * 60 * 1000;
export const MILES_PER_LAP = 3;
export const MAX_EVERY = 4;
const NAME_LIMIT = 28;

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

export function newShoeId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `shoe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultRotation() {
  return { every: 1, pinnedShoeId: null };
}

// Prize money is a dollar amount, cents included, never negative.
function cleanPrize(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(1_000_000_000, Math.round(amount * 100) / 100);
}

export function createState(
  startMs,
  { laps = [], endedAt = null, shoes = [], rotation, prize = 0 } = {},
) {
  return {
    v: STATE_VERSION,
    start: startMs,
    laps,
    endedAt,
    shoes,
    prize: cleanPrize(prize),
    rotation: rotation ? { ...defaultRotation(), ...rotation } : defaultRotation(),
  };
}

export function blankState(fromMs = Date.now()) {
  return createState(defaultStart(fromMs));
}

// Accepts v1 (no shoes) and v2 saved state, so an existing run survives the upgrade.
export function sanitize(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.v !== 1 && value.v !== STATE_VERSION) return null;

  const start = Number(value.start);
  if (!Number.isFinite(start)) return null;

  const endedAt = value.endedAt === null || value.endedAt === undefined ? null : Number(value.endedAt);
  if (endedAt !== null && !Number.isFinite(endedAt)) return null;

  const shoes = [];
  const shoeIds = new Set();
  for (const raw of Array.isArray(value.shoes) ? value.shoes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name =
      typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT) : '';
    if (!id || !name || shoeIds.has(id)) continue;
    shoeIds.add(id);
    const addedAt = Number(raw.addedAt);
    shoes.push({ id, name, addedAt: Number.isFinite(addedAt) ? addedAt : start });
  }

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
      const shoeId = typeof lap.shoeId === 'string' && shoeIds.has(lap.shoeId) ? lap.shoeId : null;
      return [
        {
          hour,
          ms: Math.min(ms, CADENCE_MS),
          at: Number.isFinite(at) ? at : start + hour * CADENCE_MS,
          shoeId,
        },
      ];
    })
    .sort((a, b) => a.hour - b.hour);

  const rawRotation = value.rotation && typeof value.rotation === 'object' ? value.rotation : {};
  const everyValue = Math.round(Number(rawRotation.every));
  const every = Number.isFinite(everyValue)
    ? Math.min(MAX_EVERY, Math.max(1, everyValue))
    : 1;
  const pinned =
    typeof rawRotation.pinnedShoeId === 'string' && shoeIds.has(rawRotation.pinnedShoeId)
      ? rawRotation.pinnedShoeId
      : null;

  return {
    v: STATE_VERSION,
    start,
    laps,
    endedAt,
    shoes,
    prize: cleanPrize(value.prize),
    rotation: { every, pinnedShoeId: pinned },
  };
}

export function loadState(fromMs = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw)) ?? blankState(fromMs);

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = sanitize(JSON.parse(legacy));
      if (migrated) {
        saveState(migrated);
        localStorage.removeItem(LEGACY_KEY);
        return migrated;
      }
    }
    return blankState(fromMs);
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

// Which pair a lap gets on its own: one pair for `every` laps, then the next in the list.
export function autoShoeId(shoes, every, lapIndex) {
  if (!Array.isArray(shoes) || shoes.length === 0) return null;
  const step = Math.floor(Math.max(0, lapIndex) / Math.max(1, every)) % shoes.length;
  return shoes[step].id;
}

export function shoeForLap(state, lapIndex) {
  const shoes = state.shoes ?? [];
  const rotation = state.rotation ?? defaultRotation();
  if (rotation.pinnedShoeId && shoes.some((shoe) => shoe.id === rotation.pinnedShoeId)) {
    return rotation.pinnedShoeId;
  }
  return autoShoeId(shoes, rotation.every, lapIndex);
}

export function shoeStats(state) {
  const counts = new Map();
  for (const lap of state.laps ?? []) {
    if (!lap.shoeId) continue;
    counts.set(lap.shoeId, (counts.get(lap.shoeId) ?? 0) + 1);
  }
  return (state.shoes ?? []).map((shoe) => {
    const laps = counts.get(shoe.id) ?? 0;
    return { ...shoe, laps, miles: laps * MILES_PER_LAP };
  });
}

export function derive(state, nowMs = Date.now()) {
  const start = state.start;
  const laps = state.laps;
  const endedAt = state.endedAt;
  const shoes = state.shoes ?? [];
  const rotation = state.rotation ?? defaultRotation();

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

  const shoeUse = {};
  for (const lap of laps) {
    if (!lap.shoeId) continue;
    shoeUse[lap.shoeId] = (shoeUse[lap.shoeId] ?? 0) + 1;
  }

  const pinnedShoeId =
    rotation.pinnedShoeId && shoes.some((shoe) => shoe.id === rotation.pinnedShoeId)
      ? rotation.pinnedShoeId
      : null;
  const activeShoeId =
    pinnedShoeId ?? autoShoeId(shoes, rotation.every, laps.length);
  const nextShoeId = pinnedShoeId ? null : autoShoeId(shoes, rotation.every, laps.length + 1);

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
    prize: state.prize ?? 0,
    shoes,
    rotation,
    pinnedShoeId,
    activeShoeId,
    nextShoeId,
    shoeUse,
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

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

// The start comes from the device's clock, so its label follows the device's locale.
export function formatDay(ms) {
  return DAY_FORMAT.format(new Date(ms));
}

export function formatTime(ms) {
  return TIME_FORMAT.format(new Date(ms));
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
