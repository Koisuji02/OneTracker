export interface ThemePreset {
  id: string
  name: { en: string; it: string }
  light?: boolean
  vars: {
    accent: string
    brand: string
    surface: string
    card: string
    card2: string
    line: string
    ink: string
    ink2: string
    ink3: string
    ink4: string
  }
}

const darkInks = { ink: '#f4f4f5', ink2: '#a1a1aa', ink3: '#71717a', ink4: '#52525b' }
const lightInks = { ink: '#17171a', ink2: '#4b4b52', ink3: '#6f6f76', ink4: '#9d9da4' }

export const THEMES: ThemePreset[] = [
  {
    id: 'dark',
    name: { en: 'Dark', it: 'Scuro' },
    vars: {
      accent: '#ffd60a',
      brand: '#ffd60a',
      surface: '#0b0b0e',
      card: '#17171c',
      card2: '#1f1f26',
      line: '#2a2a33',
      ...darkInks,
    },
  },
  {
    id: 'light',
    name: { en: 'Light', it: 'Chiaro' },
    light: true,
    vars: {
      accent: '#96780a',
      brand: '#ffd60a',
      surface: '#f6f6f3',
      card: '#ffffff',
      card2: '#e9e9e4',
      line: '#dfdfd9',
      ...lightInks,
    },
  },
  {
    id: 'amoled',
    name: { en: 'AMOLED', it: 'AMOLED' },
    vars: {
      accent: '#ffd60a',
      brand: '#ffd60a',
      surface: '#000000',
      card: '#0e0e11',
      card2: '#17171c',
      line: '#26262c',
      ...darkInks,
    },
  },
  {
    id: 'ocean',
    name: { en: 'Ocean', it: 'Oceano' },
    vars: {
      accent: '#4cc9f0',
      brand: '#4cc9f0',
      surface: '#07121c',
      card: '#0e1c2a',
      card2: '#152a3d',
      line: '#1f3a52',
      ink: '#eef6fb',
      ink2: '#9fb6c6',
      ink3: '#70899a',
      ink4: '#4e6374',
    },
  },
  {
    id: 'forest',
    name: { en: 'Forest', it: 'Foresta' },
    vars: {
      accent: '#52d17c',
      brand: '#52d17c',
      surface: '#081208',
      card: '#0f1d12',
      card2: '#16291c',
      line: '#234029',
      ink: '#eff6f0',
      ink2: '#a3b8a8',
      ink3: '#73897a',
      ink4: '#4f6356',
    },
  },
  {
    id: 'grape',
    name: { en: 'Grape', it: 'Uva' },
    vars: {
      accent: '#b39df8',
      brand: '#a78bfa',
      surface: '#0d0817',
      card: '#150f24',
      card2: '#1f1733',
      line: '#2c2247',
      ink: '#f3f0fb',
      ink2: '#aca4c2',
      ink3: '#7d7495',
      ink4: '#564e6d',
    },
  },
  {
    id: 'sunset',
    name: { en: 'Sunset', it: 'Tramonto' },
    vars: {
      accent: '#ff9f43',
      brand: '#ff9f43',
      surface: '#150c07',
      card: '#21130b',
      card2: '#2d1c10',
      line: '#3f2a18',
      ink: '#faf2ec',
      ink2: '#c2ab9b',
      ink3: '#93796a',
      ink4: '#665348',
    },
  },
  {
    id: 'paper',
    name: { en: 'Paper', it: 'Carta' },
    light: true,
    vars: {
      accent: '#175bcc',
      brand: '#8ab4f8',
      surface: '#f4f6f9',
      card: '#ffffff',
      card2: '#e5eaf1',
      line: '#d9e1ea',
      ink: '#16181d',
      ink2: '#4a5160',
      ink3: '#6c7484',
      ink4: '#9aa2b1',
    },
  },
]

/** Apply a theme preset by writing its CSS variables on the root element. */
export function applyTheme(id: string | null | undefined): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${k}`, v)
  }
  root.classList.toggle('light', !!theme.light)
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme.vars.surface)
}
