/**
 * Geometry checks for the charts. A headless run can't eyeball a rendering, so
 * these assert the things a visual pass would catch: marks and labels staying
 * inside the frame, mark sizes within spec, and every mark carrying a tooltip
 * hook and an accessible label.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-stub.mjs';

installDom();
const { heatmap, stackedColumns, horizontalBars, trendLine, columns, legend } = await import('../js/charts.js');

const WIDTH = 760;

function makeDays(n, { from = '2026-01-01' } = {}) {
  const out = [];
  const start = new Date(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const sleep = i % 11 === 0 ? 0 : 25200 + (i % 7) * 600;
    out.push({ day: key, total: sleep + (i % 4) * 1800, byActivity: { s: sleep, w: (i % 4) * 1800 } });
  }
  return out;
}

const ACTIVITIES = [
  { id: 's', name: 'Sleep', color: 6 },
  { id: 'w', name: 'Work', color: 0 },
];

/**
 * Absolute points of a path — the builders use relative commands, so the raw
 * numbers in `d` are deltas and can't be frame-checked directly.
 */
function pathPoints(d) {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) || [];
  const points = [];
  let x = 0;
  let y = 0;
  let i = 0;
  let cmd = 'M';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); break;
      case 'm': x += num(); y += num(); break;
      case 'L': x = num(); y = num(); break;
      case 'l': x += num(); y += num(); break;
      case 'H': x = num(); break;
      case 'h': x += num(); break;
      case 'V': y = num(); break;
      case 'v': y += num(); break;
      case 'A': num(); num(); num(); num(); num(); x = num(); y = num(); break;
      case 'a': num(); num(); num(); num(); num(); x += num(); y += num(); break;
      case 'Z': case 'z': break;
      default: i++; continue;
    }
    points.push([x, y]);
  }
  return points;
}

/** Every absolute coordinate in the tree, paths evaluated. */
function coords(el, out = []) {
  const d = el.attributes && el.attributes.d;
  if (d) for (const [x, y] of pathPoints(d)) out.push(x, y);
  for (const key of ['x', 'y', 'cx', 'cy', 'x1', 'x2', 'y1', 'y2']) {
    if (el.attributes && el.attributes[key] !== undefined) out.push(Number(el.attributes[key]));
  }
  for (const child of el.children || []) if (child.attributes) coords(child, out);
  return out;
}

function all(el, tag, out = []) {
  for (const child of el.children || []) {
    if (child.tagName === tag) out.push(child);
    all(child, tag, out);
  }
  return out;
}

function viewBox(svg) {
  return svg.attributes.viewBox.split(' ').map(Number);
}

/** Widths of the rounded bar paths the chart builders emit. */
function barWidths(svg) {
  return all(svg, 'path')
    .filter((p) => !p.attributes.class)
    .map((p) => {
      const xs = pathPoints(p.attributes.d).map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    });
}

test('heatmap lays a full year out inside its frame', () => {
  const { svg, legend: key } = heatmap({ perDay: makeDays(365), weekStart: 1, onSelect: () => {} });
  const [, , w, hgt] = viewBox(svg);
  const cells = all(svg, 'g').filter((g) => g.attributes.class === 'heat-cell');
  assert.equal(cells.length, 365, 'one cell per day');
  for (const n of coords(svg)) {
    assert.ok(n >= -1 && n <= Math.max(w, hgt) + 1, `coordinate ${n} is inside the frame`);
  }
  assert.ok(cells.every((c) => c.attributes.tabindex === '0'), 'cells are keyboard reachable');
  assert.ok(cells.every((c) => c.attributes['aria-label']), 'cells name their day and total');
  assert.ok(key.children.length >= 8, 'the scale legend is present');
});

test('heatmap bins resist a single outlier day', () => {
  const days = makeDays(60).map((d, i) => ({ ...d, total: i === 10 ? 86000 : 3600 }));
  const { svg } = heatmap({ perDay: days, weekStart: 1 });
  const bins = all(svg, 'rect').filter((r) => (r.attributes.class || '').startsWith('heat'))
    .map((r) => r.attributes.class.match(/heat-(\d)/)[1]);
  const ordinary = bins.filter((b) => b !== '0');
  assert.ok(new Set(ordinary).size <= 2, 'typical days do not all collapse into the lightest bin');
  assert.ok(ordinary.includes('5'), 'the busiest days still reach the darkest step');
});

test('stacked columns stay in frame with marks at most 24px thick', () => {
  const buckets = makeDays(30).map((d) => ({ key: d.day, total: d.total, byActivity: d.byActivity }));
  const svg = stackedColumns({ buckets, activities: ACTIVITIES, width: WIDTH, height: 220 });
  const [, , w, hgt] = viewBox(svg);
  assert.equal(w, WIDTH);
  for (const n of coords(svg)) assert.ok(n >= -1 && n <= Math.max(w, hgt) + 1, `coordinate ${n} in frame`);
  for (const bw of barWidths(svg)) assert.ok(bw > 0 && bw <= 24.001, `bar width ${bw} within spec`);
  const groups = all(svg, 'g').filter((g) => g.attributes.class === 'col-group');
  assert.equal(groups.length, 30);
  assert.ok(groups.every((g) => g.attributes['aria-label']));
});

