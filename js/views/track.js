/**
 * Track — the daily logging surface.
 *
 * One row per activity for the selected day. Time goes in three ways: a live
 * timer, quick +15m/+30m/+1h taps, or typing an exact amount ("1h30", "90",
 * "1:30"). The timer only appears on today; past days are edited by hand.
 */

import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { hm, clock, dayLabel, parseDuration, timeOfDay } from '../format.js';
import { seriesVar } from '../charts.js';
import {
  dayKey, addDays, activitySeconds, dayTotal, visibleActivities, pendingSeconds,
  streak, summarize, PALETTE_SLOTS,
} from '../store.js';

export function renderTrack(ctx) {
  const { store, state, day, onNavigate } = ctx;
  const today = dayKey(new Date(ctx.now()));
  const isToday = day === today;
  const isFuture = day > today;
  const activities = visibleActivities(state);
  const root = h('div', { class: 'view view-track' });

  /* --- date stepper ------------------------------------------------------ */
  root.append(h('div', { class: 'daybar' }, [
    h('button', {
      class: 'icon-btn', title: 'Previous day', 'aria-label': 'Previous day',
      onclick: () => ctx.setDay(addDays(day, -1)),
    }, [icon('left')]),
    h('div', { class: 'daybar-label' }, [
      h('strong', { text: isToday ? 'Today' : dayLabel(day) }),
      h('span', { class: 'c-note', text: isToday ? dayLabel(day) : relativeLabel(day, today) }),
    ]),
    h('button', {
      class: 'icon-btn', title: 'Next day', 'aria-label': 'Next day', disabled: day >= today,
      onclick: () => ctx.setDay(addDays(day, 1)),
    }, [icon('right')]),
    !isToday ? h('button', { class: 'btn btn-ghost btn-sm', text: 'Today', onclick: () => ctx.setDay(today) }) : null,
  ]));

  /* --- hero: the day's total -------------------------------------------- */
  const total = dayTotal(state, day) + (isToday ? pendingSeconds(state, ctx.now()) : 0);
  const trailing = summarize(state, addDays(today, -6), today);
  const avg = trailing.daysTracked ? trailing.total / trailing.daysTracked : 0;
  const run = streak(state, today);

  root.append(h('section', { class: 'card hero-card' }, [
    h('p', { class: 'stat-label', text: isToday ? 'Tracked today' : `Tracked ${dayLabel(day)}` }),
    h('p', { class: 'hero-figure', dataset: isToday ? { liveTotal: '1' } : {}, text: hm(total) }),
    h('p', { class: 'c-note' }, [
      avg > 0 && isToday ? `7-day average ${hm(avg)} a day` : null,
      avg > 0 && isToday && run > 0 ? ' · ' : null,
      run > 0 ? `${run}-day streak` : 'No streak yet — log something today',
    ]),
  ]));

  /* --- running timer ----------------------------------------------------- */
  if (state.running) {
    const activity = state.activities.find((a) => a.id === state.running.activityId);
    const elapsed = pendingSeconds(state, ctx.now());
    root.append(h('section', { class: 'card timer-card' }, [
      h('div', { class: 'timer-head' }, [
        h('span', { class: 'pulse', style: { background: seriesVar(activity ? activity.color : 0) } }),
        h('div', {}, [
          h('p', { class: 'stat-label', text: 'Running' }),
          h('strong', { text: activity ? activity.name : 'Activity' }),
        ]),
        h('p', { class: 'timer-clock', dataset: { timer: '1' }, text: clock(elapsed) }),
      ]),
      h('p', { class: 'c-note', text: `Started ${timeOfDay(state.running.startedAt)}` }),
      h('div', { class: 'row-actions' }, [
        h('button', { class: 'btn btn-primary', onclick: () => { const r = store.stopTimer(ctx.now()); ctx.toast(`Logged ${hm(Math.round((r.endedAt - r.startedAt) / 1000))} to ${activity ? activity.name : 'activity'}`); } }, [icon('stop'), 'Stop & log']),
        h('button', {
          class: 'btn btn-ghost',
          onclick: () => { if (confirm('Discard this running timer without logging it?')) { store.discardTimer(); ctx.toast('Timer discarded'); } },
        }, ['Discard']),
      ]),
    ]));
  }

  /* --- activity rows ----------------------------------------------------- */
  if (!activities.length) {
    root.append(h('section', { class: 'card empty' }, [
      h('p', { text: 'No activities yet.' }),
      h('p', { class: 'c-note', text: 'Add the handful of things you want to watch over the years — sleep, work, exercise, reading.' }),
    ]));
  }

  const list = h('ul', { class: 'activity-list' });
  for (const activity of activities) {
    list.append(activityRow(ctx, activity, { day, isToday, isFuture }));
  }
  root.append(list);

  /* --- add activity ------------------------------------------------------ */
  const addSlot = h('div', { class: 'add-slot' });
  addSlot.append(h('button', {
    class: 'btn btn-ghost btn-wide', onclick: () => openAddForm(ctx, addSlot),
  }, [icon('plus'), 'Add activity']));
  root.append(addSlot);

  if (isFuture) root.append(h('p', { class: 'c-note center', text: 'This day is in the future.' }));
  return root;
}

