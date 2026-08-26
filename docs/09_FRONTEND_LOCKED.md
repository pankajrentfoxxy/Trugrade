# 09 - Frontend design system: LOCKED

**26 August 2026. This is the approved, final design language for Trugrade.**
Supersedes the palette and typography in `08_BRAND_SYSTEM.md` §4 and §5, and Part 1 of `03_UX_SPEC.md`.
The page archetypes and section blocks in `framework` (design framework doc) still stand unchanged.

Reference implementation: the published homepage artifact. Build against it, not against a description of it.

---

## 1. What is locked

| Decision | Value |
|---|---|
| Scheme name | **Darkroom** |
| Default theme | **Dark** |
| Themes | Dark and light, user-toggleable, persisted |
| Accent | Amber `#FFB627` |
| Typefaces | **Inter** (UI) + **IBM Plex Mono** (all data) |
| Header / footer | Dark in **both** themes - brand identity is constant |
| Catalogue scope | **Laptops only.** Desktops, monitors and parts are marked SOON |
| Motif set | Viewfinder brackets, scan line, barcode, tick rules, grid ground, live blip, QR |

---

## 2. Tokens - copy verbatim into `packages/ui/src/globals.css`

```css
/* Dark is the default. Header and footer keep the same dark chrome in both
   themes, so the brand never changes shape - only the working surfaces do. */
:root, :root[data-t="dark"]{
  --chrome:#08090B; --chrome-2:#101317; --chrome-3:#1B1F26;
  --on-chrome:#E6E9EE; --on-chrome-2:#8D96A3; --on-chrome-3:#616A77;
  --chrome-line:rgba(255,255,255,.08); --chrome-line-2:rgba(255,255,255,.17);
  --ground:#0B0D10; --sheet:#14171C; --sheet-2:#1A1E24; --sheet-3:#20252C;
  --ink:#E9ECF1; --ink-2:#A8B1BE; --ink-3:#7D8694; --ink-4:#5C6572;
  --rule:#252A32; --rule-2:#1E232A;
  --acc:#FFB627; --acc-dk:#E09A10; --acc-on:#0B0D10; --acc-ink:#FFC84F; --acc-wash:#241C08;
  --acc-glow:rgba(255,182,39,.30); --scan:rgba(255,182,39,.80);
  --pass:#35C08A; --fail:#F0715C; --warn:#E0A53F;
  --shadow:0 10px 30px rgba(0,0,0,.50);
}
:root[data-t="light"]{
  --chrome:#08090B; --chrome-2:#101317; --chrome-3:#1B1F26;      /* unchanged */
  --on-chrome:#E6E9EE; --on-chrome-2:#8D96A3; --on-chrome-3:#616A77;
  --chrome-line:rgba(255,255,255,.08); --chrome-line-2:rgba(255,255,255,.17);
  --ground:#F0F1F3; --sheet:#FFFFFF; --sheet-2:#F7F8FA; --sheet-3:#EDEFF2;
  --ink:#101319; --ink-2:#3C444F; --ink-3:#68717F; --ink-4:#98A1AF;
  --rule:#DDE0E5; --rule-2:#EBEDF0;
  --acc:#FFB627; --acc-dk:#E09A10; --acc-on:#0B0D10; --acc-ink:#8A5A00; --acc-wash:#FFF6E3;
  --acc-glow:rgba(255,182,39,.34); --scan:rgba(224,154,16,.75);
  --pass:#0F7048; --fail:#C13527; --warn:#9A620A;
  --shadow:0 8px 26px rgba(16,19,25,.10);
}
/* spacing */
--s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px; --s6:28px; --s7:40px; --s8:56px;
/* radii - flat. Instruments are not pill-shaped. */
--r-xs:3px; --r-sm:4px; --r:5px; --r-lg:7px; --r-xl:9px;
--maxw:1400px;
```

**`--acc-ink` is the only token that differs in purpose between themes.** In dark it is a *lighter* amber for text on dark surfaces; in light it is a *darker* amber so amber-coloured text still passes contrast on white. Never use raw `--acc` as a text colour on a light surface.

### The four colour rules

1. **Amber means one of three things: a primary action, a measured value, or an active state.** Nothing else. The moment it becomes a decorative wash, the QC score chip stops meaning anything.
2. **Grades are neutral.** A+, A and B are all sellable - neutral chip, neutral border, ink text. Green and red are reserved for PASS and FAIL. A position on a scale is not a verdict.
3. **Header and footer never change between themes.** The dark chrome is the brand. Only working surfaces flip.
4. **No literal hex outside the token block.**

---

## 3. Typography

