import { createTheme, defaultVariantColorsResolver, isLightColor, parseThemeColor, type MantineColorsTuple, type VariantColorsResolver } from '@mantine/core';
import { t } from '../i18n';

// docs/10-design-system.md tokens
const mint: MantineColorsTuple = ['#e6fcf3', '#d0f7e6', '#a3eecb', '#72e5ae', '#4ddd98', '#3DDC97', '#2bc283', '#1f9e69', '#147a50', '#085638'];
const amber: MantineColorsTuple = ['#fff6e0', '#ffecc6', '#ffd98f', '#ffc556', '#FFB547', '#ffab27', '#e6951a', '#b37310', '#805207', '#4d3100'];
/** `info` token (#7AB8FF dark / #1D63C9 light): suggestions ✦ and links. */
const info: MantineColorsTuple = ['#e8f2ff', '#d2e5ff', '#a9cdff', '#94c3ff', '#86bdff', '#7AB8FF', '#4a8ee6', '#1D63C9', '#164ea0', '#0e3672'];
const dark: MantineColorsTuple = ['#C9D1D9', '#AEB7C2', '#8B95A1', '#5C6573', '#3A414C', '#262C35', '#171B22', '#0E1116', '#0A0C10', '#050608'];

/**
 * E-07 (WCAG 1.4.3): Mantine chooses the text colour of filled buttons/badges from the LIGHT-theme shade only, so the
 * bright dark-theme mint/amber got white text (1.8:1). Colours whose dark-theme shade is light get a scheme-dependent
 * text colour instead (dark text in the dark theme, white in the light theme – see --w-on-filled in styles.css).
 */
const DARK_SHADE = 5;
const variantColorResolver: VariantColorsResolver = (input) => {
  const r = defaultVariantColorsResolver(input);
  if (input.variant !== 'filled') return r;
  const p = parseThemeColor({ color: input.color || input.theme.primaryColor, theme: input.theme });
  if (p.isThemeColor && p.shade === undefined && isLightColor(input.theme.colors[p.color][DARK_SHADE], input.theme.luminanceThreshold)) return { ...r, color: 'var(--w-on-filled)' };
  return r;
};

export const theme = createTheme({
  variantColorResolver,
  primaryColor: 'mint',
  // E-07 (WCAG 1.4.3): same mint, but text on filled colours picks dark or white for ≥ 4.5:1, and the light theme uses
  // the next darker mint so white text and mint text on white both pass
  primaryShade: { light: 8, dark: DARK_SHADE },
  luminanceThreshold: 0.35,
  colors: { mint, amber, info, dark },
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif',
  headings: { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif', fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  other: { prColor: '#FFB547', warnColor: '#FF8A65', infoColor: '#7AB8FF', surface: '#171B22', bg: '#0E1116' },
  components: {
    Button: { defaultProps: { size: 'md' } },
    ActionIcon: { defaultProps: { size: 44, variant: 'subtle' } },
    TextInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md', hideControls: true, inputMode: 'decimal' } },
    Select: { defaultProps: { size: 'md', allowDeselect: false } },
    Textarea: { defaultProps: { size: 'md' } },
    SegmentedControl: { defaultProps: { size: 'md' } },
    Switch: { defaultProps: { size: 'md' } },
    Drawer: { defaultProps: { position: 'bottom', radius: 'lg' } },
    // Toasts (PR, undo, plan shift) get a named close button
    Notification: { defaultProps: { closeButtonProps: { 'aria-label': t('common.close') } } },
  },
});
