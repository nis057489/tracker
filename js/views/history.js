/**
 * History — the long view. A year of days as a heatmap, every month of that
 * year as stacked columns, and the last 30 days in detail.
 */

import { h, dataTable } from '../dom.js';
import { icon } from '../icons.js';
import { hm, dayLabel, shortDay, MONTHS, plural } from '../format.js';
import { heatmap, stackedColumns, legend } from '../charts.js';
import {
  dayKey, addDays, summarize, logBounds, visibleActivities, bucketDays, activityById,
} from '../store.js';
import { chartHost } from './chart-host.js';

export function renderHistory(ctx) {
  const { state, ui } = ctx;
  const today = dayKey(new Date(ctx.now()));
  const thisYear = Number(today.slice(0, 4));
  const bounds = logBounds(state);
  const firstYear = bounds ? Number(bounds.first.slice(0, 4)) : thisYear;
  if (!ui.year) ui.year = thisYear;
  ui.year = Math.min(Math.max(ui.year, firstYear), thisYear);
  const year = ui.year;

  const activities = visibleActivities(state);
  const filterActivity = ui.heatActivity && activityById(state, ui.heatActivity) ? ui.heatActivity : null;

  const root = h('div', { class: 'view view-history' });

  /* --- year heatmap ------------------------------------------------------ */
  const from = `${year}-01-01`;
  const to = year === thisYear ? today : `${year}-12-31`;
  const summary = summarize(state, from, to);
  const perDay = filterActivity
    ? summary.perDay.map((d) => ({ ...d, total: d.byActivity[filterActivity] || 0 }))
    : summary.perDay;
  const heatTotal = perDay.reduce((sum, d) => sum + d.total, 0);
  const heatDays = perDay.filter((d) => d.total > 0).length;

  const picker = h('select', {
    class: 'select', 'aria-label': 'Filter heatmap by activity',
    onchange: (ev) => { ui.heatActivity = ev.target.value || null; ctx.rerender(); },
  }, [
    h('option', { value: '', text: 'All activities', selected: !filterActivity }),
    ...activities.map((a) => h('option', { value: a.id, text: a.name, selected: a.id === filterActivity })),
  ]);

  const chart = heatmap({
    perDay,
    weekStart: state.settings.weekStart,
    selected: ctx.day,
    activityName: filterActivity ? activityById(state, filterActivity).name : null,
    onSelect: (dayValue) => { ctx.setDay(dayValue); ctx.navigate('track'); },
  });

  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: filterActivity ? `${activityById(state, filterActivity).name} in ${year}` : `Every day in ${year}` }),
        h('p', { class: 'c-note', text: `${hm(heatTotal)} across ${plural(heatDays, 'day')} · click a day to edit it` }),
      ]),
      h('div', { class: 'filter-row' }, [
        picker,
        h('div', { class: 'stepper' }, [
          h('button', {
            class: 'icon-btn', 'aria-label': 'Previous year', disabled: year <= firstYear,
            onclick: () => { ui.year = year - 1; ctx.rerender(); },
          }, [icon('left')]),
          h('strong', { class: 'stepper-label', text: String(year) }),
          h('button', {
            class: 'icon-btn', 'aria-label': 'Next year', disabled: year >= thisYear,
            onclick: () => { ui.year = year + 1; ctx.rerender(); },
          }, [icon('right')]),
        ]),
      ]),
    ]),
    chart.scroller,
    chart.legend,
    dataTable(
      `Daily totals in ${year}`,
      ['Date', 'Tracked'],
      perDay.filter((d) => d.total > 0).map((d) => [dayLabel(d.day, { withYear: true }), hm(d.total)]),
    ),
  ]));

  /* --- months of the year ------------------------------------------------ */
  if (activities.length) {
    const months = bucketDays(summary.perDay, 'month', state.settings.weekStart);
    const padded = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}-01`;
      padded.push(months.find((b) => b.key === key) || { key, total: 0, days: 0, byActivity: {} });
    }
    root.append(h('section', { class: 'card' }, [
      h('header', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', { text: `Months in ${year}` }),
          h('p', { class: 'c-note', text: 'Total hours per month, split by activity' }),
        ]),
      ]),
      chartHost(ctx, (width) => stackedColumns({
        buckets: padded,
        activities,
        width,
        height: 240,
        textures: state.settings.textures,
        labelFor: (bucket) => MONTHS[Number(bucket.key.slice(5, 7)) - 1].slice(0, 1),
        tipTitleFor: (bucket) => `${MONTHS[Number(bucket.key.slice(5, 7)) - 1]} ${year}`,
      })),
      legend(activities.map((a) => ({ label: a.name, color: a.color, value: summary.byActivity.get(a.id) || 0 }))),
      dataTable(
        `Monthly totals in ${year}`,
        ['Month', ...activities.map((a) => a.name), 'Total'],
        padded.map((bucket) => [
          MONTHS[Number(bucket.key.slice(5, 7)) - 1],
          ...activities.map((a) => hm(bucket.byActivity[a.id] || 0)),
          hm(bucket.total),
        ]),
      ),
    ]));

    /* --- last 30 days --------------------------------------------------- */
    const recentFrom = addDays(today, -29);
    const recent = summarize(state, recentFrom, today);
    root.append(h('section', { class: 'card' }, [
      h('header', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', { text: 'Last 30 days' }),
          h('p', { class: 'c-note', text: `${hm(recent.total)} · ${plural(recent.daysTracked, 'day')} tracked` }),
        ]),
      ]),
      chartHost(ctx, (width) => stackedColumns({
        buckets: recent.perDay.map((d) => ({ key: d.day, total: d.total, byActivity: d.byActivity })),
        activities,
        width,
        height: 220,
        textures: state.settings.textures,
        labelFor: (bucket, i, n) => (i === 0 || i === n - 1 || i === Math.floor(n / 2) ? shortDay(bucket.key) : null),
      })),
      legend(activities.map((a) => ({ label: a.name, color: a.color, value: recent.byActivity.get(a.id) || 0 }))),
      dataTable(
        'Last 30 days by activity',
        ['Date', ...activities.map((a) => a.name), 'Total'],
        recent.perDay.slice().reverse().map((d) => [
          dayLabel(d.day, { withYear: true }),
          ...activities.map((a) => hm(d.byActivity[a.id] || 0)),
          hm(d.total),
        ]),
      ),
    ]));
  }

  return root;
}