| Role | Face | Notes |
|---|---|---|
| UI, headings, body | **Inter** 400/500/600/700 | `letter-spacing:-.022em` on headings |
| **All data** | **IBM Plex Mono** 400/500/600/700 | `font-variant-numeric:tabular-nums` |

**Everything numeric or identifying is monospace, always:** prices, serials, service tags, certificate IDs, seal codes, QC scores, percentages, unit counts, filter counts, timings, HSN codes, GSTINs. This is not stylistic - it is what makes a column of ten prices scannable, and it is half of why the interface reads as an instrument.

Base size **14px** (not 16px). This is a working tool with dense tables; 14px is the correct base for a B2B console. Body copy inside marketing blocks may go to 14.5px.

### Text colour roles - these were a weak point and are now explicit

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--ink` | `#E9ECF1` | `#101319` | Headings, prices, key values |
| `--ink-2` | `#A8B1BE` | `#3C444F` | **Body text - one step down from headings** |
| `--ink-3` | `#7D8694` | `#68717F` | Meta, captions, secondary |
| `--ink-4` | `#5C6572` | `#98A1AF` | Placeholders, units, denominators |

`body` sets `color:var(--ink-2)`; headings opt up to `--ink`. Body text is never full-ink - that flattening of hierarchy was the original defect.

---

## 4. The QC motif set

Seven devices. All functional; none decorative. Reuse them, do not invent new ones.

| Motif | Class | Where | Rule |
|---|---|---|---|
| **Viewfinder brackets** | `.vf.tl/.tr/.bl/.br` | Every product image | Always with the real serial printed beneath |
| **Scan line** | `.scanbox` | Live inspection feed | 3.6s sweep. **Must respect `prefers-reduced-motion`** |
| **Barcode strip** | `.barcode` | Under the inspection feed | Encodes the seal code, shown beside it |
| **Tick rule** | `.tickrule` | Under section headings | A measurement scale edge, 9px tall |
| **Grid ground** | `.grid-bg` | Dark panels only | 22px, at `--chrome-line` opacity |
| **Live blip** | `.blip` | Live counters, feed header | 1.6s pulse, reduced-motion safe |
| **QR block** | `.qr` | Certificate verification | Real QR in production, never decorative |

**One rule: a motif must carry information.** A viewfinder bracket says *this unit was captured and identified*. A scan line says *this feed is live*. If a motif would sit on something that was not inspected, do not use it.

---

## 5. Search - the specification

**Header search is scoped and suggests.**

- **Scope select** with five options: All laptops · Brand · Configuration · Serial / service tag · Certificate ID
- **Suggestion panel** opens on focus, closes on outside click or `Escape`. Grouped, never a flat list:
  - `Models` - name, spec, live unit count
  - `Configuration` - saved facet combinations with result counts
  - `Look up a specific machine` - serial / service tag lookup, and certificate verification
- Each row: type badge, label with the matched term in `--ink`, right-aligned count in mono
- **Debounce 200ms.** Server-side, Postgres `tsvector` + trigram for typo tolerance
- Keyboard: arrow keys move, `Enter` selects, `Escape` closes. `aria-expanded` and `aria-activedescendant` on the input

**Searching a certificate ID must route to the public verification page**, not to a product. That is a different intent and treating it as a product search is the kind of small failure that makes people stop trusting a tool.

---

## 6. Filter rail - the specification

Sticky, `262px`, its own scroll, `max-height:calc(100vh - 24px)`.

**Structure, in this order:**
1. **Header** - "Filters", applied count, "Clear all"
2. **Search within results**
3. **Applied chips** - each removable with `x`
4. **Facet groups** as native `<details>` elements

**The fifteen facets:**

| Facet | Control | Open by default |
|---|---|---|
| Brand | Checkbox + count, "Show N more" after 5 | Yes |
| Series | Checkbox + count | Yes |
| Processor | Pills (i3-i9, Ryzen, Apple M) + generation checkboxes | Yes |
| Memory | Checkbox + count | Yes |
| Storage | Pills for capacity + checkboxes for type | No |
| **Inspected grade** | Checkbox + count, with the "nothing below B" note | Yes |
| **Battery health** | Dual-handle range + numeric inputs + cycle-count checkbox | Yes |
| **Inspection score** | Range + quick pills (90+/80+/70+) | Yes |
| Landed price | Min/max inputs + band pills | Yes |
| Screen | Size pills + resolution/touch checkboxes | No |
| Delivery | Ships-in checkboxes + **pincode input** | No |
| Supply point city | Checkbox + count | No |
| Quantity available | Pills (10+/25+/50+/100+) | No |
| Features | Backlit, fingerprint, Thunderbolt, charger included | No |
| Warranty | 6 / 12 months | No |

