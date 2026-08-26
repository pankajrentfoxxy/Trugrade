# 08 — Trugrade brand system

**26 August 2026.** The naming decision is made: **Trugrade**. This document supersedes the design-token section of `_CONTEXT.md` and Part 1 of `03_UX_SPEC.md`. Everything here is implementable — copy the token blocks directly.

Visual reference: the published brand page. This file is the version Claude Code builds from.

---

## 1. The decision, in one paragraph

**Trugrade.** Chaldean 27 → **9**, the strongest of your three under your own rule. Two syllables, unambiguous spelling, and it names the actual mechanism — the gap between a declared grade and a found one, which is the commercial heart of the whole platform. Renuveon is out because **Renuvion** is a live Apyx Medical cosmetic-surgery brand one letter away, carrying an FDA safety warning that dominates its search results. Gorefurbo loses despite being free and already owned, because the first four letters spell GORE, because "refurb" is descriptive and therefore weakly protectable, and because it anchors the brand to a process rather than a promise.

**Costs, stated honestly:** no `.com` — AutoZone or a squatter holds `trugrade.com`. `trugrade.in`, `trugrade.co.in` and `trugrade.io` are all free. AutoZone holds TRUGRADE in **US Class 12 (vehicle parts)**; you file in **India, Class 35 and Class 42**. Different class, different country, different trade.

**Two brands, two jobs.** Trugrade is the marketplace. **DeviceSure stays the QC product** — it has its own tenancy and licensing, and it can be sold to refurbishers who never list on Trugrade.

---

## 2. Brand token

Everything in the codebase reads from one place. Never hard-code a brand string in a component.

```ts
// packages/config/src/brand.ts
export const BRAND = {
  name:        'Trugrade',
  nameLower:   'trugrade',
  domain:      'trugrade.in',
  legalEntity: 'TrueTech Services Pvt. Ltd.',
  qcProduct:   'DeviceSure',
  tagline:     'Opened, tested and graded before you see it.',
  support:     'help@trugrade.in',
  vendors:     'sell@trugrade.in',
  grievance:   'grievance@trugrade.in',
} as const;
```

---

## 3. The mark

A **tolerance gauge**: two end ticks, a rail, a pale mark where the grade was *declared*, a solid dot where it was *found*. It is a picture of the product mechanism, and it reduces to a dot on a line at 16 px.

```html
<svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label="Trugrade">
  <line x1="6"  y1="23" x2="40" y2="23" stroke="currentColor" stroke-width="2" opacity=".28"/>
  <line x1="6"  y1="15" x2="6"  y2="31" stroke="currentColor" stroke-width="2" opacity=".28"/>
  <line x1="40" y1="15" x2="40" y2="31" stroke="currentColor" stroke-width="2" opacity=".28"/>
  <line x1="18" y1="17" x2="18" y2="29" stroke="currentColor" stroke-width="2.5" opacity=".55"/>
  <circle cx="30" cy="23" r="5.5" fill="var(--signal)"/>
</svg>
```

**Wordmark:** `trugrade`, lowercase, Instrument Sans 700, letter-spacing `-0.045em`. `tru` in ink, `grade` in signal blue.

**The one rule:** the dot is always signal blue, and signal blue never appears anywhere that does not mean *this was measured*. That single restriction is what keeps the brand feeling engineered rather than decorated.

**Clear space:** the height of the end tick on all sides. **Minimum size:** 16 px for the mark alone, 88 px wide for the lockup.

---

## 4. Palette — "Workbench" *(revised 26 Aug 2026 — replaces the earlier cobalt "Anodised" set)*

The first draft used a cobalt-blue signal. It was rejected as too cold for a business selling reassurance, and the rejection was correct: blue reads clinical, and this brand needs to read *warm and certain*.

**Committed palette: warm paper, ink black, one burnt-amber accent.** Light-first, high contrast, document-like. The page should feel like a well-set specification sheet, not a tech startup.

### `globals.css`

