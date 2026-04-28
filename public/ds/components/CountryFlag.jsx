/* global React */
// =============================================================================
// PREPLY DS — CountryFlag
// 4:3 image, 2px radius, 0.5px ink border. Sizes sm (16w), md (24w), lg (32w).
// Source: flagcdn.com.
// =============================================================================

const FLAG_SIZES = { sm: 'w40', md: 'w40', lg: 'w80' };

function CountryFlag({ code, size = 'md', alt, className, ...rest }) {
  const src = code
    ? `https://flagcdn.com/${FLAG_SIZES[size]}/${code.toLowerCase()}.png`
    : undefined;
  return React.createElement('img', {
    className: window.cx('pds-flag', `size-${size}`, className),
    src,
    alt: alt || (code ? code.toUpperCase() : 'Unknown country'),
    ...rest,
  });
}

window.CountryFlag = CountryFlag;
