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

## 4. Palette — "Anodised"

Taken from the material of the product: graphite chassis, calibration paper, one signal blue meaning *measured*.

### `globals.css`

```css
:root{
  /* ink */
  --ink:#14181D; --ink-2:#3D4650; --ink-3:#68727E; --ink-4:#8F98A3;
  /* grounds */
  --ground:#EFF1EE; --surface:#FFFFFF; --surface-2:#F7F8F6;
  --rule:#DCDFDA; --rule-2:#E9EBE7; --band:#D3D7D1;
  /* signal — measured values and the primary action ONLY */
  --signal:#1F3CE0; --signal-hi:#1730B8; --signal-wash:#E8EBFD; --signal-ink:#1730B8;
  /* semantic — test outcomes ONLY */
  --pass:#0E7A55; --pass-wash:#E3F2EB;
  --warn:#8A5709; --warn-wash:#FAEFDD;
  --fail:#A82A1C; --fail-wash:#FBE9E6;
  /* elevation */
  --sh-1:0 1px 2px rgba(20,24,29,.05);
  --sh-2:0 1px 2px rgba(20,24,29,.05), 0 10px 26px rgba(20,24,29,.07);
  --sh-3:0 20px 48px rgba(20,24,29,.14);
  /* spacing scale — this did not exist anywhere in the old prototypes */
  --s-1:2px; --s-2:4px; --s-3:8px; --s-4:12px; --s-5:16px; --s-6:20px;
  --s-7:24px; --s-8:32px; --s-9:40px; --s-10:48px; --s-11:64px; --s-12:80px;
  /* radii — flatter than the old system; instruments are not pill-shaped */
  --r-xs:3px; --r-sm:5px; --r:7px; --r-lg:10px; --r-xl:14px;
  --maxw:1160px;
}

@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ink:#E8EBEE; --ink-2:#AAB3BE; --ink-3:#7E8792; --ink-4:#616A75;
    --ground:#0B0E12; --surface:#151A20; --surface-2:#1B2129;
    --rule:#28303A; --rule-2:#212932; --band:#2C3540;
    --signal:#7B90FF; --signal-hi:#9AAAFF; --signal-wash:#151E43; --signal-ink:#9AAAFF;
    --pass:#3FBE8C; --pass-wash:#0D2A20;
    --warn:#DFA351; --warn-wash:#2C2110;
    --fail:#F0806E; --fail-wash:#2F1712;
    --sh-1:0 1px 2px rgba(0,0,0,.4);
    --sh-2:0 1px 2px rgba(0,0,0,.4), 0 10px 26px rgba(0,0,0,.34);
    --sh-3:0 20px 48px rgba(0,0,0,.5);
  }
}
:root[data-theme="dark"]{ /* repeat the dark block verbatim so the toggle wins both ways */ }
```

**Rules that stop this drifting:**

1. **Signal blue is a meaning, not a decoration.** The moment it appears on a hero background or a marketing badge, the tolerance dot stops meaning anything.
2. **Grades are not semantic colours.** A+, A and B are all sellable — they are set in neutral type with a tolerance band beside them. Green, amber and red are reserved for PASS, WARN and FAIL. A grade is a position on a scale; an outcome is a verdict. Colouring them the same way conflates the two, and this is the mistake the DeviceSure certificate currently makes.
3. **Style through tokens only.** Never declare a colour inside a `@media` or `[data-theme]` block — that is how a page renders one theme's text on the other theme's ground.

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