```css
:root{
  /* grounds — warm, not cream. #F4F1EA is the generic default; this is cooler and greyer */
  --paper:#F7F5F0; --sheet:#FFFFFF; --sheet-2:#FBFAF6;
  /* ink */
  --ink:#17181A; --ink-2:#4B4B48; --ink-3:#77766F; --ink-4:#A5A39B;
  --rule:#E3DFD5; --rule-2:#EFEBE2; --rule-3:#F4F1EA;
  /* dark band — footer, supplier section, the inspection card */
  --dark:#17181A; --dark-2:#212226;
  --on-dark:#F4F1EA; --on-dark-2:#A5A39B; --on-dark-3:#75746D;
  /* accent — burnt amber. Primary actions, the found-dot, active state. NOTHING else. */
  --acc:#B4611C; --acc-hi:#8F4C14; --acc-lit:#E08A3C; --acc-wash:#FBEFE3;
  /* semantic — test outcomes ONLY */
  --pass:#166E4E; --pass-wash:#E4F0EA;
  --warn:#8A5A12;                    /* render WARN outlined, never filled — see rule 4 */
  --fail:#A32A1B; --fail-wash:#FAE9E6;
  /* spacing — did not exist anywhere in the old prototypes */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px;
  --s6:32px; --s7:48px; --s8:64px; --s9:88px;
  /* radii — flat. Instruments are not pill-shaped. */
  --r-xs:3px; --r-sm:5px; --r:6px; --r-lg:10px; --r-xl:14px;
  --maxw:1180px;
}
```

**This is a deliberately single-theme design.** A B2B storefront that flips to dark mode is solving a problem nobody has, and two themes doubles the QA surface across ~135 routes. The dark band (`--dark`) is used *compositionally* — footer, supplier section, inspection card — not as an alternate theme. Paint `body` background explicitly from `--paper` so the page never borrows a host ground.

**Four rules that stop this drifting:**

1. **The accent is a meaning, not a decoration.** Burnt amber marks a primary action, a measured value, or an active state. The moment it appears as a background wash on a marketing band, the tolerance dot stops meaning anything.
2. **Grades are not semantic colours.** A+, A and B are all sellable — neutral type in a neutral chip. Green and red are reserved for PASS and FAIL. A grade is a position on a scale; an outcome is a verdict. Colouring them alike conflates the two — the mistake the DeviceSure certificate currently makes.
3. **Style through tokens only.** No literal hex outside this block.
4. **WARN renders outlined, never filled.** `--warn` sits close to the accent in hue; keeping it an outline chip means the two are never confusable at a glance. PASS and FAIL fill normally.

---

## 5. Typography

