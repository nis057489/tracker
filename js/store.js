/**
 * Data model + persistence.
 *
 * Storage shape (localStorage, JSON):
 *   {
 *     schema: 1,
 *     activities: [{ id, name, color, goal, archived, order }],
 *     log: { "YYYY-MM-DD": { activityId: seconds } },
 *     running: { activityId, startedAt, seen } | null,
 *     settings: { weekStart, theme, textures },
 *     createdAt
 *   }
 *
 * Seconds are stored as integers aggregated per day per activity. That keeps a
 * decade of tracking in a few hundred KB (a day with 6 activities is ~70 bytes)
 * which matters because localStorage gives us ~5MB total.
 */

export const SCHEMA = 1;
export const STORAGE_KEY = 'timetracker.v1';
export const PALETTE_SLOTS = 8;
/** Elapsed time past which a running timer is treated as "probably forgotten". */
export const STALE_TIMER_SECONDS = 8 * 3600;

const pad2 = (n) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ dates */

/** Local-time day key, "YYYY-MM-DD". All day math is local, never UTC. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function diffDays(fromKey, toKey) {
  const ms = keyToDate(toKey) - keyToDate(fromKey);
  return Math.round(ms / 86400000);
}

/** Inclusive list of day keys. */
export function dayRange(fromKey, toKey) {
  const out = [];
  const n = diffDays(fromKey, toKey);
  for (let i = 0; i <= n; i++) out.push(addDays(fromKey, i));
  return out;
}

/** Start of the week containing `key`, with weekStart 0=Sun..6=Sat. */
export function weekStartKey(key, weekStart = 1) {
  const d = keyToDate(key);
  const shift = (d.getDay() - weekStart + 7) % 7;
  return addDays(key, -shift);
}

export function monthStartKey(key) {
  return `${key.slice(0, 7)}-01`;
}

/**
 * Split a wall-clock span into per-day chunks at local midnight, so a session
 * that crosses midnight (or a timer left running for days) lands on the right
 * days instead of all on one.
 */
export function splitSpan(startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const d = new Date(cursor);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const chunkEnd = Math.min(endMs, nextMidnight);
    const seconds = Math.round((chunkEnd - cursor) / 1000);
    if (seconds > 0) out.push({ day: dayKey(d), seconds });
    cursor = chunkEnd;
  }
  return out;
}

/* ------------------------------------------------------------------- state */

let idCounter = 0;
export function uid(prefix = 'a') {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const STARTER_ACTIVITIES = [
  { name: 'Sleep', color: 6, goal: 480 },
  { name: 'Work', color: 0, goal: 480 },
  { name: 'Exercise', color: 2, goal: 45 },
  { name: 'Reading', color: 3, goal: 30 },
  { name: 'Chores', color: 1, goal: 0 },
  { name: 'Screen time', color: 4, goal: 0 },
];

export function defaultState(now = Date.now()) {
  return {
    schema: SCHEMA,
    createdAt: now,
    activities: STARTER_ACTIVITIES.map((a, i) => ({
      id: uid(),
      name: a.name,
      color: a.color,
      goal: a.goal,
      archived: false,
      order: i,
    })),
    log: {},
    running: null,
    settings: { weekStart: 1, theme: 'system', textures: false },
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce anything (old schema, hand-edited import, corrupted blob) into a valid
 * state. Unknown activity ids and junk values are dropped rather than thrown on:
 * a years-long log should survive a bad write somewhere in the middle.
 */
export function normalizeState(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return defaultState(now);

  const activities = [];
  const seenIds = new Set();
  const list = Array.isArray(raw.activities) ? raw.activities : [];
  list.forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    const id = typeof a.id === 'string' && a.id && !seenIds.has(a.id) ? a.id : uid();
    seenIds.add(id);
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 60) : `Activity ${i + 1}`;
    activities.push({
      id,
      name,
      color: Number.isInteger(a.color) ? ((a.color % PALETTE_SLOTS) + PALETTE_SLOTS) % PALETTE_SLOTS : i % PALETTE_SLOTS,
      goal: Number.isFinite(a.goal) ? Math.max(0, Math.round(a.goal)) : 0,
      archived: Boolean(a.archived),
      order: Number.isFinite(a.order) ? a.order : i,
    });
  });
  activities.sort((a, b) => a.order - b.order);
  activities.forEach((a, i) => { a.order = i; });

  const valid = new Set(activities.map((a) => a.id));
  const log = {};
  const rawLog = raw.log && typeof raw.log === 'object' ? raw.log : {};
  for (const [day, entry] of Object.entries(rawLog)) {
    if (!DAY_RE.test(day) || !entry || typeof entry !== 'object') continue;
    const clean = {};
    for (const [actId, seconds] of Object.entries(entry)) {
      if (!valid.has(actId)) continue;
      const s = Math.round(Number(seconds));
      if (Number.isFinite(s) && s > 0) clean[actId] = Math.min(s, 86400);
    }
    if (Object.keys(clean).length) log[day] = clean;
  }

  let running = null;
  const r = raw.running;
  if (r && typeof r === 'object' && valid.has(r.activityId) && Number.isFinite(r.startedAt)) {
    running = {
      activityId: r.activityId,
      startedAt: Math.min(r.startedAt, now),
      seen: Number.isFinite(r.seen) ? Math.min(Math.max(r.seen, r.startedAt), now) : r.startedAt,
    };
  }

  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  return {
    schema: SCHEMA,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    activities,
    log,
    running,
    settings: {
      weekStart: s.weekStart === 0 || s.weekStart === 6 ? s.weekStart : 1,
      theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
      textures: Boolean(s.textures),
    },
  };
}

