/* global React */
// =============================================================================
// PREPLY DS — shared utilities
// Loaded first; other component files depend on window.cx and window.React refs.
// =============================================================================

const cx = (...parts) => parts.filter(Boolean).join(' ');

window.cx = cx;