| Role | Face | Weights | Used for |
|---|---|---|---|
| Display | **Instrument Sans** | 600, 700 | H1–H3, wordmark, big numbers |
| Body | **IBM Plex Sans** | 400, 500, 600 | Everything readable |
| Mono | **IBM Plex Mono** | 400, 500, 600 | Serials, seal codes, scores, prices, IDs |

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Instrument+Sans:wght@400;500;600;700&display=swap">
```

**Why these, specifically.** Instrument Sans over Inter and Space Grotesk deliberately — those two are the default pairing on every AI-generated marketplace page, and a brand built on being measurably different should not open with the default face. IBM designed Plex for technical documentation, which is half this product; the decisive reason is **IBM Plex Sans Devanagari**, so Hindi localisation stays inside the same family instead of bolting on an unrelated face.

**Type scale** (`clamp` for display, fixed for UI):

| Token | Size | Line | Weight | Face |
|---|---|---|---|---|
| `display-1` | `clamp(36px,5.6vw,60px)` | 1.02 | 700 | Instrument |
| `display-2` | `clamp(28px,4vw,42px)` | 1.08 | 700 | Instrument |
| `h1` | `clamp(23px,3vw,31px)` | 1.18 | 600 | Instrument |
| `h2` | 21px | 1.25 | 600 | Instrument |
| `h3` | 17px | 1.35 | 600 | Instrument |
| `body-lg` | 18px | 1.6 | 400 | Plex Sans |
| `body` | 16px | 1.62 | 400 | Plex Sans |
| `body-sm` | 14.5px | 1.55 | 400 | Plex Sans |
| `label` | 10.5px | 1.3 | 500 | Plex Mono, `letter-spacing:.13em`, uppercase |
| `data` | 13px | 1.4 | 500 | Plex Mono, `font-variant-numeric:tabular-nums` |

**`tabular-nums` is mandatory** anywhere digits stack vertically — prices in the comparison grid, scores, payout statements, ledger. Ten prices that do not align is the difference between a tool and a toy.

---

## 6. The tolerance band — the signature component

The mark scaled up into a working component. It appears on the listing card, the comparison grid, the certificate, the unit passport, the vendor scorecard and the QC console. **One idea, used everywhere** — the same discipline as the old system's "one shape, used twice", but this shape carries information.

It shows three things at once: the **band** a grade permits, the value the vendor **declared**, and the value we **measured**.

```tsx
interface ToleranceBandProps {
  label: string;              // "Battery · Grade A band"
  bandMin: number;            // start of the permitted band, 0–100 scale position
  bandMax: number;
  declared?: number;          // hollow tick — omit when nothing was declared
  found?: number;             // solid dot — OMIT ENTIRELY when not measured
  foundLabel: string;         // "Found 91%" | "Not measured"
  outOfTolerance?: boolean;   // renders the dot and label in --fail
}
```

**Three states, and the third is the one that matters:**

| State | Render |
|---|---|
| Within tolerance | Signal-blue dot inside the wash band. Calm. |
| Outside tolerance | Fail-red dot outside the band, label in fail-red. The gap is the loudest thing on screen — correct, because that gap is the business. |
| **Not measured** | **No dot at all**, band at 45% opacity, label "Not measured" in `--ink-3`. |

**A missing value must never render as a passing one.** This is the rule your DeviceSure spec already gets right in `never-fabricate.md`, made visible in the UI. It is also the single control that keeps a grade defensible under Consumer Protection (E-Commerce) Rule 7(5).

---

## 7. Component adjustments from `03_UX_SPEC.md`

The component inventory in the UX spec stands. These override it:

| Component | Change |
|---|---|
| **Radii** | Flatter — `--r-sm:5px`, `--r:7px`. Instruments are not pill-shaped. Replaces the old 10/14/20/28 scale |
| **Primary button** | Signal blue with white text. Replaces navy-on-orange; there is no orange in this system |
| **GradeBadge** | **Neutral**, never coloured. `--surface-2` background, `--rule` border, ink text |
| **StatusPill** | Semantic colours only — PASS, WARN, FAIL, NOT MEASURED, SEALED |
| **ScoreRing** | Signal blue; turns `--warn` below 80. Replaces the tri-arc ring |
| **OfferRow** | Gains the tolerance band in the QC-score cell, and the `New supplier · N units` small-sample state |
| **Evidence pattern** | *(new)* Any percentage renders with its denominator beneath it: `98%` / `412 units`. Build it once as `<Evidence value pct denominator />` and use it everywhere |

Everything else — Button, Input with verified/rejected states, PickTile, OptionChip, OTPInput, Stepper, DataTable, FilterRail, ListingCard, SealChip, Timeline, EmptyState, Skeleton, Toast, Modal, Drawer, PriceBreakdown, DocumentViewer — carries over unchanged in behaviour, restyled through the new tokens.

---

## 8. Voice

Four rules. They are also four of your legal obligations under Rule 7 — honest copy and compliant copy are the same copy here.

**1. Every number carries its denominator.** A percentage without a sample size is a claim, not evidence.
> ✅ `98% grade accuracy · 412 units`  ❌ `98% accurate`

**2. Name what failed, specifically.** Vague errors send people to support; specific errors get fixed by the person reading them.
> ✅ `Address proof is dated Jan 2025. We need one from the last 3 months.`  ❌ `Document rejected.`

**3. Never let a missing value read as a passing one.**
> ✅ `Thermal — not measured on this system`  ❌ `Thermal ✓`

**4. The evidence persuades; you don't.** No superlatives, no urgency devices, no "only 2 left". Scarcity counters, drip pricing and confirm-shaming are named practices in the CCPA Dark Patterns Guidelines 2023 — and a real inspection report is a stronger argument than a countdown.
> ✅ `Opened, tested and sealed on 12 Aug. Report inside.`  ❌ `Hurry! Best deal ever!`

---

## 9. Accessibility

- **WCAG 2.2 AA.** Contrast pairs verified: ink on ground 14.8:1, ink-2 on surface 8.1:1, white on signal 7.4:1, signal-ink on signal-wash 8.9:1.
- **Focus ring is signal blue, 2px, 3px offset** — never removed, never a colour that fails contrast. The old prototypes used a cyan focus ring at 2.64:1; the indicator itself failed. Do not reproduce it.
- **Semantic colour is never the only signal.** PASS/WARN/FAIL pills carry text. The tolerance band carries a label. A colourblind buyer must be able to read the grid.
- **44px minimum touch targets**; 56px for the primary per-unit action in the technician and rider apps, where the screen is read at arm's length in bad warehouse lighting.
- `prefers-reduced-motion` respected everywhere.

---

## 10. What to change in the codebase

| Where | Change |
|---|---|
| `packages/config/src/brand.ts` | Create with the block in §2 |
| `packages/ui/src/globals.css` | Replace the token block with §4 |
| `packages/ui/tailwind.config.ts` | Regenerate the theme from §4 and §5 |
| `packages/ui/src/components/ToleranceBand.tsx` | **New.** §6 |
| `packages/ui/src/components/Evidence.tsx` | **New.** §7 |
| `packages/ui/src/components/GradeBadge.tsx` | Strip the colour |
| `packages/ui/src/components/ScoreRing.tsx` | Signal blue, warn below 80 |
| `packages/ui/src/brand/Mark.tsx` | **New.** §3 |
| Everywhere | Replace every literal `gorefurbo` with `BRAND.name` |

**Do it before Phase 5.** The build pack already treats the brand as a single token, so today this is a days-long change. After Phase 5 the name is in schema seeds, the invoice series, notification templates, the e-invoice payload and the certificate face — and it becomes a month.

---

## 10b. Storefront information architecture — rebuilt from research

**The old prototypes were a B2C shopping layout.** Hero → trust badges → browse by brand → browse by use case → grades → stats → two doors. That is the Amazon pattern, and it is wrong for this buyer.

Research that drove the rebuild ([Shopify Enterprise](https://www.shopify.com/enterprise/blog/b2b-ecommerce-experience), [Baymard B2B](https://baymard.com/research/business-to-business), [SwiftOtter](https://swiftotter.com/blogs/ux-quoting-vs-direct-checkout-b2b-ecommerce)):

| Finding | What it changes |
|---|---|
| **100% of B2B buyers want self-service; 61% want a completely rep-free purchase** | No "contact sales" funnel. Prices and stock visible without an account. |
| **68% stopped buying online after an ordering mistake** | Accuracy over flair. Quantities, lead times and totals must be unambiguous everywhere. |
| **Real-time stock and delivery estimates are the top stated requirement** | Stock depth and ships-in are columns on the main board, not detail-page footnotes. |
| **67% switch suppliers over a bad online experience** | The storefront is a retention surface, not a brochure. |
| **Pricing errors and wrong inventory are the two biggest distrust triggers** | One landed figure, GST inclusive, never revealed progressively. |
| **Buyers need both fast checkout and a quote path** | Standard stock → add to order. Bulk requirement → the requirement bar. Don't force one path. |

### The six blocks, in order

A procurement head arrives with a requirement, not curiosity. The page is a tool, not a pitch.

1. **Header** — thin, functional. Available stock · How we test · Sell with us. Sign in / Create account.
2. **The ask** — a **requirement sentence**, not a search box: *"I need [40] laptops for [office work] at up to [₹35,000] each, delivered to [122002] by [end of month]."* Fill-in-the-blank fields inline. This replaces search + filter rail + browse-by-brand + browse-by-use-case with one control that states its own options. Four proof numbers beneath it, no more.
3. **Live supply** — **the largest thing on the page.** Real models with grade, landed price, units available, suppliers holding it, ships-in. One row expands to show the supply points, which teaches the whole model in a single glance: *pick the machine, then pick who supplies it.* A supplier below the sample threshold shows "New supplier · 3 units tested" and no score.
4. **How we test** — three items, not a section per idea, beside a real inspection report card showing `Thermal sensors — Not measured`. That one line does more for trust than any badge row.
5. **Suppliers** — one dark band, four facts, one action.
6. **Footer** — with the Rule 4(2) legal block and the grievance officer.

**What was deleted, and why:** browse-by-brand (a buyer with a requirement does not shop by brand), browse-by-use-case (the requirement sentence covers it), the separate grades section (folded into the board's grade column plus a linked page), the standalone stats bar (folded into block 2), the trust-badge row (replaced by a real report), the second hero image. **Nine sections became six**, and the differentiator moved from position four to position three.

---

## 11. This week

| # | Action | Note |
|---|---|---|
| 1 | Register `trugrade.in`, `trugrade.co.in`, `trugrade.io` | All free as of 26 Aug 2026. Take the typo variants too |
| 2 | File TM in India, **Class 35** (wholesale/retail trading services) and **Class 42** (technology and testing services) | AutoZone holds TRUGRADE in US Class 12 only. Add Class 9 if you will brand hardware |
| 3 | Claim LinkedIn, X and Instagram handles | Before you announce anything |
| 4 | Set `BRAND` in `packages/config` | One token, everywhere |
| 5 | Keep `gorefurbo.com` and redirect it | Costs nothing to hold, and stops someone using it against you |
| 6 | Keep **DeviceSure** as the QC product name | Two brands, two jobs. Trugrade is the market; DeviceSure is the instrument |

**Verify before you buy:** DNS non-existence is a strong signal, not a registrar guarantee. Confirm at a registrar, and have counsel run the Indian TM search in Classes 35 and 42 before filing.
