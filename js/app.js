/**
 * App shell: routing, rendering, the one-second timer tick, service-worker
 * updates, and the forgotten-timer recovery prompt.
 */

import { h, clear, qs } from './dom.js';
import { icon } from './icons.js';
import { clock, hm, timeOfDay, dayLabel } from './format.js';
import { hideTip } from './charts.js';
import {
  Store, dayKey, dayTotal, activitySeconds, pendingSeconds, STALE_TIMER_SECONDS, defaultState,
} from './store.js';
import { renderTrack } from './views/track.js';
import { renderHistory } from './views/history.js';
import { renderInsights } from './views/insights.js';
import { renderSettings } from './views/settings.js';

export const VERSION = 'v1.0.0';

const TABS = [
  { id: 'track', label: 'Track', icon: 'clock', render: renderTrack },
  { id: 'history', label: 'History', icon: 'calendar', render: renderHistory },
  { id: 'insights', label: 'Insights', icon: 'chart', render: renderInsights },
  { id: 'settings', label: 'Settings', icon: 'cog', render: renderSettings },
];

const store = new Store(window.localStorage);
const ui = { track: {}, history: {}, insights: {}, settings: {} };

let tab = tabFromHash();
let day = dayKey();
let installPrompt = null;
let promptedTimer = null;
let resizeHandlers = [];
let mountHandlers = [];
let lastWidth = 0;
let resizeTimer = null;
let lastKnownToday = dayKey();

const viewRoot = qs('#view');
const navRoot = qs('#nav');
const bannerRoot = qs('#banner');

/* ------------------------------------------------------------------ render */

function tabFromHash() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? id : 'track';
}

function navigate(id, { replace = false } = {}) {
  tab = id;
  const hash = `#/${id}`;
  if (replace) window.history.replaceState(null, '', hash);
  else if (window.location.hash !== hash) window.location.hash = hash;
  render();
}

function context() {
  return {
    store,
    state: store.state,
    day,
    ui: ui[tab],
    version: VERSION,
    now: () => Date.now(),
    width: viewRoot.clientWidth,
    setDay: (value) => { day = value; render(); },
    navigate,
    rerender: render,
    toast,
    onMount: (fn) => mountHandlers.push(fn),
    onResize: (fn) => resizeHandlers.push(fn),
    applyTheme,
    canInstall: () => Boolean(installPrompt),
    isInstalled: () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    install: async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      render();
    },
    resetAll: () => {
      store.replaceState(defaultState(Date.now()));
      day = dayKey();
      toast('App reset');
      navigate('track');
    },
  };
}

function render() {
  const scroll = window.scrollY;
  hideTip();
  resizeHandlers = [];
  mountHandlers = [];

  const current = TABS.find((t) => t.id === tab) || TABS[0];
  clear(viewRoot).append(current.render(context()));
  renderNav();
  renderBanner();
  mountHandlers.forEach((fn) => fn());
  lastWidth = viewRoot.clientWidth;
  window.scrollTo({ top: scroll });
}

function renderNav() {
  clear(navRoot).append(...TABS.map((t) => h('button', {
    class: `nav-btn${t.id === tab ? ' is-on' : ''}`,
    'aria-current': t.id === tab ? 'page' : null,
    onclick: () => navigate(t.id),
  }, [icon(t.icon), h('span', { text: t.label })])));
}

/** Storage failures are the one error worth interrupting for. */
function renderBanner() {
  clear(bannerRoot);
  if (store.saveError) {
    bannerRoot.append(h('div', { class: 'banner banner-error' }, [
      h('p', {}, [h('strong', { text: 'Changes are not being saved. ' }), 'Browser storage is full or blocked — export a backup from Settings.']),
    ]));
  } else if (store.loadError) {
    bannerRoot.append(h('div', { class: 'banner banner-error' }, [
      h('p', {}, [h('strong', { text: 'Saved data could not be read. ' }), 'The app started empty rather than overwrite anything — import a backup from Settings.']),
    ]));
  }
}

/* ------------------------------------------------------------------- toast */

function toast(message, action) {
  const host = qs('#toasts');
  const el = h('div', { class: 'toast', role: 'status' }, [
    h('span', { text: message }),
    action ? h('button', { class: 'btn btn-sm btn-ghost', text: action.label, onclick: () => { action.run(); el.remove(); } }) : null,
  ]);
  host.append(el);
  setTimeout(() => el.classList.add('is-out'), action ? 8000 : 2400);
  setTimeout(() => el.remove(), action ? 8600 : 3000);
}

/* -------------------------------------------------------------------- tick */

/**
 * While a timer runs, patch only the live numbers — a full re-render every
 * second would fight with inputs and scrolling.
 */
