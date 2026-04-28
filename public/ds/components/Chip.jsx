/* global React */
// =============================================================================
// PREPLY DS — Chip
// Interactive tag for filters / multi-select / applied filters.
// Use aria-selected="true|false" for selected state, or `dismissible` for
// X-able pills. Pass `count` to render a trailing bubble badge.
// =============================================================================

function Chip({
  selected = false,
  dismissible = false,
  disabled = false,
  icon,
  count,
  onDismiss,
  children,
  className,
  ...rest
}) {
  const props = {
    className: window.cx('chip', className),
    disabled,
    ...rest,
  };
  if (dismissible) props['data-variant'] = 'dismissible';
  else props['aria-selected'] = String(selected);

  return React.createElement('button', props,
    icon && React.createElement('span', { className: 'chip-icon' }, icon),
    React.createElement('span', { className: 'chip-label' },
      children,
      typeof count !== 'undefined' && React.createElement('span', {
        className: 'bubble',
        'data-variant': 'dark', 'data-size': 'small',
        ...(String(count).length > 1 ? { 'data-multichar': true } : {}),
      }, count),
    ),
    dismissible && React.createElement('span', {
      className: 'chip-dismiss',
      onClick: (e) => { e.stopPropagation(); onDismiss?.(e); },
    }, React.createElement('svg', {
      width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round',
    },
      React.createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      React.createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    )),
  );
}

window.Chip = Chip;
