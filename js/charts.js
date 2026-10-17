/**
 * SVG chart builders.
 *
 * Shared rules, applied here once so every chart in the app agrees:
 *  - marks are thin (columns/bars capped at 24px), with a 4px rounded data-end
 *    and a square baseline end;
 *  - touching fills are separated by a 2px gap in the surface colour, never a
 *    stroke; overlapping dots carry a 2px surface ring;
 *  - gridlines and axes are solid hairlines one step off the surface;
 *  - colour comes from CSS custom properties, so light/dark swap without a
 *    re-render and series colour follows the activity, never its rank;
 *  - text wears text tokens, never a series colour;
 *  - every chart has a hover/focus tooltip, and views pair it with a table.
 */

import { svgEl, h } from './dom.js';
import { hm, hours, dayLabel, WEEKDAYS } from './format.js';

export const SERIES_SLOTS = 8;

export function seriesVar(slot) {
  return `var(--series-${(((slot % SERIES_SLOTS) + SERIES_SLOTS) % SERIES_SLOTS) + 1})`;
}

/** Fill for a series: flat colour, or the ordered texture when enabled. */
function fillFor(slot, textures) {
  const i = (((slot % SERIES_SLOTS) + SERIES_SLOTS) % SERIES_SLOTS);
  return textures ? `url(#tex-${i})` : seriesVar(i);
}

/**
 * Texture is the backup identity channel for CVD, print and forced-colors —
 * one directional fill at 45 degrees and its 135 mirror, tone-on-tone.
 */
