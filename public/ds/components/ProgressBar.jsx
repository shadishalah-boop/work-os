/* global React */
// =============================================================================
// DS — ProgressBar
// 8px tall, pill ends, ink fill. Drive with `value` (0–100).
// =============================================================================

function ProgressBar({ value = 0, label, className, ...rest }) {
  const pct = Math.max(0, Math.min(100, value));
  return React.createElement('div', {
    className: window.cx('pds-bar', className),
    role: 'progressbar',
    'aria-label': label,
    'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100,
    style: { '--pct': `${pct}%` },
    ...rest,
  });
}

window.ProgressBar = ProgressBar;
