/* global React */
// =============================================================================
// PREPLY DS — Slider & RangeSlider
// 4px track, 32×32 thumb. Single-thumb drives via --val/--min/--max;
// range drives via --lo/--hi (as %). Both use real <input type=range> for
// keyboard accessibility, with the visual track painted by CSS.
// =============================================================================

function Slider({ min = 0, max = 100, step = 1, value = 50, onChange, label, className, ...rest }) {
  const v = Math.max(min, Math.min(max, value));
  return React.createElement('div', {
    className: window.cx('pds-slider', className),
    style: { '--val': v, '--min': min, '--max': max },
  },
    React.createElement('div', { className: 'track' },
      React.createElement('div', { className: 'range' }),
    ),
    React.createElement('input', {
      type: 'range', min, max, step, value: v,
      'aria-label': label,
      onChange: e => onChange?.(+e.target.value),
      ...rest,
    }),
  );
}

function RangeSlider({ min = 0, max = 100, step = 1, low = 25, high = 75, onChange, labelLow, labelHigh, className }) {
  const span = max - min;
  const lo = Math.max(min, Math.min(high, low));
  const hi = Math.min(max, Math.max(low, high));
  const pct = v => ((v - min) / span) * 100;
  return React.createElement('div', {
    className: window.cx('pds-range', className),
    style: { '--lo': pct(lo), '--hi': pct(hi) },
  },
    React.createElement('div', { className: 'track' }),
    React.createElement('div', { className: 'range' }),
    React.createElement('input', {
      type: 'range', min, max, step, value: lo, className: 'lo',
      'aria-label': labelLow,
      onChange: e => onChange?.({ low: +e.target.value, high: hi }),
    }),
    React.createElement('input', {
      type: 'range', min, max, step, value: hi, className: 'hi',
      'aria-label': labelHigh,
      onChange: e => onChange?.({ low: lo, high: +e.target.value }),
    }),
  );
}

window.Slider = Slider;
window.RangeSlider = RangeSlider;
