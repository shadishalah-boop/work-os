/* global React */
// =============================================================================
// DS — Bubble counter & overlay
// Bubble: pill counter for unread / counts. Variants dark|light, sizes
// small|medium|large. Auto-collapses values > limit (default 99) to "99+".
// BubbleOverlay: positions a bubble in the top-right corner of its child
// (icon button, avatar) with an optional cutout outline.
// =============================================================================

function Bubble({ value, size = 'small', variant = 'dark', limit = 99, className, ...rest }) {
  const display = (typeof value === 'number' && value > limit) ? `${limit}+` : value;
  const isMulti = String(display).length > 1;
  return React.createElement('span', {
    className: window.cx('bubble', className),
    'data-size': size, 'data-variant': variant,
    ...(isMulti ? { 'data-multichar': true } : {}),
    ...rest,
  }, display);
}

function BubbleOverlay({ count, bubbleSize = 'small', cutout = true, children, className }) {
  return React.createElement('div', {
    className: window.cx('bubble-overlay', className),
    ...(cutout ? { 'data-cutout': 'true' } : {}),
  },
    React.createElement(Bubble, { value: count, size: bubbleSize }),
    children,
  );
}

window.Bubble = Bubble;
window.BubbleOverlay = BubbleOverlay;
