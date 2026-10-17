/**
 * A very small DOM stand-in — just enough of the browser for the app to boot
 * and render under `node --test`, so view and chart code is exercised without
 * a headless browser. It is a test harness, not a DOM implementation.
 */

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on === undefined ? this.set.has(name) : !on) this.remove(name); else this.add(name); }
  sync() { this.el.attributes.class = [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attributes = {};
    // Writing to dataset must mirror into attributes, as the real DOM does,
    // because the app finds its live-updating elements with [data-*] selectors.
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = String(value);
        this.attributes[`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(value);
        return true;
      },
    });
    this.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; } });
    this.listeners = new Map();
    this.parentNode = null;
    this._text = '';
    this.classList = new ClassList(this);
  }

  get className() { return this.attributes.class || ''; }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') { this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); }
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'object' ? node : new Text(String(node));
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(node) { this.append(node); return node; }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  set innerHTML(value) { this.children = []; this._text = String(value).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this._text; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ type, target: this, preventDefault() {}, ...event });
  }
  click() { this.dispatch('click'); }
  focus() {}
  select() {}

  get clientWidth() { return 800; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 200, right: 800, bottom: 200 }; }

  /** Supports the selector shapes the app actually uses. */
  matches(selector) {
    const parts = selector.trim().match(/^([a-z0-9]*)((?:[#.[][^#.[]*)*)$/i);
    if (!parts) return false;
    if (parts[1] && parts[1].toLowerCase() !== this.tagName) return false;
    const rest = parts[2] || '';
    for (const token of rest.match(/[#.[][^#.[]*/g) || []) {
      if (token.startsWith('#') && this.attributes.id !== token.slice(1)) return false;
      if (token.startsWith('.') && !this.classList.contains(token.slice(1))) return false;
      if (token.startsWith('[')) {
        const m = token.slice(1, -1).match(/^([^=]+)(?:=["']?([^"']*)["']?)?$/);
        if (!m) return false;
        const value = this.attributes[m[1]];
        if (value === undefined) return false;
        if (m[2] !== undefined && value !== m[2]) return false;
      }
    }
    return true;
  }

  walk(fn) {
    for (const child of this.children) {
      if (child instanceof Node) { fn(child); child.walk(fn); }
    }
  }
  querySelector(selector) {
    let found = null;
    this.walk((el) => { if (!found && el.matches(selector)) found = el; });
    return found;
  }
  querySelectorAll(selector) {
    const out = [];
    this.walk((el) => { if (el.matches(selector)) out.push(el); });
    return out;
  }
}

class Text extends Node {
  constructor(value) { super('#text'); this._text = value; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = value; }
  walk() {}
  matches() { return false; }
}

export function installDom({ hash = '#/track', storage = {} } = {}) {
  const doc = new Node('document');
  doc.documentElement = new Node('html');
  doc.body = new Node('body');
  doc.head = new Node('head');
  doc.append(doc.documentElement, doc.head, doc.body);
  doc.createElement = (tag) => new Node(tag);
  doc.createElementNS = (_ns, tag) => new Node(tag);
  doc.createTextNode = (value) => new Text(String(value));
  doc.visibilityState = 'visible';

  const store = { ...storage };
  const win = {
    document: doc,
    innerWidth: 900,
    innerHeight: 800,
    scrollY: 0,
    scrollTo() {},
    location: { hash, protocol: 'http:', reload() {} },
    history: { replaceState(_s, _t, value) { win.location.hash = value; } },
    navigator: { standalone: false },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    addEventListener() {},
    requestAnimationFrame: (fn) => fn(),
  };

  globalThis.window = win;
  globalThis.document = doc;
  // Node defines `navigator` as a getter-only global.
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
  globalThis.localStorage = win.localStorage;
  globalThis.Node = Node;   // dom.js checks `instanceof Node`
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.confirm = () => true;
  globalThis.DOMException = globalThis.DOMException || class DOMException extends Error {};
  // The app sets up tick/heartbeat intervals at boot; keep the test process free.
  globalThis.setInterval = () => 0;

  return { win, doc, storage: store };
}
