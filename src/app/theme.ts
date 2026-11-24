import { createTheme, type MantineColorsTuple } from '@mantine/core';

// docs/10-design-system.md tokens
const mint: MantineColorsTuple = ['#e6fcf3', '#d0f7e6', '#a3eecb', '#72e5ae', '#4ddd98', '#3DDC97', '#2bc283', '#1f9e69', '#147a50', '#085638'];
const amber: MantineColorsTuple = ['#fff6e0', '#ffecc6', '#ffd98f', '#ffc556', '#FFB547', '#ffab27', '#e6951a', '#b37310', '#805207', '#4d3100'];
const dark: MantineColorsTuple = ['#C9D1D9', '#AEB7C2', '#8B95A1', '#5C6573', '#3A414C', '#262C35', '#171B22', '#0E1116', '#0A0C10', '#050608'];

export const theme = createTheme({
  primaryColor: 'mint',
  primaryShade: { light: 7, dark: 5 },
  colors: { mint, amber, dark },
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
  },
});
