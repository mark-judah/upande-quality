import { Dimensions, PixelRatio } from 'react-native';

// Brought into line with the Upande Production design system so the two apps
// look identical in the field. COLORS keeps its original keys for backwards
// compatibility — new code should use the type/fontFamily exports below.

export const COLORS = {
  // Surfaces & text
  text: '#171717',
  textMuted: '#6B6B6B',
  textSecondary: '#525252',
  textOnPrimary: '#FFFFFF',
  border: '#E5E5E5',
  bg: '#FFFFFF',
  bgMuted: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',

  // Action / status
  primary: '#171717',
  info: '#171717',
  success: '#22C55E',
  warn: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(0, 0, 0, 0.4)',
} as const;

// Legacy alias kept so older files that import { colors } continue to compile
// during the refactor. New code should use COLORS.
export const colors = {
  black: COLORS.text,
  white: COLORS.bg,
  gray900: '#0A0A0A',
  gray800: '#171717',
  gray700: '#262626',
  gray600: COLORS.textMuted,
  gray500: '#737373',
  gray400: '#A3A3A3',
  gray300: COLORS.border,
  gray200: '#E5E5E5',
  gray100: COLORS.bgMuted,
  gray50: '#FAFAFA',
  success: COLORS.success,
  error: COLORS.danger,
  warning: COLORS.warn,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 9999,
};

/** Production-aligned alias of `radius`. Use `borderRadius.full` for pills. */
export const borderRadius = {
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: 20,
  full: radius.pill,
};

/** Poppins at every weight: the one typeface across the app. */
export const fontFamily = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/**
 * Type that fits the device. Sizes are designed for a ~390dp-wide phone; on a
 * narrower screen (handheld scanners are ~320-360dp) every size shrinks with the
 * width, down to 82%. The phone's own text-size setting still applies, but only
 * up to 1.15x, so a large setting can't push labels off a small screen.
 */
const SCREEN_SCALE = Math.min(1, Math.max(0.82, Dimensions.get('window').width / 390));
const OS_FONT_SCALE = PixelRatio.getFontScale() || 1;
const FONT_FACTOR = SCREEN_SCALE * Math.min(1, 1.15 / OS_FONT_SCALE);

/** A designed font size (or line height) for this device: see FONT_FACTOR. */
export function scaleFont(size: number): number {
  return Math.round(size * FONT_FACTOR * 2) / 2;
}

export const fontSize = {
  xs: scaleFont(11),
  sm: scaleFont(13),
  md: scaleFont(15),
  lg: scaleFont(18),
  xl: scaleFont(22),
  xxl: scaleFont(28),
} as const;

export const typography = {
  // Original keys (kept so existing imports compile, all Poppins now)
  display: { fontFamily: fontFamily.bold, fontSize: fontSize.xxl, color: COLORS.text },
  title: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: COLORS.text },
  heading: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: COLORS.text },
  body: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: COLORS.text },
  bodyBold: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  caption: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  // Production-aligned aliases for new components
  h1: { fontFamily: fontFamily.bold, fontSize: fontSize.xxl, color: COLORS.text },
  h2: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: COLORS.text },
  h3: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: COLORS.text },
  bodySmall: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  mono: { fontFamily: fontFamily.medium, fontSize: fontSize.md, color: COLORS.text },
};

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
};