/* ------------------------------------------------------------------ queries */

export function dayEntry(state, day) {
  return state.log[day] || null;
}

export function dayTotal(state, day) {
  const entry = state.log[day];
  if (!entry) return 0;
  let total = 0;
  for (const s of Object.values(entry)) total += s;
  return total;
}

export function activitySeconds(state, day, activityId) {
  const entry = state.log[day];
  return (entry && entry[activityId]) || 0;
}

export function activityById(state, id) {
  return state.activities.find((a) => a.id === id) || null;
}

export function visibleActivities(state) {
  return state.activities.filter((a) => !a.archived);
}

/** Seconds the running timer has accumulated but not yet written to the log. */
export function pendingSeconds(state, now = Date.now()) {
  if (!state.running) return 0;
  return Math.max(0, Math.round((now - state.running.startedAt) / 1000));
}

/** The earliest and latest days with data (null when the log is empty). */
export function logBounds(state) {
  const keys = Object.keys(state.log).sort();
  if (!keys.length) return null;
  return { first: keys[0], last: keys[keys.length - 1] };
}

/**
 * Aggregate a date range once and derive everything from the result, so a view
 * never walks the log more than it has to.
 */
export function summarize(state, fromKey, toKey) {
  const byActivity = new Map();
  const perDay = [];
  let total = 0;
  let daysTracked = 0;
  let best = null;

  for (const day of dayRange(fromKey, toKey)) {
    const entry = state.log[day];
    let dayTotalSeconds = 0;
    if (entry) {
      for (const [actId, seconds] of Object.entries(entry)) {
        dayTotalSeconds += seconds;
        byActivity.set(actId, (byActivity.get(actId) || 0) + seconds);
      }
    }
    if (dayTotalSeconds > 0) daysTracked += 1;
    if (!best || dayTotalSeconds > best.seconds) best = { day, seconds: dayTotalSeconds };
    total += dayTotalSeconds;
    perDay.push({ day, total: dayTotalSeconds, byActivity: entry || {} });
  }

  const dayCount = perDay.length;
  return {
    fromKey,
    toKey,
    total,
    dayCount,
    daysTracked,
    best: best && best.seconds > 0 ? best : null,
    perDay,
    byActivity,
    averagePerDay: dayCount ? total / dayCount : 0,
    averagePerTrackedDay: daysTracked ? total / daysTracked : 0,
  };
}

/** Consecutive tracked days ending today (or yesterday, so today stays open). */
export function streak(state, todayKeyValue = dayKey()) {
  let cursor = todayKeyValue;
  if (dayTotal(state, cursor) === 0) {
    cursor = addDays(cursor, -1);
    if (dayTotal(state, cursor) === 0) return 0;
  }
  let count = 0;
  while (dayTotal(state, cursor) > 0) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function longestStreak(state) {
  const keys = Object.keys(state.log).filter((k) => dayTotal(state, k) > 0).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && diffDays(prev, key) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = key;
  }
  return best;
}

