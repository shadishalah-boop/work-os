/* global React */
// =============================================================================
// PREPLY DS — Button
// Pill-square, 8px radius, 2px border (see button.css). Variants map to
// .btn--<variant>; sizes 'sm'/'xs' map to .btn--sm/.btn--xs (default = medium).
// iconOnly renders the square .btn--icon form (used by IconButton).
// =============================================================================

function Button({
  variant = 'primary',
  size,
  iconOnly = false,
  className,
  children,
  type = 'button',
  ...rest
}) {
  const sizeClass = size === 'sm' ? 'btn--sm' : size === 'xs' ? 'btn--xs' : null;
  return React.createElement(
    'button',
    {
      type,
      className: window.cx(
        'btn',
        variant && `btn--${variant}`,
        sizeClass,
        iconOnly && 'btn--icon',
        className
      ),
      ...rest,
    },
    children
  );
}

window.Button = Button;
