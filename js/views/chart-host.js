import { h, clear } from '../dom.js';

/**
 * Charts are drawn at a pixel width so their text stays crisp, so the host
 * measures itself after mount and redraws on resize.
 */
export function chartHost(ctx, build) {
  const host = h('div', { class: 'chart-host' });
  const draw = () => {
    const width = Math.max(260, Math.round(host.clientWidth || ctx.width || 320));
    clear(host).append(build(width));
  };
  ctx.onMount(() => {
    draw();
    ctx.onResize(draw);
  });
  return host;
}
