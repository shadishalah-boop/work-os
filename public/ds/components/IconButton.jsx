/* global React */
// =============================================================================
// DS — IconButton
// Convenience wrapper around <Button iconOnly>. Always supply ariaLabel.
// =============================================================================

function IconButton({ variant = 'tertiary', size, icon, ariaLabel, className, ...rest }) {
  return React.createElement(window.Button, {
    variant, size, iconOnly: true,
    'aria-label': ariaLabel,
    className, ...rest,
  }, icon);
}

window.IconButton = IconButton;
