import type { Config } from 'tailwindcss';

/**
 * This config is a 1:1 port of the inline `tailwind.config` block that Google
 * Stitch embedded in every exported screen under
 * `stitch_bakenye_mobile_sacco_navigator/`.
 *
 * It is reproduced verbatim (tokens, radii, spacing, font sizes) so that every
 * class name copied out of the Stitch HTML compiles to exactly the same CSS it
 * did under the `cdn.tailwindcss.com` runtime. The only difference is that we
 * now compile ahead of time instead of shipping the ~90KB JIT compiler to a
 * low-end Android phone on 3G.
 *
 * DO NOT rename or "clean up" these tokens. The Stitch markup is the visual
 * source of truth and references them directly.
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
        tertiary: '#004417',
        primary: '#0e3483',
        'surface-bright': '#f9f9fc',
        error: '#ba1a1a',
        'primary-fixed-dim': '#b3c5ff',
        'inverse-on-surface': '#f0f0f3',
        'tertiary-container': '#005e23',
        'on-background': '#1a1c1e',
        'surface-container-high': '#e8e8ea',
        'primary-fixed': '#dbe1ff',
        'on-tertiary-fixed': '#002108',
        'on-secondary-fixed-variant': '#544600',
        'secondary-container': '#fcd400',
        'on-tertiary': '#ffffff',
        'tertiary-fixed': '#93f99e',
        'on-secondary-container': '#6e5c00',
        outline: '#747682',
        'on-tertiary-container': '#74d982',
        'inverse-surface': '#2f3133',
        'on-primary-fixed': '#00174a',
        'on-primary-fixed-variant': '#214291',
        'secondary-fixed': '#ffe16d',
        background: '#f9f9fc',
        'primary-container': '#2d4c9b',
        'surface-tint': '#3d5aaa',
        'surface-variant': '#e2e2e5',
        surface: '#f9f9fc',
        'inverse-primary': '#b3c5ff',
        secondary: '#705d00',
        'on-error-container': '#93000a',
        'surface-container-low': '#f3f3f6',
        'surface-container': '#eeeef0',
        'outline-variant': '#c4c6d3',
        'surface-container-lowest': '#ffffff',
        'on-primary': '#ffffff',
        'on-surface-variant': '#444651',
        'on-tertiary-fixed-variant': '#00531e',
        'on-primary-container': '#afc1ff',
        'tertiary-fixed-dim': '#77dc85',
        'surface-container-highest': '#e2e2e5',
        'on-surface': '#1a1c1e',
        'on-error': '#ffffff',
        'on-secondary-fixed': '#221b00',
        'on-secondary': '#ffffff',
        'secondary-fixed-dim': '#e9c400',
        'error-container': '#ffdad6',
        'surface-dim': '#dadadc',
        // Added for status semantics the Stitch DESIGN.md describes but that the
        // exported screens expressed only through the `secondary` ramp.
        warning: '#8a5100',
        'warning-container': '#ffdcbe',
        'on-warning-container': '#2e1500',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        'container-margin-desktop': '48px',
        unit: '4px',
        'container-margin-mobile': '16px',
        gutter: '16px',
        'touch-target-primary': '56px',
        'touch-target-min': '44px',
      },
      maxWidth: {
        /**
         * The widest the back office ever gets.
         *
         * Stitch designed for 1440px. Left to fill a 1920px monitor, a stat
         * card becomes 400px of empty space around one number, a search field
         * runs 1,580px, and the eye has to travel the whole screen between a
         * page title on the left and its action button on the right. Capping
         * the content and centring it keeps the composition the design
         * intended, and still leaves eight-column tables room to breathe.
         */
        content: '1440px',
      },
      fontFamily: {
        'display-currency': ['Inter', 'system-ui', 'sans-serif'],
        'headline-lg': ['Inter', 'system-ui', 'sans-serif'],
        'button-text': ['Inter', 'system-ui', 'sans-serif'],
        'body-md': ['Inter', 'system-ui', 'sans-serif'],
        'label-md': ['Inter', 'system-ui', 'sans-serif'],
        'headline-lg-mobile': ['Inter', 'system-ui', 'sans-serif'],
        'body-lg': ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-currency': [
          '32px',
          { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' },
        ],
        'headline-lg': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'button-text': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'label-md': [
          '12px',
          { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' },
        ],
        'headline-lg-mobile': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
      },
      keyframes: {
        'skeleton-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        // Deliberately short + cheap: these run on low-end Android GPUs.
        'skeleton-pulse': 'skeleton-pulse 1.6s ease-in-out infinite',
        'slide-up': 'slide-up 150ms ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};

export default config;
