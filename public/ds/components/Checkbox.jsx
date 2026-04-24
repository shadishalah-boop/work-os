/* global React */
// =============================================================================
// DS — Checkbox
// 20×20, 2px border, 4px radius. Wrap a real <input> with two SVG glyphs.
// `indeterminate` flips on the mixed-state dash glyph.
// =============================================================================

const CHECK_SVG = React.createElement('svg', {
  className: 'check', width: 13, height: 13, viewBox: '0 0 13 13', fill: '#fff',
}, React.createElement('path', { d: 'M11.3 2.4 4.6 9.1 1.7 6.2.3 7.6l4.3 4.3 8.1-8.1z' }));

const DASH_SVG = React.createElement('svg', {
  className: 'dash', width: 15, height: 15, viewBox: '0 0 15 15', fill: '#fff',
}, React.createElement('rect', { x: 2, y: 6.5, width: 11, height: 2, rx: 1 }));

function Checkbox({ checked, indeterminate = false, invalid = false, disabled = false, onChange, className, ...rest }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return React.createElement('span', { className: window.cx('pds-cb', className) },
    React.createElement('input', {
      ref, type: 'checkbox',
      checked: !!checked, disabled, onChange,
      'aria-invalid': invalid || undefined,
      ...rest,
    }),
    CHECK_SVG, DASH_SVG,
  );
}

function CheckboxField({ children, ...checkboxProps }) {
  return React.createElement('label', {
    className: 'field',
    style: { display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' },
  },
    React.createElement(Checkbox, checkboxProps),
    React.createElement('span', null, children),
  );
}

window.Checkbox = Checkbox;
window.CheckboxField = CheckboxField;
