/**
 * Settings — activities, appearance, and the backup tools.
 *
 * Backup gets prominent treatment on purpose: everything lives in this
 * browser's localStorage, so clearing site data or switching devices loses the
 * log unless it was exported.
 */

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { hm, bytes, plural } from '../format.js';
import { seriesVar } from '../charts.js';
import { dayKey, summarize, logBounds, diffDays, PALETTE_SLOTS } from '../store.js';

export function renderSettings(ctx) {
  const { store, state } = ctx;
  const today = dayKey(new Date(ctx.now()));
  const bounds = logBounds(state);
  const root = h('div', { class: 'view view-settings' });

  /* --- activities -------------------------------------------------------- */
  const all = state.activities.slice().sort((a, b) => a.order - b.order);
  const lifetime = bounds ? summarize(state, bounds.first, today) : null;

  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: 'Activities' }),
        h('p', { class: 'c-note', text: 'Archive keeps the history but hides the activity from the Track tab.' }),
      ]),
    ]),
    h('ul', { class: 'settings-list' }, all.map((activity, i) => activityEditor(ctx, activity, i, all.length, lifetime))),
    all.length >= PALETTE_SLOTS
      ? h('p', { class: 'c-note', text: `${PALETTE_SLOTS} colours exist, so activities past the eighth reuse one. Fewer, broader activities hold up better over years.` })
      : null,
  ]));

  /* --- appearance -------------------------------------------------------- */
  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [h('div', {}, [h('h2', { text: 'Appearance' })])]),
    h('div', { class: 'field' }, [
      h('label', { for: 'set-theme', text: 'Theme' }),
      h('select', {
        id: 'set-theme', class: 'select',
        onchange: (ev) => { store.setSetting('theme', ev.target.value); ctx.applyTheme(); },
      }, [
        h('option', { value: 'system', text: 'Match system', selected: state.settings.theme === 'system' }),
        h('option', { value: 'light', text: 'Light', selected: state.settings.theme === 'light' }),
        h('option', { value: 'dark', text: 'Dark', selected: state.settings.theme === 'dark' }),
      ]),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'set-week', text: 'Week starts on' }),
      h('select', {
        id: 'set-week', class: 'select',
        onchange: (ev) => store.setSetting('weekStart', Number(ev.target.value)),
      }, [
        h('option', { value: '1', text: 'Monday', selected: state.settings.weekStart === 1 }),
        h('option', { value: '0', text: 'Sunday', selected: state.settings.weekStart === 0 }),
        h('option', { value: '6', text: 'Saturday', selected: state.settings.weekStart === 6 }),
      ]),
    ]),
    h('label', { class: 'field-check' }, [
      h('input', {
        type: 'checkbox', checked: state.settings.textures,
        onchange: (ev) => store.setSetting('textures', ev.target.checked),
      }),
      h('span', {}, [
        h('strong', { text: 'Patterned chart fills' }),
        h('span', { class: 'c-note', text: 'Adds a hatch pattern on top of colour, for colour-vision differences or printing.' }),
      ]),
    ]),
  ]));

  /* --- backup ------------------------------------------------------------ */
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden',
    onchange: (ev) => importFile(ctx, ev.target.files[0]),
  });

  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: 'Backup' }),
        h('p', { class: 'c-note', text: 'Data lives only in this browser. Export now and then — especially before clearing site data or changing device.' }),
      ]),
    ]),
    h('div', { class: 'row-actions' }, [
      h('button', { class: 'btn btn-primary', onclick: () => download(`time-tracker-${today}.json`, store.exportJSON(), 'application/json') }, [icon('download', { size: 16 }), 'Export JSON']),
      h('button', { class: 'btn', onclick: () => download(`time-tracker-${today}.csv`, store.exportCSV(), 'text/csv') }, [icon('download', { size: 16 }), 'Export CSV']),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, [icon('upload', { size: 16 }), 'Import JSON']),
      fileInput,
    ]),
    h('dl', { class: 'facts' }, [
      h('div', {}, [h('dt', { text: 'Stored' }), h('dd', { text: bytes(store.storageBytes()) })]),
      h('div', {}, [h('dt', { text: 'Days logged' }), h('dd', { text: String(Object.keys(state.log).length) })]),
      h('div', {}, [h('dt', { text: 'Lifetime tracked' }), h('dd', { text: lifetime ? hm(lifetime.total) : '0m' })]),
      bounds ? h('div', {}, [h('dt', { text: 'History spans' }), h('dd', { text: plural(diffDays(bounds.first, today) + 1, 'day') })]) : null,
    ]),
    h('p', { class: 'c-note', text: 'At this rate a decade of tracking stays well inside the browser’s 5 MB limit.' }),
  ]));

  /* --- install ----------------------------------------------------------- */
  const installRow = h('div', { class: 'row-actions' });
  if (ctx.canInstall()) {
    installRow.append(h('button', { class: 'btn btn-primary', onclick: () => ctx.install() }, [icon('install', { size: 16 }), 'Install app']));
  } else if (ctx.isInstalled()) {
    installRow.append(h('p', { class: 'c-note', text: 'Running as an installed app.' }));
  } else {
    installRow.append(h('p', { class: 'c-note', text: 'To install: Chrome/Edge — the install icon in the address bar. iOS Safari — Share, then "Add to Home Screen".' }));
  }
  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: 'Install' }),
        h('p', { class: 'c-note', text: 'Installed, it opens in its own window and works offline.' }),
      ]),
    ]),
    installRow,
  ]));

  /* --- danger zone ------------------------------------------------------- */
  root.append(h('section', { class: 'card card-danger' }, [
    h('header', { class: 'card-head' }, [h('div', {}, [h('h2', { text: 'Danger zone' })])]),
    h('div', { class: 'row-actions' }, [
      h('button', {
        class: 'btn btn-danger',
        onclick: () => {
          if (!confirm('Delete every logged day but keep your activities?')) return;
          store.update((s) => { s.log = {}; s.running = null; });
          ctx.toast('All logged time deleted');
        },
      }, [icon('trash', { size: 16 }), 'Delete all logged time']),
      h('button', {
        class: 'btn btn-danger',
        onclick: () => {
          if (!confirm('Reset everything — activities and history — back to a fresh start?')) return;
          if (!confirm('Last check: this cannot be undone. Export first if you want a copy.')) return;
          ctx.resetAll();
        },
      }, [icon('trash', { size: 16 }), 'Reset app']),
    ]),
  ]));

  root.append(h('p', { class: 'c-note center version-note', text: `Time Tracker · offline-first · ${ctx.version}` }));
  return root;
}

