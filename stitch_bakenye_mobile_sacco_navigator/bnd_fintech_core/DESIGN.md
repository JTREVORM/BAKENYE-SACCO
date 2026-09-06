---
name: BND Fintech Core
colors:
  surface: '#f9f9fc'
  surface-dim: '#dadadc'
  surface-bright: '#f9f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f6'
  surface-container: '#eeeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e5'
  on-surface: '#1a1c1e'
  on-surface-variant: '#444651'
  inverse-surface: '#2f3133'
  inverse-on-surface: '#f0f0f3'
  outline: '#747682'
  outline-variant: '#c4c6d3'
  surface-tint: '#3d5aaa'
  primary: '#0e3483'
  on-primary: '#ffffff'
  primary-container: '#2d4c9b'
  on-primary-container: '#afc1ff'
  inverse-primary: '#b3c5ff'
  secondary: '#705d00'
  on-secondary: '#ffffff'
  secondary-container: '#fcd400'
  on-secondary-container: '#6e5c00'
  tertiary: '#004417'
  on-tertiary: '#ffffff'
  tertiary-container: '#005e23'
  on-tertiary-container: '#74d982'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b3c5ff'
  on-primary-fixed: '#00174a'
  on-primary-fixed-variant: '#214291'
  secondary-fixed: '#ffe16d'
  secondary-fixed-dim: '#e9c400'
  on-secondary-fixed: '#221b00'
  on-secondary-fixed-variant: '#544600'
  tertiary-fixed: '#93f99e'
  tertiary-fixed-dim: '#77dc85'
  on-tertiary-fixed: '#002108'
  on-tertiary-fixed-variant: '#00531e'
  background: '#f9f9fc'
  on-background: '#1a1c1e'
  surface-variant: '#e2e2e5'
typography:
  display-currency:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  button-text:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-margin-mobile: 16px
  container-margin-desktop: 48px
  gutter: 16px
  touch-target-min: 44px
  touch-target-primary: 56px
---

## Brand & Style

The design system is engineered for Bakenye National Development SACCO (BND-SACCO), prioritizing trust, communal growth, and financial empowerment. The brand personality is **Professional, Grounded, and Reliable**, reflecting the institutional stability of a national development cooperative.

The visual style is **Corporate / Modern** with a mobile-first focus. It leverages a clean, flat aesthetic to ensure high performance on lower-bandwidth mobile devices and maximum legibility on various Android screen qualities. The interface utilizes generous whitespace and a structured grid to manage complex financial data without overwhelming the user. Subtle depth is introduced through functional shadows, ensuring the UI feels tactile and responsive while remaining strictly utilitarian and accessible.

## Colors

The palette is derived from the BND-SACCO heritage, optimized for digital accessibility.

- **Primary (Royal Blue):** Used for headers, primary actions, and navigational anchors to evoke stability and authority.
- **Secondary (Golden Yellow):** Reserved for high-value accents, promotional badges, and secondary highlights that signify growth.
- **Success (Green):** Applied to balance increases, approved loans, and completed transactions.
- **Warning (Orange):** Dedicated to pending actions, overdue loan installments, and system alerts.
- **Neutral:** A deep navy-tinted charcoal for text to ensure high contrast (WCAG AA compliant) against soft gray backgrounds (#F8F9FA).

## Typography

The typography system uses **Inter** for its exceptional legibility on small-scale digital displays. 

A specific `display-currency` role is used for financial balances, featuring a heavier weight and tighter tracking to make large numbers appear as a singular visual unit. On mobile, headlines scale down to prevent text wrapping in tight layouts. All body text is capped at a minimum of 14px to ensure readability for all demographics within the SACCO membership.

## Layout & Spacing

This design system employs a **Fluid Grid** model with progressive enhancement for larger screens.

- **Mobile:** A 4-column layout with 16px side margins. Primary actions are anchored to the bottom for thumb-reachability.
- **Desktop:** Scales to a 12-column grid. The mobile Bottom Nav transitions into a persistent **Left Sidebar** for navigation.
- **Rhythm:** An 8px base grid governs all component relationships. 
- **Touch Targets:** All interactive elements (buttons, inputs, list items) maintain a minimum height of 44px, with primary action buttons (like 'Submit' or 'Apply') defaulting to 56px to accommodate varied user dexterity.

## Elevation & Depth

Visual hierarchy is established using **Tonal Layering** supplemented by functional shadows.

- **Level 0 (Base):** The application background, utilizing a soft neutral tint.
- **Level 1 (Cards):** White surfaces with a very soft, diffused shadow (0px 2px 8px rgba(0,0,0,0.05)) used for transaction items and input fields.
- **Level 2 (High-Impact):** Balances and primary loan status cards use a slightly deeper shadow and high-contrast borders to draw immediate attention.
- **Level 3 (Modals/Overlays):** Elevated surfaces for multi-step wizards, using a dark backdrop overlay to focus the user’s cognitive load on the task at hand.

## Shapes

The design system uses a **Rounded** shape language (8px/0.5rem radius). This provides a friendly, approachable feel while maintaining a sense of professional structure. 

Buttons, input fields, and cards share this uniform radius. Small components like badges and chips may use `rounded-xl` for a pill-style appearance to distinguish them from interactive containers.

## Components

### Buttons & Inputs
Primary buttons utilize the Royal Blue background with white text. Multi-step forms (wizards) must include a clear progress indicator at the top and "Back/Next" controls at the bottom 56px height. Input fields require persistent labels and clear error states in Warning Orange.

### Bottom Navigation
A persistent mobile bar containing: Home, Savings, Loans, Transactions, and More. Icons must be stroke-based for clarity, paired with 12px labels.

### Financial Cards
Balance cards use high-contrast backgrounds (Royal Blue or Success Green) to make white currency text pop. These should include a "View Details" secondary action.

### Transaction Lists
Mobile: Vertical card stacks with a 1:1 icon for transaction type, title/date, and right-aligned amount. 
Desktop: These cards expand into a full-width table with sortable headers.

### Receipts
A specialized layout for transaction confirmations featuring a mono-spaced font for the transaction ID and a clear "Share/Download" action at the bottom.

### Skeleton Loading
All data-heavy components (Transaction lists, Balance summaries) must have a defined skeleton state to reduce perceived latency during network requests.