/* global React */
// =============================================================================
// PREPLY DS — Input / Select / Field
// Field wraps a label + input + hint. Input/Select carry `.input` styling.
// =============================================================================

function Field({ label, hint, error, children }) {
  const id = React.useId();
  return React.createElement('label', { className: 'field', htmlFor: id },
    label && React.createElement('span', { className: 'lbl' }, label),
    React.cloneElement(children, { id }),
    (error || hint) && React.createElement('span', {
      className: window.cx('hint', error && 'err'),
    }, error || hint),
  );
}

function Input({ error = false, className, ...rest }) {
  return React.createElement('input', {
    className: window.cx('input', error && 'error', className),
    ...rest,
  });
}

function Select({ error = false, className, children, ...rest }) {
  return React.createElement('select', {
    className: window.cx('input', 'select', error && 'error', className),
    ...rest,
  }, children);
}

window.Field = Field;
window.Input = Input;
window.Select = Select;
