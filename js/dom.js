/** Minimal DOM helpers — enough structure to keep views declarative. */

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
}

function append(el, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** A labelled table rendered under a chart — the chart's accessible fallback. */
export function dataTable(caption, headers, rows) {
  return h('details', { class: 'data-table' }, [
    h('summary', { text: 'Data table' }),
    h('div', { class: 'data-table-scroll' }, [
      h('table', {}, [
        h('caption', { text: caption }),
        h('thead', {}, [h('tr', {}, headers.map((head, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: head })))]),
        h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell, i) => (i
          ? h('td', { class: 'num', text: cell })
          : h('th', { scope: 'row', text: cell })))))),
      ]),
    ]),
  ]);
}
