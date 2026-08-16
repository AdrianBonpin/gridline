# Gridline landing page — design spec

**Date:** 2026-10-05  
**Scope:** `www/` Astro site, single long-scrolling landing page, first public-facing marketing page.  
**Approach:** Zen Browser layout + Gridline app visual identity. Dark-first with system-aware light mode.

---

## Goal

Replace the current default Astro starter page with a focused landing page whose primary action is **downloading the desktop app**. Secondary actions: view GitHub repo, read feature highlights, open FAQ answers.

---

## Sections (in order)

1. **Nav** — fixed, translucent, pill nav on scroll
2. **Hero** — eyebrow, headline, subtitle, dual CTA, app screenshot card
3. **Why Gridline** — three value props
4. **Feature highlights** — four feature cards with screenshots
5. **Open source** — GitHub callout
6. **FAQ** — five accordion items
7. **Footer** — Zen-style big footer

---

## Design system

### Typography

| Role | Font | Package |
|------|------|---------|
| Serif display headings | Literata | `@fontsource-variable/literata` |
| Sans-serif body / UI | Outfit | `@fontsource-variable/outfit` |
| Monospace code / labels | Space Mono | `@fontsource/space-mono` |

### Color tokens

| Token | Dark value | Light value |
|-------|------------|-------------|
| `--bg` | `#0a0a0a` | `#fafafa` |
| `--surface` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` |
| `--surface-elevated` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.06)` |
| `--border` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` |
| `--text` | `rgba(255,255,255,0.90)` | `#171717` |
| `--text-muted` | `rgba(255,255,255,0.55)` | `#737373` |
| `--primary` | `#3b82f6` | `#2563eb` |
| `--primary-hover` | `#60a5fa` | `#1d4ed8` |
| `--accent` | `#f59e0b` | `#d97706` |

### Radius & spacing

- Buttons: `9999px` pill
- Large cards / screenshot frame: `1.5rem`
- Small cards: `1rem`
- Section vertical gap: `6rem` desktop, `4rem` mobile
- Max container width: `1200px`

---

## Section details

### Nav

- Logo + wordmark on left (icon SVG + “Gridline” in Sans)
- Links on right: Features, GitHub, Download
- Theme toggle icon button
- On scroll past hero: background gains `--surface` with backdrop blur

### Hero

- Eyebrow: `OPEN-SOURCE DATABASE GUI` in Space Mono uppercase, small, amber
- H1: serif, “One app for every database.”
- Subtitle: sans, max-width ~560px
- CTA row:
  - Primary pill: “Download for macOS” (OS-detected, default macOS)
  - Secondary ghost pill: “View on GitHub”
- App screenshot card: query-editor.png inside rounded glass frame with subtle gradient border
- Version note below screenshot: “Free for personal and commercial use · Apache 2.0 · v0.7.10”

### Why Gridline

- Heading: “Everything the paid apps lock behind a subscription.”
- Three glass cards:
  1. **No limits** — connections, tabs, saved queries, exports.
  2. **DB-to-DB sync** — pipe pg_dump → pg_restore between live connections.
  3. **Deeper PG explorer** — functions, triggers, sequences, enums, extensions.

### Feature highlights

- 2×2 grid of cards. Each card has:
  - Small icon / monospace label
  - Heading
  - One-line description
  - Screenshot image (home, er-diagram, data-grid, json-popover)

Cards:

1. **Query & edit** — query editor + virtualized data grid — `query-editor.png`
2. **Visualize schemas** — ER diagram with cross-schema FKs — `er-diagram.png`
3. **Move data** — backup, restore, DB-to-DB sync — `home.png` or abstract graphic
4. **Manage objects** — functions, triggers, roles, grants — `data-grid.png`

### Open source

- Centered section with GitHub star count (static for now, can be dynamic later)
- Heading: “Built in public. No VC roadmap, no rug pulls.”
- CTA: “Star on GitHub”

### FAQ

- Five accordion items, first open by default:
  1. Is Gridline really free for commercial use?
  2. Which databases are supported?
  3. How is this different from TablePlus / Beekeeper / DB Pro?
  4. Do you store my database credentials?
  5. Can I self-host or contribute?

### Footer

- Zen-style big footer, 4-column layout
- Brand blurb + three link columns: Product, Project, Connect
- Bottom bar: copyright + license + small tagline

---

## Theme behavior

- Default follows system `prefers-color-scheme`.
- Toggle persists choice to `localStorage` key `gridline-theme`.
- `html` gets class `.light` when light mode is active; base styles target `:root` for dark.
- Tailwind v4 configured with CSS variables in `global.css`.

---

## Motion

Use `animejs` loaded as a script in the landing page only (no need site-wide yet).

### Hero entrance

1. Nav: `translateY(-20px)`, opacity 0 → 1, 600ms, easeOutExpo
2. Eyebrow: 80ms delay, `translateY(15px)` → 0
3. H1 words: split by word, stagger 60ms, `translateY(30px)` → 0
4. Subtitle + buttons: 150ms delay, `translateY(20px)` → 0
5. Screenshot card: scale 0.96 → 1, opacity 0 → 1, 800ms

### Scroll reveals

- Each section observes IntersectionObserver threshold 0.15.
- On enter: direct children animate `translateY(40px)` → 0, opacity 0 → 1, stagger 80–120ms.
- `prefers-reduced-motion`: skip transform, only fade opacity.

### Micro-interactions

- Primary CTA hover: scale 1.02, brighter background, larger shadow
- Nav link hover: underline slides in from left
- Theme toggle: rotate + crossfade 300ms
- FAQ accordion: height + opacity expand, chevron rotate 180°

---

## Assets

| Asset | Source | Destination |
|-------|--------|-------------|
| Gridline icon SVG | `desktop/src-tauri/icons/icon.svg` | `www/public/gridline-icon.svg` |
| Query editor screenshot | `screenshots/query-editor.png` | `www/public/screenshots/query-editor.png` |
| ER diagram screenshot | `screenshots/er-diagram.png` | `www/public/screenshots/er-diagram.png` |
| Home screenshot | `screenshots/home.png` | `www/public/screenshots/home.png` |
| Data grid screenshot | `screenshots/data-grid.png` | `www/public/screenshots/data-grid.png` |
| JSON popover screenshot | `screenshots/json-popover.png` | `www/public/screenshots/json-popover.png` |

---

## Tech notes

- Astro 7 + Tailwind CSS v4 + TypeScript.
- `animejs` added as dependency.
- Fontsource packages added for all three typefaces.
- Landing page implemented as `www/src/pages/index.astro` with Astro components / vanilla JS for motion.
- No framework components needed for this version; keep it static and fast.

---

## Open questions / future iterations

- Dynamic GitHub star count.
- OS-aware download button text.
- Multi-page expansion (Docs, Changelog, Download) after landing page ships.
- Testimonial / social proof section if we collect quotes.
