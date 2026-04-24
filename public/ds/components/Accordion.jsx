/* global React */
// =============================================================================
// DS — Accordion
// Native <details>-based. Pass `exclusiveName` to make items mutually
// exclusive (HTML <details name=...>). Pass `card` for the surface variant.
// items: [{ title, content, open? }]
// =============================================================================

function Accordion({ card = false, exclusiveName, items = [], className }) {
  return React.createElement('div', {
    className: window.cx('pds-accordion', card && 'card-accordion', className),
  },
    items.map((item, i) => React.createElement('details', {
      key: i, name: exclusiveName, open: !!item.open,
    },
      React.createElement('summary', null,
        React.createElement('span', { className: 'text' }, item.title),
        React.createElement('svg', {
          className: 'chev', viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2,
        }, React.createElement('path', {
          d: 'm6 9 6 6 6-6', strokeLinecap: 'round', strokeLinejoin: 'round',
        })),
      ),
      React.createElement('div', { className: 'content' }, item.content),
    )),
  );
}

window.Accordion = Accordion;
