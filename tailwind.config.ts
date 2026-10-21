import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

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
        'ink-soft': '#13315f',
        'ink-line': '#1d3f74',
        'ink-deep': '#06132e',

        /* --- Page and card surfaces ---------------------------------------
         * `background` is a cool, very light blue-grey page; `surface` is the
         * white card that sits on it. The separation is carried by the hairline
         * ring and the soft ambient shadow in `boxShadow` below — enough edge to
         * survive a dim outdoor phone screen, not so much that a dashboard of
         * twenty cards reads as twenty boxes.
         *
         * `surface-container-low` is the quiet tint used for table headers and
         * row hover; `surface-container` is the page tone again, for the wells
         * (fields, tracks, tab strips) that have to read as recesses. */
        background: '#eef2f9',
        surface: '#ffffff',
        'surface-bright': '#ffffff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f5f8fc',
        'surface-container': '#eef2f9',
        'surface-container-high': '#e4eaf4',
        'surface-container-highest': '#d9e1ee',
        'surface-variant': '#eef2f9',
        'surface-dim': '#dfe6f1',
        'inverse-surface': '#1b2537',
        'inverse-on-surface': '#f1f4f9',

        /* --- Text ---------------------------------------------------------- */
        'on-background': '#111827',
        'on-surface': '#111827',
        'on-surface-variant': '#5a6782',
        outline: '#8d97ac',
        /* Deliberately close to the surfaces it separates. Most chrome is now
         * drawn with shadow; where a border survives (tables, dividers) it is a
         * hairline that steadies the eye rather than a drawn box. */
        'outline-variant': '#e3e9f3',

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

        /* --- Scrollbars -----------------------------------------------------
         * The thumb is its own token rather than a reuse of `outline`, because
         * it answers a different question. An outline separates two things; a
         * thumb has to be findable against the page at a glance and then get
         * out of the way, which lands it a step darker at rest and darker again
         * under the pointer. The dark pair is for the navy rails. */
        'scroll-thumb': '#b4bfd2',
        'scroll-thumb-hover': '#8d97ac',
        'scroll-thumb-dark': 'rgba(255, 255, 255, 0.22)',
        'scroll-thumb-dark-hover': 'rgba(255, 255, 255, 0.4)',

        /* --- Where the money is ---------------------------------------------
         * One identity colour per kind of account, used for chart marks and the
         * small identity stripe on the account cards - never for text. Validated
         * together as a categorical palette against `surface` (lightness band,
         * colour-blind separation and 3:1 contrast all pass). */
        'acct-merchant': '#b07f00',
        'acct-bank': '#2f5ba8',
        'acct-cash': '#1d9aa8',

        /* --- Caution (amber) ------------------------------------------------ */
        warning: '#a35a00',
        'warning-container': '#fdefdc',
        'on-warning-container': '#7a4200',
      },

      /* Softer throughout. Soft UI is defined as much by its radii as by its
       * shadows: a 4px corner cannot catch a highlight, so it reads as a flat
       * rectangle no matter what shadow is on it. Controls that are a single
       * line tall go all the way to `full` and become pills. */
      borderRadius: {
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.375rem',
        '3xl': '1.75rem',
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

      /* The soft-UI elevation ramp.
       *
       * Every raised shadow is a pair: a cool grey cast down and to the right,
       * and a white highlight up and to the left, as if one light sits above
       * the top-left corner of the screen. Recessed controls invert the same
       * pair inwards. Keeping the light in one place is the whole trick — a
       * panel lit from the left next to a field lit from the right stops
       * reading as a surface and starts reading as a mistake.
       *
       * `card` / `card-hover` / `pop` keep their names because ~160 files
       * already reference them; only the values are new. */
      boxShadow: {
        /* Elevation, 2026 edition.
         *
         * Every raised surface carries the same three-part recipe: a hairline
         * ring that draws the card's edge, a 1px contact shadow that sits it on
         * the page, and a wide, very soft ambient shadow that gives it height.
         * The ring is part of the shadow rather than a `border` so that ~270
         * existing `shadow-neu` / `shadow-card` call sites gain the edge without
         * a single one of them changing, and so a card's edge never adds a pixel
         * to its box and shifts a grid.
         *
         * `card` / `card-hover` / `pop` and the `neu-*` family keep their names
         * because the whole product references them; only the values are new. */
        card: '0 0 0 1px rgba(17, 38, 76, 0.055), 0 1px 2px rgba(17, 38, 76, 0.05), 0 10px 26px -14px rgba(17, 38, 76, 0.22)',
        'card-hover':
          '0 0 0 1px rgba(17, 38, 76, 0.08), 0 2px 5px rgba(17, 38, 76, 0.07), 0 18px 38px -16px rgba(17, 38, 76, 0.30)',
        pop: '0 0 0 1px rgba(17, 38, 76, 0.06), 0 10px 20px -8px rgba(17, 38, 76, 0.16), 0 28px 60px -20px rgba(17, 38, 76, 0.32)',
        brand:
          '0 0 0 1px rgba(10, 33, 72, 0.35), 0 10px 24px -10px rgba(10, 33, 72, 0.45), 0 28px 54px -28px rgba(10, 33, 72, 0.55)',

        /* Named for the places that need to say what they mean. */
        neu: '0 0 0 1px rgba(17, 38, 76, 0.055), 0 1px 2px rgba(17, 38, 76, 0.05), 0 10px 26px -14px rgba(17, 38, 76, 0.22)',
        'neu-sm':
          '0 0 0 1px rgba(17, 38, 76, 0.06), 0 1px 2px rgba(17, 38, 76, 0.06), 0 4px 10px -6px rgba(17, 38, 76, 0.18)',
        'neu-lg':
          '0 0 0 1px rgba(17, 38, 76, 0.06), 0 10px 20px -8px rgba(17, 38, 76, 0.16), 0 28px 60px -20px rgba(17, 38, 76, 0.32)',
        /* Wells: text fields, search bars, track backgrounds. The ring is what
         * makes a field findable now that the surface it sits on is white. */
        'neu-inset':
          'inset 0 0 0 1px rgba(17, 38, 76, 0.11), inset 0 1px 2px rgba(17, 38, 76, 0.06)',
        'neu-inset-sm':
          'inset 0 0 0 1px rgba(17, 38, 76, 0.08), inset 0 1px 1px rgba(17, 38, 76, 0.04)',
        /* A raised control while it is held down. */
        'neu-pressed':
          'inset 0 0 0 1px rgba(17, 38, 76, 0.12), inset 0 2px 5px rgba(17, 38, 76, 0.14)',
        /* Dark pills (the primary action) carry their own pair - a light ring
         * on navy would read as a halo. */
        'neu-dark':
          '0 1px 2px rgba(10, 33, 72, 0.25), 0 10px 22px -10px rgba(10, 33, 72, 0.55)',
        'neu-dark-sm': '0 1px 2px rgba(10, 33, 72, 0.22), 0 6px 14px -8px rgba(10, 33, 72, 0.45)',
      },

      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #1a4a9c 0%, #0a2148 60%, #071a3a 100%)',
        'ink-gradient': 'linear-gradient(180deg, #102e60 0%, #0a2148 55%, #061531 100%)',
        /* The gold rule under a hero title and the rail's active marker. */
        'gold-gradient': 'linear-gradient(90deg, #ffe375 0%, #e8b800 45%, #c67a06 100%)',
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
  // Imported at the top rather than `require`d here: under Node's ESM
  // loader this file has no `require`, and Tailwind re-reads the config on
  // every CSS rebuild — so a `require` call here takes the dev server down
  // on the first edit after it starts.
  plugins: [forms, containerQueries],
};

export default config;
