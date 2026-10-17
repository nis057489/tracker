/**
 * Boot the real app against the DOM stub and render every tab, with a year of
 * seeded data so the charts, tables and summaries all run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-stub.mjs';

function seed() {
  const ids = ['a-sleep', 'a-work', 'a-run'];
  const log = {};
  const today = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (i % 7 === 3) continue; // a weekly gap, so empty days are exercised
    log[key] = {
      'a-sleep': 25200 + (i % 5) * 900,
      'a-work': 14400 + (i % 9) * 1200,
      ...(i % 3 === 0 ? { 'a-run': 2700 } : {}),
    };
  }
  return JSON.stringify({
    schema: 1,
    activities: [
      { id: 'a-sleep', name: 'Sleep', color: 6, goal: 480, archived: false, order: 0 },
      { id: 'a-work', name: 'Work', color: 0, goal: 420, archived: false, order: 1 },
      { id: 'a-run', name: 'Running', color: 2, goal: 30, archived: false, order: 2 },
    ],
    log,
    running: null,
    settings: { weekStart: 1, theme: 'system', textures: false },
  });
}

async function boot(extraStorage = {}) {
  const env = installDom({ storage: { 'timetracker.v1': seed(), ...extraStorage } });
  const { doc } = env;
  for (const id of ['view', 'nav', 'banner', 'toasts']) {
    const el = doc.createElement('div');
    el.setAttribute('id', id);
    doc.body.append(el);
  }
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  doc.head.append(meta);
  // Fresh module instance per test run.
  await import(`../js/app.js?cache=${Math.random()}`);
  return { ...env, view: doc.querySelector('#view'), nav: doc.querySelector('#nav') };
}

function text(el) { return el.textContent; }

test('the app boots on the Track tab and renders the day', async () => {
  const { view, nav } = await boot();
  assert.ok(view.children.length > 0, 'the view is populated');
  assert.match(text(view), /Tracked today/);
  assert.match(text(view), /Sleep/);
  assert.match(text(view), /Work/);
  assert.match(text(view), /\+15m/, 'quick-add buttons are present');
  assert.equal(nav.children.length, 4, 'four tabs');
});

test('every tab renders without throwing', async () => {
  const { view, nav } = await boot();
  const labels = nav.children.map((b) => b.textContent);
  assert.deepEqual(labels, ['Track', 'History', 'Insights', 'Settings']);

  nav.children[1].click();
  assert.match(text(view), /Every day in \d{4}/, 'History shows the year heatmap');
  assert.match(text(view), /Months in \d{4}/);
  assert.ok(view.querySelectorAll('.heat-cell').length > 250, 'the year so far is drawn, one cell per day');

  nav.children[2].click();
  assert.match(text(view), /Total tracked/, 'Insights leads with the hero figure');
  assert.match(text(view), /Where the time went/);
  assert.match(text(view), /Weekday rhythm/);

  nav.children[3].click();
  assert.match(text(view), /Activities/);
  assert.match(text(view), /Export JSON/);
  assert.match(text(view), /Danger zone/);
});

test('charts draw marks and ship a data table beside them', async () => {
  const { view, nav } = await boot();
  nav.children[2].click();
  assert.ok(view.querySelectorAll('path').length > 3, 'bars and the trend line are drawn');
  assert.ok(view.querySelectorAll('.data-table').length >= 3, 'each chart has its table');
  assert.ok(view.querySelectorAll('svg').length >= 3);
});

test('quick-add writes through to storage', async () => {
  const { view, storage } = await boot();
  const before = JSON.parse(storage['timetracker.v1']);
  const chip = view.querySelectorAll('.chip').find((c) => c.textContent.includes('+30m'));
  assert.ok(chip, 'a +30m chip exists');
  chip.click();
  const after = JSON.parse(storage['timetracker.v1']);
  const today = Object.keys(after.log).sort().pop();
  assert.equal(after.log[today]['a-sleep'] - before.log[today]['a-sleep'], 1800);
});

test('an empty install renders the starter activities', async () => {
  const { view } = await boot({ 'timetracker.v1': null });
  assert.match(text(view), /Tracked today/);
  assert.match(text(view), /Sleep/);
  assert.match(text(view), /No streak yet/);
});

test('a running timer shows the stop control and live clock', async () => {
  const started = Date.now() - 3600 * 1000;
  const state = JSON.parse(seed());
  state.running = { activityId: 'a-work', startedAt: started, seen: Date.now() };
  const { view } = await boot({ 'timetracker.v1': JSON.stringify(state) });
  assert.match(text(view), /Running/);
  assert.match(text(view), /Stop & log/);
  assert.ok(view.querySelector('[data-timer]'), 'the live clock element is marked for ticking');
});

test('a storage failure surfaces a banner instead of failing silently', async () => {
  const env = installDom({ storage: {} });
  const { doc } = env;
  for (const id of ['view', 'nav', 'banner', 'toasts']) {
    const el = doc.createElement('div');
    el.setAttribute('id', id);
    doc.body.append(el);
  }
  doc.body.append(Object.assign(doc.createElement('meta'), {}));
  globalThis.window.localStorage.setItem = () => { throw new Error('quota'); };
  await import(`../js/app.js?cache=${Math.random()}`);
  const view = doc.querySelector('#view');
  const chip = view.querySelectorAll('.chip').find((c) => c.textContent.includes('+15m'));
  chip.click();
  assert.match(doc.querySelector('#banner').textContent, /not being saved/);
});
