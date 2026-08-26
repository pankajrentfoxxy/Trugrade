# RETROFIT ADDENDUM - the locked frontend

**Paste everything between the `===` markers into Claude Code.**
**Run this INSTEAD OF Change 2 in `PHASE_00_01_RETROFIT.md`.** Every other change in that file stands.
**Estimated size:** 1 engineer, 3-4 days.

**Before you paste, put these in the repo:**
- `docs/09_FRONTEND_LOCKED.md`
- `docs/reference/homepage.html` - save the published homepage artifact's page source here. **This is the single most useful thing you can give it.** A reference implementation settles a hundred questions a written spec cannot.

===============================================================

The Trugrade frontend design language is now locked. Read `docs/09_FRONTEND_LOCKED.md` in full, then open `docs/reference/homepage.html` and read it end to end. **That file is the approved reference implementation** - when this prompt and that file disagree, the file wins.

This supersedes Change 2 of `docs/PHASE_00_01_RETROFIT.md`. The earlier warm-paper palette with Instrument Sans is dead. Do not carry any of it forward.

## Task 1 - Replace the token layer

Rewrite `packages/ui/src/globals.css` with the token block from `09_FRONTEND_LOCKED.md` §2, verbatim - both `:root[data-t="dark"]` (the default) and `:root[data-t="light"]`. Regenerate `tailwind.config.ts` from it.

Remove every trace of the previous palettes:
- Gone: navy `#191F2E`, cyan `#17AFC5`, orange `#FE9D00` (original prototypes)
- Gone: signal blue `#1F3CE0` (Anodised draft)
- Gone: paper `#F7F5F0`, burnt amber `#B4611C` (Workbench draft)
- Live: chrome `#08090B`, amber `#FFB627`

`grep -rE "#(191F2E|17AFC5|FE9D00|1F3CE0|B4611C|F7F5F0)"` across the repo must return nothing.

**Two things that are easy to get wrong:**
- `--chrome` and `--on-chrome*` are **identical in both themes**. The header and footer never change. Only working surfaces flip.
- `--acc-ink` differs in *purpose* by theme: lighter amber for text on dark, darker amber for text on light. Never use raw `--acc` as a text colour on a light surface - it fails contrast.

## Task 2 - Typography