function relativeLabel(day, today) {
  const diff = Math.round((new Date(day) - new Date(today)) / 86400000);
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${Math.abs(diff)} days ago`;
  return '';
}

function activityRow(ctx, activity, { day, isToday, isFuture }) {
  const { store, state } = ctx;
  const logged = activitySeconds(state, day, activity.id);
  const isRunning = state.running && state.running.activityId === activity.id;
  const live = logged + (isRunning && isToday ? pendingSeconds(state, ctx.now()) : 0);
  const row = h('li', { class: `activity-row${isRunning ? ' is-running' : ''}` });

  const main = h('div', { class: 'activity-main' }, [
    h('span', { class: 'swatch', style: { background: seriesVar(activity.color) }, 'aria-hidden': 'true' }),
    h('div', { class: 'activity-id' }, [
      h('span', { class: 'activity-name', text: activity.name }),
      activity.goal > 0
        ? h('span', { class: 'c-note', text: `${hm(live)} of ${hm(activity.goal * 60)} goal` })
        : h('span', { class: 'c-note', text: live > 0 ? hm(live) : 'nothing yet' }),
    ]),
  ]);

  const valueBtn = h('button', {
    class: 'value-btn', title: 'Edit exact time',
    dataset: isRunning ? { liveActivity: activity.id } : {},
    'aria-label': `Edit time for ${activity.name} on ${dayLabel(day, { withYear: true })}`,
    text: hm(live),
    onclick: () => openEditor(ctx, row, activity, day, logged),
  });
  main.append(valueBtn);
  row.append(main);

  if (activity.goal > 0) {
    const pct = Math.min(100, (live / (activity.goal * 60)) * 100);
    row.append(h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${activity.name} daily goal` }, [
      h('span', {
        class: 'meter-fill',
        dataset: { liveMeter: activity.id, goal: String(activity.goal * 60) },
        style: { width: `${pct}%`, background: seriesVar(activity.color) },
      }),
    ]));
  }

  const actions = h('div', { class: 'row-actions' }, [
    ...[15, 30, 60].map((mins) => h('button', {
      class: 'chip', disabled: isFuture, text: mins === 60 ? '+1h' : `+${mins}m`,
      'aria-label': `Add ${mins} minutes to ${activity.name}`,
      onclick: () => { store.addSeconds(day, activity.id, mins * 60); ctx.toast(`+${mins === 60 ? '1h' : `${mins}m`} ${activity.name}`); },
    })),
    logged > 0 ? h('button', {
      class: 'chip', text: '−15m', 'aria-label': `Remove 15 minutes from ${activity.name}`,
      onclick: () => store.addSeconds(day, activity.id, -15 * 60),
    }) : null,
    isToday ? h('button', {
      class: `chip chip-timer${isRunning ? ' is-on' : ''}`,
      onclick: () => {
        if (isRunning) {
          const r = store.stopTimer(ctx.now());
          ctx.toast(`Logged ${hm(Math.round((r.endedAt - r.startedAt) / 1000))} to ${activity.name}`);
        } else {
          store.startTimer(activity.id, ctx.now());
          ctx.toast(`Timer started for ${activity.name}`);
        }
      },
    }, [icon(isRunning ? 'stop' : 'play', { size: 16 }), isRunning ? 'Stop' : 'Start']) : null,
  ]);
  row.append(actions);
  return row;
}

