// Pitch palettes for the Variant lab field selector. The renderer reads these
// every frame, so switching a field theme never touches the analysis maths.
export const FIELD_THEMES = Object.freeze({
  classic: Object.freeze({
    base: '#14261a',
    pitch: '#1a3322',
    stripe: 'rgba(255,255,255,0.025)',
  }),
  broadcast: Object.freeze({
    base: '#17351f',
    pitch: '#2a5a2a',
    stripe: 'rgba(255,255,255,0.045)',
  }),
  night: Object.freeze({
    base: '#07110b',
    pitch: '#0a1a12',
    stripe: 'rgba(120,255,180,0.035)',
  }),
  // Football GEV Figma PitchScene: vertical green gradient + radial glow +
  // seven alternating dark stripes, thin white 8% lines, grey nodes.
  figma: Object.freeze({
    base: '#0F2C1E',
    pitch: '#0A2117',
    stripe: 'rgba(255,255,255,0.025)',
    figma: true,
    gradient: Object.freeze(['#0F2C1E', '#0A2117', '#071710']),
    glow: 'rgba(18,55,38,0.9)',
    stripeA: '#151623',
    stripeB: '#1D1934',
    line: 'rgba(255,255,255,0.08)',
    lineWidth: 0.914715,
    nodeGrey: '#4F547D',
    goalWash: 'rgba(255,255,255,0.1)',
  }),
});

export function fieldTheme(id) {
  return FIELD_THEMES[id] ?? FIELD_THEMES.classic;
}