function tick() {
  const running = store.state.running;
  if (!running) return;
  const elapsed = pendingSeconds(store.state, Date.now());
  document.querySelectorAll('[data-timer]').forEach((el) => { el.textContent = clock(elapsed); });

  if (tab === 'track' && day === dayKey()) {
    const totalEl = document.querySelector('[data-live-total]');
    if (totalEl) totalEl.textContent = hm(dayTotal(store.state, day) + elapsed);
    const valueEl = document.querySelector(`[data-live-activity="${running.activityId}"]`);
    if (valueEl) valueEl.textContent = hm(activitySeconds(store.state, day, running.activityId) + elapsed);
    const meterEl = document.querySelector(`[data-live-meter="${running.activityId}"]`);
    if (meterEl) {
      const goal = Number(meterEl.dataset.goal) || 0;
      if (goal > 0) {
        const pct = Math.min(100, ((activitySeconds(store.state, day, running.activityId) + elapsed) / goal) * 100);
        meterEl.style.width = `${pct}%`;
      }
    }
  }
}

/** Roll the view over to the new day if the app is left open past midnight. */
function checkDayRollover() {
  const todayKey = dayKey();
  if (day !== todayKey && day === lastKnownToday) {
    day = todayKey;
    render();
  }
  lastKnownToday = todayKey;
}

/* ------------------------------------------------------- forgotten timers */

/**
 * A timer that has been running for hours usually means the app was closed with
 * it on. Offer the last moment the app was actually open as the end time.
 */
function checkStaleTimer() {
  const running = store.state.running;
  if (!running) return;
  const elapsed = pendingSeconds(store.state, Date.now());
  if (elapsed < STALE_TIMER_SECONDS || promptedTimer === running.startedAt) return;
  promptedTimer = running.startedAt;

  const activity = store.state.activities.find((a) => a.id === running.activityId);
  const seenSeconds = Math.max(0, Math.round((running.seen - running.startedAt) / 1000));
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();

  overlay.append(h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Timer still running' }, [
    h('h2', { text: 'That timer is still running' }),
    h('p', {}, [
      h('strong', { text: activity ? activity.name : 'A timer' }),
      ` has been running for ${hm(elapsed)}, since ${timeOfDay(running.startedAt)} on ${dayLabel(dayKey(new Date(running.startedAt)), { withYear: true })}.`,
    ]),
    h('p', { class: 'c-note', text: `This app was last open at ${timeOfDay(running.seen)}, which is ${hm(seenSeconds)} after the timer started.` }),
    h('div', { class: 'modal-actions' }, [
      h('button', {
        class: 'btn btn-primary',
        onclick: () => { store.stopTimer(store.state.running.seen); close(); toast(`Logged ${hm(seenSeconds)}`); },
      }, [`Log ${hm(seenSeconds)} and stop`]),
      h('button', { class: 'btn', onclick: () => { close(); toast('Timer still running'); } }, ['Keep running']),
      h('button', {
        class: 'btn btn-danger',
        onclick: () => { store.discardTimer(); close(); toast('Timer discarded'); },
      }, ['Discard']),
    ]),
  ]));
  overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  document.body.append(overlay);
  overlay.querySelector('button').focus();
}

/* ------------------------------------------------------------------ theme */

function applyTheme() {
  const theme = store.state.settings.theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0d0d0d' : '#f9f9f7');
}

/* --------------------------------------------------------- service worker */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready.', { label: 'Reload', run: () => window.location.reload() });
        }
      });
    });
  } catch {
    /* Offline support is a bonus; the app works without it. */
  }
}

/* -------------------------------------------------------------------- boot */

store.subscribe(() => render());

window.addEventListener('hashchange', () => {
  const next = tabFromHash();
  if (next === tab) return; // our own navigate() already rendered
  tab = next;
  render();
});

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  if (tab === 'settings') render();
});
window.addEventListener('appinstalled', () => { installPrompt = null; });

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    store.touchTimer();
  } else {
    checkDayRollover();
    checkStaleTimer();
    tick();
  }
});
window.addEventListener('pagehide', () => store.touchTimer());

new ResizeObserver(() => {
  const width = viewRoot.clientWidth;
  if (Math.abs(width - lastWidth) < 8) return;
  lastWidth = width;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resizeHandlers.forEach((fn) => fn()), 120);
}).observe(viewRoot);

setInterval(tick, 1000);
setInterval(() => { store.touchTimer(); }, 30000);
setInterval(checkDayRollover, 60000);

applyTheme();
navigate(tab, { replace: true });
checkStaleTimer();
registerServiceWorker();
