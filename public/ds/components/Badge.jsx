/* global React */
// =============================================================================
// DS — Badge
// Display-only label. <Badge type size>Text</Badge>.
// =============================================================================

function Badge({
  type = 'neutral',  // neutral | positive | warning | info | critical | ai
  size = 'medium',   // small | medium | large
  icon,
  children,
  className,
  ...rest
}) {
  return React.createElement('span', {
    className: window.cx('badge', className),
    'data-type': type, 'data-size': size,
    ...rest,
  },
    icon && React.createElement('span', { className: 'badge-icon' }, icon),
    React.createElement('span', { className: 'badge-label' }, children),
  );
}

window.Badge = Badge;