function activityEditor(ctx, activity, index, count, lifetime) {
  const { store } = ctx;
  const total = lifetime ? lifetime.byActivity.get(activity.id) || 0 : 0;
  const item = h('li', { class: `settings-row${activity.archived ? ' is-archived' : ''}` });

  const name = h('input', {
    type: 'text', class: 'input', value: activity.name, maxlength: 60, 'aria-label': 'Activity name',
    onchange: (ev) => store.updateActivity(activity.id, { name: ev.target.value }),
  });
  const goal = h('input', {
    type: 'number', class: 'input input-sm', value: activity.goal || '', min: 0, max: 1440, step: 5,
    placeholder: '0', 'aria-label': `Daily goal in minutes for ${activity.name}`,
    onchange: (ev) => store.updateActivity(activity.id, { goal: Number(ev.target.value) || 0 }),
  });

  const swatches = h('div', { class: 'swatch-picker', role: 'radiogroup', 'aria-label': `Colour for ${activity.name}` });
  for (let i = 0; i < PALETTE_SLOTS; i++) {
    swatches.append(h('button', {
      type: 'button', class: `swatch-opt${i === activity.color ? ' is-on' : ''}`, style: { background: seriesVar(i) },
      role: 'radio', 'aria-checked': i === activity.color ? 'true' : 'false', 'aria-label': `Colour ${i + 1}`,
      onclick: () => store.updateActivity(activity.id, { color: i }),
    }));
  }

  item.append(h('div', { class: 'settings-row-top' }, [
    h('span', { class: 'swatch', style: { background: seriesVar(activity.color) }, 'aria-hidden': 'true' }),
    name,
    h('div', { class: 'stepper' }, [
      h('button', { class: 'icon-btn', 'aria-label': `Move ${activity.name} up`, disabled: index === 0, onclick: () => store.moveActivity(activity.id, -1) }, [icon('up', { size: 16 })]),
      h('button', { class: 'icon-btn', 'aria-label': `Move ${activity.name} down`, disabled: index === count - 1, onclick: () => store.moveActivity(activity.id, 1) }, [icon('down', { size: 16 })]),
    ]),
  ]));

  item.append(h('div', { class: 'settings-row-body' }, [
    swatches,
    h('label', { class: 'field-inline' }, [h('span', { class: 'c-note', text: 'Daily goal (min)' }), goal]),
    h('p', { class: 'c-note', text: total > 0 ? `${hm(total)} logged all time` : 'nothing logged yet' }),
    h('div', { class: 'row-actions' }, [
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => store.updateActivity(activity.id, { archived: !activity.archived }),
      }, [icon('archive', { size: 16 }), activity.archived ? 'Restore' : 'Archive']),
      h('button', {
        class: 'btn btn-ghost btn-sm btn-danger-text',
        onclick: () => {
          const warning = total > 0
            ? `Delete "${activity.name}" and its ${hm(total)} of logged time? This cannot be undone.`
            : `Delete "${activity.name}"?`;
          if (!confirm(warning)) return;
          store.deleteActivity(activity.id);
          ctx.toast(`Deleted ${activity.name}`);
        },
      }, [icon('trash', { size: 16 }), 'Delete']),
    ]),
  ]));
  return item;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(ctx, file) {
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    ctx.toast('Could not read that file');
    return;
  }
  const mode = confirm('OK = merge into the current data.\nCancel = replace everything with the backup.') ? 'merge' : 'replace';
  try {
    const result = ctx.store.importJSON(text, mode);
    ctx.toast(`${mode === 'merge' ? 'Merged' : 'Imported'} ${plural(result.days, 'day')} and ${plural(result.activities, 'activity', 'activities')}`);
  } catch (err) {
    ctx.toast("That file isn't a valid export");
  }
}