function textureDefs(slots) {
  return svgEl('defs', {}, [...new Set(slots)].map((raw) => {
    const i = (((raw % SERIES_SLOTS) + SERIES_SLOTS) % SERIES_SLOTS);
    const angle = i % 2 === 0 ? 45 : 135;
    return svgEl('pattern', {
      id: `tex-${i}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse',
      patternTransform: `rotate(${angle})`,
    }, [
      svgEl('rect', { width: 6, height: 6, style: `fill: ${seriesVar(i)}; opacity: 0.35` }),
      svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, style: `stroke: ${seriesVar(i)}; stroke-width: 3` }),
    ]);
  }));
}

/* ----------------------------------------------------------------- tooltip */

let tipEl = null;

function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite' });
    document.body.append(tipEl);
  }
  return tipEl;
}

export function hideTip() {
  if (tipEl) tipEl.classList.remove('is-visible');
}

function showTip(html, clientX, clientY) {
  const el = tip();
  el.innerHTML = html;
  el.classList.add('is-visible');
  const rect = el.getBoundingClientRect();
  const pad = 12;
  let left = clientX - rect.width / 2;
  left = Math.max(pad, Math.min(window.innerWidth - rect.width - pad, left));
  let top = clientY - rect.height - 14;
  if (top < pad) top = clientY + 18;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** Hit targets are bigger than their marks, and keyboard focus shows the tip. */
function attachTip(el, html, anchor) {
  const place = (ev) => {
    if (ev && 'clientX' in ev && ev.clientX) showTip(html, ev.clientX, ev.clientY);
    else {
      const box = (anchor || el).getBoundingClientRect();
      showTip(html, box.left + box.width / 2, box.top);
    }
  };
  el.addEventListener('pointerenter', place);
  el.addEventListener('pointermove', place);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', place);
  el.addEventListener('blur', hideTip);
}

/* ------------------------------------------------------------------- paths */

/** Rect with only the data-end corners rounded. */
function barPath(x, y, w, hgt, r, end = 'top') {
  const rr = Math.max(0, Math.min(r, w / 2, hgt));
  if (rr === 0) return `M${x},${y}h${w}v${hgt}h${-w}Z`;
  if (end === 'top') return `M${x},${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${hgt - rr}h${-w}Z`;
  // 'right': rounded on the right edge, square at the left baseline
  return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${hgt - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}Z`;
}

/** Nice round axis ticks (1 / 2 / 5 × 10^n) covering 0..max. */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function gridline(x1, y, x2) {
  return svgEl('line', { x1, y1: y, x2, y2: y, class: 'c-grid' });
}

/* --------------------------------------------------------------- heatmap */

/**
 * Year heatmap: one cell per day, sequential single-hue ramp, light to dark.
 * The lightest bin means "near zero" and is allowed to recede into the surface.
 * Bins are cut against the 90th percentile so one marathon day doesn't flatten
 * the rest of the year.
 */
export function heatmap({ perDay, weekStart = 1, onSelect, selected, activityName }) {
  const CELL = 13;
  const GAP = 3;
  const STEP = CELL + GAP;
  const LEFT = 30;
  const TOP = 18;

  const nonZero = perDay.filter((d) => d.total > 0).map((d) => d.total).sort((a, b) => a - b);
  const reference = nonZero.length ? nonZero[Math.floor(nonZero.length * 0.9)] : 0;
  const cuts = [0.2, 0.4, 0.6, 0.8].map((f) => f * reference);
  const binOf = (total) => {
    if (total <= 0) return 0;
    for (let i = 0; i < cuts.length; i++) if (total <= cuts[i]) return i + 1;
    return 5;
  };

  // Pad to whole weeks so columns line up with calendar weeks.
  const firstDate = perDay.length
    ? new Date(Number(perDay[0].day.slice(0, 4)), Number(perDay[0].day.slice(5, 7)) - 1, Number(perDay[0].day.slice(8, 10)))
    : new Date();
  const lead = (firstDate.getDay() - weekStart + 7) % 7;
  const cells = [...new Array(lead).fill(null), ...perDay];
  const weeks = Math.ceil(cells.length / 7);
  const width = LEFT + weeks * STEP;
  const height = TOP + 7 * STEP + 4;

  const svg = svgEl('svg', {
    class: 'chart chart-heatmap', width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': `Daily tracked time heatmap, ${perDay.length} days`,
  });

  // Weekday labels: every other row, so they stay quiet.
  for (let row = 0; row < 7; row++) {
    const weekday = (weekStart + row) % 7;
    if (row % 2 !== 1) continue;
    svg.append(svgEl('text', {
      x: LEFT - 6, y: TOP + row * STEP + CELL - 2, class: 'c-axis', 'text-anchor': 'end',
      text: WEEKDAYS[weekday].slice(0, 1),
    }));
  }

  let lastMonth = null;
  cells.forEach((cell, i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    if (!cell) return;
    const month = cell.day.slice(5, 7);
    if (month !== lastMonth && row <= 2) {
      lastMonth = month;
      svg.append(svgEl('text', {
        x: LEFT + col * STEP, y: TOP - 6, class: 'c-axis',
        text: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1],
      }));
    }
    const bin = binOf(cell.total);
    const g = svgEl('g', { class: 'heat-cell', tabindex: onSelect ? 0 : -1, role: onSelect ? 'button' : null });
    const rect = svgEl('rect', {
      x: LEFT + col * STEP, y: TOP + row * STEP, width: CELL, height: CELL, rx: 3,
      class: `heat heat-${bin}${cell.day === selected ? ' is-selected' : ''}`,
    });
    g.append(rect);
    const detail = cell.total > 0 ? hm(cell.total) : 'nothing tracked';
    attachTip(g, `<strong>${dayLabel(cell.day, { withYear: true })}</strong><span>${activityName ? `${activityName}: ` : ''}${detail}</span>`, rect);
    if (onSelect) {
      g.addEventListener('click', () => onSelect(cell.day));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(cell.day); }
      });
      g.setAttribute('aria-label', `${dayLabel(cell.day, { withYear: true })}: ${detail}`);
    }
    svg.append(g);
  });

  const legend = h('div', { class: 'heat-legend' }, [
    h('span', { class: 'c-note', text: 'Less' }),
    ...[0, 1, 2, 3, 4, 5].map((bin) => h('span', { class: `heat-swatch heat-${bin}` })),
    h('span', { class: 'c-note', text: 'More' }),
    reference > 0 ? h('span', { class: 'c-note', text: `· darkest ≈ ${hm(reference)}+ a day` }) : null,
  ]);

  return { svg, legend, scroller: h('div', { class: 'chart-scroll' }, [svg]) };
}

/* -------------------------------------------------- stacked columns (days) */

/**
 * Stacked columns: one column per bucket, one segment per activity.
 * Segments are separated by a 2px surface gap and the top segment carries the
 * 4px rounded cap; identity comes from the legend the view renders beside it.
 */
export function stackedColumns({ buckets, activities, width, height = 220, labelFor, tipTitleFor, textures = false }) {
  const PAD = { top: 10, right: 8, bottom: 26, left: 42 };
  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const n = Math.max(1, buckets.length);
  const step = plotW / n;
  const barW = Math.min(24, Math.max(3, step - 6));
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const ticks = niceTicks(max / 3600, 3);
  const scaleMax = Math.max(max, ticks[ticks.length - 1] * 3600);
  const y = (seconds) => PAD.top + plotH - (seconds / scaleMax) * plotH;

  const svg = svgEl('svg', {
    class: 'chart', width: '100%', height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': 'Tracked time per period, by activity',
  });
  if (textures) svg.append(textureDefs(activities.map((a) => a.color)));

  for (const tick of ticks) {
    svg.append(gridline(PAD.left, y(tick * 3600), PAD.left + plotW));
    svg.append(svgEl('text', {
      x: PAD.left - 8, y: y(tick * 3600) + 4, class: 'c-axis', 'text-anchor': 'end',
      text: tick === 0 ? '0' : `${tick}h`,
    }));
  }

  buckets.forEach((bucket, i) => {
    const x = PAD.left + i * step + (step - barW) / 2;
    const g = svgEl('g', { class: 'col-group', tabindex: 0 });
    g.append(svgEl('rect', { x: PAD.left + i * step, y: PAD.top, width: step, height: plotH, class: 'col-hit' }));

    const segments = activities
      .map((a) => ({ activity: a, seconds: bucket.byActivity[a.id] || 0 }))
      .filter((s) => s.seconds > 0);

    let cursor = 0;
    segments.forEach((seg, idx) => {
      const isTop = idx === segments.length - 1;
      const yTop = y(cursor + seg.seconds);
      const yBottom = y(cursor);
      const gapped = Math.max(1, yBottom - yTop - (idx === 0 ? 0 : 2));
      const segY = yBottom - gapped;
      g.append(svgEl('path', {
        d: barPath(x, segY, barW, gapped, isTop ? 4 : 0, 'top'),
        style: `fill: ${fillFor(seg.activity.color, textures)}`,
      }));
      cursor += seg.seconds;
    });

    const title = tipTitleFor ? tipTitleFor(bucket) : dayLabel(bucket.key, { withYear: true });
    const lines = segments.slice().reverse().map((seg) => `<span><i class="sw" style="background:${seriesVar(seg.activity.color)}"></i>${seg.activity.name}<b>${hm(seg.seconds)}</b></span>`).join('');
    attachTip(g, `<strong>${title}</strong>${lines || '<span>Nothing tracked</span>'}${segments.length > 1 ? `<span class="tip-total">Total<b>${hm(bucket.total)}</b></span>` : ''}`);
    g.setAttribute('aria-label', `${title}: ${hm(bucket.total)}`);
    svg.append(g);

    const label = labelFor ? labelFor(bucket, i, n) : null;
    if (label) {
      svg.append(svgEl('text', {
        x: PAD.left + i * step + step / 2, y: height - 8, class: 'c-axis', 'text-anchor': 'middle', text: label,
      }));
    }
  });

  svg.append(svgEl('line', { x1: PAD.left, y1: PAD.top + plotH, x2: PAD.left + plotW, y2: PAD.top + plotH, class: 'c-baseline' }));
  return svg;
}

/* ----------------------------------------------------- horizontal bars */

/**
 * One bar per activity, colour following the activity. Each bar is directly
 * labelled, so identity never rests on hue alone (and the light-mode palette's
 * low-contrast slots stay readable).
 */
export function horizontalBars({ rows, width, total, textures = false }) {
  const ROW = 30;
  const BAR = 18;
  const LABEL_W = Math.min(132, Math.max(84, Math.round(width * 0.3)));
  const VALUE_W = 86;
  const plotW = Math.max(40, width - LABEL_W - VALUE_W);
  const height = Math.max(ROW, rows.length * ROW) + 6;
  const max = Math.max(...rows.map((r) => r.value), 1);

  const svg = svgEl('svg', {
    class: 'chart', width: '100%', height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': 'Time per activity',
  });
  if (textures) svg.append(textureDefs(rows.map((r) => r.color)));

  rows.forEach((row, i) => {
    const y = i * ROW + (ROW - BAR) / 2;
    const w = Math.max(2, (row.value / max) * plotW);
    const g = svgEl('g', { class: 'bar-group', tabindex: 0 });
    g.append(svgEl('rect', { x: 0, y: i * ROW, width, height: ROW, class: 'col-hit' }));
    g.append(svgEl('text', { x: 0, y: i * ROW + ROW / 2 + 4, class: 'c-label', text: row.label }));
    g.append(svgEl('path', {
      d: barPath(LABEL_W, y, w, BAR, 4, 'right'),
      style: `fill: ${fillFor(row.color, textures)}`,
    }));
    g.append(svgEl('text', {
      x: LABEL_W + w + 8, y: y + BAR / 2 + 4, class: 'c-value', text: hm(row.value),
    }));
    const share = total > 0 ? ` · ${Math.round((row.value / total) * 100)}% of tracked time` : '';
    attachTip(g, `<strong>${row.label}</strong><span>${hm(row.value)}${share}</span>${row.perDay ? `<span>${hours(row.perDay, 1)} a day on average</span>` : ''}`);
    g.setAttribute('aria-label', `${row.label}: ${hm(row.value)}`);
    svg.append(g);
  });

  svg.append(svgEl('line', { x1: LABEL_W, y1: 0, x2: LABEL_W, y2: rows.length * ROW, class: 'c-baseline' }));
  return svg;
}

/* ------------------------------------------------------------ trend line */

/**
 * A single-series trend: 2px line, 10% area wash, an end dot with a 2px surface
 * ring, and a crosshair that snaps to the nearest point. One series, so no
 * legend — the card title says what is plotted.
 */
export function trendLine({ points, width, height = 200, unitLabel = 'tracked' }) {
  const PAD = { top: 12, right: 14, bottom: 26, left: 42 };
  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const ticks = niceTicks(max / 3600, 3);
  const scaleMax = Math.max(max, ticks[ticks.length - 1] * 3600);
  const n = points.length;
  const x = (i) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / scaleMax) * plotH;

  const svg = svgEl('svg', {
    class: 'chart', width: '100%', height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': `Trend of time ${unitLabel}`,
  });

  for (const tick of ticks) {
    svg.append(gridline(PAD.left, y(tick * 3600), PAD.left + plotW));
    svg.append(svgEl('text', {
      x: PAD.left - 8, y: y(tick * 3600) + 4, class: 'c-axis', 'text-anchor': 'end',
      text: tick === 0 ? '0' : `${tick}h`,
    }));
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  svg.append(svgEl('path', {
    d: `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`,
    class: 'trend-area', style: `fill: ${seriesVar(0)}`,
  }));
  svg.append(svgEl('path', { d: line, class: 'trend-line', style: `stroke: ${seriesVar(0)}` }));

  const last = points[n - 1];
  svg.append(svgEl('circle', { cx: x(n - 1), cy: y(last.value), r: 5, class: 'trend-dot', style: `fill: ${seriesVar(0)}` }));
  svg.append(svgEl('text', {
    x: Math.min(x(n - 1), PAD.left + plotW - 2), y: Math.max(PAD.top + 10, y(last.value) - 12),
    class: 'c-value', 'text-anchor': 'end', text: hm(last.value),
  }));

  points.forEach((p, i) => {
    if (i === 0 || i === n - 1 || (n > 6 && i === Math.floor(n / 2))) {
      svg.append(svgEl('text', {
        x: Math.max(PAD.left, Math.min(x(i), PAD.left + plotW)), y: height - 8, class: 'c-axis',
        'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', text: p.label,
      }));
    }
  });

  const crosshair = svgEl('line', { class: 'crosshair', y1: PAD.top, y2: PAD.top + plotH, x1: 0, x2: 0, style: 'opacity:0' });
  const marker = svgEl('circle', { class: 'trend-dot', r: 5, style: `fill: ${seriesVar(0)}; opacity:0`, cx: 0, cy: 0 });
  svg.append(crosshair, marker);

  const hit = svgEl('rect', { x: PAD.left - step(plotW, n) / 2, y: PAD.top, width: plotW + step(plotW, n), height: plotH, class: 'col-hit', tabindex: 0 });
  let focusIndex = n - 1;
  const show = (i, clientX, clientY) => {
    const p = points[i];
    if (!p) return;
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    crosshair.style.opacity = '1';
    marker.setAttribute('cx', x(i));
    marker.setAttribute('cy', y(p.value));
    marker.style.opacity = '1';
    const box = svg.getBoundingClientRect();
    const scale = box.width / width;
    showTip(
      `<strong>${p.title || p.label}</strong><span>${hm(p.value)}</span>${p.sub ? `<span>${p.sub}</span>` : ''}`,
      clientX ?? box.left + x(i) * scale,
      clientY ?? box.top + y(p.value) * scale,
    );
  };
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const local = ((clientX - box.left) / box.width) * width;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - local);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };
  hit.addEventListener('pointermove', (ev) => { focusIndex = nearest(ev.clientX); show(focusIndex, ev.clientX, ev.clientY); });
  hit.addEventListener('pointerenter', (ev) => { focusIndex = nearest(ev.clientX); show(focusIndex, ev.clientX, ev.clientY); });
  hit.addEventListener('pointerleave', () => {
    hideTip();
    crosshair.style.opacity = '0';
    marker.style.opacity = '0';
  });
  hit.addEventListener('focus', () => show(focusIndex));
  hit.addEventListener('blur', () => {
    hideTip();
    crosshair.style.opacity = '0';
    marker.style.opacity = '0';
  });
  hit.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    focusIndex = Math.max(0, Math.min(n - 1, focusIndex + (ev.key === 'ArrowRight' ? 1 : -1)));
    show(focusIndex);
  });
  svg.append(hit);
  return svg;
}

