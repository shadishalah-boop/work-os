/* global React */
// =============================================================================
// PREPLY DS — Avatar
// Sizes are LOCKED to 24, 32, 48, 64, 96, 160. Always 4px radius.
// =============================================================================

const AVATAR_SIZES = [24, 32, 48, 64, 96, 160];
const AVATAR_FALLBACK = 'assets/avatar-default.svg';

function Avatar({ src, alt = '', size = 48, className, ...rest }) {
  if (!AVATAR_SIZES.includes(size)) {
    console.warn(`[Avatar] size ${size} is not allowed. Use one of: ${AVATAR_SIZES.join(', ')}`);
  }
  return React.createElement('span', {
    className: window.cx('pds-avatar', `size-${size}`, className), ...rest,
  },
    React.createElement('img', { src: src || AVATAR_FALLBACK, alt }),
  );
}

window.Avatar = Avatar;
window.AVATAR_SIZES = AVATAR_SIZES;
