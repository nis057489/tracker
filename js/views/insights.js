/**
 * Insights — where the long term shows up: totals per activity, the trend over
 * weeks or months, and the weekday profile, all over a chosen range.
 */

import { h, dataTable } from '../dom.js';
import { hm, hours, dayLabel, shortDay, monthLabel, plural, WEEKDAYS } from '../format.js';
import { horizontalBars, trendLine, columns } from '../charts.js';
import { chartHost } from './chart-host.js';
import {
  dayKey, addDays, diffDays, summarize, logBounds, visibleActivities, activityById,
  bucketDays, weekdayProfile, streak, longestStreak, weekStartKey,
} from '../store.js';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '12 months', days: 365 },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function renderInsights(ctx) {
  const { state, ui } = ctx;
  const today = dayKey(new Date(ctx.now()));
  const bounds = logBounds(state);
  if (!ui.range) ui.range = '30';
  const range = RANGES.find((r) => r.id === ui.range) || RANGES[1];

  let from;
  if (range.id === 'all') from = bounds ? bounds.first : addDays(today, -29);
  else if (range.id === 'year') from = `${today.slice(0, 4)}-01-01`;
  else from = addDays(today, -(range.days - 1));
  const to = today;
  const spanDays = diffDays(from, to) + 1;

  const summary = summarize(state, from, to);
  const activities = visibleActivities(state);
  const root = h('div', { class: 'view view-insights' });

  /* --- filters: one row above the charts --------------------------------- */
  root.append(h('div', { class: 'filter-row filter-row-top', role: 'group', 'aria-label': 'Date range' }, [
    ...RANGES.map((r) => h('button', {
      class: `chip${r.id === range.id ? ' is-on' : ''}`, text: r.label,
      'aria-pressed': r.id === range.id ? 'true' : 'false',
      onclick: () => { ui.range = r.id; ctx.rerender(); },
    })),
  ]));
  root.append(h('p', { class: 'c-note range-note', text: `${dayLabel(from, { withYear: true })} → ${dayLabel(to, { withYear: true })} · ${plural(spanDays, 'day')}` }));

  /* --- figures ----------------------------------------------------------- */
  const current = streak(state, today);
  const tiles = h('div', { class: 'tile-grid' }, [
    h('section', { class: 'card tile tile-hero' }, [
      h('p', { class: 'stat-label', text: 'Total tracked' }),
      h('p', { class: 'hero-figure', text: hm(summary.total) }),
      h('p', { class: 'c-note', text: summary.total > 0 ? `${hours(summary.averagePerDay, 1)} a day across the range` : 'Nothing logged in this range yet' }),
    ]),
    tile('Days tracked', `${summary.daysTracked}`, `of ${plural(summary.dayCount, 'day')} · ${Math.round((summary.daysTracked / Math.max(1, summary.dayCount)) * 100)}% coverage`),
    tile('Average per tracked day', hm(summary.averagePerTrackedDay), summary.daysTracked ? 'Days with nothing logged are left out' : '—'),
    tile('Current streak', plural(current, 'day'), `Longest ${plural(longestStreak(state), 'day')}`),
    summary.best ? tile('Busiest day', hm(summary.best.seconds), dayLabel(summary.best.day, { withYear: true })) : null,
    bounds ? tile('Tracking since', dayLabel(bounds.first, { withYear: true }), `${plural(diffDays(bounds.first, today) + 1, 'day')} of history`) : null,
  ]);
  root.append(tiles);

  if (summary.total === 0) {
    root.append(h('section', { class: 'card empty' }, [
      h('p', { text: 'No time logged in this range.' }),
      h('p', { class: 'c-note', text: 'Log some time on the Track tab, or widen the range.' }),
    ]));
    return root;
  }

  /* --- per activity ------------------------------------------------------ */
  const rows = activities
    .map((a) => ({
      label: a.name,
      color: a.color,
      value: summary.byActivity.get(a.id) || 0,
      perDay: (summary.byActivity.get(a.id) || 0) / Math.max(1, summary.dayCount),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  // Activities that are gone but still hold logged time keep their totals here.
  for (const [actId, seconds] of summary.byActivity) {
    const activity = activityById(state, actId);
    if (activity && !activity.archived) continue;
    rows.push({
      label: activity ? `${activity.name} (archived)` : 'Removed activity',
      color: activity ? activity.color : 0,
      value: seconds,
      perDay: seconds / Math.max(1, summary.dayCount),
    });
  }
  rows.sort((a, b) => b.value - a.value);

  const top = rows[0];
  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: 'Where the time went' }),
        h('p', { class: 'c-note', text: top ? `${top.label} is ${Math.round((top.value / summary.total) * 100)}% of tracked time — ${hours(top.perDay, 1)} a day` : '' }),
      ]),
    ]),
    chartHost(ctx, (width) => horizontalBars({ rows, width, total: summary.total, textures: state.settings.textures })),
    dataTable(
      `Time per activity, ${dayLabel(from, { withYear: true })} to ${dayLabel(to, { withYear: true })}`,
      ['Activity', 'Total', 'Per day', 'Share'],
      rows.map((r) => [r.label, hm(r.value), hm(r.perDay), `${Math.round((r.value / summary.total) * 100)}%`]),
    ),
  ]));

  /* --- trend ------------------------------------------------------------- */
  const grain = spanDays <= 31 ? 'day' : spanDays <= 400 ? 'week' : 'month';
  const buckets = bucketDays(summary.perDay, grain, state.settings.weekStart);
  const points = buckets.map((bucket) => ({
    label: grain === 'month' ? bucket.key.slice(0, 7).replace('-', '/') : shortDay(bucket.key),
    title: grain === 'day' ? dayLabel(bucket.key, { withYear: true })
      : grain === 'week' ? `Week of ${dayLabel(bucket.key, { withYear: true })}`
        : monthLabel(bucket.key),
    value: bucket.total,
    sub: grain === 'day' ? null : `${hm(bucket.total / Math.max(1, bucket.days))} a day over ${plural(bucket.days, 'day')}`,
  }));

  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: grain === 'day' ? 'Total time per day' : grain === 'week' ? 'Total time per week' : 'Total time per month' }),
        h('p', { class: 'c-note', text: 'All activities combined' }),
      ]),
    ]),
    chartHost(ctx, (width) => trendLine({ points, width, height: 210 })),
    dataTable(
      grain === 'month' ? 'Monthly totals' : grain === 'week' ? 'Weekly totals' : 'Daily totals',
      [grain === 'day' ? 'Date' : grain === 'week' ? 'Week of' : 'Month', 'Total', 'Per day'],
      points.slice().reverse().map((p, i) => {
        const bucket = buckets[buckets.length - 1 - i];
        return [p.title, hm(p.value), hm(p.value / Math.max(1, bucket.days))];
      }),
    ),
  ]));

  /* --- weekday profile --------------------------------------------------- */
  const profile = weekdayProfile(summary.perDay);
  const ordered = [];
  for (let i = 0; i < 7; i++) {
    const wd = (state.settings.weekStart + i) % 7;
    ordered.push({
      label: WEEKDAYS[wd].slice(0, 3),
      title: WEEKDAYS[wd],
      value: profile[wd].average,
      sub: `average over ${plural(profile[wd].days, 'tracked day')}`,
    });
  }
  root.append(h('section', { class: 'card' }, [
    h('header', { class: 'card-head' }, [
      h('div', {}, [
        h('h2', { text: 'Weekday rhythm' }),
        h('p', { class: 'c-note', text: 'Average tracked time on each day of the week' }),
      ]),
    ]),
    chartHost(ctx, (width) => columns({ items: ordered, width, height: 190, textures: state.settings.textures })),
    dataTable('Average per weekday', ['Weekday', 'Average', 'Tracked days'], ordered.map((o, i) => {
      const wd = (state.settings.weekStart + i) % 7;
      return [o.title, hm(o.value), String(profile[wd].days)];
    })),
  ]));

  /* --- week-over-week for long ranges ----------------------------------- */
  if (grain !== 'day' && activities.length) {
    const thisWeek = summarize(state, weekStartKey(today, state.settings.weekStart), today);
    const prevStart = addDays(weekStartKey(today, state.settings.weekStart), -7);
    const prev = summarize(state, prevStart, addDays(prevStart, 6));
    const delta = thisWeek.total - prev.total;
    root.append(h('p', { class: 'c-note center', text: `This week so far: ${hm(thisWeek.total)} · last week ${hm(prev.total)} (${delta >= 0 ? '+' : '−'}${hm(Math.abs(delta))})` }));
  }

  return root;
}

function tile(label, value, note) {
  return h('section', { class: 'card tile' }, [
    h('p', { class: 'stat-label', text: label }),
    h('p', { class: 'tile-value', text: value }),
    note ? h('p', { class: 'c-note', text: note }) : null,
  ]);
}
