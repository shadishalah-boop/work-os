/* global React */
// =============================================================================
// PREPLY DS — Divider
// 1px line. Default uses --border-subtle. `strong` -> --border-default.
// `ink` -> full ink rule. `vertical` -> 1px-wide span instead of <hr>.
// =============================================================================

function Divider({ strong = false, ink = false, vertical = false, className, ...rest }) {
  return React.createElement(vertical ? 'span' : 'hr', {
    className: window.cx(
      'pds-divider',
      strong && 'pds-divider--strong',
      ink && 'pds-divider--ink',
      vertical && 'pds-divider--vertical',
      className,
    ),
    ...rest,
  });
}

window.Divider = Divider;