test('stacked columns survive a single bucket and empty buckets', () => {
  const one = stackedColumns({ buckets: [{ key: '2026-10-17', total: 0, byActivity: {} }], activities: ACTIVITIES, width: 320 });
  for (const n of coords(one)) assert.ok(Number.isFinite(n), 'no NaN geometry when nothing is logged');
});

test('horizontal bars keep their value labels inside the frame', () => {
  const rows = [
    { label: 'Sleep', color: 6, value: 1000000, perDay: 27000 },
    { label: 'Work', color: 0, value: 600000, perDay: 16000 },
    { label: 'A very long activity name indeed', color: 2, value: 40, perDay: 2 },
  ];
  const svg = horizontalBars({ rows, width: WIDTH, total: 1600040 });
  const [, , w, hgt] = viewBox(svg);
  for (const text of all(svg, 'text')) {
    const x = Number(text.attributes.x);
    // A value label sits at the bar tip; allow for its own rendered width.
    assert.ok(x >= 0 && x + text.textContent.length * 8 <= w + 1, `label "${text.textContent}" fits`);
    assert.ok(Number(text.attributes.y) <= hgt);
  }
  for (const bw of barWidths(svg)) assert.ok(bw >= 2, 'even a tiny value draws a visible bar');
});

test('the trend line, its area and its end dot stay inside the plot', () => {
  const points = makeDays(52).map((d, i) => ({ label: `W${i}`, title: `Week ${i}`, value: d.total }));
  const svg = trendLine({ points, width: WIDTH, height: 210 });
  const [, , w, hgt] = viewBox(svg);
  for (const n of coords(svg)) assert.ok(n >= -1 && n <= Math.max(w, hgt) + 1, `coordinate ${n} in frame`);
  assert.equal(all(svg, 'path').filter((p) => p.attributes.class === 'trend-line').length, 1);
  assert.ok(all(svg, 'circle').length >= 2, 'end dot plus the hover marker');
  const xLabels = all(svg, 'text').filter((t) => t.attributes.class === 'c-axis' && Number(t.attributes.y) === 210 - 8);
  assert.ok(xLabels.length <= 3, `x labels are sparse (${xLabels.length}), not one per point`);
});

test('a one-point trend does not divide by zero', () => {
  const svg = trendLine({ points: [{ label: 'Jan 1', value: 3600 }], width: 320 });
  for (const n of coords(svg)) assert.ok(Number.isFinite(n));
});

test('weekday columns label every bar and stay in frame', () => {
  const items = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ label, title: label, value: 3600 * (i + 1) }));
  const svg = columns({ items, width: WIDTH, height: 190 });
  const [, , w, hgt] = viewBox(svg);
  for (const n of coords(svg)) assert.ok(n >= -1 && n <= Math.max(w, hgt) + 1);
  assert.equal(all(svg, 'text').filter((t) => items.some((i) => i.label === t.textContent)).length, 7);
  for (const bw of barWidths(svg)) assert.ok(bw <= 24.001);
});

test('charts hold up at phone width', () => {
  for (const width of [280, 320, 380]) {
    const svg = stackedColumns({
      buckets: makeDays(31).map((d) => ({ key: d.day, total: d.total, byActivity: d.byActivity })),
      activities: ACTIVITIES, width,
    });
    const [, , w] = viewBox(svg);
    assert.equal(w, width);
    for (const bw of barWidths(svg)) assert.ok(bw > 0, 'bars never collapse to zero width');
    const bars = horizontalBars({ rows: [{ label: 'Sleep', color: 6, value: 100, perDay: 10 }], width, total: 100 });
    for (const n of coords(bars)) assert.ok(Number.isFinite(n) && n >= -1);
  }
});

test('legend names every series it is given', () => {
  const list = legend(ACTIVITIES.map((a) => ({ label: a.name, color: a.color, value: 3600 })));
  assert.equal(list.children.length, 2);
  assert.match(list.textContent, /Sleep/);
  assert.match(list.textContent, /1h/);
});

test('textured fills are opt-in and define a pattern per series', () => {
  const plain = stackedColumns({ buckets: makeDays(5).map((d) => ({ key: d.day, total: d.total, byActivity: d.byActivity })), activities: ACTIVITIES, width: WIDTH });
  assert.equal(all(plain, 'pattern').length, 0, 'off by default');
  const textured = stackedColumns({ buckets: makeDays(5).map((d) => ({ key: d.day, total: d.total, byActivity: d.byActivity })), activities: ACTIVITIES, width: WIDTH, textures: true });
  assert.equal(all(textured, 'pattern').length, 2, 'one pattern per series in play');
});
