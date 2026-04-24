/* global React */
// =============================================================================
// DS — ProgressSteps
// Discrete pill steps. Each step gets data-active, the current also gets
// aria-current="step".
// =============================================================================

function ProgressSteps({ count, current = 1, label, className }) {
  return React.createElement('div', {
    className: window.cx('pds-steps', className),
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 1, 'aria-valuemax': count, 'aria-valuenow': current,
  },
    Array.from({ length: count }, (_, i) => {
      const idx = i + 1;
      const active = idx <= current;
      const isCurrent = idx === current;
      return React.createElement('div', {
        key: i,
        className: 'step',
        'data-active': String(active),
        ...(isCurrent ? { 'aria-current': 'step' } : {}),
      });
    }),
  );
}

window.ProgressSteps = ProgressSteps;
