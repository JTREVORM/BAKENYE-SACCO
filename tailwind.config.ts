import type { Config } from 'tailwindcss';

/**
 * BAKENYE UNITY AND DEVELOPMENT SACCO — design tokens.
 *
 * The token *names* are inherited from the original Stitch export, because ~160
 * files reference them directly. The token *values* are the 2026 redesign: a
 * deep-navy financial palette, white card surfaces on a cool grey page, softer
 * radii and a real elevation ramp.
 *
 * The single most important change is that `surface` (cards) is now pure white
 * while `background` (the page) is a cool grey. They used to be the same value,
 * which is why every card dissolved into the page and the whole product read as
 * unfinished. Everything else here is refinement on top of that.
 *
 * Rules for editing:
 *  - Never introduce a raw hex in a component. Add a token here instead.
 *  - `primary` is the brand navy. `accent` is the gold. Green means money in,
 *    red means money out; neither is ever used decoratively.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /* --- Brand ---------------------------------------------------------
         * A single navy ramp. `primary` is the interactive blue; `ink` is the
         * near-black navy the sidebar and hero are built from. */
        primary: '#123a86',
        'primary-container': '#1e4ea8',
        'on-primary': '#ffffff',
        'on-primary-container': '#c7d7ff',
        'primary-fixed': '#e3ebff',
        'primary-fixed-dim': '#adc4f5',
        'on-primary-fixed': '#071c46',
        'on-primary-fixed-variant': '#20428f',
        'inverse-primary': '#adc4f5',
        'surface-tint': '#2f5ba8',

        /* The navigation / hero navy, darker than `primary` so white text on it
         * clears AAA and the chrome recedes behind the content. */
        ink: '#0a2148',
        'ink-soft': '#132f5e',
        'ink-line': '#1d3f74',

        /* --- Page and card surfaces ---------------------------------------
         * `background` is the page, `surface` is a card. These MUST differ. */
        background: '#f4f6fb',
        surface: '#ffffff',
        'surface-bright': '#ffffff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#fafbfd',
        'surface-container': '#f4f6fb',
        'surface-container-high': '#eef1f7',
        'surface-container-highest': '#e5e9f2',
        'surface-variant': '#eef1f7',
        'surface-dim': '#dfe4ee',
        'inverse-surface': '#1b2537',
        'inverse-on-surface': '#f1f4f9',

        /* --- Text ---------------------------------------------------------- */
        'on-background': '#111827',
        'on-surface': '#111827',
        'on-surface-variant': '#5b647a',
        outline: '#8a93a8',
        'outline-variant': '#dbe1ec',

        /* --- Money in (green) ---------------------------------------------- */
        tertiary: '#0f7a4a',
        'tertiary-container': '#12965a',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#065f38',
        'tertiary-fixed': '#dcf5e8',
        'tertiary-fixed-dim': '#9fdcc0',
        'on-tertiary-fixed': '#04301c',
        'on-tertiary-fixed-variant': '#0a6b41',

        /* --- Accent (gold) -------------------------------------------------
         * Used sparingly: the active-nav rail, the hero underline, share
         * capital. Never for whole surfaces. */
        secondary: '#8a6a00',
        'secondary-container': '#f5c518',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#5c4600',
        'secondary-fixed': '#fdf0c4',
        'secondary-fixed-dim': '#e8b800',
        'on-secondary-fixed': '#2a1f00',
        'on-secondary-fixed-variant': '#6b5200',

        /* --- Money out / danger (red) --------------------------------------- */
        error: '#c02a2a',
        'error-container': '#fde8e8',
        'on-error': '#ffffff',
        'on-error-container': '#8c1d1d',

        /* --- Caution (amber) ------------------------------------------------ */
        warning: '#a35a00',
        'warning-container': '#fdefdc',
        'on-warning-container': '#7a4200',
      },

      borderRadius: {
        DEFAULT: '0.375rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
        full: '9999px',
      },

      spacing: {
        'container-margin-desktop': '32px',
        unit: '4px',
        'container-margin-mobile': '16px',
        gutter: '20px',
        'touch-target-primary': '52px',
        'touch-target-min': '44px',
        sidebar: '264px',
      },

      maxWidth: {
        /* The widest the back office ever gets. Beyond this a stat card becomes
         * 400px of empty space around one number. */
        content: '1560px',
      },

      fontFamily: {
        'display-currency': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'headline-lg': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'button-text': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'body-md': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'label-md': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'headline-lg-mobile': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        'body-lg': ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      /* A financial UI lives or dies on its number type. Money gets tight
       * tracking so a nine-digit figure reads as one object; labels get open
       * tracking so they read as quiet supporting text. */
      fontSize: {
        'display-currency': [
          '30px',
          { lineHeight: '36px', letterSpacing: '-0.025em', fontWeight: '700' },
        ],
        'headline-lg': ['26px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg-mobile': [
          '21px',
          { lineHeight: '28px', letterSpacing: '-0.015em', fontWeight: '700' },
        ],
        'title-md': ['17px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '650' }],
        'button-text': ['15px', { lineHeight: '22px', fontWeight: '600' }],
        'body-lg': ['15px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '21px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '600' }],
        'label-sm': ['11px', { lineHeight: '15px', letterSpacing: '0.04em', fontWeight: '650' }],
      },

      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        'card-hover': '0 4px 12px rgba(16, 24, 40, 0.08), 0 2px 4px rgba(16, 24, 40, 0.04)',
        pop: '0 12px 32px rgba(16, 24, 40, 0.14), 0 4px 8px rgba(16, 24, 40, 0.06)',
        brand: '0 8px 24px rgba(18, 58, 134, 0.24)',
      },

      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #123a86 0%, #0a2148 100%)',
        'ink-gradient': 'linear-gradient(180deg, #0d2856 0%, #081b3c 100%)',
      },

      keyframes: {
        'skeleton-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        // Deliberately short + cheap: these run on low-end Android GPUs.
        'skeleton-pulse': 'skeleton-pulse 1.6s ease-in-out infinite',
        'slide-up': 'slide-up 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 140ms ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};

export default config;
