/**
 * Tests for the data layer — the part that has to stay correct for years:
 * day-boundary splitting, aggregation, streaks, import/export, and recovery
 * from a corrupted or hand-edited store.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Store, splitSpan, dayKey, addDays, diffDays, weekStartKey, normalizeState, defaultState,
  summarize, streak, longestStreak, bucketDays, weekdayProfile, dayTotal, activitySeconds,
} from '../js/store.js';

function fakeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    get raw() { return value; },
  };
}

function freshStore() {
  const store = new Store(fakeStorage());
  store.update((s) => { s.activities = []; s.log = {}; });
  const work = store.addActivity({ name: 'Work', color: 0 });
  const sleep = store.addActivity({ name: 'Sleep', color: 6 });
  return { store, work, sleep };
}

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

test('day keys use local time, not UTC', () => {
  assert.equal(dayKey(new Date(2026, 0, 1, 23, 30)), '2026-01-01');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 5)), '2026-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01'); // 2026 is not a leap year
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(diffDays('2026-01-01', '2026-12-31'), 364);
});

test('weekStartKey honours the configured first day', () => {
  assert.equal(weekStartKey('2026-10-17', 1), '2026-10-12'); // Sat -> Monday
  assert.equal(weekStartKey('2026-10-17', 0), '2026-10-11'); // Sat -> Sunday
});

test('splitSpan divides a session at local midnight', () => {
  const chunks = splitSpan(at(2026, 10, 16, 22, 30), at(2026, 10, 17, 1, 0));
  assert.deepEqual(chunks, [
    { day: '2026-10-16', seconds: 5400 },
    { day: '2026-10-17', seconds: 3600 },
  ]);
});

test('splitSpan covers a multi-day span and conserves total time', () => {
  const start = at(2026, 10, 15, 12, 0);
  const end = at(2026, 10, 18, 6, 0);
  const chunks = splitSpan(start, end);
  assert.equal(chunks.length, 4);
  assert.equal(chunks.reduce((sum, c) => sum + c.seconds, 0), Math.round((end - start) / 1000));
});

test('splitSpan returns nothing for an empty or reversed span', () => {
  assert.deepEqual(splitSpan(1000, 1000), []);
  assert.deepEqual(splitSpan(2000, 1000), []);
});

test('a timer running over midnight lands on both days', () => {
  const { store, work } = freshStore();
  store.startTimer(work, at(2026, 10, 16, 23, 0));
  store.stopTimer(at(2026, 10, 17, 1, 30));
  assert.equal(activitySeconds(store.state, '2026-10-16', work), 3600);
  assert.equal(activitySeconds(store.state, '2026-10-17', work), 5400);
  assert.equal(store.state.running, null);
});

test('starting a second timer logs the first one', () => {
  const { store, work, sleep } = freshStore();
  store.startTimer(work, at(2026, 10, 17, 9, 0));
  store.startTimer(sleep, at(2026, 10, 17, 10, 0));
  assert.equal(activitySeconds(store.state, '2026-10-17', work), 3600);
  assert.equal(store.state.running.activityId, sleep);
});

test('a discarded timer logs nothing', () => {
  const { store, work } = freshStore();
  store.startTimer(work, at(2026, 10, 17, 9, 0));
  store.discardTimer();
  assert.equal(store.state.running, null);
  assert.equal(dayTotal(store.state, '2026-10-17'), 0);
});

test('manual edits add, subtract and clear', () => {
  const { store, work } = freshStore();
  store.addSeconds('2026-10-17', work, 3600);
  store.addSeconds('2026-10-17', work, 1800);
  assert.equal(activitySeconds(store.state, '2026-10-17', work), 5400);
  store.addSeconds('2026-10-17', work, -7200); // clamped at zero
  assert.equal(activitySeconds(store.state, '2026-10-17', work), 0);
  assert.equal(store.state.log['2026-10-17'], undefined, 'empty days are dropped');
});

test('a single activity cannot exceed 24 hours in a day', () => {
  const { store, work } = freshStore();
  store.setSeconds('2026-10-17', work, 90000);
  assert.equal(activitySeconds(store.state, '2026-10-17', work), 86400);
});

test('summarize aggregates totals, coverage and the busiest day', () => {
  const { store, work, sleep } = freshStore();
  store.setSeconds('2026-10-15', work, 3600);
  store.setSeconds('2026-10-15', sleep, 1800);
  store.setSeconds('2026-10-17', work, 7200);
  const summary = summarize(store.state, '2026-10-15', '2026-10-17');
  assert.equal(summary.total, 12600);
  assert.equal(summary.dayCount, 3);
  assert.equal(summary.daysTracked, 2);
  assert.equal(summary.byActivity.get(work), 10800);
  assert.equal(summary.best.day, '2026-10-17');
  assert.equal(summary.averagePerDay, 4200);
  assert.equal(summary.averagePerTrackedDay, 6300);
});

test('streaks count consecutive days and tolerate an unlogged today', () => {
  const { store, work } = freshStore();
  const today = '2026-10-17';
  for (const day of ['2026-10-14', '2026-10-15', '2026-10-16']) store.setSeconds(day, work, 600);
  assert.equal(streak(store.state, today), 3, 'yesterday still counts');
  store.setSeconds(today, work, 600);
  assert.equal(streak(store.state, today), 4);
  store.setSeconds('2026-10-10', work, 600);
  assert.equal(longestStreak(store.state), 4);
  assert.equal(streak(store.state, '2026-10-20'), 0, 'a gap ends the streak');
});

test('bucketDays groups into weeks and months', () => {
  const { store, work } = freshStore();
  for (const day of ['2026-10-05', '2026-10-06', '2026-10-13', '2026-11-02']) {
    store.setSeconds(day, work, 3600);
  }
  const perDay = summarize(store.state, '2026-10-01', '2026-11-30').perDay;
  const weeks = bucketDays(perDay, 'week', 1).filter((b) => b.total > 0);
  assert.deepEqual(weeks.map((b) => [b.key, b.total]), [
    ['2026-10-05', 7200],
    ['2026-10-12', 3600],
    ['2026-11-02', 3600],
  ]);
  const months = bucketDays(perDay, 'month', 1).filter((b) => b.total > 0);
  assert.deepEqual(months.map((b) => [b.key, b.total]), [['2026-10-01', 10800], ['2026-11-01', 3600]]);
});

test('weekdayProfile averages only over tracked days', () => {
  const { store, work } = freshStore();
  store.setSeconds('2026-10-12', work, 3600); // Monday
  store.setSeconds('2026-10-19', work, 7200); // Monday
  const profile = weekdayProfile(summarize(store.state, '2026-10-12', '2026-10-25').perDay);
  assert.equal(profile[1].days, 2);
  assert.equal(profile[1].average, 5400);
  assert.equal(profile[2].average, 0);
});

test('deleting an activity removes its logged time', () => {
  const { store, work, sleep } = freshStore();
  store.setSeconds('2026-10-17', work, 3600);
  store.setSeconds('2026-10-17', sleep, 1800);
  store.startTimer(work, at(2026, 10, 17, 9, 0));
  store.deleteActivity(work);
  assert.equal(store.state.log['2026-10-17'][work], undefined);
  assert.equal(store.state.log['2026-10-17'][sleep], 1800);
  assert.equal(store.state.running, null, 'a running timer for it stops');
});

test('state survives a reload through storage', () => {
  const storage = fakeStorage();
  const first = new Store(storage);
  const id = first.addActivity({ name: 'Piano', color: 2 });
  first.setSeconds('2026-10-17', id, 1800);
  const second = new Store(storage);
  assert.equal(activitySeconds(second.state, '2026-10-17', id), 1800);
  assert.ok(second.state.activities.some((a) => a.name === 'Piano'));
});

test('normalizeState repairs junk instead of throwing it away', () => {
  const state = normalizeState({
    activities: [
      { id: 'a1', name: 'Work', color: 99 },
      { id: 'a1', name: 'Duplicate id' },
      'nonsense',
    ],
    log: {
      '2026-10-17': { a1: 3600, ghost: 900, bad: 'x' },
      'not-a-date': { a1: 60 },
    },
    running: { activityId: 'missing', startedAt: 1 },
    settings: { weekStart: 9, theme: 'neon' },
  });
  assert.equal(state.activities.length, 2, 'the duplicate id is re-issued, junk is dropped');
  assert.ok(state.activities[0].color >= 0 && state.activities[0].color < 8);
  assert.deepEqual(Object.keys(state.log), ['2026-10-17']);
  assert.deepEqual(state.log['2026-10-17'], { a1: 3600 }, 'unknown activities and bad values go');
  assert.equal(state.running, null, 'a timer for a missing activity is cleared');
  assert.equal(state.settings.weekStart, 1);
  assert.equal(state.settings.theme, 'system');
});

test('a corrupted blob starts the app empty rather than crashing', () => {
  const store = new Store(fakeStorage('{not json'));
  assert.ok(store.loadError, 'the failure is recorded so the UI can say so');
  assert.ok(store.state.activities.length > 0);
});

test('export and import round-trip', () => {
  const { store, work } = freshStore();
  store.setSeconds('2026-10-17', work, 3600);
  const backup = store.exportJSON();

  const restored = new Store(fakeStorage());
  restored.importJSON(backup, 'replace');
  const workId = restored.state.activities.find((a) => a.name === 'Work').id;
  assert.equal(activitySeconds(restored.state, '2026-10-17', workId), 3600);
});

test('merge import matches activities by name and keeps the larger value', () => {
  const { store, work } = freshStore();
  store.setSeconds('2026-10-17', work, 3600);
  store.setSeconds('2026-10-16', work, 1800);
  const backup = store.exportJSON();

  const target = new Store(fakeStorage());
  target.update((s) => { s.activities = []; s.log = {}; });
  const localWork = target.addActivity({ name: 'Work', color: 0 });
  target.setSeconds('2026-10-17', localWork, 7200);
  target.importJSON(backup, 'merge');

  assert.equal(target.state.activities.filter((a) => a.name === 'Work').length, 1, 'no duplicate activity');
  assert.equal(activitySeconds(target.state, '2026-10-17', localWork), 7200, 'local value wins when larger');
  assert.equal(activitySeconds(target.state, '2026-10-16', localWork), 1800, 'missing days come across');
  assert.ok(target.state.activities.some((a) => a.name === 'Sleep'), 'new activities are added');
});

test('CSV export is one tidy row per day and activity', () => {
  const { store, work } = freshStore();
  store.setSeconds('2026-10-17', work, 5400);
  const [header, row] = store.exportCSV().split('\n');
  assert.equal(header, 'date,activity,minutes,hours');
  assert.equal(row, '2026-10-17,"Work",90.0,1.50');
});

test('a save failure is reported instead of being swallowed', () => {
  const store = new Store({
    getItem: () => null,
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
  });
  store.addActivity({ name: 'Work' });
  assert.ok(store.saveError, 'the UI can warn that changes are not persisting');
});

test('ten years of daily logging stays well inside the storage budget', () => {
  const storage = fakeStorage();
  const store = new Store(storage);
  const ids = store.state.activities.map((a) => a.id);
  store.update((s) => {
    for (let i = 0; i < 3650; i++) {
      const day = addDays('2016-01-01', i);
      s.log[day] = Object.fromEntries(ids.map((id, n) => [id, 1800 + n * 600]));
    }
  });
  const bytes = Buffer.byteLength(storage.raw, 'utf8');
  assert.ok(bytes < 2_000_000, `10 years of 6 activities is ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  const summary = summarize(store.state, '2016-01-01', '2025-12-29');
  assert.equal(summary.daysTracked, 3650);
});

test('defaultState gives a usable starting point', () => {
  const state = defaultState();
  assert.ok(state.activities.length >= 4);
  assert.equal(Object.keys(state.log).length, 0);
  assert.equal(state.running, null);
});
