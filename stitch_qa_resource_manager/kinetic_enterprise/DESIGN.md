---
name: Kinetic Enterprise
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
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
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1440px
---

## Brand & Style

The design system is engineered for high-stakes internal resource management, where clarity and data integrity are paramount. It adopts a **Corporate / Modern** style with a focus on **Minimalism** to ensure that users can process complex QA metrics without cognitive overload. 

The aesthetic is characterized by high information density, crisp edges, and a structured hierarchy. It prioritizes functional utility over decorative elements, utilizing ample white space to separate data clusters and a rigorous alignment to a systematic grid. The emotional response is one of reliability, precision, and executive control.

## Colors

The color palette is architected to drive focus and communicate status instantaneously. 

- **Primary (Deep Navy):** Reserved for high-level structural elements like the side navigation and header, providing a solid anchor for the interface.
- **Secondary (Professional Blue):** Used for primary actions, links, and active selection states.
- **Semantic Colors:** Critical for resource management. Success Green indicates available capacity, Warning Orange signals near-limit thresholds (90-100%), and Critical Red flags overcapacity (>100%).
- **Neutral (Slate):** Utilized for borders, secondary labels, and icon states to maintain a low-noise environment.
- **Background:** A cool-toned off-white is used for the canvas to reduce eye strain during prolonged data analysis.

## Typography

The typography system relies exclusively on **Inter** to leverage its exceptional legibility in data-heavy environments. 

- **Data Tables:** Use `body-sm` for standard row content to maximize information density.
- **Headers:** Use `headline-md` for section titles within dashboards.
- **Labels:** Use `label-md` for table headers and metadata descriptors to provide clear categorization without competing with the primary data.
- **Numerical Data:** Tabular lining should be enabled to ensure numbers align vertically in columns for easy scanning.

## Layout & Spacing

This design system utilizes a **Fixed Grid** model for desktop to maintain structural integrity of complex dashboards, transitioning to a fluid model for tablet.

- **Grid:** A 12-column grid with 16px gutters. 
- **Side Navigation:** Fixed at 240px width to ensure persistent access to Team and Project modules.
- **Spacing Rhythm:** Based on a 4px baseline. Components like table rows and input fields should use tight vertical padding (8px to 12px) to optimize for "at-a-glance" data consumption.
- **Breakpoints:** Mobile (up to 767px), Tablet (768px - 1023px), Desktop (1024px+). On mobile, side navigation collapses into a hamburger menu and tables transition to card-based layouts if columns exceed the viewport.

## Elevation & Depth

To maintain a clean, "Enterprise Modern" look, this design system avoids heavy shadows. Instead, it uses **Tonal Layers** and **Low-contrast Outlines**.

- **Level 0 (Canvas):** Background color (#F8FAFC).
- **Level 1 (Cards/Tables):** White surface (#FFFFFF) with a 1px border in Slate-200. No shadow.
- **Level 2 (Modals/Dropdowns):** White surface with a very subtle, diffused shadow (0px 4px 12px rgba(15, 23, 42, 0.08)) to indicate temporary overlay without disrupting the flat aesthetic.
- **Interactions:** Hover states on table rows use a subtle tint (Slate-50) rather than elevation changes to maintain the grid's visual stability.

## Shapes

The shape language is **Soft**, utilizing small border radii to take the edge off a strictly industrial look while remaining professional.

- **Standard Elements:** 0.25rem (4px) radius for buttons, input fields, and status badges.
- **Containers:** 0.5rem (8px) radius for cards and modals to provide a clear container boundary.
- **Progress Bars:** Fully rounded (pill) ends to differentiate them from interactive buttons and structural containers.

## Components

### Data Tables
- **Header:** Slate-100 background, `label-md` text, 1px bottom border.
- **Rows:** 48px height, `body-sm` text, hover state #F1F5F9.
- **Cell Alignment:** Text is left-aligned; numerical values are right-aligned for comparison.

### Progress Bars
- **Track:** 8px height, Slate-200 background.
- **Fill:** Dynamic color based on semantic rules (Success/Warning/Critical). 
- **Label:** Percentage shown to the right in `body-sm` bold.

### Status Badges
- **Style:** Small, subtle background tint with high-contrast text. 
- **States:** Active (Blue), Completed (Green), On Hold (Slate), Overcapacity (Red).

### Buttons
- **Primary:** Deep Navy background, white text. No gradient.
- **Ghost/Tertiary:** No background, Blue text, for secondary actions within tables.

### Modal Forms
- Centered, 560px max-width.
- Header with clear title and close 'X' icon.
- Footer with right-aligned actions (Cancel as ghost button, Save as primary).

### Side Navigation
- Deep Navy background.
- Active state: Professional Blue left-accent bar (4px) with a subtle background highlight.
- Icons: 20px size, Slate-400 color, shifting to White on active/hover.