/** Inline exact-time editor. Accepts "90", "1h30", "1.5h", "1:30". */
function openEditor(ctx, row, activity, day, currentSeconds) {
  const existing = row.querySelector('.inline-form');
  if (existing) { existing.remove(); return; }

  const input = h('input', {
    type: 'text', inputmode: 'numeric', class: 'input', value: currentSeconds ? String(Math.round(currentSeconds / 60)) : '',
    placeholder: 'e.g. 90, 1h30, 1:30', 'aria-label': `Minutes for ${activity.name}`,
  });
  const hint = h('p', { class: 'c-note', text: 'Minutes, or 1h30 / 1:30 / 1.5h' });
  const commit = () => {
    const mins = parseDuration(input.value);
    if (mins === null) { hint.textContent = "Couldn't read that — try 90, 1h30 or 1:30"; hint.classList.add('is-error'); return; }
    ctx.store.setSeconds(day, activity.id, mins * 60);
    ctx.toast(`${activity.name} set to ${hm(mins * 60)}`);
  };
  const form = h('form', {
    class: 'inline-form',
    onsubmit: (ev) => { ev.preventDefault(); commit(); },
  }, [
    h('div', { class: 'inline-row' }, [
      input,
      h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, [icon('check', { size: 16 }), 'Save']),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cancel', onclick: () => form.remove() }),
    ]),
    hint,
  ]);
  row.append(form);
  input.focus();
  input.select();
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') form.remove(); });
}

function openAddForm(ctx, slot) {
  const used = new Set(ctx.state.activities.map((a) => a.color));
  let chosen = 0;
  for (let i = 0; i < PALETTE_SLOTS; i++) if (!used.has(i)) { chosen = i; break; }

  const name = h('input', { type: 'text', class: 'input', placeholder: 'Activity name', 'aria-label': 'Activity name', maxlength: 60, required: true });
  const goal = h('input', { type: 'number', class: 'input input-sm', min: 0, max: 1440, step: 5, placeholder: '0', 'aria-label': 'Daily goal in minutes' });
  const swatches = h('div', { class: 'swatch-picker', role: 'radiogroup', 'aria-label': 'Colour' });
  const paint = () => {
    clear(swatches);
    for (let i = 0; i < PALETTE_SLOTS; i++) {
      swatches.append(h('button', {
        type: 'button', class: `swatch-opt${i === chosen ? ' is-on' : ''}`, style: { background: seriesVar(i) },
        role: 'radio', 'aria-checked': i === chosen ? 'true' : 'false', 'aria-label': `Colour ${i + 1}`,
        onclick: () => { chosen = i; paint(); },
      }));
    }
  };
  paint();

  const form = h('form', {
    class: 'inline-form card',
    onsubmit: (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) return;
      ctx.store.addActivity({ name: name.value, color: chosen, goal: Number(goal.value) || 0 });
      ctx.toast(`Added ${name.value.trim()}`);
    },
  }, [
    h('div', { class: 'inline-row' }, [name]),
    swatches,
    h('label', { class: 'field-inline' }, [h('span', { class: 'c-note', text: 'Daily goal (minutes, optional)' }), goal]),
    h('div', { class: 'row-actions' }, [
      h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, [icon('plus', { size: 16 }), 'Add activity']),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cancel', onclick: () => ctx.rerender() }),
    ]),
  ]);
  clear(slot).append(form);
  name.focus();
}
