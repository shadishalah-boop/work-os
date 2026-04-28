/* global React */
// =============================================================================
// PREPLY DS — Switch
// Pill toggle. Auto-resizes for pointer type (39×24 desktop, 52×32 touch).
// =============================================================================

function Switch({ checked = false, disabled = false, onChange, ariaLabel, className, ...rest }) {
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    className: window.cx('pds-switch', className),
    'aria-checked': String(!!checked),
    'aria-label': ariaLabel,
    disabled: disabled || undefined,
    onClick: () => !disabled && onChange?.(!checked),
    ...rest,
  }, React.createElement('span', { className: 'thumb' }));
}

window.Switch = Switch;