Replace Instrument Sans and IBM Plex Sans with **Inter** + **IBM Plex Mono**:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap">
```

- Base font size **14px**, not 16px. This is a dense working tool.
- Headings: Inter 700, `letter-spacing:-.022em`, colour `--ink`.
- `body` colour is `--ink-2`, never `--ink`. Headings opt up. That one step is what makes hierarchy readable.
- **Every numeric or identifying value is IBM Plex Mono with `font-variant-numeric:tabular-nums`** - prices, serials, service tags, certificate IDs, seal codes, QC scores, percentages, counts, timings, GSTINs, HSN codes. No exceptions. This is half of why the interface reads as an instrument.
- Keep IBM Plex Sans Devanagari for Hindi.

## Task 3 - Theme toggle

- Icon button in the header between search and the account actions. Moon in dark, sun in light.
- Sets `data-t` on `<html>`; persists to `localStorage` key `tg-theme`.
- **Inline a pre-paint read in `<head>`** so there is no flash of the wrong theme on load:

```html
<script>try{var t=localStorage.getItem('tg-theme');if(t)document.documentElement.setAttribute('data-t',t)}catch(e){}</script>
```

- **Do not** follow `prefers-color-scheme`. Dark is the brand default; light is a deliberate opt-out.
- `data-t` is orthogonal to `data-density` from the design framework. Both live on the root; neither knows about the other.

## Task 4 - The QC motif utilities

Add all seven to `packages/ui`, exactly as implemented in the reference file (§4 of the locked doc):

`ViewfinderFrame` · `ScanBox` · `Barcode` · `TickRule` · `GridGround` · `LiveBlip` · `QrBlock`

**Two hard rules:**
- `ScanBox` and `LiveBlip` **must** respect `prefers-reduced-motion` - the reference file shows the media query.
- A motif may only appear on something that was actually inspected. A viewfinder bracket means *this unit was captured and identified*; putting one on a placeholder is a lie in visual form.

## Task 5 - Component changes

| Component | Change |
|---|---|
| `Button` primary | Amber fill, `--acc-on` text. No other primary style exists |
| `GradeBadge` | **Neutral** - `--sheet` background, `--rule` border, `--ink` text, mono. Never coloured |
| `QcChip` | *(new)* Amber fill, `--acc-on` text, mono. `QC 94` |
| `StatusPill` | Semantic only: PASS, FAIL, NOT MEASURED, SEALED |
| `BatteryBar` | *(new)* Mono label + thin bar in `--pass` + percentage. On every product card |
| `ProductCard` | Viewfinder brackets, grade chip, QC chip, serial, battery bar, mono price, supply-point count, stock |
| `DataBoard` | Amber selected row + 3px inset left edge. Mono throughout |
| Focus ring | `--acc`, 2px, 2px offset. Never removed |

Delete `ToleranceBand` and `ScoreRing` from the earlier drafts - the board uses a simple `--acc` progress bar with the score in mono beside it, as in the reference file.

## Task 6 - Search

Build `SearchBar` per `09_FRONTEND_LOCKED.md` §5:

- Scope select: All laptops · Brand · Configuration · Serial / service tag · Certificate ID
- Suggestion panel on focus, closing on outside click or `Escape`
- **Grouped**, never a flat list: `Models` / `Configuration` / `Look up a specific machine`
- Each row: type badge, label with the matched term in `--ink`, right-aligned count in mono
- 200ms debounce, server-side, Postgres `tsvector` + trigram
- Arrow keys navigate, `Enter` selects, `Escape` closes. `aria-expanded` + `aria-activedescendant`
- **A certificate ID routes to the public verification page, not to a product.** Different intent - treating it as a product search is exactly the small failure that makes people stop trusting a tool

## Task 7 - Filter rail

Build `FilterRail` per §6 - sticky, 262px, own scroll.

Header with applied count and Clear all → search-within-results → removable applied chips → fifteen facet groups as native `<details>`.

The fifteen facets and their controls are tabulated in §6. **Open by default:** Brand, Series, Processor, Memory, Inspected grade, Battery health, Inspection score, Landed price.

**Battery health, inspection score and inspected grade are the three facets no competitor can offer**, because they require having opened the machine. Keep them above the fold. They are the product's argument, expressed as a filter.

**Behaviour that is not optional:**
- **Every facet state lives in the URL.** A buyer sends a colleague a link that reproduces exactly what they saw. This also removes most of the need for a client state library
- **Counts are live** and reflect currently-applied filters
- **A zero-result facet is disabled and dimmed to `--ink-4`, never hidden.** Options that vanish make people think the site is broken
- **Grade counts read `unit.grade_actual`** - the inspected grade, never the supplier's declared one
- Under 900px the rail becomes a full-screen sheet behind a `Filters (3)` button
- Range inputs debounce 300ms; checkboxes apply immediately

## Task 8 - Catalogue scope

**Laptops only.** Remove Desktops, Monitors and Accessories from the category strip, the rail and the search scope. In their place, right-aligned on the category strip:

```
Desktops, monitors & parts  [SOON]
```

Non-interactive, `--ink-4`, with a bordered mono `SOON` chip. The ambition reads without promising stock that does not exist.

Category strip is: All laptops · Business · Mobile workstations · MacBooks · Ready in 24h · By brand · By grade · Bulk pricing.

## Task 9 - Homepage

Build it to the nine-block structure in §7, matching `docs/reference/homepage.html`. Two-column body: **filter rail + main. No third rail** - the verify-certificate and bulk-requirement panels moved into a full-width strip below the supply board.

## Exit criteria

- [ ] `grep -rE "#(191F2E|17AFC5|FE9D00|1F3CE0|B4611C|F7F5F0)"` returns nothing
- [ ] Theme toggle switches both ways, persists across reload, and there is **no flash of the wrong theme** on first paint
- [ ] Header and footer are visually identical in both themes
- [ ] Every price, serial, score, count and percentage renders in IBM Plex Mono with tabular numerals
- [ ] `GradeBadge` is neutral in every variant; `QcChip` is amber in every variant
- [ ] All seven QC motifs exist in `packages/ui` with Storybook stories
- [ ] `ScanBox` and `LiveBlip` stop animating under `prefers-reduced-motion`
- [ ] Search suggestions open on focus, group into three sections, close on `Escape`, and are keyboard navigable
- [ ] A certificate ID in search routes to the verification page, not a product
- [ ] Filter rail renders all fifteen facets; the eight listed above are open by default
- [ ] **Applying three filters changes the URL; pasting that URL into a new tab reproduces the same state**
- [ ] A zero-result facet is disabled and dimmed, not hidden
- [ ] Category strip shows laptops only, with the SOON marker
- [ ] Contrast pairs in §9 verified; axe reports zero violations in both themes
- [ ] Storybook builds with every component in both themes

===============================================================