/** Bucket a summary's days into weeks or months for trend charts. */
export function bucketDays(perDay, grain, weekStart = 1) {
  const buckets = new Map();
  for (const row of perDay) {
    let key;
    if (grain === 'week') key = weekStartKey(row.day, weekStart);
    else if (grain === 'month') key = monthStartKey(row.day);
    else key = row.day;
    const bucket = buckets.get(key) || { key, total: 0, days: 0, byActivity: {} };
    bucket.total += row.total;
    bucket.days += 1;
    for (const [actId, seconds] of Object.entries(row.byActivity)) {
      bucket.byActivity[actId] = (bucket.byActivity[actId] || 0) + seconds;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Average seconds per weekday (index 0=Sunday), over tracked days only. */
export function weekdayProfile(perDay) {
  const totals = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const row of perDay) {
    const wd = keyToDate(row.day).getDay();
    if (row.total > 0) {
      totals[wd] += row.total;
      counts[wd] += 1;
    }
  }
  return totals.map((t, i) => ({ weekday: i, average: counts[i] ? t / counts[i] : 0, days: counts[i] }));
}

/* -------------------------------------------------------------------- store */

/**
 * Observable state container. Takes a storage object so it can be driven by
 * localStorage in the browser and by a plain object in tests.
 */
export class Store {
  constructor(storage, { now = () => Date.now(), key = STORAGE_KEY } = {}) {
    this.storage = storage;
    this.now = now;
    this.key = key;
    this.listeners = new Set();
    this.loadError = null;
    this.state = this.#read();
  }

  #read() {
    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (err) {
      this.loadError = err;
    }
    if (!raw) return defaultState(this.now());
    try {
      return normalizeState(JSON.parse(raw), this.now());
    } catch (err) {
      this.loadError = err;
      return defaultState(this.now());
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply a mutation, persist, then notify. Mutators work on a shallow clone. */
  update(mutator) {
    const next = {
      ...this.state,
      activities: this.state.activities.map((a) => ({ ...a })),
      log: { ...this.state.log },
      settings: { ...this.state.settings },
    };
    const result = mutator(next);
    this.state = result === undefined ? next : result;
    this.save();
    this.listeners.forEach((fn) => fn(this.state));
    return this.state;
  }

  save() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
      this.saveError = null;
    } catch (err) {
      this.saveError = err;
      this.listeners.forEach((fn) => fn(this.state, err));
    }
  }

  replaceState(raw) {
    return this.update(() => normalizeState(raw, this.now()));
  }

  /* --- activities --- */

  addActivity({ name, color, goal = 0 }) {
    const id = uid();
    this.update((s) => {
      const used = new Set(s.activities.map((a) => a.color));
      let slot = Number.isInteger(color) ? color : 0;
      if (!Number.isInteger(color)) {
        for (let i = 0; i < PALETTE_SLOTS; i++) if (!used.has(i)) { slot = i; break; }
      }
      s.activities.push({
        id,
        name: String(name || 'Untitled').trim().slice(0, 60) || 'Untitled',
        color: slot,
        goal: Math.max(0, Math.round(goal) || 0),
        archived: false,
        order: s.activities.length,
      });
    });
    return id;
  }

  updateActivity(id, patch) {
    this.update((s) => {
      const a = s.activities.find((x) => x.id === id);
      if (!a) return;
      if (patch.name !== undefined) a.name = String(patch.name).trim().slice(0, 60) || a.name;
      if (patch.color !== undefined) a.color = ((Math.round(patch.color) % PALETTE_SLOTS) + PALETTE_SLOTS) % PALETTE_SLOTS;
      if (patch.goal !== undefined) a.goal = Math.max(0, Math.round(patch.goal) || 0);
      if (patch.archived !== undefined) a.archived = Boolean(patch.archived);
    });
  }

  moveActivity(id, delta) {
    this.update((s) => {
      const i = s.activities.findIndex((a) => a.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.activities.length) return;
      const [item] = s.activities.splice(i, 1);
      s.activities.splice(j, 0, item);
      s.activities.forEach((a, idx) => { a.order = idx; });
    });
  }

  /** Delete an activity and every logged second attached to it. */
  deleteActivity(id) {
    this.update((s) => {
      s.activities = s.activities.filter((a) => a.id !== id);
      s.activities.forEach((a, idx) => { a.order = idx; });
      for (const [day, entry] of Object.entries(s.log)) {
        if (!(id in entry)) continue;
        const next = { ...entry };
        delete next[id];
        if (Object.keys(next).length) s.log[day] = next;
        else delete s.log[day];
      }
      if (s.running && s.running.activityId === id) s.running = null;
    });
  }

  /* --- log --- */

  setSeconds(day, activityId, seconds) {
    this.update((s) => {
      const value = Math.max(0, Math.min(86400, Math.round(seconds) || 0));
      const entry = { ...(s.log[day] || {}) };
      if (value > 0) entry[activityId] = value;
      else delete entry[activityId];
      if (Object.keys(entry).length) s.log[day] = entry;
      else delete s.log[day];
    });
  }

  addSeconds(day, activityId, delta) {
    const current = activitySeconds(this.state, day, activityId);
    this.setSeconds(day, activityId, current + delta);
  }

  /** Write a wall-clock span, splitting it across local midnights. */
  addSpan(activityId, startMs, endMs) {
    const chunks = splitSpan(startMs, endMs);
    this.update((s) => {
      for (const chunk of chunks) {
        const entry = { ...(s.log[chunk.day] || {}) };
        entry[activityId] = Math.min(86400, (entry[activityId] || 0) + chunk.seconds);
        s.log[chunk.day] = entry;
      }
    });
    return chunks;
  }

  /* --- timer --- */

  startTimer(activityId, at = this.now()) {
    this.update((s) => {
      if (s.running) {
        const prev = s.running;
        for (const chunk of splitSpan(prev.startedAt, at)) {
          const entry = { ...(s.log[chunk.day] || {}) };
          entry[prev.activityId] = Math.min(86400, (entry[prev.activityId] || 0) + chunk.seconds);
          s.log[chunk.day] = entry;
        }
      }
      s.running = { activityId, startedAt: at, seen: at };
    });
  }

  /** Stop the timer, optionally back-dating the end (for a forgotten timer). */
  stopTimer(endAt = this.now()) {
    const running = this.state.running;
    if (!running) return null;
    const end = Math.max(running.startedAt, endAt);
    this.update((s) => {
      for (const chunk of splitSpan(running.startedAt, end)) {
        const entry = { ...(s.log[chunk.day] || {}) };
        entry[running.activityId] = Math.min(86400, (entry[running.activityId] || 0) + chunk.seconds);
        s.log[chunk.day] = entry;
      }
      s.running = null;
    });
    return { activityId: running.activityId, startedAt: running.startedAt, endedAt: end };
  }

  discardTimer() {
    this.update((s) => { s.running = null; });
  }

  /** Heartbeat so a timer running when the tab dies has a known last-seen time. */
  touchTimer(at = this.now()) {
    if (!this.state.running) return;
    this.state.running = { ...this.state.running, seen: at };
    this.save();
  }

  setSetting(key, value) {
    this.update((s) => { s.settings[key] = value; });
  }

  /* --- backup --- */

  exportJSON() {
    return JSON.stringify({ ...this.state, exportedAt: new Date().toISOString(), app: 'timetracker' }, null, 2);
  }

  /**
   * Import a backup. 'replace' swaps everything; 'merge' keeps current data and
   * adds the backup's, matching activities by name so re-imports don't fork.
   */
  importJSON(text, mode = 'replace') {
    const parsed = normalizeState(JSON.parse(text), this.now());
    if (mode === 'replace') {
      this.replaceState(parsed);
      return { activities: parsed.activities.length, days: Object.keys(parsed.log).length };
    }
    const idMap = new Map();
    this.update((s) => {
      const byName = new Map(s.activities.map((a) => [a.name.toLowerCase(), a]));
      for (const incoming of parsed.activities) {
        const existing = byName.get(incoming.name.toLowerCase());
        if (existing) {
          idMap.set(incoming.id, existing.id);
        } else {
          const copy = { ...incoming, order: s.activities.length };
          s.activities.push(copy);
          byName.set(copy.name.toLowerCase(), copy);
          idMap.set(incoming.id, copy.id);
        }
      }
      for (const [day, entry] of Object.entries(parsed.log)) {
        const merged = { ...(s.log[day] || {}) };
        for (const [actId, seconds] of Object.entries(entry)) {
          const mapped = idMap.get(actId);
          if (!mapped) continue;
          merged[mapped] = Math.min(86400, Math.max(merged[mapped] || 0, seconds));
        }
        if (Object.keys(merged).length) s.log[day] = merged;
      }
      s.activities.forEach((a, i) => { a.order = i; });
    });
    return { activities: parsed.activities.length, days: Object.keys(parsed.log).length };
  }

  /** Tidy CSV: one row per day per activity, easy to pivot in a spreadsheet. */
  exportCSV() {
    const names = new Map(this.state.activities.map((a) => [a.id, a.name]));
    const rows = ['date,activity,minutes,hours'];
    for (const day of Object.keys(this.state.log).sort()) {
      for (const [actId, seconds] of Object.entries(this.state.log[day])) {
        const name = (names.get(actId) || 'Unknown').replace(/"/g, '""');
        rows.push(`${day},"${name}",${(seconds / 60).toFixed(1)},${(seconds / 3600).toFixed(2)}`);
      }
    }
    return rows.join('\n');
  }

  storageBytes() {
    try {
      return new Blob([this.storage.getItem(this.key) || '']).size;
    } catch {
      return (JSON.stringify(this.state) || '').length;
    }
  }
}
