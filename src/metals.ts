/**
 * The four metals, shared by the rating badge and the achievement medals so a
 * gold 9/10 and a gold medal are the same gold.
 *
 * Each entry is [light, dark, mid] — the stops of a metallic gradient: a glint
 * at the top-left, the shadow under the middle, back to the body colour.
 */
export type MetalName = 'bronze' | 'silver' | 'gold' | 'diamond'

export const METAL_STOPS: Record<MetalName, [string, string, string]> = {
  bronze: ['#f0b27d', '#8a4f1d', '#c47f3e'],
  silver: ['#f2f2f7', '#7c7c88', '#c9c9d2'],
  gold: ['#ffe98a', '#a97b06', '#f2c94c'],
  diamond: ['#e8fcff', '#4aa8dd', '#b9e8f5'],
}

/** The same gradient as a CSS background (the square tiles and chips). */
export function metalBackground(metal: MetalName): string {
  const [light, dark, mid] = METAL_STOPS[metal]
  return `linear-gradient(145deg, ${light} 0%, ${mid} 30%, ${dark} 62%, ${mid} 100%)`
}