**Battery health, inspection score and grade are the three facets no competitor can offer**, because they require having opened the machine. Keep them open by default and keep them above the fold - they are the product's whole argument, expressed as a filter.

### Non-negotiable filter behaviour

- **Every facet state lives in the URL.** A buyer must be able to send a colleague a link that reproduces exactly what they saw. This also removes most of the need for a state library.
- **Counts are live and reflect currently-applied filters.** A facet that would return zero is disabled and shown at `--ink-4`, never hidden - disappearing options make people think the site is broken.
- **Grade counts come from `unit.grade_actual`**, the inspected grade, never the supplier's declared one.
- Under 900px the rail becomes a full-screen sheet behind a "Filters (3)" button.
- Debounce range inputs at 300ms; checkboxes apply immediately.

---

## 7. Homepage structure - final

| # | Block | Notes |
|---|---|---|
| 1 | Utility bar | Live tested count, delivery, GST, verify certificate, track order, help, sell |
| 2 | Header | Logo, Browse laptops, scoped search, **theme toggle**, requirement, sign in, create account |
| 3 | Category strip | Laptops only. `Desktops, monitors & parts SOON` right-aligned |
| 4 | Body | **Filter rail (262px) + main.** No third rail |
| 4a | Hero | Dark, grid ground, value claim + live inspection feed with scan line and barcode |
| 4b | Result bar | Match count, sort select, grid/list toggle |
| 4c | Product grid | 4 across. Viewfinder brackets, grade chip, QC chip, serial, **battery bar**, price, supply points, stock |
| 4d | Load more | Server-paginated |
| 5 | Supply board | Full width. The differentiator |
| 6 | Utility strip | Verify a certificate + Bulk requirement, side by side |
| 7 | Process | Four steps |
| 8 | Supplier band | Dark, grid ground |
| 9 | Footer | Five columns, legal block, payment rails |

**Deleted for good:** browse-by-brand tiles, browse-by-use-case, standalone grades section, stats bar, trust-badge row, the third rail. Nine sections became six plus the board.

---

## 8. Theme toggle

- Icon button in the header, between search and the account actions. Moon in dark, sun in light.
- Sets `data-t` on `<html>`, persists to `localStorage` under `tg-theme`.
- **Read the stored value before first paint** - inline the read in `<head>` so there is no flash of the wrong theme.
- Do not follow `prefers-color-scheme` automatically. Dark is the brand default; the user opts out deliberately.

---

## 9. Accessibility - verified pairs

| Pair | Ratio |
|---|---|
| `--ink` on `--sheet`, dark | 13.1:1 |
| `--ink-2` on `--sheet`, dark | 7.4:1 |
| `--ink` on `--sheet`, light | 16.8:1 |
| `--ink-2` on `--sheet`, light | 9.6:1 |
| `--acc-on` on `--acc` (button) | 11.2:1 |
| `--acc` on `--chrome` | 10.4:1 |
| `--acc-ink` on `--acc-wash`, light | 6.9:1 |

Focus ring is `--acc`, 2px, 2px offset, never removed. Semantic colour is never the only signal - PASS/FAIL always carry text. Touch targets 44px minimum, 56px in the technician and rider apps.

---

## 10. What to hand Claude Code

Give it, in this order:

1. `09_FRONTEND_LOCKED.md` **(this file)**
2. The **published homepage HTML** - save the artifact page source as `docs/reference/homepage.html`. It is the reference implementation and settles every question a written spec cannot.
3. `_CONTEXT.md`, and the design-framework doc for the six page archetypes
4. `PHASE_00_01_RETROFIT.md`, which now needs the amendment in §11 below

Then the prompt in `PHASE_00_01_RETROFIT_ADDENDUM.md`.

---

## 11. Amendment to the retrofit

`PHASE_00_01_RETROFIT.md` Change 2 specified the earlier warm-paper "Anodised" palette with Instrument Sans. **That is superseded.** Apply instead:

- Tokens from §2 of this file, both themes
- **Inter + IBM Plex Mono**, not Instrument Sans + IBM Plex Sans
- Base font size **14px**, not 16px
- Radii **3/4/5/7/9**, not 3/5/7/10/14
- Add the seven QC motif utilities from §4 to `packages/ui`
- Add the theme toggle with the pre-paint read from §8
- `data-density` from the design framework still applies and is orthogonal to `data-t`

Everything else in the retrofit - the Trugrade rename, the Vite console, the four vendor-onboarding captures, the payout freeze, the five schema additions - is unchanged.
