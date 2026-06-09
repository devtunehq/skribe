# Skribe Design System

> A playful blueprint on a paper bag — the design system behind **Skribe**, a local-first Markdown writing workbench with an AI review partner, for writers who still enjoy the writing process.

This project is a **design system**: tokens, fonts, reusable React primitives, foundation specimen cards, and a full UI-kit recreation of the Skribe editor. Link `styles.css` to inherit every token and webfont; import components from the generated bundle.

---

## Source material

This system was reverse-engineered from the Skribe product itself. If you have access, explore these to go deeper — the GitHub repo's `src/styles.css` is the canonical visual source of truth, and `src/App.tsx` holds the real interaction logic.

- **GitHub:** `devtunehq/skribe` — https://github.com/devtunehq/skribe
  - `src/styles.css` — the complete production stylesheet (palette, the five themes, every component rule). The strongest reference.
  - `PRODUCT.md`, `README.md` — product purpose, brand personality, principles, and feature surfaces.
  - `docs/screenshots/` — editor, threads, chat, diff, settings (mirrored in `assets/screenshots/`).
  - `public/skribe-icon.png` — the app icon (mirrored in `assets/skribe-icon.png`).

To build new product surfaces accurately, read the real components in `src/App.tsx` rather than working from screenshots alone.

---

## What Skribe is

Skribe is a **local-only Markdown writing and review workbench**. It separates clean document content from review state, so the writer works fast in an editable canvas while comments, chat, suggestions, diffs, agent context and revision history are preserved alongside.

Two agent surfaces, one document:
- **Threads** — anchored comments on a selected passage; focused, paragraph-level rewrites.
- **Chat** — article-level discussion, broad review passes, skill-driven rewrites, reviewable document diffs.

It is **provider-agnostic** (Codex CLI, Claude Code, or `auto`) and **bring-your-own-subscription** — Skribe drives the native agent CLI you already have. Skills are reusable `/slash` instructions (`/humanizer`, `/copywriting`) the agent loads before replying.

**Brand personality:** focused, tactile, opinionated. "A serious writing instrument — compact, legible, direct, and a little distinctive without competing with the document." It deliberately avoids marketing-site chrome, generic SaaS gradients, and toolbar density that makes writing feel secondary.

---

## Content fundamentals

How Skribe writes its own UI copy — match this when adding surfaces.

- **Two registers.** *Chrome* (labels, buttons, status, headings-of-UI) is **Space Mono, UPPERCASE, lightly tracked** — terse and instrument-like: `SAVED`, `CONTEXT MEMORY`, `0 VISIBLE · 19 RESOLVED`, `ACCEPT ALL`. *Prose & helper text* is **Inter, sentence case**, plain and human: "Select text in the canvas, then use the comment button in the toolbar."
- **Voice.** Direct, practical, evidence-led, low-hype. Second person for guidance ("Use Threads when the question belongs to a specific passage"). The product's own default tone prompt: *"Be direct, practical, evidence-led, and plainspoken. Prefer concrete examples and clear recommendations over hype."*
- **British-leaning spelling** in product prose (humanise, behaviour) — the default language is **EN-GB**, with EN-US available.
- **Imperative verbs** on actions: Accept, Decline, Rewrite, Resolve, Ask agent, Build tone. No "please", no exclamation marks in chrome.
- **Numbers are first-class.** Counts and metrics are shown bare and confident: `4,058 words`, `12` (context-memory count), `−3 · +5` on diff blocks.
- **No emoji.** None in the UI, none in chrome. The one decorative signal is the yellow highlighter mark, never a 🟡.
- **Short, declarative microcopy.** "Own the verb. Become the default. Expand from there." Skribe favours cadence over completeness.

---

## Visual foundations

