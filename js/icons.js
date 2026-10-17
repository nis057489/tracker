import { svgEl } from './dom.js';

const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  pencil: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  check: 'M4 12.5l5 5L20 6.5',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  up: 'M5 15l7-7 7 7',
  down: 'M5 9l7 7 7-7',
  calendar: 'M4 8h16M7 4v3M17 4v3M5 8h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  clock: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1017 0 8.5 8.5 0 10-17 0',
  cog: 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM4 12l-1.5-1 1-2.5 1.8.3M20 12l1.5-1-1-2.5-1.8.3M12 4l-1-1.5h-2L8.2 4M12 20l1 1.5h2l.8-1.5M6 17l-1.8.4-1-2.5L4.7 14M18 7l1.8-.4 1 2.5-1.5.9',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 20V9m0 0l-4 4m4-4l4 4M5 5h14',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
  archive: 'M4 7h16v4H4zM6 11v9h12v-9M10 15h4',
  install: 'M12 4v9m0 0l-3.5-3.5M12 13l3.5-3.5M6 16v3h12v-3',
  target: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM12 3v2M12 19v2M3 12h2M19 12h2',
};

export function icon(name, { size = 20, className = '' } = {}) {
  return svgEl('svg', {
    class: `icon ${className}`.trim(), width: size, height: size, viewBox: '0 0 24 24',
    'aria-hidden': 'true', focusable: 'false',
  }, [svgEl('path', { d: PATHS[name] || PATHS.clock })]);
}
