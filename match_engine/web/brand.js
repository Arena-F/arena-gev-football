// Arena brand system — single source of truth for every GEV surface.
//
// Scales transcribed from the Arena brand boards. 500 is the anchor of each
// scale; pair a 500 with its 300 (light) and 800/900 (deep) for ramps.
// Canvas modules import the rgb maps; DOM chrome uses the CSS variables in
// index.html (kept in sync by hand — update both when the brand moves).

/** Full 50–900 scale as uppercase hex. */
export const ARENA = Object.freeze({
  blue: Object.freeze({
    50: '#EFF8FE', 100: '#D9EEFD', 200: '#BBDFFD', 300: '#8CC6FB',
    400: '#68BDF9', 500: '#52B4F5', 600: '#3299E0', 700: '#247DB8',
    800: '#1E5F8A', 900: '#17415D',
  }),
  purple: Object.freeze({
    50: '#F6F1FE', 100: '#E8E0FD', 200: '#D7C2FB', 300: '#BE9DF7',
    400: '#A77BF2', 500: '#8E5FEC', 600: '#7947D6', 700: '#6234B4',
    800: '#4C29BD', 900: '#351064',
  }),
  pink: Object.freeze({
    50: '#FCF4FC', 100: '#F7E5F8', 200: '#EFC2F0', 300: '#E5A8E8',
    400: '#D67EDD', 500: '#C861D1', 600: '#AD45E7', 700: '#8C3684',
    800: '#6B2870', 900: '#4B1E4F',
  }),
  violet: Object.freeze({
    50: '#F5F5FC', 100: '#E9E6F7', 200: '#D1CCEF', 300: '#B1A9DF',
    400: '#8B83C8', 500: '#6B5DA8', 600: '#51468A', 700: '#322F68',
    800: '#221B49', 900: '#171437',
  }),
  grey: Object.freeze({
    50: '#FFFFFF', 100: '#F5F5F5', 200: '#E5E5E5', 300: '#D4D4D4',
    400: '#A3A3A3', 500: '#737373', 600: '#525252', 700: '#404040',
    800: '#262626', 900: '#171717',
  }),
  success: Object.freeze({
    50: '#F1F8F0', 100: '#DFE9DD', 200: '#C7E3BE', 300: '#9BD995',
    400: '#75C66E', 500: '#52B44C', 600: '#439B2B', 700: '#37752F',
    800: '#285C25', 900: '#1C401B',
  }),
  warning: Object.freeze({
    50: '#FDF2F2', 100: '#FBE3E3', 200: '#F5C5C6', 300: '#EC999D',
    400: '#E36B70', 500: '#D63A3F', 600: '#B52D32', 700: '#9B2429',
    800: '#7A1D21', 900: '#521518',
  }),
});

/** Hex → [r, g, b]. */
export function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Hex → 'r,g,b' for canvas rgba() strings. */
export function hexCss(hex) {
  return hexRgb(hex).join(',');
}

/** Hex + alpha → 'rgba(r,g,b,a)'. */
export function hexA(hex, alpha) {
  return `rgba(${hexCss(hex)},${alpha})`;
}

// ── Semantic tokens ──────────────────────────────────────────────
// Primary = blue, Secondary = pink, accent violet. Home wears primary blue,
// away wears secondary pink; the ball is always white.

export const BRAND = Object.freeze({
  background: ARENA.violet[900],
  panel: ARENA.violet[800],
  border: ARENA.violet[700],
  ink: ARENA.grey[900],
  text: ARENA.grey[100],
  textBright: ARENA.grey[50],
  muted: ARENA.grey[400],
  faint: ARENA.grey[500],

  primary: ARENA.blue[500],
  primaryDeep: ARENA.blue[800],
  primarySoft: ARENA.blue[300],
  primaryPale: ARENA.blue[100],

  secondary: ARENA.pink[500],
  secondaryDeep: ARENA.pink[800],
  secondarySoft: ARENA.pink[300],

  accent: ARENA.purple[500],

  home: ARENA.blue[500],
  away: ARENA.pink[500],
  ball: ARENA.grey[50],

  success: ARENA.success[500],
  successSoft: ARENA.success[300],
  warning: ARENA.warning[500],
  warningSoft: ARENA.warning[300],
});

/** Passing-network unit colours: DEF primary, MID purple, FWD secondary. */
export const NETWORK_COLORS = Object.freeze({
  def: ARENA.blue[500],
  mid: ARENA.purple[500],
  fwd: ARENA.pink[500],
});

/** Same, as [r, g, b] for canvas compositing. */
export const NETWORK_RGB = Object.freeze({
  def: Object.freeze(hexRgb(ARENA.blue[500])),
  mid: Object.freeze(hexRgb(ARENA.purple[500])),
  fwd: Object.freeze(hexRgb(ARENA.pink[500])),
});

/** Team colours as [r, g, b]: home primary blue, away secondary pink. */
export const TEAM_RGB = Object.freeze({
  home: Object.freeze(hexRgb(ARENA.blue[500])),
  away: Object.freeze(hexRgb(ARENA.pink[500])),
});

/** Type stacks. Display = Bebas Neue; body = Manrope. */
export const FONTS = Object.freeze({
  display: "'Bebas Neue', 'Arial Narrow', sans-serif",
  body: "'Manrope', system-ui, sans-serif",
});