function step(plotW, n) {
  return n > 1 ? plotW / (n - 1) : plotW;
}

/* ---------------------------------------------------------------- columns */

/** Single-series columns (weekday profile) — one colour for every column. */
export function columns({ items, width, height = 180, textures = false }) {
  const PAD = { top: 14, right: 8, bottom: 26, left: 42 };
  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const n = Math.max(1, items.length);
  const stepW = plotW / n;
  const barW = Math.min(24, Math.max(6, stepW - 10));
  const max = Math.max(...items.map((i) => i.value), 1);
  const ticks = niceTicks(max / 3600, 3);
  const scaleMax = Math.max(max, ticks[ticks.length - 1] * 3600);
  const y = (v) => PAD.top + plotH - (v / scaleMax) * plotH;

  const svg = svgEl('svg', {
    class: 'chart', width: '100%', height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': 'Average tracked time by weekday',
  });
  if (textures) svg.append(textureDefs([0]));

  for (const tick of ticks) {
    svg.append(gridline(PAD.left, y(tick * 3600), PAD.left + plotW));
    svg.append(svgEl('text', { x: PAD.left - 8, y: y(tick * 3600) + 4, class: 'c-axis', 'text-anchor': 'end', text: tick === 0 ? '0' : `${tick}h` }));
  }

  items.forEach((item, i) => {
    const x = PAD.left + i * stepW + (stepW - barW) / 2;
    const top = y(item.value);
    const g = svgEl('g', { class: 'col-group', tabindex: 0 });
    g.append(svgEl('rect', { x: PAD.left + i * stepW, y: PAD.top, width: stepW, height: plotH, class: 'col-hit' }));
    g.append(svgEl('path', {
      d: barPath(x, top, barW, Math.max(1, PAD.top + plotH - top), 4, 'top'),
      style: `fill: ${fillFor(0, textures)}`,
    }));
    g.append(svgEl('text', { x: PAD.left + i * stepW + stepW / 2, y: height - 8, class: 'c-axis', 'text-anchor': 'middle', text: item.label }));
    attachTip(g, `<strong>${item.title || item.label}</strong><span>${hm(item.value)}${item.sub ? ` · ${item.sub}` : ''}</span>`);
    g.setAttribute('aria-label', `${item.title || item.label}: ${hm(item.value)}`);
    svg.append(g);
  });

  svg.append(svgEl('line', { x1: PAD.left, y1: PAD.top + plotH, x2: PAD.left + plotW, y2: PAD.top + plotH, class: 'c-baseline' }));
  return svg;
}

/** Legend — always rendered by views showing two or more series. */
export function legend(items) {
  return h('ul', { class: 'legend' }, items.map((item) => h('li', {}, [
    h('i', { class: 'sw', style: { background: seriesVar(item.color) } }),
    h('span', { text: item.label }),
    item.value !== undefined ? h('b', { text: hm(item.value) }) : null,
  ])));
}
