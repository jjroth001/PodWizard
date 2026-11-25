/**
 * Pod Wizard's three looks (see docs/mockups). Every screen reads colours from the active theme,
 * so adding a theme means adding one object here.
 */

export type ThemeName = 'paper' | 'dusk' | 'midnight';

export type Theme = {
  name: ThemeName;
  label: string;
  dark: boolean;
  /** Page background; Dusk paints a gradient over it (`gradient`). */
  background: string;
  gradient: readonly [string, string, string] | null;
  text: string;
  textSecondary: string;
  /** Cards and grouped rows. */
  card: string;
  cardBorder: string;
  /** Small round buttons, inputs, pressed rows. */
  element: string;
  accent: string;
  onAccent: string;
  /** Unfilled part of progress bars and rings. */
  track: string;
  tabBar: string;
  tabBarBorder: string;
  /** Background of the selected tab's pill. */
  tabSelected: string;
  /** The tab bar's selected icon and label. */
  tabActive: string;
  miniPlayer: string;
  miniPlayerText: string;
  danger: string;
  /** Large titles use a serif face in Paper and Dusk. */
  serifTitles: boolean;
  /** Tab bar floats as a pill (Dusk) or sits flat along the bottom edge. */
  floatingTabBar: boolean;
};

export const THEMES: Record<ThemeName, Theme> = {
  paper: {
    name: 'paper',
    label: 'Paper',
    dark: false,
    background: '#F6F1EA',
    gradient: null,
    text: '#2B2520',
    // Grey and terracotta are dark enough for small text on the page, on cards and on chips
    // (4.5:1 or better), and white reads on the terracotta buttons.
    textSecondary: '#6B5F55',
    card: '#FFFFFF',
    cardBorder: '#E9E0D4',
    element: '#EFE6DA',
    accent: '#B04730',
    onAccent: '#FFFFFF',
    track: '#D2C4B1',
    tabBar: '#FBF8F3',
    tabBarBorder: '#E9E0D4',
    tabSelected: 'transparent',
    tabActive: '#B04730',
    miniPlayer: '#2B2520',
    miniPlayerText: '#F6F1EA',
    danger: '#B03A2E',
    serifTitles: true,
    floatingTabBar: false,
  },
  dusk: {
    name: 'dusk',
    label: 'Dusk',
    dark: true,
    background: '#1A3350',
    gradient: ['#1D2547', '#1A3350', '#123F48'],
    text: '#F4F1EC',
    textSecondary: 'rgba(244,241,236,0.62)',
    card: 'rgba(255,255,255,0.08)',
    cardBorder: 'rgba(255,255,255,0.16)',
    element: 'rgba(255,255,255,0.12)',
    accent: '#F2B880',
    onAccent: '#1D2547',
    track: 'rgba(255,255,255,0.18)',
    tabBar: 'rgba(20,26,52,0.92)',
    tabBarBorder: 'rgba(255,255,255,0.16)',
    tabSelected: 'rgba(255,255,255,0.14)',
    tabActive: '#F4F1EC',
    miniPlayer: '#2A3B5E',
    miniPlayerText: '#F4F1EC',
    danger: '#FF9C8A',
    serifTitles: true,
    floatingTabBar: true,
  },
  midnight: {
    name: 'midnight',
    label: 'Midnight',
    dark: true,
    background: '#000000',
    gradient: null,
    text: '#F5F5F5',
    textSecondary: 'rgba(245,245,245,0.56)',
    card: '#141414',
    cardBorder: '#1F1F1F',
    element: '#1C1C1C',
    accent: '#8FD3B0',
    onAccent: '#06110C',
    track: 'rgba(255,255,255,0.16)',
    tabBar: '#0A0A0A',
    tabBarBorder: '#1F1F1F',
    tabSelected: 'rgba(143,211,176,0.18)',
    tabActive: '#8FD3B0',
    miniPlayer: '#1E3A35',
    miniPlayerText: '#F5F5F5',
    danger: '#FF8A80',
    serifTitles: false,
    floatingTabBar: false,
  },
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { small: 10, medium: 14, large: 20, pill: 999 } as const;

/** Android's built-in serif (Noto Serif) for large titles. */
export const SERIF = 'serif';