- **The metaphor:** ink on paper, laid on a desk. A warm **Canvas Oat** (`#F4EFEA`) ground sits under everything; **Paper White** surfaces (cards, panels, the writing sheet) float on it; **Ink** (`#383838`) hairlines draw every structural edge like a blueprint.
- **Color discipline.** The document stays ink-on-paper. **Sky Blue** (`#6FC2FF`) is reserved *exclusively for interaction* — the primary button, focus rings, the active tab, anchor selection. **Mellow Yellow** (`#FFDE00`) only ever appears as a **highlighter mark** (comment anchors, selection) or a tiny tab on a card. Eight decorative accents (coral, aqua, cerulean, …) live on **borders and small washes only** — aqua = additions/suggestions, coral = removals/destructive, cerulean = links/agent — never as large fields or body text.
- **Type.** Two families. **Space Mono** carries the brand: all chrome, labels, document headings, metrics — almost always uppercase, +0.02em tracking, weight 700. **Inter** is the reading voice: document prose at 18px / 1.7 and all UI body at 14px, sentence case. Optional document fonts: clean sans, editorial serif (Georgia), mono draft.
- **Shape.** Hard-edged and flat. **Cards/panels have 0px radius**; controls a barely-there **2px**. Two hairline weights: warm **oat** (`#E2DCD3`, quiet dividers inside cards) and **ink** (every structural border).
- **The one shadow.** A single **hard offset shadow, no blur**: `-6px 6px 0 0 ink`. There are no soft/blurred shadows in the system. Interactive elements **lift toward the top-right on hover** (`translate(6px,-6px)` + the hard shadow) and **press in on click** (`translate(2px,-2px)`, a tighter `-2px 2px` shadow). This snap is the brand's signature motion.
- **Motion.** Restrained and fast: 120–160ms, spring easing `cubic-bezier(0.22,1,0.36,1)` for the lift, plain `ease` for color. Only three keyframes exist — `spin` (running status), `typingPulse` (agent dots), `anchorPulse` (a comment scroll-target flash). Respect `prefers-reduced-motion`; no decorative loops on content.
- **Hover / press states.** Hover = the lift + hard shadow (buttons, pills, icon buttons, cards) or a **Frost Blue** (`#EBF9FF`) wash (toolbar buttons, tabs, list rows). Active/selected = Sky Blue fill with Coal text. Press = the shrink-in transform.
- **Backgrounds.** No imagery, no gradients, no textures. Flat oat and paper fields with ink rules. The only "texture" is a subtle checkerboard inside empty image placeholders.
- **Cards.** 1px ink border, paper-white fill, 0px radius, usually no shadow at rest — the shadow is reserved for the *focused/active* card (active thread, new-thread box, popovers, the diff review bar) which lifts out with the hard offset.
- **Transparency & blur.** Almost none. Washes are achieved with `color-mix(... %, white/transparent)`, not opacity layers or backdrop blur. The settings backdrop is the one scrim (`coal 24%`).
- **Themes.** Five named workspaces remap the same token names: **Skribe** (default oat), **Newsprint** (monochrome + red notes), **Sage** (soft green), **Coral** (warm paper), **Graphite** (the one dark theme). Set `data-theme="…"` on a container.

---

## Iconography

- **Style:** thin **line icons**, ~2px stroke, rounded joins/caps, on a 24px grid — the Feather / Lucide silhouette. They sit in 32–34px square hit targets and inherit `currentColor`. No filled icons, no duotone, no emoji, no unicode glyphs used as icons (the one exception is the `¶` pilcrow in the format toolbar).
- **In this system:** the kit ships a hand-rolled inline-SVG set at `ui_kits/editor/icons.jsx` (spark, disk, gear, export, copy, download, file, clock, chat, comment, eye, send, chevrons, list, quote, link, code, check, cross, refresh) drawn to the Feather spec. They're plain `React.createElement` paths so any card or kit can reuse them.
- **Substitution note:** the production app uses its own inline SVGs in `src/App.tsx`; this system reproduces the same shapes to the Feather/Lucide spec rather than importing that file. If you want exact parity, lift the SVG paths from `App.tsx`. For new work, **[Lucide](https://lucide.dev)** (CDN) is the closest faithful match — same stroke weight and geometry.
- **Logo:** a yellow quill nib on a sky-blue rounded-square (`assets/skribe-icon.png`), shown beside the tracked `SKRIBE` wordmark in the topbar. Don't recolor or add effects.

---

## Index / manifest

Root:
- `styles.css` — global entry point (import manifest only — link this).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `fonts.css`, `themes.css`, `base.css`.
- `assets/` — `skribe-icon.png`, `screenshots/` (editor, threads, chat, diff, settings).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `components/` — reusable React primitives (below).
- `ui_kits/editor/` — the interactive Skribe workbench recreation.
- `slides/` — branded sample slide layouts.
- `SKILL.md` — Agent-Skills manifest for use in Claude Code.

Components (`window.SkribeDesignSystem_a6e4e0.<Name>`):
- `components/buttons/` — **Button**, **IconButton**
- `components/status/` — **Pill**, **Badge**
- `components/review/` — **ThreadCard**, **MessageBubble**, **SuggestionCard**
- `components/forms/` — **Select**, **Tabs**, **SkillChip**

Each component directory carries a `.d.ts` (props + JSDoc), a `.prompt.md` (usage), and a `@dsCard` HTML specimen. The compiler generates `_ds_bundle.js`, `_ds_manifest.json`, and `_adherence.oxlintrc.json` — never edit those by hand.

---

## Using it

```html
<link rel="stylesheet" href="styles.css">
<!-- React + Babel, then: -->
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Button, ThreadCard, Pill } = window.SkribeDesignSystem_a6e4e0;
  // …compose away
</script>
```

Reach for the CSS variables (`var(--accent)`, `var(--hard-shadow)`, `var(--font-mono)`) rather than raw hex, and keep the discipline: oat ground, paper surfaces, ink lines, blue for interaction, yellow for the mark.
