/* global React */
// =============================================================================
// DS — Rating (display only)
// Five stars, drive with `value` (0–5). The CSS uses --filled-pct to clip
// the filled layer over the empty layer. Sizes sm | md | lg.
// =============================================================================

const STAR_FILL_PATH = 'm12 3 2.221 5.942 6.338.277-4.965 3.95 1.696 6.112L12 15.78l-5.29 3.501 1.695-6.113-4.965-3.95 6.338-.276L11.999 3Z';
const STAR_EMPTY_PATH = 'M14.221 8.942 12 3 9.778 8.942l-6.338.277 4.964 3.95L6.71 19.28 12 15.78l5.29 3.501-1.695-6.113 4.965-3.95-6.338-.276Zm-1.234 1.699L11.999 8l-.987 2.64-2.817.124 2.207 1.755-.754 2.717L12 13.68l2.352 1.556-.754-2.717 2.207-1.755-2.817-.123Z';

function StarLayer({ which }) {
  const d = which === 'fill' ? STAR_FILL_PATH : STAR_EMPTY_PATH;
  return React.createElement('div', {
    className: `layer ${which === 'fill' ? 'filled' : 'empty'}`,
  },
    Array.from({ length: 5 }, (_, i) => React.createElement('svg', {
      key: i, viewBox: '0 0 24 24',
    },
      which === 'fill'
        ? React.createElement('path', { d })
        : React.createElement('path', { d, fillRule: 'evenodd', clipRule: 'evenodd' }),
    )),
  );
}

function Rating({ value = 0, size = 'lg', className, ...rest }) {
  const pct = Math.max(0, Math.min(5, value)) / 5 * 100;
  return React.createElement('div', {
    className: window.cx('pds-rating', `pds-rating--${size}`, className),
    style: { '--filled-pct': `${pct}%` },
    role: 'img',
    'aria-label': `${value} out of 5 stars`,
    ...rest,
  },
    React.createElement(StarLayer, { which: 'empty' }),
    React.createElement(StarLayer, { which: 'fill' }),
  );
}

window.Rating = Rating;
