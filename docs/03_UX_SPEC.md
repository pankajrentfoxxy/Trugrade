# 03 — UI/UX SPECIFICATION
### gorefurbo · TrueTech Services Pvt. Ltd. · B2B refurbished laptops (India)

**Status:** buildable spec. Everything here is a build instruction, not a suggestion.
**Applies to:** `apps/storefront` (Next.js 15, public + customer portal, SSR), `apps/console` (Next.js 15, vendor + admin, role-routed), `apps/mobile` (Expo — Technician QC + Rider).
**Reads with:** `_CONTEXT.md` (business model, module map, schema gaps). Where this document and a prototype disagree, this document wins.

---

## 0. Deviations from the existing prototypes — read first

The HTML prototypes (`New_plan/*.html`) are the design source of truth for *style*. Five things in them are wrong against the confirmed model or against WCAG 2.2 AA and must not be carried into the build.

| # | In the prototype | Why it is wrong | What to build instead |
|---|---|---|---|
| D1 | Homepage search suggests **"Seller · Nexus IT Recyclers · Gold · 4.6★"**; offer grid spec lists "vendor rating and grade accuracy" | Breaks the vendor-anonymity display rule. We are the merchant of record; there is no third-party seller to name, rate or rank in front of a buyer. | Search never has a "Sellers" facet. The offer row shows **"Supply Point A · Gurugram"** + dispatch commitment + stock depth + inspection date. No name, no rating, no stars, no tier, no address, no GSTIN. Enforced by the API DTO whitelist, mirrored here so nobody designs a slot for it. |
| D2 | Primary CTA = `--orange` fill with **white** text | 2.09:1. Fails AA by a wide margin on the single most-used control in the product. | Primary CTA = `--orange` fill with **`--navy` text** (7.86:1). Hover `--orange-dk` + navy (5.47:1). See §1.9. |
| D3 | `.btn-cyan` = `--cyan` fill, white text; `.btn-link` = `--cyan-dk` text | 2.64:1 and 3.94:1. Both fail AA for body text. | Introduce `--cyan-ink #0C7E92` (4.76:1 on white). All cyan text, links and cyan fills-with-white-text use it. `--cyan` becomes a graphic/fill-only token. Same split for good / warn / bad. See §1.3. |
| D4 | `:focus-visible{outline:2.5px solid var(--cyan)}` | `--cyan` is 2.64:1 on white — the focus indicator itself fails 2.4.11/1.4.11. | Two-tone ring: 2px `--focus` (`--cyan-ink`) + 2px `--surface` offset; `--cyan` only as the ring colour on navy surfaces. See §1.7. |
| D5 | Buyer registration shown as **4 steps** | The confirmed onboarding is **5 steps / 34 fields** (`TrueTech_Schema_Addendum_Customer_Vendor.md` §A.7). | Build 5: Account · Company · Statutory · Contacts & addresses · Documents & preferences. §3A.10. |

Two further prototype behaviours are **correct and must be preserved**: the collapsed-completed-step summary rail, and specific rejection copy on documents ("dated Jan 2025, send one from the last three months").

---

# PART 1 — DESIGN SYSTEM

## 1.1 Principles

1. **One shape, used twice.** The logo's tri-arc ring is the QC score ring and the grade badge. No other decorative circular motif exists in the product.
2. **Orange is reserved for the primary action.** One orange element per view, maximum. Never for a status, a badge, a chart series, or a link. `--warn` handles caution; it is a different hue family and is never substituted with orange.
3. **Cosmetic grade is never mixed with function.** Grade badge, battery health, warranty and working condition are four separate marks, always rendered separately, on every surface.
4. **Fill colours and text colours are different tokens.** Every semantic hue ships as a `-wash` (background), a base (fill / mark / chart), and an `-ink` (text on light). Text never uses the base.
5. **Density is a property of the app, not the component.** `apps/storefront` runs the `comfortable` density; `apps/console` runs `compact`. One `data-density` attribute on `<html>`; components read spacing from density-aware tokens.

## 1.2 `globals.css` — `:root` block

Author this file verbatim. Layer 1 is the brand palette (immutable, from `_CONTEXT.md`). Layer 2 is the derived accessible set. Layer 3 is the shadcn/ui bridge — shadcn components read `--background`/`--foreground`/etc., so they must be defined here or every shadcn primitive renders unstyled-grey.

```css
/* apps/*/src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
:root{
  /* ---------- 1. BRAND (canonical, do not edit) ---------- */
  --navy:#191F2E;  --navy-2:#232B3D;  --navy-3:#2E374C;
  --cyan:#17AFC5;  --cyan-dk:#0E8DA0; --cyan-wash:#E6F7FA;
  --orange:#FE9D00;--orange-dk:#D97F00;--orange-wash:#FFF4E2;
  --grey:#5B5B5B;

  /* ---------- 2. NEUTRALS ---------- */
  --paper:#F4F6F8; --surface:#FFFFFF; --surface-2:#FBFCFD;
  --rule:#E2E7EC;  --rule-2:#EEF1F4;
  --ink:#1B2333;   --muted:#697586;   --muted-2:#94A1B2;

  /* ---------- 3. SEMANTIC FILLS ---------- */
  --good:#12945F;  --good-wash:#E6F5EE;
  --warn:#E08B3C;  --warn-wash:#FDF2E3;
  --bad:#D24A3A;   --bad-wash:#FCEDEB;
  --info:#17AFC5;  --info-wash:#E6F7FA;

  /* ---------- 4. DERIVED INK COLOURS (AA on --surface AND on the
       matching -wash). These are the ONLY legal text colours for
       semantic meaning. See the contrast table in §1.9. ---------- */
  --cyan-ink:#0C7E92;   /* 4.76:1 on white  — links, cyan buttons  */
  --good-ink:#0B7A4C;   /* 5.38:1 on white, 4.74:1 on --good-wash  */
  --warn-ink:#8A5410;   /* 6.26:1 on white, 5.57:1 on --warn-wash  */
  --bad-ink:#B93A2B;    /* 5.67:1 on white, 4.94:1 on --bad-wash   */
  --muted-ink:#5A6675;  /* secondary text on --paper / any -wash   */
  --on-primary:var(--navy);      /* text on --orange                */
  --on-accent:#FFFFFF;           /* text on --cyan-ink / --navy     */

  /* ---------- 5. RADII ---------- */
  --r-xs:6px; --r-sm:10px; --r:14px; --r-lg:20px; --r-xl:28px;
  --r-full:9999px;

  /* ---------- 6. SPACING (the missing scale) ---------- */
  --s-0:0px;   --s-05:2px;  --s-1:4px;   --s-2:8px;  --s-3:12px;
  --s-4:16px;  --s-5:20px;  --s-6:24px;  --s-8:32px; --s-10:40px;
  --s-12:48px; --s-16:64px; --s-20:80px;

  /* density: console overrides these on [data-density="compact"] */
  --pad-card:22px; --pad-control-y:12px; --pad-control-x:16px;
  --row-h:52px;    --gap-stack:16px;     --section-y:56px;

  /* ---------- 7. ELEVATION ---------- */
  --sh-1:0 1px 2px rgba(25,31,46,.05), 0 2px 6px rgba(25,31,46,.05);
  --sh-2:0 2px 6px rgba(25,31,46,.06), 0 10px 28px rgba(25,31,46,.08);
  --sh-3:0 20px 50px rgba(25,31,46,.16);
  --sh-cta:0 4px 14px rgba(254,157,0,.32);
  --sh-inset-top:inset 0 1px 0 rgba(255,255,255,.6);

  /* ---------- 8. FOCUS ---------- */
  --focus:var(--cyan-ink);
  --focus-on-dark:var(--cyan);
  --focus-w:2px;
  --focus-offset:2px;

  /* ---------- 9. MOTION ---------- */
  --d-instant:80ms; --d-fast:120ms; --d-base:160ms;
  --d-slow:240ms;   --d-sheet:320ms; --d-toast:200ms;
  --e-standard:cubic-bezier(.2,0,0,1);
  --e-decel:cubic-bezier(0,0,0,1);
  --e-accel:cubic-bezier(.3,0,1,1);
  --e-emphasis:cubic-bezier(.2,0,0,1.2);   /* pick-tile select only  */

  /* ---------- 10. TYPE ---------- */
  --display:"Poppins",system-ui,sans-serif;
  --body:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SFMono-Regular",monospace;

  /* ---------- 11. LAYOUT ---------- */
  --maxw:1240px; --maxw-wide:1400px; --maxw-narrow:980px;
  --header-h:64px; --rail-w:268px; --gutter:24px;

  /* ---------- 12. Z-INDEX ---------- */
  --z-base:0;   --z-sticky:90;  --z-header:100; --z-dropdown:200;
  --z-drawer:300; --z-modal:400; --z-toast:500; --z-palette:600;

  /* ---------- 13. shadcn/ui BRIDGE (HSL triples, no hsl() wrapper) --- */
  --background:210 20% 97%;      /* --paper                          */
  --foreground:222 31% 15%;      /* --ink                            */
  --card:0 0% 100%;              --card-foreground:222 31% 15%;
  --popover:0 0% 100%;           --popover-foreground:222 31% 15%;
  --primary:37 100% 50%;         --primary-foreground:222 30% 14%;
  --secondary:190 84% 31%;       --secondary-foreground:0 0% 100%;
  --muted-bg:210 17% 94%;        --muted-foreground:215 12% 40%;
  --accent:187 78% 94%;          --accent-foreground:190 84% 31%;
  --destructive:5 63% 44%;       --destructive-foreground:0 0% 100%;
  --border:210 22% 90%;          --input:210 22% 90%;
  --ring:190 84% 31%;
  --radius:0.875rem;             /* = --r 14px                       */
}

[data-density="compact"]{
  --pad-card:16px; --pad-control-y:9px; --pad-control-x:12px;
  --row-h:44px;    --gap-stack:12px;    --section-y:32px;
}

/* Dark surfaces are LOCAL, not a theme. The product has no dark mode.
   .on-navy re-points focus + ink for navy panels, the console sidebar
   and the technician app's capture screens. */
.on-navy{
  --focus:var(--focus-on-dark);
  --ink:#FFFFFF; --muted:#C9D2E0; --muted-ink:#C9D2E0;
  --rule:rgba(255,255,255,.14); --rule-2:rgba(255,255,255,.08);
  --surface:var(--navy-2); --paper:var(--navy);
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:var(--body);font-size:.9375rem;line-height:1.55;
  -webkit-font-smoothing:antialiased;
}
:focus-visible{
  outline:var(--focus-w) solid var(--focus);
  outline-offset:var(--focus-offset);
  border-radius:var(--r-xs);
}
:focus:not(:focus-visible){outline:none}
::selection{background:var(--cyan-wash);color:var(--ink)}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{
    animation-duration:1ms!important;animation-iteration-count:1!important;
    transition-duration:1ms!important;scroll-behavior:auto!important;
  }
}
}
```

**Font loading.** `next/font/google` for Poppins (600, 700) and Inter (400, 500, 600), `display:swap`, `preload:true`, subset `latin`. JetBrains Mono (500, 700) is `preload:false` — it is below the fold on every route. Self-hosted via `next/font`, never a `<link>` to fonts.googleapis.com (blocks LCP and leaks to a third party under DPDP).

## 1.3 `tailwind.config.ts` — theme extension

```ts
// packages/config/tailwind/tailwind.config.ts  (shared by both apps)
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1.5rem",
      screens: { "2xl": "1240px" } },
    extend: {
      colors: {
        navy:   { DEFAULT: "var(--navy)", 2: "var(--navy-2)", 3: "var(--navy-3)" },
        cyan:   { DEFAULT: "var(--cyan)", dk: "var(--cyan-dk)",
                  ink: "var(--cyan-ink)", wash: "var(--cyan-wash)" },
        orange: { DEFAULT: "var(--orange)", dk: "var(--orange-dk)",
                  wash: "var(--orange-wash)" },
        paper:    "var(--paper)",
        surface:  { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        rule:     { DEFAULT: "var(--rule)", 2: "var(--rule-2)" },
        ink:      "var(--ink)",
        muted:    { DEFAULT: "var(--muted)", 2: "var(--muted-2)",
                    ink: "var(--muted-ink)" },
        good: { DEFAULT: "var(--good)", ink: "var(--good-ink)", wash: "var(--good-wash)" },
        warn: { DEFAULT: "var(--warn)", ink: "var(--warn-ink)", wash: "var(--warn-wash)" },
        bad:  { DEFAULT: "var(--bad)",  ink: "var(--bad-ink)",  wash: "var(--bad-wash)" },
        // shadcn bridge
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary:     { DEFAULT: "hsl(var(--primary))",
                       foreground: "hsl(var(--primary-foreground))" },
        secondary:   { DEFAULT: "hsl(var(--secondary))",
                       foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))",
                       foreground: "hsl(var(--destructive-foreground))" },
        accent:      { DEFAULT: "hsl(var(--accent))",
                       foreground: "hsl(var(--accent-foreground))" },
        popover:     { DEFAULT: "hsl(var(--popover))",
                       foreground: "hsl(var(--popover-foreground))" },
        card:        { DEFAULT: "hsl(var(--card))",
                       foreground: "hsl(var(--card-foreground))" },
      },
      spacing: {
        "0.5": "2px", "1": "4px",  "2": "8px",  "3": "12px", "4": "16px",
        "5": "20px",  "6": "24px", "8": "32px", "10": "40px","12": "48px",
        "16": "64px", "20": "80px",
        rail: "var(--rail-w)", header: "var(--header-h)",
      },
      borderRadius: {
        xs: "var(--r-xs)", sm: "var(--r-sm)", DEFAULT: "var(--r)",
        md: "var(--r)",    lg: "var(--r-lg)", xl: "var(--r-xl)",
        full: "var(--r-full)",
      },
      boxShadow: {
        1: "var(--sh-1)", 2: "var(--sh-2)", 3: "var(--sh-3)",
        cta: "var(--sh-cta)", "inset-top": "var(--sh-inset-top)",
        focus: "0 0 0 2px var(--surface), 0 0 0 4px var(--focus)",
      },
      fontFamily: {
        display: ["var(--font-poppins)", "Poppins", "system-ui", "sans-serif"],
        sans:    ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono:    ["var(--font-jetbrains)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing, fontWeight }]
        "display-1": ["clamp(1.875rem,4.4vw,3.125rem)", { lineHeight: "1.08", letterSpacing: "-0.03em",  fontWeight: "700" }],
        "display-2": ["clamp(1.75rem,3.4vw,2.5rem)",    { lineHeight: "1.12", letterSpacing: "-0.028em", fontWeight: "700" }],
        "display-3": ["clamp(1.375rem,2.6vw,2rem)",     { lineHeight: "1.16", letterSpacing: "-0.025em", fontWeight: "600" }],
        "h1": ["1.625rem", { lineHeight: "1.20", letterSpacing: "-0.022em", fontWeight: "600" }],
        "h2": ["1.375rem", { lineHeight: "1.25", letterSpacing: "-0.020em", fontWeight: "600" }],
        "h3": ["1.1875rem",{ lineHeight: "1.30", letterSpacing: "-0.016em", fontWeight: "600" }],
        "h4": ["0.96875rem",{lineHeight: "1.35", letterSpacing: "-0.012em", fontWeight: "600" }],
        "body-lg":  ["1.0625rem", { lineHeight: "1.60", fontWeight: "400" }],
        "body":     ["0.9375rem", { lineHeight: "1.55", fontWeight: "400" }],
        "body-sm":  ["0.84375rem",{ lineHeight: "1.50", fontWeight: "400" }],
        "label":    ["0.78125rem",{ lineHeight: "1.35", letterSpacing: "0.005em", fontWeight: "600" }],
        "eyebrow":  ["0.6875rem", { lineHeight: "1.30", letterSpacing: "0.15em",  fontWeight: "600" }],
        "num":      ["0.8125rem", { lineHeight: "1.40", letterSpacing: "-0.02em", fontWeight: "600" }],
        "num-lg":   ["1.5rem",    { lineHeight: "1.10", letterSpacing: "-0.04em", fontWeight: "700" }],
      },
      maxWidth: { content: "var(--maxw)", wide: "var(--maxw-wide)",
                  narrow: "var(--maxw-narrow)", prose: "62ch" },
      zIndex: { sticky: "90", header: "100", dropdown: "200",
                drawer: "300", modal: "400", toast: "500", palette: "600" },
      transitionDuration: {
        instant: "80ms", fast: "120ms", DEFAULT: "160ms",
        slow: "240ms", sheet: "320ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(.2,0,0,1)",
        decel:    "cubic-bezier(0,0,0,1)",
        accel:    "cubic-bezier(.3,0,1,1)",
        emphasis: "cubic-bezier(.2,0,0,1.2)",
      },
      keyframes: {
        "ring-draw":   { from: { strokeDashoffset: "var(--circ)" },
                         to:   { strokeDashoffset: "var(--offset)" } },
        "skeleton":    { "0%": { opacity: ".55" }, "50%": { opacity: "1" },
                         "100%": { opacity: ".55" } },
        "toast-in":    { from: { opacity: "0", transform: "translateY(8px)" },
                         to:   { opacity: "1", transform: "none" } },
        "sheet-in":    { from: { transform: "translateX(100%)" },
                         to:   { transform: "none" } },
      },
      animation: {
        "ring-draw": "ring-draw 640ms cubic-bezier(0,0,0,1) both",
        skeleton:    "skeleton 1.4s ease-in-out infinite",
        "toast-in":  "toast-in 200ms cubic-bezier(0,0,0,1) both",
        "sheet-in":  "sheet-in 320ms cubic-bezier(.2,0,0,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/container-queries")],
};
export default config;
```

## 1.4 Spacing scale

`2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80` px. No value outside this list appears in any margin, padding or gap. Enforce with an ESLint rule banning arbitrary Tailwind spacing values (`p-[13px]`) in `packages/ui` and both apps.

| Token | px | Use |
|---|---|---|
| `s-05` | 2 | Hairline nudge; badge inner offset; ring stroke gap |
| `s-1` | 4 | Icon-to-icon; chip inner y |
| `s-2` | 8 | Label→control; icon→label inside a button |
| `s-3` | 12 | Control inner x (compact); chip x; table cell x (compact) |
| `s-4` | 16 | Default stack gap; card inner (compact); form field gap |
| `s-5` | 20 | Grid gutter inside a card; tile padding |
| `s-6` | 24 | Page gutter; card padding (comfortable); column gap |
| `s-8` | 32 | Card→card; sub-section separation |
| `s-10` | 40 | Section header→content |
| `s-12` | 48 | Section→section inside a page (console) |
| `s-16` | 64 | Section→section (storefront) |
| `s-20` | 80 | Hero top/bottom; page end→footer |

Vertical rhythm: sections use `--section-y` (56 comfortable / 32 compact), never a hard-coded value.

## 1.5 Type scale

Base = 15px (`0.9375rem`) at a 16px root. All sizes are `rem` so browser zoom and OS text scaling work (1.4.4 Resize Text).

| Role | Family | Size | Weight | Line-height | Tracking | Where |
|---|---|---|---|---|---|---|
| Display 1 | Poppins | clamp 30→50px | 700 | 1.08 | −0.030em | Homepage hero, one per page |
| Display 2 | Poppins | clamp 28→40px | 700 | 1.12 | −0.028em | Section openers, order-confirmation headline |
| Display 3 | Poppins | clamp 22→32px | 600 | 1.16 | −0.025em | Sub-section, PDP model name |
| Heading 1 | Poppins | 26px | 600 | 1.20 | −0.022em | Console page title |
| Heading 2 | Poppins | 22px | 600 | 1.25 | −0.020em | Card group title, modal title |
| Heading 3 | Poppins | 19px | 600 | 1.30 | −0.016em | Card title, step title |
| Heading 4 | Poppins | 15.5px | 600 | 1.35 | −0.012em | Field-group title, table caption |
| Body lg | Inter | 17px | 400 | 1.60 | 0 | Lede paragraph, max 62ch |
| Body | Inter | 15px | 400 | 1.55 | 0 | Default |
| Body sm | Inter | 13.5px | 400 | 1.50 | 0 | Helper text, table body (compact), captions |
| Label | Inter | 12.5px | 600 | 1.35 | +0.005em | Form labels, table headers, chip text |
| Eyebrow | JetBrains Mono | 11px | 600 | 1.30 | +0.150em, uppercase | Section kicker. **Never carries information not repeated in the heading below it.** |
| Num | JetBrains Mono | 13px | 600 | 1.40 | −0.020em | Prices, serials, seal codes, GSTIN, quantities, dates in tables. `font-variant-numeric: tabular-nums` |
| Num lg | JetBrains Mono | 24px | 700 | 1.10 | −0.040em | KPI tiles, ring centre, price on PDP |

Rules:
- Headings are Poppins; everything else is Inter. Mono is for **machine-issued identifiers and money only** — serials, seal codes, GSTIN/PAN, invoice/PO/order numbers, prices, percentages, counts. Never for prose.
- Prices always render with `tabular-nums`, `₹` prefix, Indian digit grouping (`₹1,24,900`), and no trailing `.00` unless paise are non-zero.
- Max measure 62ch for `body-lg`, 74ch for `body`.
- Never below 12.5px except `eyebrow`. Nothing under 11px exists.

## 1.6 Elevation

Shadow encodes *distance from the page*, and nothing else. It never encodes state, selection or emphasis.

| Level | Token | Used by | Rule |
|---|---|---|---|
| 0 | none, `1px solid var(--rule)` | Table rows, list items, inline panels, form fields | The default. Prefer a rule to a shadow. |
| 1 | `--sh-1` | Resting cards: ListingCard, KPI tile, AddressCard, document row | Card + `--rule` border together. |
| 2 | `--sh-2` | Lifted surfaces: dropdown, popover, combobox list, sticky filter bar on scroll, hovered ListingCard, side panel | Appears on interaction or on scroll, never at rest. |
| 3 | `--sh-3` | Modal, Drawer, CommandPalette | Always with a scrim `rgba(25,31,46,.44)`. |
| CTA | `--sh-cta` | The single orange primary button | Only control in the system that carries a coloured shadow. Removed when `disabled` or `loading`. |

Constraints: a shadowed element never contains another shadowed element (a card inside a card drops to level 0). Maximum two stacked levels on screen at once — a Modal (3) may contain a dropdown (2) but a Drawer inside a Modal is banned. Elevation changes animate `box-shadow` over `--d-fast`; no `transform` scale on hover for cards (causes CLS on touch).

## 1.7 Focus ring

```css
.focus-ring {
  outline: var(--focus-w) solid var(--focus);   /* #0C7E92, 4.76:1 on white */
  outline-offset: var(--focus-offset);          /* 2px                      */
  border-radius: inherit;
}
/* on --orange, --navy, --cyan-ink and photo backgrounds */
.on-navy :focus-visible,
.focus-ring--inverse { outline-color: var(--focus-on-dark); }
/* where outline-offset is clipped (table cells, sticky headers) */
.focus-ring--inset { outline-offset: -3px; }
```

Spec:
- **2px minimum thickness, 2px offset**, fully enclosing the control. Contrast of the ring against *both* the adjacent background and the control's own fill is ≥3:1 (2.4.11 Focus Not Obscured / 1.4.11 Non-text Contrast).
- `:focus-visible` only — pointer clicks never show the ring. `:focus:not(:focus-visible){outline:none}`.
- A focused element is never covered by the sticky header, the sticky filter bar or the cart summary bar: every scroll container sets `scroll-padding-top: calc(var(--header-h) + 16px)` and `scroll-padding-bottom: 96px` (2.4.11 AA).
- Custom composites (OTPInput, RadioTile, PickTile, DataTable grid) draw the ring on the **element that holds `tabindex`**, not on a wrapper.
- Never remove the ring to "fix" a layout. If the offset clips, use `.focus-ring--inset`.

## 1.8 Motion

| Token | Value | Applies to |
|---|---|---|
| `--d-instant` 80ms | `--e-standard` | Chip/checkbox tick, button colour |
| `--d-fast` 120ms | `--e-standard` | Hover, shadow lift, row highlight |
| `--d-base` 160ms | `--e-standard` | Dropdown, popover, accordion, tab underline |
| `--d-slow` 240ms | `--e-decel` | Modal enter, step transition, stepper rail advance |
| `--d-sheet` 320ms | `--e-standard` | Drawer / mobile bottom sheet |
| `--d-toast` 200ms | `--e-decel` | Toast in; `--e-accel` out |
| ring-draw 640ms | `--e-decel` | ScoreRing stroke sweep, once on mount, never on re-render |

Rules: exits are always faster than entries and use `--e-accel`. Nothing loops except `skeleton` and an indeterminate progress bar. No parallax, no scroll-jacking, no auto-advancing carousel (2.2.2 Pause Stop Hide — and an auto-carousel of "deals" edges into the scarcity/urgency prohibitions in §5.5). `prefers-reduced-motion: reduce` collapses every duration to 1ms and disables `ring-draw`, `sheet-in` and skeleton pulsing (skeletons become static tint).

## 1.9 Accessibility targets

**Conformance target: WCAG 2.2 Level AA**, plus IS 17802 (Indian accessibility standard) for the storefront, and RPwD Act 2016 s.42 obligations. Verified per-PR by `axe-core` in Playwright on every route listed in Part 3; a violation fails CI.

### 1.9.1 Verified contrast pairs

Computed, not eyeballed. ✅ = passes AA for normal text (≥4.5:1). ⚠️ = large text / UI only (≥3:1). ❌ = banned.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--ink` #1B2333 | `--surface` #FFFFFF | 14.64 | ✅ |
| `--ink` | `--paper` #F4F6F8 | 13.36 | ✅ |
| `--navy` #191F2E | `--surface` | 16.45 | ✅ |
| `--navy` | `--orange` #FE9D00 | **7.86** | ✅ **primary button** |
| `--navy` | `--orange-dk` #D97F00 | 5.47 | ✅ primary hover |
| `--muted` #697586 | `--surface` | 4.68 | ✅ |
| `--muted` | `--paper` | 4.27 | ❌ — use `--muted-ink` |
| `--muted-ink` #5A6675 | `--paper` / any `-wash` | 5.33 | ✅ |
| `--muted-2` #94A1B2 | `--surface` | 2.63 | ❌ **decorative only** — never text, never a border that conveys state |
| `--cyan` #17AFC5 | `--surface` | 2.64 | ❌ text and UI. Fills, chart marks, ring arcs only |
| `--cyan-dk` #0E8DA0 | `--surface` | 3.94 | ⚠️ icons/UI/large text only |
| `--cyan-ink` #0C7E92 | `--surface` | 4.76 | ✅ links, cyan buttons (white on it: 4.76) |
| `--cyan` | `--navy` | 6.23 | ✅ on navy panels |
| `--good` #12945F | `--surface` | 3.87 | ⚠️ mark only |
| `--good-ink` #0B7A4C | `--surface` / `--good-wash` | 5.38 / 4.74 | ✅ |
| `--warn` #E08B3C | `--surface` | 2.65 | ❌ text |
| `--warn-ink` #8A5410 | `--surface` / `--warn-wash` | 6.26 / 5.57 | ✅ |
| `--bad` #D24A3A | `--surface` | 4.39 | ❌ (misses by 0.11) |
| `--bad-ink` #B93A2B | `--surface` / `--bad-wash` | 5.67 / 4.94 | ✅ |
| `--rule` #E2E7EC | `--surface` | 1.24 | Decorative divider only — a field border that conveys state uses `--rule` **plus** an ink-coloured 1.5px border and an icon |
| `--focus` #0C7E92 | `--surface` / `--paper` | 4.76 / 4.34 | ✅ (needs ≥3) |

**Colour is never the only channel** (1.4.1). Grade = colour + letter + ring shape. Pass/fail = colour + icon + word. Chart series = colour + direct label or pattern. Verified field = green rule + ✓ icon + the resolved entity name in text. Rejected field = red rule + ! icon + the specific reason.

### 1.9.2 Target size

- **44×44 CSS px minimum** for every interactive target across all three apps (2.5.8 AAA-level size adopted as our floor; AA's 24px is not enough for a rider wearing gloves or a technician on a warehouse floor).
- Where a control is visually smaller (a 24px table-row checkbox, a 20px close ✕, an option chip), it carries an invisible expanded hit area via `::after{position:absolute;inset:-10px}`. The *visual* size may shrink; the *hit* size may not.
- Adjacent targets keep ≥8px of separation, or the hit areas must not overlap.
- Mobile (Expo): 48×48 dp minimum, 56dp for the technician's per-unit pass/fail and the rider's scan trigger — both are used one-handed with the other hand holding a machine.

### 1.9.3 Keyboard order and traps

- DOM order == visual order on every route. Zero positive `tabindex`.
- Every page begins with a "Skip to content" link (visually hidden until focused), and console pages add "Skip to filters".
- **Modal / Drawer / CommandPalette**: focus moves to the dialog on open (to the first interactive element, or the heading with `tabindex="-1"` if the first element is destructive); `Tab` cycles inside; `Esc` closes and returns focus to the invoker. Background is `aria-hidden` + `inert`.
- **Sticky header** never traps: it is `position:sticky`, not focus-scoped.
- **Roving tabindex** for: OTPInput, OptionChip groups, RadioTile groups, DataTable grid cells, Stepper rail, Timeline. One tab stop for the group; arrows move within.
- **Drag-and-drop** (file upload, route-stop reordering in admin) always has a keyboard equivalent — a "Move up / Move down" menu item and a file-picker button (2.5.7 Dragging Movements).
- **No keyboard shortcut is a single unmodified character** except within the CommandPalette when it is open (2.1.4). Global palette open = `⌘K` / `Ctrl+K`, and it is remappable in Settings.

### 1.9.4 ARIA patterns — the four hard ones

**Stepper / ProgressRail** (registration, listing wizard, checkout)
```html
<nav aria-label="Registration progress">
  <ol>
    <li><a href="/register/account" aria-current="false">
      <span class="sr-only">Step 1 of 5, completed:</span> Your details
      <span aria-hidden="true">✓</span></a></li>
    <li><a href="/register/company" aria-current="step">
      <span class="sr-only">Step 2 of 5, current:</span> Company &amp; GST</a></li>
    <li><span aria-disabled="true">
      <span class="sr-only">Step 3 of 5, not started:</span> Statutory</span></li>
  </ol>
</nav>
<div role="status" aria-live="polite" class="sr-only">
  Step 2 of 5. Company and GST details.
</div>
```
- It is a `nav > ol`, **not** `role="tablist"` — each step is a real route with its own URL, back-button behaviour and server state.
- Completed steps are links. Future steps are non-interactive `<span aria-disabled="true">` until unlocked; do not render a disabled `<button>` (it disappears from the a11y tree in some SR/browser pairs).
- Advancing a step announces via a polite live region, and focus moves to the new step's `<h2>` (`tabindex="-1"`).
- A blocked step (e.g. vendor step 6 with two rejected documents) sets `aria-describedby` to the blocker text and renders `role="alert"` on that text once.

**OTPInput** (6 digits, mobile + email)
```html
<fieldset role="group" aria-labelledby="otp-lbl" aria-describedby="otp-help otp-err">
  <legend id="otp-lbl">Enter the 6-digit code sent to +91 98xxx xx210</legend>
  <input inputmode="numeric" autocomplete="one-time-code" maxlength="6"
         aria-label="Verification code, digit 1 of 6" ... />
  <!-- ×6 -->
  <p id="otp-help">The code expires in 9:41. <button type="button">Resend</button></p>
  <p id="otp-err" role="alert"></p>
</fieldset>
```
- Six separate `<input>`s, each `inputmode="numeric"`, `pattern="[0-9]*"`, `autocomplete="one-time-code"` on the **first** input only (Android/iOS SMS autofill fills the group from it).
- Paste of a 6-digit string on any box distributes across all six and submits.
- `Backspace` on an empty box moves to the previous box and clears it. `ArrowLeft/Right` move without clearing. Roving tabindex: the group is one tab stop.
- Auto-submit on the 6th digit **only when the field has not been auto-filled mid-edit**; always keep a visible Verify button (never rely on auto-submit alone — 3.2.2 On Input).
- Countdown is `aria-live="off"` (would spam); the resend button becomes enabled with a single polite announcement "You can resend the code now."
- On failure, `role="alert"` states attempts remaining: "Wrong code. 3 attempts left before this number is locked for 30 minutes."

**Comparison / offer grid** (the anonymised multi-supply-point table)
```html
<table role="table" aria-label="6 supply points offering Dell Latitude 5420, i5-1145G7 / 16 GB / 512 GB">
  <caption class="sr-only">Sorted by landed price, lowest first. Prices include GST and freight to 110020.</caption>
  <thead><tr>
    <th scope="col"><button aria-sort="ascending">Landed price</button></th>
    <th scope="col">Supply point</th>
    <th scope="col">Grade</th>
    <th scope="col">Battery</th>
    <th scope="col">Units available</th>
    <th scope="col">Inspected</th>
    <th scope="col">Dispatch</th>
    <th scope="col"><span class="sr-only">Add to cart</span></th>
  </tr></thead>
  ...
</table>
```
- A real `<table>` with `<th scope="col">`. Sortable headers are `<button>`s inside the `<th>`; the active column carries `aria-sort="ascending|descending"`, others `aria-sort="none"`.
- Sorting/filtering re-renders and announces the new count via `role="status"`: "12 offers, sorted by landed price, lowest first."
- Below `md`, the table becomes a stacked card list; each card is an `<article>` with an `<h3>` = "Supply Point A · Gurugram" and a `<dl>` of the same fields. The `<table>` semantics are dropped, not faked with `role` overrides.
- Row selection for side-by-side compare uses checkboxes with an explicit `aria-label` ("Compare Supply Point A, Gurugram, ₹24,980 landed").
- **The row exposes no vendor identity in any attribute, `data-*`, tooltip, sort key or ARIA label.**

**FileBar / Uploader**
```html
<div>
  <label for="gst-cert">GST registration certificate</label>
  <p id="gst-hint">PDF or JPG, up to 10 MB. The certificate as downloaded
     from the GST portal, not a photo of a printout.</p>
  <input type="file" id="gst-cert" accept="application/pdf,image/jpeg,image/png"
         aria-describedby="gst-hint gst-status" />
  <div id="gst-status" role="status" aria-live="polite">
    Uploading GST-cert.pdf, 62 percent.
  </div>
</div>
```
- A real `<input type="file">` is always present and focusable; the drop zone is a decorative enhancement layered over it. Drop zone is not the only path (2.5.7).
- Progress announces at 0 / 25 / 50 / 75 / 100% only — not on every tick.
- Success announces the resolved fact, not the mechanism: "Accepted. GSTIN on the certificate matches the one you entered."
- Failure is `role="alert"` with the *actual* reason (§5.2), and the file stays listed with a **Replace** button, so the user never has to remember which of six documents failed.
- Uploaded files are a `<ul>`; each `<li>` has the filename, size, status chip, a Preview button (opens DocumentViewer) and a Remove button with `aria-label="Remove GST-cert.pdf"`.
- Camera capture on mobile web uses `capture="environment"` only on the technician/rider PWAs, never on the buyer's document upload (users need their file manager there).

### 1.9.5 Other conformance notes

- **1.4.13 Content on Hover**: every tooltip is dismissible with `Esc`, hoverable, and persistent. The price-breakdown popover is a click-popover, not a hover-tooltip, because it carries information required before purchase.
- **3.3.7 Redundant Entry**: this is Rule 01 ("Never ask twice") as a legal requirement, not a preference. Nothing verified in an earlier step is re-requested. Address selection offers previously-entered addresses; the vendor's bank account is never re-typed.
- **3.3.8 Accessible Authentication**: OTP login must not require the user to transcribe from an image; `autocomplete="one-time-code"` and paste are always allowed. Password fields allow paste. No cognitive-function test (no puzzle CAPTCHA) — rate-limit + device fingerprint + Turnstile-style invisible challenge instead.
- **2.4.11/2.4.12 Focus Not Obscured**: verified by a Playwright helper that tabs every route and asserts the focused element's bounding box is fully inside the viewport and not intersected by any `position:fixed` element.
- **1.3.5 Identify Input Purpose**: `autocomplete` on name, email, tel, org, street-address, postal-code, cc-* (Razorpay iframe handles card fields).
- **Language**: `<html lang="en-IN">`. Hindi is out of scope for v1 on the storefront/console; the **technician and rider apps ship English + Hindi** from day one (`i18n-js`, device locale default) because field staff are the users least likely to read English fluently.
- **Errors**: `aria-invalid="true"` + `aria-describedby` pointing at the message, message rendered adjacent and in text, never colour-only, never only in a toast.

---

# PART 2 — COMPONENT INVENTORY

All shared components live in `packages/ui/src/components`. They are presentational and take no data-fetching responsibility. Anything with a `--` in the States column does not have that state.

Conventions used below: every component accepts `className`, `id`, `data-testid`; every form component accepts `name`, `label`, `hint`, `error`, `required`, `disabled`. Loading is a `loading` boolean, never a swapped component. Error is a string, never a boolean.

## 2.1 Master table

| # | Component | Variants | States | Props sketch | Used in |
|---|---|---|---|---|---|
| 1 | **Button** | `primary` (orange fill, navy ink, `--sh-cta`) · `secondary` (cyan-ink fill, white) · `navy` · `ghost` (white, rule border) · `ghost-inverse` · `link` · `danger` (bad-ink fill) · sizes `sm`/`md`/`lg` · `block` · `iconOnly` | default · hover · focus-visible · active (translateY 1px) · disabled (opacity .45, no shadow, `aria-disabled` not `disabled` when it needs a reason tooltip) · loading (spinner replaces leading icon, label stays, width frozen, `aria-busy`) · `--` error/empty | `{variant, size, block, loading, leadingIcon, trailingIcon, asChild, confirm?: {title,body,confirmLabel}}` | Everywhere. Exactly one `primary` per view. |
| 2 | **Input** | `text` · `email` · `tel` (+91 prefix) · `number` · `currency` (₹ prefix, tabular) · `mono` (GSTIN/PAN/serial, uppercase transform) · `textarea` · `password` (reveal toggle) · `search` (leading icon, clear button) · with `prefix`/`suffix`/`unit` slot · with inline `Verify` action | default · hover · focus · filled · **verifying** (spinner in suffix, input read-only) · **verified** (good rule + ✓ + resolved-entity line: "Active · Northwind Logistics Private Limited · Haryana (06)") · **rejected** (bad rule + ! + specific reason) · warning · disabled · readonly (grey fill, no border) · error · `--` empty | `{type, value, onChange, verifyState?: 'idle'|'verifying'|'verified'|'rejected', verifyDetail?: ReactNode, onVerify?, mask?, maxLength, autoComplete, inputMode}` | Every form. Verified/rejected are the GSTIN, PAN, IFSC, Udyam, pincode and serial fields. |
| 3 | **Select** | `native` (mobile, ≤7 options) · `listbox` (shadcn Select) · `combobox` (typeahead, async) · `multi` (token input) · `grouped` · `async-paged` | default · hover · focus · open · selected · loading options · empty options ("No brand matches 'thnkpad'") · error · disabled | `{options, value, onChange, searchable, async?: (q)=>Promise<Opt[]>, emptyMessage, renderOption}` | Filters, catalog pick, GSTIN chooser, carrier chooser, role assignment |
| 4 | **PickTile** | `radio` · `checkbox` · sizes `md`/`lg` · with icon · with trailing price/count | default · hover (rule→navy) · focus · selected (`.on`: cyan-wash fill, cyan-ink 1.5px border, ✓ corner) · disabled · error (group-level) | `{title, subtitle, icon?, meta?, selected, disabled, name, value}` | "A choice with a trade-off worth explaining": constitution type, payment mode, category, delivery speed, credit vs prepay |
| 5 | **OptionChip** | `filter` (toggle) · `select` (in a form) · `removable` (token) · `count` (shows unit count) | default · hover · focus · selected (navy fill, white text) · disabled · loading count · `--` error | `{label, count?, selected, onToggle, removable}` | "Many short values from a known list": brands, RAM, generations, grades, states |
| 6 | **Checkbox** | `default` · `with-consequence` (bold label + consequence sub-line) · `indeterminate` · `table-row` | default · hover · focus · checked · indeterminate · disabled · error · `--` loading | `{checked, indeterminate, label, consequence?: string, onChange}` | "A statement you agree with". Every checkbox that changes account behaviour **must** pass `consequence` (Rule 03). |
| 7 | **RadioTile** | `stacked` · `inline` · `with-price` · `with-badge` | default · hover · focus · selected · disabled (with reason) · error · loading (price still resolving) | `{options, value, onChange, name, orientation}` | Payment mode, shipping option, refund method, grade-correction response |
| 8 | **FileBar / Uploader** | `single` · `multi` · `document-slot` (a named, required document) · `csv` (with template download + column mapper) · `image` (technician, with camera) | idle · dragover · uploading (determinate %) · scanning (magic-byte + AV) · **uploaded-pending-review** · **accepted** · **rejected** (with reason + Replace) · expired (document past validity) · error · disabled | `{slotKey, accept, maxSizeMb, multiple, value: UploadedFile[], onUpload, onRemove, status, rejectionReason, expiresOn}` | Vendor step 6, buyer step 5, vendor invoice upload, claim evidence, admin bulk import |
| 9 | **OTPInput** | `6-digit` · `4-digit` (rider POD) | idle · entering · verifying · verified · wrong (shake once + attempts left) · locked (30 min) · expired (with Resend) · resend-cooldown | `{length, onComplete, onResend, cooldownSec, attemptsLeft, channel: 'sms'|'email'|'whatsapp'}` | Registration, login, vendor handover sign-off, delivery POD |
| 10 | **Stepper / ProgressRail** | `vertical-rail` (registration sidebar) · `horizontal` (checkout, listing wizard) · `compact` (mobile: "Step 2 of 5" + bar) | step: not-started · in-progress · complete (collapses to a summary line + Edit) · blocked (with blocker list) · error · skipped-optional | `{steps: {key,label,eta,status,summary?,blockers?}[], current, onNavigate}` | Buyer 5-step, vendor 7-step, listing wizard, checkout, credit application |
| 11 | **DataTable** | `basic` · `selectable` · `expandable-row` · `grouped` · `editable-cell` · `virtualised` (>200 rows) · `sticky-first-col` | loading (skeleton rows, header real) · empty (no data) · empty-filtered (different copy + Clear filters) · error (retry) · partial-error · row-loading · row-error · all-selected / page-selected | `{columns, rows, rowKey, sort, onSort, selection, pagination, onRowClick, density, stickyHeader, bulkActions}` | Every console list: listings, units, orders, POs, payouts, visits, tickets |
| 12 | **FilterRail** | `rail` (desktop sticky left, 268px) · `drawer` (below `lg`) · `bar` (horizontal chips summary) | idle · applying (results dim, rail stays live) · with-active-filters (count badge + Clear all) · empty facet (disabled with count 0) · loading facets | `{facets, values, onChange, onClear, resultCount, collapsibleGroups}` | Search results, order board, QC console, procurement board |
| 13 | **ListingCard** | `grid` · `row` (search list view) · `mini` (cart, related) · `skeleton` | default · hover (`--sh-2`) · focus · out-of-stock · qc-expiring (warn chip) · added-to-cart · unavailable-at-pincode · loading | `{sku, title, spec, grade, batteryPct, score, priceFrom, supplyPointCount, unitsAvailable, image, href}` | Homepage, search, brand pages, related, saved searches |
| 14 | **OfferRow** | `table-row` (≥md) · `card` (<md) · `compare-column` | default · hover · focus · selected-for-compare · best-price (a neutral "Lowest landed" label, not a scarcity badge) · partially-available (qty < requested) · qc-expiring-14d · unavailable · loading price (pincode resolving) | `{supplyPointLabel, city, landedPrice, priceBreakdown, grade, batteryPct, unitsAvailable, inspectedOn, qcExpiresOn, dispatchCommitment, onAdd, qty}` | PDP offer grid, compare page, RFQ response view. **Anonymity-critical — see §2.2.** |
| 15 | **GradeBadge** | `A_PLUS` · `A` · `B` · sizes `sm`/`md`/`lg` · `with-label` · `declared` (vendor-side, dashed border, "declared, not yet verified") · `corrected` (strike-through old → new) | default · hover (popover with the grade definition) · focus · `--` others | `{grade, size, variant: 'verified'|'declared'|'corrected', previousGrade?}` | Everywhere a unit appears |
| 16 | **ScoreRing** | `lg` 86px · `md` 58px · `sm` 40px · `inline` 24px (no label) | idle · animating (once on mount) · loading (grey track pulse) · no-score (dashed track, "—") | `{value: 0..100, size, label?, segments?: {cosmetic,functional,battery}}` | QC report, unit passport, PDP, vendor scorecard |
| 17 | **SealChip** | `intact` · `broken` · `voided` · `replaced` (links to replacement) · `not-applied` | default · hover (seal photo thumb) · focus · verifying (rider scan in progress) · mismatch (scanned ≠ manifest) | `{sealCode, status, appliedOn, photoUrl?, replacedBy?}` | Unit passport, order detail, pickup, delivery, admin seal register |
| 18 | **StatusPill** | tone `neutral`/`info`/`good`/`warn`/`bad`/`processing` · `with-dot` · `with-icon` · `sm`/`md` | static · processing (animated dot) · `--` others | `{tone, label, icon?, tooltip?}` | Order, PO, payout, claim, ticket, visit, listing, document status |
| 19 | **Timeline** | `vertical` · `compact` · `with-actor` (who did it) · `branching` (delivery attempts) | complete · current · pending · failed (with reason + retry) · loading · empty | `{events: {at, actor, title, detail, tone, attachments?}[]}` | Order events, shipment tracking, claim history, audit log, visit log |
| 20 | **EmptyState** | `first-run` (no data yet, with a primary action) · `no-results` (filters too tight, with Clear) · `error` · `permission` (role can't see this) · `blocked` (account pending) · `success-terminal` (nothing left to do — an empty approval inbox) | static | `{illustration?, title, body, primaryAction?, secondaryAction?}` | Every list, table and inbox |
| 21 | **Skeleton** | `text` (1–3 lines) · `block` · `card` · `table-rows` · `ring` · `image` | pulsing (static under reduced-motion) | `{variant, lines?, width?, height?}` | Every async surface. Skeletons match the final layout box exactly — CLS budget is 0.02. |
| 22 | **Toast** | `success` · `error` · `info` · `warn` · `undo` (with a 7s action) · `progress` (background job) | entering · visible · dismissing · stacked (max 3, oldest collapses) | `{tone, title, body?, action?, duration, persistent}` | Confirmations, background job results, connectivity |
| 23 | **Modal** | `sm` 440 · `md` 600 · `lg` 800 · `confirm` · `destructive-confirm` (types the entity name) · `form` | opening · open · submitting (footer buttons lock, body stays scrollable) · error (inline banner at top, never a nested toast) · closing | `{size, title, description, onClose, dismissible, footer}` | Confirmations, quick edits, grade-correction response, price override |
| 24 | **Drawer** | `right` (detail panel, 420/560/720) · `bottom` (mobile sheet) · `stacked` (max 2, second is 40px inset) | opening · open · loading content · error · closing | `{side, size, title, onClose}` | Order detail from a board, unit detail, filter drawer, document preview |
| 25 | **CommandPalette** | `global` (⌘K) · `scoped` (inside a board) | closed · open-empty (recent + suggested) · typing · loading results · results · no-results · error | `{sources: {id,label,search,render}[], onSelect, recents}` | `apps/console` only. Jump to order/PO/serial/seal/vendor/ticket by ID; run admin actions. |
| 26 | **PriceBreakdown** | `inline` (checkout summary) · `popover` (offer row) · `document` (invoice view) · `vendor-payout` (the deduction stack) | resolved · resolving (pincode/GSTIN pending) · stale (inputs changed, "Recalculate") · error · `--` empty | `{lines: {label, amount, note?, tone?}[], total, currency, taxNote, valuationMethod: 'REGULAR'\|'MARGIN'}` | Cart, checkout, offer row, invoice, payout statement. **Every line visible before the pay button — see §5.5 drip-pricing prohibition.** |
| 27 | **AddressCard** | `billing` (bound to a GSTIN) · `delivery` (with gate instructions) · `pickup` (vendor facility) · `selectable` · `compact` | default · selected · default-flagged · unserviceable-pincode (warn + reason) · editing · verifying-pincode · error | `{address, kind, selected, onSelect, onEdit, serviceability?: {ok, etaDays, carriers}}` | Checkout, address book, vendor facilities, shipment creation |
| 28 | **DocumentViewer** | `pdf` (paged) · `image` (zoom/rotate) · `side-by-side` (two docs, for KYC + three-way match) · `annotated` (admin adds rejection notes on a region) | loading · loaded · password-protected · unsupported-type · expired-signed-url (auto-refetch once, then error) · error | `{fileId, kind, pages, annotations, onApprove, onReject, onDownload}` | KYC review, three-way match, claim evidence, QC report, wipe certificate |
| 29 | **KPI tile** | `number` · `number-with-delta` · `currency` · `percentage` · `with-sparkline` · `with-target` · `alert` (threshold breached) | loading (skeleton keeps the box) · loaded · no-data ("No orders in this period" — never `0` styled as data) · stale (last-updated line) · error | `{label, value, unit, delta?, deltaPeriod, sparkline?, target?, tone, href?}` | Every dashboard: ops, vendor, buyer |
| 30 | **Chart shells** | `line` (time series) · `bar` · `stacked-bar` · `horizontal-bar` (rankings) · `funnel` (onboarding) · `donut` (grade mix — the only donut, and it reuses the ring geometry) · `heatmap` (QC divergence by vendor × week) | loading · loaded · empty ("No data for this range") · partial (gap in series, dashed) · error · zoomed | `{data, series, xKey, yKey, valueFormat, height, legend: 'direct'\|'bottom'\|'none', annotations}` | Reporting/BI, scorecards, payout analytics |

## 2.2 Component notes for the non-obvious ones

**OfferRow — the anonymity contract.** This is the highest-risk component in the product.
- Renders **only** from `SupplyPointOfferDto`, which the API builds through an explicit whitelist. The frontend never receives `vendor_id`, `organization_id`, `vendor_name`, `gstin`, `facility_address`, `vendor_tier`, `vendor_rating` or `expected_payout_price`. There is no client-side hiding.
- The supply-point letter is **stable per SKU per buyer session**, derived from a salted hash of `(vendor_id, sku_id)`, so the same vendor is "Supply Point A" throughout one product page but the letter carries no cross-SKU or cross-buyer information.
- City is the **dispatch city** taken from the facility's pincode → city mapping, never the registered office.
- Fields rendered, exhaustively: supply-point label, dispatch city, landed price (with a breakdown popover), grade badge, battery health %, units available (sellable only), inspection date + expiry, dispatch commitment ("Hands over within 24 h"), quantity stepper, Add to cart.
- Banned in this component and its parents: any star rating, tier, badge like "Gold", "Top seller", "Trusted", any count of a vendor's other listings, any "seller since" date, any response-time metric.
- A Playwright test asserts the serialised RSC payload for `/laptops/[slug]` contains none of the banned keys. It fails the build if it does.

**PriceBreakdown — the two valuation channels.** `valuation_method` is set per unit at purchase and is immutable. A cart may contain both REGULAR and MARGIN units; they can never be combined on one invoice, so the cart splits sub-orders by `(supply_point, valuation_method)`. The breakdown shows, for REGULAR: `Unit price × qty → Freight → Taxable value → IGST/CGST+SGST @18% → Total`. For MARGIN: the same, plus the mandated narration line — *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."* — and an explicit ITC line reading "Input tax credit available to you: nil on this line". Buyers must be able to see this **before** adding to cart, from the offer-row popover, because thinner ITC materially changes a B2B buyer's cost.

**Input `verified` state.** Never shows only a tick. It shows the resolved entity: GSTIN → legal name + taxpayer type + state + registration date; PAN → name-match verdict against the GSTIN's characters 3–12; IFSC → bank + branch; pincode → city, state, serviceability, ETA; bank account → the name the bank holds, from the ₹1 penny-drop. The resolved text is what makes the tick trustworthy.

**Stepper summary lines.** A completed step collapses to a `<dl>` of the two or three facts that step established, plus an Edit link that routes back and returns to where the user was. Masked PII in summaries: `+91 98••• ••210`, `AAFFN••••K`. Full values only behind an explicit "Show" toggle that writes an `audit_log` entry when used in the console.

**DataTable.** Server-driven sort, filter and pagination; URL is the source of truth (`?sort=-created_at&status=AWAITING_QC&page=2`) so a console user can bookmark and share a board state. Bulk actions require a confirm modal that names the count and the irreversible part ("Approve 14 listings. Approved listings go live immediately and are visible to buyers."). Virtualised above 200 rows; the sticky header is a real `<thead>` with `position:sticky`, not a duplicated div.

**Skeleton vs spinner.** Skeleton for *first* load of a known layout. Spinner (inside the button) for a *user-initiated* action. Neither for a re-fetch of already-visible data — that dims to 60% opacity and keeps the old data interactive (avoids layout thrash on filter changes).

**CommandPalette sources** (console): Orders (by order no / PO no), Units (by serial), Seals (by seal code), Vendors (admin only, by legal name or GSTIN), Buyers (admin only), Tickets, Listings, Navigation, and Actions (e.g. "Create payout run", "Open QC visit"). Each source declares required permissions; results the role cannot see are never returned by the API, not filtered client-side.

---

# PART 3 — SCREEN INVENTORY

This is the build checklist. Every row is a route that must exist, ship with its empty/loading/error states, and pass the axe-core gate.

**Role vocabulary.**
*Buyer side:* `PUBLIC` (unauthenticated) · `BUYER_OWNER` · `BUYER_ADMIN` · `BUYER_PROCURER` (raises orders) · `BUYER_APPROVER` (approves above a limit) · `BUYER_FINANCE` (invoices, credit, payments) · `BUYER_VIEWER`.
*Vendor side:* `VENDOR_OWNER` (MFA mandatory) · `VENDOR_ADMIN` · `VENDOR_OPS` (listings, QC, handover) · `VENDOR_FINANCE` (invoices, payouts) · `VENDOR_VIEWER`.
*Admin side:* `ADMIN_SUPER` · `ADMIN_OPS` · `ADMIN_KYC` · `ADMIN_CATALOG` · `ADMIN_QC` · `ADMIN_PRICING` · `ADMIN_FINANCE` · `ADMIN_LOGISTICS` · `ADMIN_SUPPORT` · `ADMIN_AUDIT` (read-only + audit log) · `ADMIN_DPO` (DPDP requests).
*Field:* `TECHNICIAN` · `RIDER`.

Roles are checked server-side on every route via a middleware that reads the session's permission set. A route the role lacks returns the `permission` EmptyState variant, never a 404 (a 404 leaks nothing but confuses a legitimate user who lost a permission).

---

## 3A. `apps/storefront` — public storefront + customer portal

Rendering: `/`, `/laptops/**`, `/brands/**`, `/units/**`, `/legal/**` are SSR/ISR for SEO. `/cart`, `/checkout/**`, `/account/**` are dynamic, `noindex`, session-guarded.

### 3A.1 Discovery (public)

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/` | Convert a business buyer who arrived from search or a sales call. Explains grades, inspection and the seal before anything else. | PUBLIC + all buyer roles | Search; pick a brand; pick a use-case; "Create buyer account"; "Sell on gorefurbo" | `catalog.sku` (featured), `listing.listing` aggregates, `platform.config` (hero stats), `qc` monthly inspected count | **Loading:** hero is static SSR; card rails are skeletons. **Empty:** if a rail has <4 items it is not rendered at all (never a half-empty rail). **Error:** rails fail independently; a failed rail is omitted, page still renders. | Hero stat "4,180 laptops inspected this month" must be a real, cached query, refreshed hourly. It is a factual claim under CPA 2019 — no rounding up, no "over 5,000". No countdown, no "only X left" anywhere on this page (§5.5). Search box is a real `<form>` with a GET action so it works without JS. |
| `/search?q=&brand=&ram=&grade=&…` | Faceted results with the filter rail. The buyer's main working surface. | PUBLIC + buyer | Apply/clear facets; change sort; toggle grid/list; save this search; add to cart from a row | `catalog.sku`, `listing.listing`, `listing.unit` (sellable counts), `qc.qc_report` (freshness), `customer.saved_search` | **Loading:** 12 skeleton cards + real facet counts (facets resolve first). **Empty-filtered:** "No inspected stock matches all 6 filters." + the two filters cutting the most results, each removable inline, + "Save this search and we'll alert you". **Empty-query:** popular models. **Error:** retry with the query preserved in the URL. | URL is state; every filter is a query param and is shareable. Facet counts are **sellable units only** — never counts units awaiting QC. No "Sellers" facet (D1). Sort options: relevance, landed price asc/desc, recently inspected, battery health, units available. Default sort = relevance; never a paid or margin-weighted sort presented as "recommended" without a label. |
| `/brands`, `/brands/[brand]`, `/brands/[brand]/[series]` | SEO landing + navigation by what the buyer already standardises on. | PUBLIC | Drill down; jump to search with the facet pre-applied | `catalog.brand/series/model`, listing aggregates | Empty: brand exists but no stock → "No inspected {Brand} stock right now" + saved-search CTA + nearest alternatives. | Static params generated from the catalog; ISR 15 min. Canonical tags; no duplicate content between `/brands/dell` and `/search?brand=dell`. |
| `/use-case/[slug]` | "Shop by what your team does" — office, developers, design/engineering, field. | PUBLIC | Jump to a pre-filtered search | `catalog.sku` tagged by use-case, price floor | Empty → generic search. | "From ₹14,900" must be the true current minimum landed-price-excluding-freight for the filter set, recomputed hourly, or the line is hidden. A stale "from" price is a misleading advertisement. |
| `/laptops/[slug]` | Product detail for one SKU + configuration. The claim surface. | PUBLIC + buyer | Choose configuration; view offers; open a unit passport; add to cart; save search; request a bulk quote | `catalog.sku`, `catalog.condition_image` (platform's own images by grade), `listing`, `qc` aggregate, `platform.review` | **Loading:** spec block SSR-rendered; offer grid streams in (Suspense) with 3 skeleton rows. **Empty:** SKU exists, no sellable stock → passport of a past unit is still viewable, offer grid replaced by saved-search CTA. **Error:** offer grid errors alone; spec + gallery still render. | Images come from `catalog.condition_image` for the **actual grade of the offer being viewed** — vendors upload none. Every image carries a caption stating it is a representative image of that grade, not the specific unit; the specific unit's own six QC photographs are in its passport. Grade, battery, warranty and working condition are four separate marks. |
| `/laptops/[slug]/offers` (also embedded on the PDP) | The anonymised multi-supply-point comparison grid. | PUBLIC + buyer | Set delivery pincode; sort; select rows to compare; set qty; add one or several to cart; "combine to reach 90 units" | `listing.listing`, `listing.unit` (sellable), `listing.listing_tier_price`, `qc.qc_report` (inspected_on, valid_until), `logistics.serviceability` + rate card (freight), `procurement.price_book` (retail price) | **Loading:** rows render with price cells as skeletons while the pincode resolves; everything else is already known. **Empty:** no sellable offers → saved-search CTA with a target price. **Partial:** requested qty > any single supply point → a "Combine supply points" panel showing the blended landed price. **Error:** freight service down → show ex-freight price with an explicit "Freight to {pincode} unavailable right now — final freight shown at checkout" note, never a guessed number. | **Anonymity: §2.2.** Landed price = retail + freight to pincode + GST, shown as one number the buyer can act on, with a breakdown popover. Stock depth counts sellable units only. QC expiry: ≤14 days shows a warn chip "Inspection expires in 9 days"; expired listings are not offered at all. p95 render budget 500 ms (§6.3). |
| `/units/[serial]` | Unit passport / QC report viewer. The evidence behind the claim. | PUBLIC (pre-purchase, redacted) · buyer who owns it (full) | View report areas, six photographs, seal photo, wipe certificate; download PDF; verify a seal code | `qc.qc_report`, `qc.qc_area_result`, `qc.hardware_detected`, `qc.qc_photo`, `qc.qc_seal`, `qc.wipe_certificate`, `listing.unit` | **Loading:** ring + area skeletons. **Empty:** never — a unit without a report is not listable. **Error:** signed-URL expiry auto-refetches once, then a Retry. **Expired report:** banner "This inspection expired on {date}. This unit is not currently sellable." | Public view redacts the facility address and any vendor identifier from the report header and from EXIF (stripped at ingest). Shows: score ring, cosmetic area scores, battery health % + cycle count, hardware detected vs SKU spec, verdict, technician ID (pseudonymous, e.g. `TECH-0142`), inspected-on, valid-until, seal code + status. The grade shown is `grade_actual`, never the vendor's declared grade. |
| `/compare?skus=` | Side-by-side of up to 4 SKUs or 4 offers. | PUBLIC + buyer | Remove a column; add to cart from a column | Same as offer grid | Empty (<2 selected) → "Pick at least two to compare". | Differences highlighted; identical rows collapsible. Row order fixed so columns align. |
| `/rfq/new` | Bulk enquiry — quantity we cannot serve from a single listing. | PUBLIC (captures lead) + BUYER_PROCURER | Submit requirement (model/spec, qty, grade floor, battery floor, target price, delivery pincode, needed-by date) | `catalog`, `identity.pincode` | Loading on submit; error keeps the draft in localStorage. | Qty ≥ 10 to use RFQ; below that the buyer is routed to normal search. Needed-by ≥ today+2. PUBLIC submissions create a `registration_lead`, not an order. |
| `/track` | Public order tracking by order number + registered mobile OTP. | PUBLIC | Enter order no + mobile → OTP → status | `ordering.order`, `logistics.shipment_tracking` | Empty/not-found: one generic message for both "no such order" and "mobile doesn't match" (no enumeration). | Rate limit 5 attempts / 15 min / IP. Shows status, ETA and last scan only — no line items, no prices, no addresses. |
| `/help`, `/help/[article]` | Help centre. | PUBLIC | Search; open article; open a ticket | `platform` CMS content | Standard search-empty. | — |

### 3A.2 Cart and checkout

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/cart` | Hold a multi-supply-point selection and show how it will split. | BUYER_PROCURER, BUYER_ADMIN, BUYER_OWNER | Change qty; remove line; move to saved; apply a delivery pincode; proceed | `ordering.cart`, `listing.unit` availability, price book, freight | **Empty:** "Nothing in the cart yet" + recent searches + last-ordered SKUs. **Loading:** line-level skeletons. **Error per line:** a line whose stock dropped shows an inline warn ("Only 12 of the 20 you wanted are still sellable at Supply Point A") with Reduce / Find elsewhere. | The cart splits into sub-orders by **(supply point × valuation_method)** and says so in plain words: "This will become 3 deliveries and 3 tax invoices." Qty cannot exceed sellable units at that supply point. Price is re-validated on every load; a price change is shown as an explicit diff the buyer must acknowledge — never silently applied. No pre-ticked add-ons, no auto-added warranty or insurance (§5.5). |
| `/checkout` | Turn a cart into a legally correct order. Four panels on one page, plus a review. | BUYER_PROCURER (create) · BUYER_APPROVER (may be required) | Select billing GSTIN; select delivery site (per sub-order if needed); enter PO number; choose payment mode; review; place order | `identity.organization`, `kyc.gst_profile` (all GSTINs), `identity.org_address`, `customer.approval_policy`, `customer.credit_application`, `payment` methods | **Loading:** tax recompute shows the total as a skeleton, the pay button disabled with "Recalculating tax for Haryana". **Error:** payment init failure keeps the order in `PENDING_PAYMENT` and offers Retry / change method — never silently drops the cart. **Blocked:** order above the user's spend limit → routes to approval instead of payment, with a clear explanation before the button is pressed. | **GSTIN selection decides place of supply and therefore IGST vs CGST+SGST** — the tax lines recompute visibly when it changes, with a one-line explanation. PO number required if `organization.po_required`; regex configurable per org, default `^[A-Za-z0-9/_-]{3,32}$`. Delivery pincode must be serviceable for every sub-order; an unserviceable line blocks checkout with the specific line named. **Full price breakdown, including freight and GST, is visible before the pay button (drip-pricing prohibition).** MARGIN lines carry the Rule 32(5) narration and the "no ITC" line. Credit terms only if `credit_application.status = APPROVED` and the order fits the remaining limit — the remaining limit is shown, not just a pass/fail. |
| `/checkout/approval-required` | The order was created but needs an internal approver. | BUYER_PROCURER | Notify approver; view policy | `customer.approval_policy`, `ordering.order_approval` | — | Explains which rule triggered it and who can approve, with names. Stock is **not** reserved during approval; the screen says so and shows the current sellable count. |
| `/checkout/pay/[orderId]` | Razorpay checkout / virtual-account instructions / cheque-PDC instructions. | BUYER_PROCURER, BUYER_FINANCE | Pay; copy VA details; upload cheque details | `payment.payment`, Razorpay order | **Loading:** iframe skeleton. **Error:** gateway declined → the bank's reason verbatim plus what to do; never "Something went wrong". **Timeout:** VA payments show "We'll confirm within 30 minutes of your bank transfer" with a live status. | Never auto-retries a card. Never stores card data (Razorpay iframe). For NEFT/RTGS the virtual account is TPV-bound to the org's registered bank account; the screen states that a transfer from any other account will be returned. |
| `/checkout/confirmation/[orderNo]` | Confirm, and name the specific machines. | BUYER_PROCURER, BUYER_ADMIN | Download PO/invoice; track; add to asset register (CSV) | `ordering.order`, `order_line_unit` (serials), `payment.invoice` | **Loading:** never — this route only renders after the transaction commits. **Error:** if invoice generation lags, the serial list still renders with "Tax invoice will be emailed within 15 minutes". | Lists the **assigned serial numbers and seal codes** — the buyer knows exactly which machines are theirs before dispatch. States the 48-hour inspection window and how to use it, in the same visual weight as the confirmation. |

### 3A.3 Orders, documents, delivery

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/account/orders` | All orders for the organisation. | All buyer roles (VIEWER read-only) | Filter by status/date/site/GSTIN/PO; search by order no, PO no or serial; export CSV | `ordering.order`, `sub_order` | **First-run:** "No orders yet" + browse CTA. **Filtered-empty:** clear-filters. **Loading:** 8 skeleton rows. | A `BUYER_PROCURER` sees the whole org's orders (B2B norm) but can only act on their own unless `BUYER_ADMIN`. Export is audit-logged. |
| `/account/orders/[id]` | One order: sub-orders, lines, status, money, documents. | All buyer roles | Track; download docs; raise a ticket; start a return; claim warranty | `ordering.order`, `order_event`, `payment.invoice`, `procurement.purchase_order` (buyer-safe fields only), `logistics.shipment` | **Loading:** header real, timeline skeleton. **Error per panel.** | Sub-orders are labelled "Delivery 1 of 3 · Supply Point A · Gurugram". The PO we raised to the vendor is **not** shown to the buyer; only the buyer's own PO number is. |
| `/account/orders/[id]/units` | Per-serial QC results for what was actually shipped. | All buyer roles | Open a passport; verify a seal; flag a mismatch | `order_line_unit`, `qc.qc_report`, `qc.qc_seal` | **Loading:** row skeletons. **Empty:** pre-allocation → "Machines are assigned when your order is confirmed" (should not occur post-confirmation). | Every row: serial, seal code + status, grade actual, battery %, score, inspected on, passport link. This is the asset-register source; CSV export matches the invoice exactly. |
| `/account/orders/[id]/documents` | Tax invoice, e-way bill, wipe certificates, QC reports, delivery POD, credit notes. | BUYER_FINANCE, BUYER_ADMIN, BUYER_OWNER, BUYER_PROCURER | Preview; download; email to accounts | `payment.invoice`, `payment.eway_bill`, `qc.wipe_certificate`, `logistics` POD | **Empty:** documents not yet generated → each row shows *when* it will exist ("E-way bill is generated at pickup"). **Error:** signed URL expired → auto-refetch once. | Documents open in DocumentViewer, download via short-lived signed URL. Every download writes an `audit_log` row. |
| `/account/orders/[id]/tracking` | Where the machines are. | All buyer roles | Refresh; contact support; reschedule delivery | `logistics.shipment`, `shipment_tracking`, `delivery_attempt`, `route_stop` | **Loading:** timeline skeleton. **Empty:** pre-dispatch → "Not dispatched yet. Handover is scheduled for {date}." **Error:** carrier API down → last known scan + its timestamp + "Carrier updates are delayed", never a fabricated status. | ETA is a range, never a single time. A failed attempt shows the carrier's reason and the next attempt, plus a reschedule action. |
| `/account/orders/[id]/delivery` | Seal verification at handover — the buyer's own check. | BUYER_PROCURER, BUYER_ADMIN, site contact via magic link | Enter/scan seal codes; mark intact/broken; confirm receipt; report a discrepancy | `qc.qc_seal`, `order_line_unit`, `logistics.delivery_task` | **Loading:** per-row check state. **Error:** a scanned code not on the manifest → immediate `role="alert"`: "Seal 88-041992 is not on this delivery. Do not accept this machine." | Buyer marks each seal intact or broken. Any broken or mismatched seal blocks POD completion and opens a discrepancy automatically — Rule 7(4) take-back is ours and non-delegable, so this must be one tap, not a support call. |

### 3A.4 After-sale — returns, warranty, disputes, invoices

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/account/returns/new?order=&units=` | Return within the 48-hour inspection window. | BUYER_PROCURER, BUYER_ADMIN | Pick units; pick reason; upload evidence; submit | `ordering.order_line_unit`, `logistics.delivery_task` (delivered_at), `platform.return_request` | **Blocked:** window closed → explains the exact closing timestamp and routes to warranty instead. **Loading/Error:** draft preserved. | Window = 48 h from POD, per sub-order, computed server-side and displayed as a live countdown **as information, not pressure** — no red flashing, no "hurry". Reasons: not as described / physical damage / functional failure / wrong model or spec / seal broken on arrival / short shipment. Evidence: ≥2 photos for physical damage, seal photo mandatory for a broken-seal claim. Serial must belong to this order. |
| `/account/returns/[id]` | Track a return. | Buyer roles | Add evidence; accept resolution; escalate | `platform.return_request`, timeline, `payment.credit_note` | Loading skeleton; error retry. | Shows pickup schedule, inspection result on return, refund/credit-note status. Refund timeline is stated in working days and honoured — Rule 7(4). |
| `/account/warranty` | Warranty status for every unit the org owns. | Buyer roles | Filter by expiring; open a unit; start a claim | `platform.warranty`, `order_line_unit` | **Empty:** first-run. **Loading:** table skeleton. | Shows coverage start/end per serial, what is covered, what is not. Expiring-in-30-days chip. |
| `/account/warranty/claims/new` | Raise a claim. | BUYER_PROCURER, BUYER_ADMIN | Select serial; describe fault; upload evidence; choose site | `platform.warranty`, addresses | **Blocked:** out of warranty → shows the exact expiry and offers paid repair. | Serial must be in warranty and owned by this org. Fault category from a fixed list mapped to QC area codes, so a claim can be checked against the original report. |
| `/account/warranty/claims/[id]` | Track a claim. | Buyer roles | Add evidence; approve a quote; escalate to dispute | `platform.warranty_claim`, timeline | — | Status set is CHECKed (schema gap #5): `RAISED, TRIAGED, PICKUP_SCHEDULED, IN_REPAIR, AWAITING_PARTS, REPAIRED, REPLACED, REJECTED, CLOSED`. Rejection always states which finding contradicts the claim. |
| `/account/invoices` · `/account/invoices/[id]` · `/account/credit-notes/[id]` | Tax documents for finance. | BUYER_FINANCE, BUYER_OWNER, BUYER_ADMIN | Filter by GSTIN/period; download; bulk ZIP; export for GSTR-2B reconciliation | `payment.invoice`, `invoice_line`, `credit_note` | **Empty-filtered:** clear filters. **Error:** retry. | Filterable by GSTIN because a multi-state buyer reconciles per registration. Export columns match GSTR-2B fields. MARGIN invoices carry the Rule 32(5) narration and are visually flagged so the buyer's finance team does not claim ITC in error. |
| `/account/support` · `/account/support/[ticketId]` | Tickets. | All buyer roles | Raise; reply; attach; close; reopen | `platform.ticket` | **Empty:** "No open tickets" + how to raise one. | Ticket can be attached to an order, a unit or nothing. SLA shown as a commitment, and the grievance-officer escalation path is one click away (Consumer Protection (E-Commerce) Rules 2020 Rule 4(5)). |

### 3A.5 Account, team and governance

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/account/saved-searches` | The searches that become alerts. | Buyer roles | Create; edit criteria; set target price; set alert channel; pause; delete | `customer.saved_search` | **Empty:** "Save a search and we'll tell you when matching stock passes inspection" + link to search. | Alert channels: email, WhatsApp, in-app. Frequency: immediate / daily digest. **Opt-in only, never pre-ticked.** Target price is optional and never used to raise a price shown to that buyer. |
| `/account/alerts` | Alert history and delivery status. | Buyer roles | Mute; open the matching listing | `platform.notification_log` | Empty: "No alerts yet". | Shows what was sent, when, to which channel, and whether it delivered. |
| `/account/team` · `/account/team/[userId]` | Users in the buying organisation. | BUYER_OWNER, BUYER_ADMIN | Invite; assign role; set spend limit; set delivery-site scope; deactivate; force MFA | `identity.user`, `identity.role`, `customer.approval_policy` | **Empty:** just the owner → "Invite the people who will raise and approve orders". **Error:** invite to an existing email → explains it is already in the org. | Deactivation never deletes; historical orders keep the actor. At least one BUYER_OWNER must remain — the UI blocks removing the last one and says why. Role change takes effect at next request and is announced to the affected user. |
| `/account/roles` | What each role can do. | BUYER_OWNER, BUYER_ADMIN | View matrix; create a custom role (permission checkboxes) | `identity.role`, `permission` | — | Matrix is read from the server, not hard-coded in the UI. Custom roles cannot exceed the creator's own permissions. |
| `/account/approvals` | Approval inbox — orders waiting on this person. | BUYER_APPROVER, BUYER_OWNER | Approve; reject with reason; request changes; bulk approve | `ordering.order_approval`, `order` | **Empty (success-terminal):** "Nothing waiting on you." — a deliberately calm empty state, not a nag. **Loading:** row skeletons. | Approving shows the full landed cost, the PO number, the requester and which policy rule triggered the approval, before the button. Rejection reason is mandatory and is sent to the requester verbatim. Approval expires after `policy.expiry_hours` and returns to the requester with an explanation. |
| `/account/approvals/[id]` | One approval in detail. | BUYER_APPROVER, BUYER_OWNER | Approve/reject; open the offer detail | Same + `order_line_unit` | — | Shows the serials that will be allocated, so an approver approves specific machines. |
| `/account/spend-limits` | Per-user and per-role spend controls. | BUYER_OWNER | Set per-order and monthly limits; set approval thresholds; set who approves what | `customer.approval_policy` | **Empty:** "No limits set — anyone with the Procurer role can order any amount." Stated plainly, because that is the risk. | Limits in ₹, per order and per calendar month. Changing a limit does not retro-affect pending approvals; the screen says so. |
| `/account/credit` | Credit application and current terms. | BUYER_FINANCE, BUYER_OWNER | Apply; upload financials; add trade references; view limit and utilisation | `customer.credit_application`, `trade_reference`, `payment.ledger_entry` | **States:** not-applied · draft · submitted · under-review (with SLA) · approved (limit, terms, utilisation bar) · rejected (specific reason) · suspended (reason + what to do). | Documents: audited financials (2 years), bank statement (6 months), 2 trade references, optional security deposit. Rejection reasons are specific and re-application rules stated. Utilisation shows available limit, not just used. |
| `/account/addresses` | Billing (per GSTIN) and delivery sites. | BUYER_ADMIN, BUYER_OWNER, BUYER_PROCURER (add delivery only) | Add; edit; set default; check serviceability; deactivate | `identity.org_address`, `identity.pincode` | **Empty:** guided add. **Error:** unserviceable pincode → names the pincode and offers the nearest serviceable one + a callback request. | Billing address is bound to a GSTIN and cannot be edited freely — a change requires a `profile_change_request` with proof. Delivery site requires contact name, mobile, landmark, gate/security instruction and receiving hours — the rider app shows these verbatim. |
| `/account/gstins` | Additional GST registrations. | BUYER_FINANCE, BUYER_OWNER | Add + verify; set primary; deactivate | `kyc.gst_profile`, `verification_check` | Verifying / verified / rejected states on the Input. | Each added GSTIN triggers a `verification_check`; PAN inside it must match the org PAN. A GSTIN that is cancelled or suspended at the portal cannot be made primary, and the reason is shown. |
| `/account/settings` | Profile, notifications, security, language. | All buyer roles (own profile) | Edit name/mobile/email (re-OTP); notification matrix; set/rotate password; enable TOTP MFA; view sessions; revoke a session; download my data; delete request | `identity.user`, `identity.session`, `org_preference`, `platform.data_subject_request` | — | Changing mobile or email requires OTP on the **new** value and notifies the old one. MFA enrolment shows recovery codes once, with a mandatory "I have saved these" confirmation. "Download my data" and "Delete my account" create DPDP data-subject requests with a stated 30-day response — never buried, never behind a chat widget. |

### 3A.6 Registration — 5 steps

Route pattern `/register/[step]`, server-persisted after every field blur into `kyc.registration_lead` + `kyc.onboarding_progress`. "Save and finish later" emails a resume link valid 30 days. Progress rail is the Stepper pattern in §1.9.4.

| Route | Step | Fields | Validation | States |
|---|---|---|---|---|
| `/register/account` | 1. Account | Full name, work email, mobile, password, email OTP, mobile OTP, how they heard, referral code | Name 2–80 chars. Email: valid, not a known free-mail domain → soft warning, not a block ("A work email keeps invoices with your company"). Mobile `^[6-9]\d{9}$`. Password ≥10 chars, checked against a breached-password list, no composition rules, paste allowed (3.3.8). Both OTPs required. | OTP: sending / sent / verifying / wrong (attempts left) / expired / locked 30 min after 5 failures. Resend cooldown 30 s, max 3/hour. Duplicate email → "This email is already registered" + sign-in link (acceptable enumeration for B2B; mobile does **not** enumerate). |
| `/register/company` | 2. Company | Legal name, trade name, constitution, industry, year established, employee band, website, annual laptop volume | Legal name required, must match the GST certificate later — the field says so. Constitution from the fixed list (Pvt Ltd / Public Ltd / LLP / Partnership / Proprietorship / Trust / Society / Govt). Year ≥1900 ≤ current. Website optional, URL-validated. | Volume band sets the default tier price band; the helper text says "Not a commitment — change it any time." |
| `/register/statutory` | 3. Statutory | GSTIN + verify, additional GSTINs, PAN + verify, primary GSTIN | GSTIN regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` + state code in the valid set + mod-36 checksum, then a live portal check for status = Active. PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, 4th char must match the constitution (C/P/H/F/A/T/B/L/J/G), and must equal GSTIN chars 3–12. | Verified state shows legal name, taxpayer type, state, registration date. Rejected states the actual failure: "No taxpayer found for this GSTIN. Check the last two characters." / "This GSTIN is cancelled with effect from 12 Jun 2025." / "The PAN inside this GSTIN is AAFFN8812K, which does not match the PAN you entered." |
| `/register/contacts` | 4. Contacts & addresses | Procurement / finance / IT contacts; billing address per GSTIN; delivery addresses with contact, mobile, landmark, gate instructions, receiving hours | At least one billing address per active GSTIN, state must equal the GSTIN's state code. At least one delivery address. Pincode must exist in `identity.pincode` and be serviceable (or flagged "we'll confirm within a day"). Receiving hours must be a valid range. | Address rows are AddressCards; serviceability resolves inline. |
| `/register/documents` | 5. Documents & preferences | GST certificate, PAN card, authorised-purchaser ID, optional PO template; notification channels, language, PO-required flag, preferred brands and grades | Each document: PDF/JPG/PNG, ≤10 MB, magic-byte validated, AV scanned, EXIF stripped. GST certificate must be the portal download — a photo of a printout is rejected with that reason. Consent checkboxes are **unticked by default** and each carries its consequence line. | Per-document accepted / rejected states with specific reasons. Terms + privacy acceptance recorded in `consent_record` with timestamp, IP, version hash. |
| `/register/credit` *(optional)* | Credit application | Turnover, financials, bank statement, references, security deposit | As §3A.5 `/account/credit`. | Can be started later; skipping it is a one-click "Pay before dispatch for now". |
| `/register/status` | Terminal states | — | — | **submitted:** "Automatic checks → a reviewer looks (only if needed) → approved, usually within an hour", with real per-stage state. **pending:** which check is outstanding and who to contact. **rejected:** the exact failing item(s), what to fix, and the re-apply rule (30 days, or immediately if the fix is a document). **blacklisted:** a neutral non-specific decline plus the grievance-officer contact — never the blacklist reason. |

### 3A.7 Authentication and recovery

| Route | Purpose | Roles | Actions | States / validation |
|---|---|---|---|---|
| `/login` | Choose OTP or password. | PUBLIC | Enter mobile or email | Rate limit 5/15 min/identifier + 20/hour/IP. Non-enumerating: "If that account exists, we've sent a code." |
| `/login/otp` | OTP sign-in. | PUBLIC | Enter 6 digits; resend; switch to password | OTPInput states as §2.1 #9. `autocomplete="one-time-code"`. |
| `/login/password` | Password sign-in. | PUBLIC | Password; remember this device (30 days, explicit, unticked) | Paste allowed. Reveal toggle. After 5 failures → OTP fallback offered rather than a lockout dead-end. |
| `/login/mfa` | TOTP challenge (mandatory for admin and vendor-owner; optional for buyers). | Any with MFA | 6-digit TOTP; use a recovery code | Clock-skew tolerance ±1 window. Recovery code consumes and warns how many remain. |
| `/forgot-password` · `/reset-password?token=` | Recovery. | PUBLIC | Request link; set new password | Token single-use, 30 min TTL, invalidated on use or on any password change. Success revokes all other sessions and says so. |
| `/register/resume?token=` | Resume an abandoned registration. | PUBLIC | Continue | 30-day token; lands on the exact step, with completed steps collapsed. |
| `/account/pending` | Signed in, account not yet approved. | Buyer, unapproved | View status; contact onboarding; edit submitted data | Browsing and search remain available; cart and checkout are blocked with an explanation of what is outstanding, not a generic "no access". |

### 3A.8 Legal and trust pages (public, SSR, indexed)

`/legal/terms` · `/legal/privacy` (DPDP notice: purposes, retention, consent manager, grievance) · `/legal/grievance` (grievance officer name, designation, email, phone, address, 48h acknowledgement, 1-month resolution — Rule 4(5)) · `/legal/returns-and-refunds` (the 48-hour inspection window, Rule 7(4) obligations stated as ours) · `/legal/warranty` · `/legal/grading` (the objective definition of A+/A/B against measurable QC outputs — this is the Rule 7(5) liability document) · `/legal/wipe-standard` · `/legal/shipping` · `/legal/cancellation` · `/legal/pricing-and-taxes` (including how the margin scheme affects ITC).

Each page carries a version number and a last-updated date. Changes to `/legal/grading`, `/legal/returns-and-refunds` and `/legal/terms` are versioned in `platform.config` and re-consented at next login for existing users.

---

## 3B. `apps/console` — vendor portal (`/vendor/**`)

One Next.js app, role-routed. A vendor session can never resolve an `/admin/**` route; the middleware returns the `permission` EmptyState. `data-density="compact"`. Left sidebar is `.on-navy`.

### 3B.1 Onboarding — 7 steps

Route pattern `/vendor/register/[step]`. Save-and-resume is mandatory: every field blur PATCHes `kyc.onboarding_progress`; the rail shows a live percentage and a **blocker banner** listing exactly what is stopping approval and which step it lives on ("Two items are blocking approval: a current address proof and the signatory's ID. Both are on step 6.").

| Route | Step | Fields | Validation | States |
|---|---|---|---|---|
| `/vendor/register/contact` | 1. Contact | Company name, contact person, mobile + OTP, email + OTP, city, monthly volume, brands dealt | Mobile `^[6-9]\d{9}$`, both OTPs verified. City from pincode master. | Same OTP state machine as buyers. |
| `/vendor/register/business` | 2. Business | Legal name, trade name, constitution, incorporation date, registered address, operating address, business category, website, staff count | Incorporation date ≤ today, ≥1900. Operating address may equal registered — a checkbox, not a re-type (Rule 01). | — |
| `/vendor/register/statutory` | 3. Statutory | GSTIN + verify, PAN + verify, CIN/LLPIN, Udyam, TAN | GSTIN and PAN as §3A.6. CIN 21 chars `^[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$`; LLPIN `^[A-Z]{3}-\d{4}$`; Udyam `^UDYAM-[A-Z]{2}-\d{2}-\d{7}$`; TAN `^[A-Z]{4}\d{5}[A-Z]$`. TAN is optional but its absence is recorded — it affects nothing on our side (we deduct, they don't). | Verified line shows the resolved legal name; a mismatch between the GST legal name and the entered legal name is a hard block with both values shown. Udyam verified → "MSME · we pay within 45 days" (a real obligation under the MSMED Act, so it changes the payout clock — say so). |
| `/vendor/register/capability` | 4. Capability | Categories, brands, monthly capacity, typical grade mix (A+/A/B %), price bands, sourcing channels, serials-upfront capability, in-house testing, in-house repair, lead time | Grade mix must total exactly 100% — live sum with an inline error. Capacity a positive integer. At least one category, at least one brand, at least one sourcing channel. | Sourcing channels carry consequences: "Auction purchases → purchase documents become compulsory for every batch above ₹5 lakh"; "Imports → bill of entry required, adds a customs check". The serials-upfront checkbox carries its penalty consequence. Provenance note explains it decides margin-scheme eligibility. |
| `/vendor/register/facility` | 5. Facility & contacts | Per warehouse: address, type, capacity, loading dock, vehicle access, lift, testing stations, hours per day, holidays. Owner / ops / finance / warehouse contacts with WhatsApp + language | At least one facility with a serviceable pincode. Hours: open < close, at least 3 working days. Four contact roles required; mobiles must be distinct from each other where the person differs. | Facility hours drive QC visit scheduling and pickup windows — the screen states that a closed day cannot be booked. |
| `/vendor/register/documents` | 6. Documents & bank | GST certificate, PAN, cancelled cheque, address proof, incorporation doc, signatory ID, board resolution, optional CPCB/ISO; bank account + penny-drop | Documents as §3A.6 rules. Address proof must be dated within 3 months — the rejection says so explicitly. Board resolution required only for Pvt Ltd / Public Ltd / LLP. IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`. Account number 9–18 digits, entered twice (no paste on the confirm field). | Penny-drop: pending → "We're sending ₹1 to confirm the name your bank holds" → verified (shows the bank's name string and whether it matches the legal name) → mismatch (blocks payouts, states both names). Only a verified account can receive payouts, said before the money matters. |
| `/vendor/register/agreement` | 7. Agreement & payout | Vendor agreement, grading & inspection policy, data-wipe undertaking, ownership declaration (Aadhaar e-Sign); payout cycle, threshold, notification preferences | All four must be e-signed. Each is readable in full in a DocumentViewer before signing; the "I have read" checkbox is unticked and enabled only after the document has been scrolled or opened. | e-Sign states: not started / OTP sent / signed / failed (with the NSDL/eMudhra reason). Signed PDFs land in `kyc.agreement_acceptance` with the signature hash. |
| `/vendor/register/status` | Terminal | — | — | **submitted** (48h SLA, with elapsed time) · **more-info-needed** (exactly which items, deep-linked to the step) · **approved** (what unlocks) · **rejected** (the specific failed item, from the common-reasons list, plus the 30-day re-apply rule) · **blacklisted** (neutral decline + grievance route). |

### 3B.2 Selling — listings and QC

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/vendor` | Dashboard: what needs the vendor today. | All vendor roles | Jump to blockers | `listing`, `qc.qc_visit`, `procurement.purchase_order`, `vendor_payable`, `scorecard` | **First-run:** a 3-step "List your first stock" guide, not an empty grid. **Loading:** KPI skeletons that keep the box. | Tiles: units live · units awaiting QC · QC expiring ≤14 d · POs to fulfil today · payout due · open penalties · scorecard + tier. Every tile is a link to a filtered board. No vanity metrics. |
| `/vendor/listings` | Manage stock. | VENDOR_OPS, ADMIN, OWNER | Filter; reprice; pause; add units; request QC; export | `listing.listing`, `unit`, `listing_tier_price`, `qc` | **First-run:** create CTA. **Filtered-empty:** clear. **Error:** retry. | Columns: SKU, declared grade, actual grade (post-QC), units total / sellable / reserved / sold, expected payout, retail price (**read-only, informational**), QC status, QC expiry. Vendor sees the retail price we set — they are our supplier, not an anonymous party — but never another vendor's price. |
| `/vendor/listings/new` | Listing wizard, 4 steps. | VENDOR_OPS+ | Step 1 catalog pick → 2 condition declaration → 3 serial entry → 4 expected payout price → submit for QC | `catalog.sku`, `catalog.condition_image`, `procurement.price_book`, `listing` | **Step 1 empty:** "No SKU matches this configuration" → Request a SKU. **Loading:** price guidance skeleton. **Error:** draft persisted per step. | **Step 1:** search the master catalog by model/spec; the vendor cannot free-text a title. Shows the platform's condition images for each grade so the declaration is anchored to pictures, not adjectives. **Step 2:** declare grade per unit or per batch, battery health band, accessories, known defects; the screen states the declaration will be checked and that a mismatch has consequences. **Step 3:** serials — typed, pasted or CSV; validated live (format, duplicates in file, duplicates against `listing.unit` globally, blacklisted/stolen-serial check). **Step 4:** expected **net payout** price per unit; we show the current price band and, live, what the buyer-facing retail price would be and what the vendor nets after TDS — no surprises later. Submitting does **not** publish: it creates a QC visit request, and the screen says exactly that. |
| `/vendor/listings/bulk-upload` | CSV of many units. | VENDOR_OPS+ | Download template; upload; map columns; review errors; commit | `catalog.sku`, `listing.unit` | **Loading:** row-by-row progress. **Error:** a per-row error table, downloadable as a corrected-CSV starter. | Max 5,000 rows / 10 MB. Validation per row: SKU code resolvable, serial format + global uniqueness, grade in {A_PLUS,A,B}, battery 0–100, payout price > 0 and within guardrail. Partial commit is allowed and is stated up front: "412 of 440 rows will be imported. 28 rows have errors and will not." |
| `/vendor/listings/[id]` · `/units` | One listing, and every serial under it. | VENDOR_OPS+ | Add/remove units; view per-unit QC; withdraw a unit | `listing`, `unit`, `qc_report`, `qc_seal` | Loading/empty/error standard. | A unit that is RESERVED or SOLD cannot be removed; the row says which order holds it. A sealed unit cannot be edited — opening it requires the "Request to open a sealed unit" action, which voids the seal and removes the unit from sale. |
| `/vendor/listings/[id]/reprice` | Change the expected payout. | VENDOR_OPS, VENDOR_ADMIN, OWNER | Set new payout; preview effect; submit | `price_book`, `margin_rule`, price history | **Blocked:** units already reserved keep the old price; the screen names them. | Live preview of the resulting retail price and net payout after TDS. Outside the guardrail band → routed to admin approval with the reason shown, not silently rejected. Price history chart. |
| `/vendor/qc/requests` | QC visits the vendor has asked for. | VENDOR_OPS+ | Request a visit; cancel; add units to a pending request | `qc.qc_visit`, `visit_unit` | **Empty:** "No inspections requested" + which listings are waiting. | A request needs: facility, unit count, preferred date window (within facility hours), and a contact who will be present. Minimum lot size and lead time come from `platform.config`, and are shown before the request, not after. |
| `/vendor/qc/visits` · `/vendor/qc/visits/[id]` | Scheduling and confirmation. | VENDOR_OPS+ | Confirm a proposed slot; propose an alternative; prepare the manifest; download the pre-visit checklist | `qc.qc_visit`, `technician` (pseudonymous), `facility_hours` | **States:** requested · slot proposed (with an accept-by deadline) · confirmed · technician en route · in progress (live unit counter) · completed · cancelled (with reason) · no-show (either side, with the consequence). | The technician is identified as `TECH-0142`, not by name, until arrival. A confirmed slot inside a facility holiday is impossible — the calendar disables it. Cancelling inside the notice window triggers a visit fee, and the fee is stated on the cancel confirmation before it is charged. |
| `/vendor/qc/visits/[id]/results` | Pass/fail per unit for a completed visit. | VENDOR_OPS+ | Open a unit report; accept results; respond to a correction; withdraw failed units | `qc_report`, `qc_area_result`, `hardware_detected`, `qc_photo`, `qc_seal`, `grade_correction` | **Loading:** per-unit skeleton. **Empty:** never. **Error:** report photos behind signed URLs, auto-refetch once. | Summary of the classic outcome shape — passed as declared / passed at a lower grade / failed. Every failed unit states the measured reason ("Battery health 71%, below the 80% floor for grade A"), never "failed inspection". Failed units are never listed and the screen says they are returning to the vendor's own stock. |
| `/vendor/qc/corrections/[id]` | Respond to a grade correction. | VENDOR_OPS, VENDOR_ADMIN, OWNER | **Accept** (list at the corrected grade, same payout) · **Accept and reprice** (list at corrected grade, new payout) · **Withdraw** (unit returns, no listing) · **Dispute** (with evidence, goes to an audit recheck) | `grade_correction`, `qc_report`, `qc_photo` | **Loading/Error:** standard. **Blocked:** response window elapsed → the default outcome (auto-withdraw) is applied and explained. | Side-by-side: declared grade vs actual grade, with the specific area scores and the photographs that produced the difference. Each of the four responses shows its money and score consequence **before** the click: the new net payout, and whether it affects grade-accuracy score. Dispute requires a written reason ≥40 chars and at least one piece of evidence; it opens an audit recheck by a second technician. Response window (default 48 h) is a countdown, stated as information. |
| `/vendor/qc/expiring` | QC expiry management — the 14-day and 90-day clocks. | VENDOR_OPS+ | Request a re-inspection; pause a listing; bulk-select | `qc_report.valid_until`, `listing.unit` | **Empty (success-terminal):** "Nothing expiring in the next 30 days." | Reports are valid 90 days. At **T−14 days** the listing shows a warn chip to buyers and a banner here. At **T−0** units become non-sellable automatically, and the screen states that this already happened rather than warning about it in future tense. Batch re-inspection request from a multi-select. |

### 3B.3 Fulfilment — POs, handover, invoicing

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/vendor/orders` | Purchase orders **we** raised to the vendor. | VENDOR_OPS+, VENDOR_FINANCE (read) | Filter by status/date; accept; open handover | `procurement.purchase_order`, `po_line` | **Empty:** "No purchase orders yet" + what triggers one (a buyer order against your live stock). **Filtered-empty:** clear. | These are POs, not "orders from customers" — the vendor's counterparty is us. The buyer's identity, delivery address and retail price are **not** on the vendor's PO view; the ship-to is rendered as the delivery city + a task reference, with the full address released to the packing list and the carrier only. |
| `/vendor/orders/[poId]` | One PO. | VENDOR_OPS+ | Accept / flag a problem; view the exact serials; open handover; open packing list | `purchase_order`, `po_line`, `order_line_unit` (serials), `qc_seal` | **Loading:** header real, lines skeleton. | Lines name **specific serials and seal codes**, because those units were allocated at order confirmation. Acceptance deadline shown with the penalty for missing it, stated before acceptance. |
| `/vendor/orders/[poId]/handover` | "Produce these sealed machines." | VENDOR_OPS+ | Tick each serial as produced; report a problem per unit; confirm ready; sign the rider's OTP | `order_line_unit`, `qc_seal`, `logistics.pickup_task` | **Error per unit:** seal broken → the unit is excluded immediately and a replacement is requested from the same listing; if none remain, the line reduces and the buyer is notified — the screen states both consequences. | Big list, one row per serial, 44px+ targets (used on a warehouse floor, often on a tablet). Per-unit outcomes: produced · seal broken · cannot find · already sold elsewhere (a serious event → penalty + score). Handover cannot be confirmed until every line is resolved. OTP from the rider closes custody. |
| `/vendor/orders/[poId]/packing-list` | Printable list for the box. | VENDOR_OPS+ | Print; download PDF | `po_line`, `order_line_unit`, `logistics.shipment` | — | Contains serials, seal codes, SKU, quantity, PO number, our shipment reference, and the ship-to **address** (released at this point because the goods must physically travel). **Contains no price** — Bill-To-Ship-To under s.10(1)(b) means the vendor's invoice value never travels with the goods, and neither does ours. |
| `/vendor/invoices` · `/vendor/invoices/new` | Invoice-1: vendor → platform. | VENDOR_FINANCE, VENDOR_ADMIN, OWNER | Upload/generate against a PO; submit; correct a rejected invoice | `procurement.vendor_invoice`, `purchase_order`, `goods_receipt` | **Empty:** "No invoices raised" + eligible POs listed. **Error:** three-way-match failure → shows exactly which of value / quantity / serials mismatched, with both numbers. | Invoice must reference exactly one PO. Value must equal the PO value ± a configured tolerance (default ₹0). Quantity and serials must match the goods receipt. Invoice number unique per vendor per FY, format free but validated against duplicates. GST fields required for REGULAR-channel vendors; MARGIN-channel (unregistered) vendors get a different form with no GST fields at all and a declaration instead. |

### 3B.4 Money and standing

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/vendor/payables` | What we owe, and when it becomes payable. | VENDOR_FINANCE, OWNER | Filter; open a PO; open a payout | `procurement.vendor_payable`, `purchase_order`, `platform.return_request` | **Empty:** "Nothing payable yet" + the rule that makes something payable. | Every row shows the payable date and the reason it is not yet payable ("Delivered 14 Aug · inspection window closes 16 Aug 18:30"). Money is paid after delivery **and** after the inspection window closes — that rule is visible on every row, not in a help article. |
| `/vendor/payouts` · `/vendor/payouts/[id]` | Payout runs and statements. | VENDOR_FINANCE, OWNER | Download statement PDF/CSV; download the TDS certificate reference; raise a query | `procurement.payout_run`, `payout`, `payment.ledger_entry`, `penalty` | **Empty:** first-run. **Loading:** statement skeleton. **Error:** retry. | The statement renders the **full deduction stack, every line, always**: `Gross (sum of PO values) → less TDS u/s 393(1) Sl.8(ii) @0.1% on value excluding GST (or 5% if no PAN) → less penalties (each itemised with its cause and date) → less adjustments/credit notes → Net payable`. Section code 1031, Form 26Q, deducted at credit or payment whichever is earlier, computed on value **excluding GST** — the statement states each of these on the TDS line. A ₹0 deduction line is still shown, with "below the ₹50 lakh threshold for this financial year" as the reason. |
| `/vendor/ledger` | Every money movement. | VENDOR_FINANCE, OWNER | Filter by type/date; export; open the source document | `payment.ledger_entry` | Empty/filtered-empty standard. | Running balance, debit/credit pairs, each linked to its source (PO, invoice, payout, penalty, credit note). Read-only. Export is audit-logged. |
| `/vendor/penalties` | Penalties charged, and why. | VENDOR_FINANCE, OPS, OWNER | View evidence; dispute within 7 days | `payment.penalty`, `platform.dispute` | **Empty (success-terminal):** "No penalties." | Each penalty states the rule, the event, the evidence, the amount, the calculation, and which payout it was or will be deducted from. Disputable within 7 days with a reason; a disputed penalty is held, not collected, and the row says so. |
| `/vendor/scorecard` | Tier and the numbers that set it. | All vendor roles | View trend; open the definition of each metric | `platform.vendor_scorecard` | **Empty:** "Not enough history yet — your first score appears after 20 inspected units." | Metrics with weights shown: grade accuracy (heaviest after fulfilment), QC first-pass rate, handover on-time, serial-accuracy, seal integrity, return rate attributable to the vendor, response time on corrections. Each metric links to the underlying events. Tier drives payout speed, sampling rate and direct-dispatch eligibility — each consequence is stated next to the tier. **The scorecard is never exposed to buyers** (D1). |
| `/vendor/documents` | Document vault and renewals. | VENDOR_ADMIN, OWNER, FINANCE | Re-upload; view rejection reasons; see expiry | `kyc.kyc_document`, `vendor_certification` | **Empty:** never (onboarding populates it). | Expiring-in-30-days and expired chips. An expired mandatory document suspends new listings — stated on the row, with the date it will happen, before it happens. |
| `/vendor/facilities` | Warehouses, hours, holidays, access. | VENDOR_ADMIN, OPS, OWNER | Add/edit facility; edit hours; add holidays; mark temporarily closed | `vendor.vendor_facility`, `facility_hours`, `facility_holiday` | — | Changing hours or adding a holiday that collides with a confirmed QC visit or pickup is blocked, naming the visit and offering to reschedule. |
| `/vendor/team` | Users and roles. | VENDOR_OWNER, VENDOR_ADMIN | Invite; assign role; deactivate; enforce MFA | `identity.user`, `role` | Empty: owner only. | `VENDOR_OWNER` MFA is mandatory and cannot be disabled. Last-owner protection as §3A.5. |
| `/vendor/settings` | Payout preferences, bank account, notifications, security, language. | VENDOR_OWNER, FINANCE | Change payout cycle/threshold; change bank account; notifications; MFA; sessions | `vendor_payout_preference`, `bank_account`, `org_preference` | — | A bank-account change triggers penny-drop re-verification, a **24-hour freeze on payouts**, and an alert to the owner and to admin. All three consequences are stated on the form before submission, not after. |

---

## 3C. `apps/console` — admin portal (`/admin/**`)

`data-density="compact"`. CommandPalette (⌘K) is the primary navigation for experienced ops staff; the sidebar is the discoverable fallback. Every mutating action writes `identity.audit_log` with actor, before/after and reason. Destructive actions require a typed confirmation of the entity identifier.

### 3C.1 Operations overview and onboarding

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin` | Ops dashboard — the day's exceptions, not vanity metrics. | ADMIN_OPS, ADMIN_SUPER (others see their slice) | Jump to any queue | Aggregates across `kyc`, `qc`, `ordering`, `procurement`, `payment`, `logistics`, `platform` | **Loading:** KPI skeletons holding their box. **Empty per tile:** "0" is only shown where 0 is meaningful (0 breached SLAs); otherwise "No data in this period". **Error per tile.** | Tiles: onboarding applications breaching the 48h SLA · QC visits today / unstaffed · units failing QC above the divergence threshold · orders unallocated · POs unaccepted · shipments with a failed attempt (NDR) · returns in the inspection window · payouts pending approval · unmatched payments · tickets breaching SLA · **partition runway days remaining** (schema gap #1 — this is an operational risk, so it is on the ops dashboard, not hidden in a runbook). |
| `/admin/onboarding` | Review queue for buyer and vendor applications. | ADMIN_KYC, ADMIN_OPS, ADMIN_SUPER | Claim; open; approve; reject; request more info; blacklist | `kyc.registration_lead`, `onboarding_progress`, `kyc_document`, `verification_check` | **Empty (success-terminal):** "Queue clear." **Filtered-empty:** clear filters. **Loading:** row skeletons. | Sorted by SLA risk first, not FIFO. **48h SLA** shown per row as time remaining, turning warn at 12h and bad at 0 with the elapsed overrun. Claiming locks the application to a reviewer for 30 min (a Redis lock) so two reviewers never double-decide; the lock holder's name is visible. |
| `/admin/onboarding/[id]` | The review surface: documents beside the extracted data. | ADMIN_KYC+ | Approve / reject each document; approve / reject the application; request specific items; add an internal note | `registration_lead`, all `kyc` tables, `verification_check` results, blacklist match | **Loading:** viewer skeleton. **Error:** a failed external verification shows the provider's error and a Retry, and never blocks the human decision. | Split view: DocumentViewer left, the corresponding form data right, with automatic field-vs-document mismatches highlighted (legal name on the GST certificate vs the typed legal name; PAN in the GSTIN vs the entered PAN; account name from penny-drop vs legal name). Rejecting a document **requires** choosing a reason from a controlled list and adds a free-text specific: the buyer/vendor sees exactly that text (§5.2). Approving requires every mandatory document accepted and every automated check green or explicitly overridden with a written justification. |
| `/admin/onboarding/kyc-checks` | Automated verification runs and their failures. | ADMIN_KYC, ADMIN_SUPER | Re-run; view raw provider response; override with justification | `kyc.verification_check`, `platform.integration_log` | **Empty:** "No checks in this period". **Error:** provider outage banner across the queue with the affected check types named. | Check types: GSTIN status, PAN validity, PAN↔GSTIN linkage, bank penny-drop, CIN/LLPIN, Udyam, blacklist, director/PAN match. Every override is audit-logged with the justification and shown on the application forever. |
| `/admin/blacklist` | Blocked entities. | ADMIN_SUPER, ADMIN_KYC | Add (PAN / GSTIN / mobile / email / bank account / director PAN / serial); remove with justification; search | `kyc.blacklist` | **Empty:** "No blocked entities". | Adding requires a reason and a source reference. A blacklist match on registration produces a **neutral decline** to the applicant — the reason is never disclosed externally (§3B.1). Removals require ADMIN_SUPER and a second-person approval. |

### 3C.2 Catalog, condition images, pricing

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin/catalog` | Brand → series → model → SKU tree. | ADMIN_CATALOG, ADMIN_SUPER | Create/edit at any level; merge duplicates; deprecate; bulk import | `catalog.brand/series/model/sku`, `change_log` | **Empty:** guided first-brand creation. **Filtered-empty:** clear. | SKU code is generated and immutable. Deprecating a SKU with live listings is blocked and names them. Every edit writes `catalog.change_log` with before/after — the catalog is the basis of every listing claim, so its history is evidence. |
| `/admin/catalog/skus/[id]` | One SKU: full spec, images, listings, price history. | ADMIN_CATALOG, ADMIN_PRICING (price tab) | Edit spec; attach condition images; set price band; view live listings | `catalog.sku`, `condition_image`, `listing`, `price_book` | Loading/error standard. | Spec fields are typed (CPU family, generation, cores, RAM GB, storage GB + type, display size + panel + resolution, GPU, ports, weight, OS, keyboard layout). Changing a spec on a SKU with live listings requires a justification and notifies the affected vendors — the listing's claims change with it. |
| **`/admin/catalog/condition-images`** | **The condition-image library.** The platform owns every image a buyer sees; vendors upload none. | ADMIN_CATALOG, ADMIN_SUPER | Upload; tag; set the canonical set per (SKU-family × grade × condition aspect); reorder; retire; preview as a buyer | `catalog.condition_image` | **Empty per slot:** "No image for {family} · Grade B · lid scuffing — buyers see the generic Grade B set until one is added." **Loading:** thumbnail grid skeleton. **Error:** upload failure per file. | This is a **liability control**, not asset management. Rules: every image is captioned "Representative image — Grade {X}. The photographs of your specific machine are in its unit passport."; each grade must have a complete set before that grade can be published for a SKU family; a Grade B set must include an image of the worst permissible defect for that grade; images are versioned and retired, never overwritten, so we can prove what a buyer saw on a given date. Metadata per image: SKU family, grade, aspect (lid / palmrest / display / ports / hinge / base / keyboard), defect type, severity, shot angle, capture date, photographer, licence. EXIF stripped, WebP + AVIF derivatives, alt text mandatory and descriptive ("Grade B lid with fine scratches concentrated near the hinge"). Preview-as-buyer renders the actual PDP gallery. |
| `/admin/catalog/sku-requests` | Vendor requests for a SKU that does not exist. | ADMIN_CATALOG | Approve (creates the SKU) · merge into an existing SKU · reject with reason | `catalog.sku_request` | **Empty (success-terminal):** "No pending requests." | Shows the requesting vendor's proposed spec beside the closest existing SKUs with a similarity score, because most requests are duplicates. Approval creates the SKU and unblocks the vendor's draft listing automatically; the vendor is told. |
| `/admin/listings` | Listing approval and guardrails. | ADMIN_PRICING, ADMIN_OPS, ADMIN_SUPER | Approve; reject; hold; override a price guardrail; bulk approve | `listing.listing`, `unit`, `price_history`, `procurement.margin_rule`, `price_book` | **Empty (success-terminal):** "Nothing awaiting approval." **Bulk error:** partial results with a per-row outcome. | A listing reaches this queue only after QC passes. Guardrail breach types: payout above the band ceiling, payout below the floor (a stolen-goods and under-declaration signal), a resulting retail price outside the market band, an unusual price change velocity. An override requires a written justification, is capped per role, and is visible on the listing forever. Bulk approve names the count and states that approved listings go live immediately. |
| `/admin/pricing/rules` | Margin rules and price books. | ADMIN_PRICING, ADMIN_SUPER | Create/edit a margin rule; set price bands; schedule an effective date; simulate | `procurement.margin_rule`, `price_book` | **Empty:** "No rules — the platform default margin applies." | A rule is `(scope: brand / series / SKU / grade / valuation_method / vendor tier) → (margin %, floor ₹, ceiling ₹, freight policy, effective_from, effective_to)`. **Overlapping effective ranges on the same scope must be rejected** (mirrors the `listing_tier_price` exclusion constraint the schema already has, which `carrier_rate_card` is missing — gap #7). A simulator shows the retail-price change across the affected live listings before saving, with the count of listings whose price would move by more than 5%. Scheduled changes never apply retroactively to a reserved unit. |
| `/admin/pricing/history` | Who changed what price, when, and why. | ADMIN_PRICING, ADMIN_AUDIT | Filter; export | `listing.price_history`, `audit_log` | Filtered-empty standard. | Read-only. Every row carries the actor and the justification. |

### 3C.3 QC console

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin/qc` | QC control room: today's visits, live progress, exceptions. | ADMIN_QC, ADMIN_OPS | Jump to a visit; reassign; escalate | `qc.qc_visit`, `visit_unit`, `technician` | Loading skeletons; empty "No visits scheduled today". | Live counters per visit: units done / total, pass rate, elapsed vs planned. A visit stalled >45 min with no sync raises an exception row. |
| `/admin/qc/visits` · `/admin/qc/visits/[id]` | Every visit, its units, its results. | ADMIN_QC, ADMIN_OPS | Schedule; assign a technician + tool seat; reschedule; cancel with reason; close; reopen with justification | `qc_visit`, `visit_unit`, `qc_report`, `technician_availability`, `vendor_facility`, `facility_hours` | **Empty-filtered:** clear. **Error:** offline technician → last sync time shown, never a fabricated status. | Scheduling is blocked outside facility hours and on facility holidays. Assignment checks technician availability, tool-seat licence availability, and travel feasibility between consecutive stops (max 3 stops/day). Cancelling inside the notice window charges the vendor a visit fee — confirm modal states the amount and who bears it. |
| `/admin/qc/technicians` · `/[id]` | The people who do the inspecting. | ADMIN_QC, ADMIN_SUPER | Add; set skills, home base, service radius; activate/suspend; view performance | `qc.technician`, `qc_report` aggregates | Empty first-run. | Performance metrics: units/day, average time per unit, divergence vs audit recheck, photo-completeness rate, seal-reconciliation accuracy. A technician above the divergence threshold is auto-flagged for audit rechecks and cannot be un-flagged without ADMIN_SUPER. |
| `/admin/qc/availability` | Capacity calendar. | ADMIN_QC | Set shifts; block leave; view utilisation; publish a week | `technician_availability` | Empty: "No availability published for next week" with the publish deadline. | Publishing a week locks it; changes after publication notify affected vendors whose visits move. |
| `/admin/qc/tool-runs` | Ingested runs from the QC .exe. | ADMIN_QC, ADMIN_SUPER | Inspect a raw report; re-ingest; quarantine | `qc.tool_run`, `qc_report`, `hardware_detected`, `platform.integration_log` | **Error:** signature verification failure is a first-class state, quarantined and alarmed. | Ingestion contract: signed JSON, schema-versioned. Rejection reasons surfaced individually — bad signature · unknown tool version · serial not on the visit manifest · duplicate run for the same serial · clock skew beyond tolerance. A quarantined run never updates a unit's grade. |
| `/admin/qc/seals` | Seal roll register and reconciliation. | ADMIN_QC, ADMIN_OPS | Issue a roll to a technician; reconcile end-of-day; void; link a replacement; investigate a gap | `qc.qc_seal` | **Empty:** "No rolls issued." **Error:** unreconciled gap is an alert row, not a silent count. | Every seal number issued must end in one of: applied · voided-with-replacement · returned unused · reported damaged. An unexplained gap blocks the technician's next roll issue and raises an incident. Seal status set is CHECK-constrained: `ISSUED, APPLIED, INTACT, BROKEN, VOIDED, REPLACED, RETURNED`. |
| `/admin/qc/sampling-rules` | How much of a vendor's stock gets audit-rechecked. | ADMIN_QC, ADMIN_SUPER | Create/edit a rule; schedule; simulate load | `qc.qc_sampling_rule` | Empty: "No rules — the default 10% applies." | Rule = `(vendor_tier, effective_from) → sample %`. **`(vendor_tier, effective_from)` must be unique** (schema gap #8) — the form rejects a duplicate with both rows shown. A rule change previews the technician-hours it will consume next week. |
| `/admin/qc/audits` | Audit rechecks — a second technician re-inspects a sampled unit. | ADMIN_QC | Order a recheck; record the outcome; close a divergence | `qc.audit_recheck`, `qc_report` | Empty (success-terminal). | Recheck results are compared area-by-area against the original. A grade divergence opens a divergence case automatically. |
| `/admin/qc/divergence` | Where our own inspections disagree with each other, or with vendor declarations. | ADMIN_QC, ADMIN_SUPER, ADMIN_AUDIT | Filter by technician / vendor / SKU / area; open the case; retrain flag; suspend a technician; penalise a vendor | `qc.qc_mismatch`, `audit_recheck`, `vendor_scorecard` | **Empty (success-terminal):** "No open divergences." | Heatmap of divergence by technician × week and by vendor × week. A vendor divergence drives grade-accuracy score and penalties; a technician divergence drives retraining and sampling rate. **The two are never conflated** — the screen separates "the vendor declared wrongly" from "our technicians disagree with each other", because only the first is a vendor penalty and only the second is our own quality problem. This distinction is the Rule 7(5) defence. |
| `/admin/qc/wipe-certificates` | Data-wipe evidence. | ADMIN_QC, ADMIN_SUPER | View; re-issue; export for an enterprise buyer | `qc.wipe_certificate` | Empty: none in range. | Certificate names the standard applied, the tool, the pass count, the serial and the technician. Buyers whose org set the "wipe certificate required" flag get it attached to every unit automatically. |

### 3C.4 Orders, procurement, money

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin/orders` | Order board. | ADMIN_OPS, ADMIN_SUPPORT (read + notes) | Filter/search; open; cancel with reason; reallocate a unit; force-progress a stuck state | `ordering.order`, `sub_order`, `order_line`, `order_line_unit`, `order_event` | **Empty-filtered:** clear. **Loading:** virtualised skeleton rows. | Search by order no, PO no, serial, seal code, GSTIN, buyer name, mobile. Cancelling releases units back to sellable inside one transaction and reverses the PO — the confirm modal names every downstream effect (PO cancelled, payment refunded, e-way bill cancelled if generated). |
| `/admin/orders/[id]` | One order end-to-end. | ADMIN_OPS | Everything above, plus: replace a unit, split a sub-order, add an internal note, resend documents | Same + `payment`, `logistics`, `procurement` | Per-panel loading/error. | Full timeline with actor on every event. Shows both sides: the buyer's invoice (Invoice-2) and the vendor PO/invoice (Invoice-1) with the margin — this is the only place the two ever sit on one screen, and it is ADMIN-only. |
| `/admin/procurement/pos` | Purchase orders raised to vendors. | ADMIN_OPS, ADMIN_FINANCE | Filter; open; cancel; re-raise; chase acceptance | `procurement.purchase_order`, `po_line` | Empty-filtered standard. | A PO is created inside the order-confirmation transaction and is never created by hand except by ADMIN_SUPER with a justification. |
| `/admin/procurement/vendor-invoices` | Invoice-1 intake. | ADMIN_FINANCE | Approve; reject with reason; request a correction | `procurement.vendor_invoice`, `goods_receipt` | **Error:** OCR/parse failure falls back to manual entry, never to a blocked queue. | Duplicate invoice-number detection per vendor per FY. GST validity check for REGULAR vendors. MARGIN-channel invoices are visually distinct and are **blocked from the ITC ledger** — the screen states it. |
| `/admin/procurement/three-way-match` | PO × goods receipt × vendor invoice. | ADMIN_FINANCE | Match; resolve a variance; approve for payment; escalate | `purchase_order`, `goods_receipt`, `vendor_invoice` | **Empty (success-terminal):** "All matched." **Error:** partial match with the exact differing field. | Match on quantity, value and **serials**. A variance shows both values side by side and requires a resolution reason before it can be forced. Only a matched (or explicitly resolved) invoice becomes payable. |
| `/admin/payments` | Customer payments and their state. | ADMIN_FINANCE | Search; refund; retry; mark manual; view gateway payload | `payment.payment`, `refund`, Razorpay webhooks, `platform.integration_log` | **Error:** webhook gaps are a visible state ("Last webhook received 14 min ago"), never silence. | Payment status set is CHECK-constrained (gap #5). Refunds require a linked reason (return / cancellation / overpayment / goodwill) and an approver above a threshold. |
| `/admin/payments/reconciliation` | Bank statement vs virtual accounts vs orders. | ADMIN_FINANCE | Import a statement; auto-match; manual-match; write off with approval; export | `payment.payment`, `settlement`, `ledger_entry` | **Empty:** "Nothing unmatched." **Error:** import parse failure names the row and column. | Auto-match on the virtual-account reference and UTR. Unmatched credits age with a warn at 3 days and bad at 7. TPV violations (a transfer from an account other than the org's registered one) are their own queue with a "return to remitter" action. |
| `/admin/payouts` · `/admin/payouts/runs/[id]` | Vendor payout runs. | ADMIN_FINANCE, ADMIN_SUPER (approve) | Create a run; preview; approve; execute; retry a failed line; download the bank file | `procurement.payout_run`, `vendor_payable`, `payment.ledger_entry`, `penalty` | **Preview loading:** computed server-side, shown as a full statement per vendor before approval. **Error:** a failed bank line is isolated; the rest of the run stands. | The preview shows the whole deduction stack per vendor (§3B.4) and a **run-level assertion that the ledger entries sum to zero**. If the assertion fails the run cannot be approved and the failing pair is named. Approval is two-person above a configured amount. Execution is idempotent on the run ID. Eligibility: delivered **and** inspection window closed **and** three-way match complete **and** bank account verified **and** no unresolved dispute on the PO. Each ineligible payable shows which of those five it fails. |
| `/admin/payments/invoices` | Invoice-2 register (platform → customer). | ADMIN_FINANCE | Search; regenerate; issue a credit note; export for GSTR-1 | `payment.invoice`, `invoice_line`, `credit_note` | Empty-filtered standard. | Invoice numbering is sequential per GSTIN per FY with no gaps — a gap is an alarm, not a warning. MARGIN invoices carry the Rule 32(5) narration; the register can be filtered by `valuation_method` and the two channels are never mixed on one document. |
| `/admin/payments/eway-bills` | E-way bill generation and cancellation. | ADMIN_LOGISTICS, ADMIN_FINANCE | Generate; cancel (<24h); extend validity; view Part-B | `payment.eway_bill`, `logistics.shipment` | **Error:** NIC portal downtime is a named state with a retry queue and the queue depth. | **One e-way bill, Case 2**: Bill-From = platform, Dispatch-From = vendor address, Bill-To = buyer, Ship-To = buyer site. The form makes Dispatch-From non-editable and explains why. Cancellation window and Part-B update rules enforced in the UI with the actual deadline. |
| `/admin/payments/tds` | TDS deducted, per vendor per FY. | ADMIN_FINANCE | View accruals; export Form 26Q data; mark a certificate issued | `payment.ledger_entry`, `procurement.purchase_order` | Empty: "No deductions this quarter." | Shows the ₹50 lakh per-vendor-per-year threshold progress per vendor, the applicable rate (0.1%, or 5% without PAN), and the earlier-of-credit-or-payment trigger date. Section code 1031. **s.206C(1H) and s.206AB/206CCA do not exist in this UI** — they are omitted from 1 Apr 2025 and must not be built. |

### 3C.5 Logistics

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin/logistics` | Shipment board. | ADMIN_LOGISTICS, ADMIN_OPS | Filter; open; re-route; force a carrier; cancel | `logistics.shipment`, `shipment_unit`, `shipment_tracking` | Empty-filtered standard; carrier-API error shown per shipment, not as a page failure. | Search by AWB, order no, serial, seal code. |
| `/admin/logistics/routing-rules` | Direct vs hub, and which carrier. | ADMIN_LOGISTICS, ADMIN_SUPER | Create/edit; order by priority; simulate against last week's shipments | `logistics.routing_rule`, `carrier` | Empty: "No rules — everything routes through the hub." | A rule is `(origin zone, destination zone, weight band, value band, vendor tier, unit count) → (mode: DIRECT|HUB, carrier)`. **`carrier_code` must be a real carrier FK, not free text** (schema gap #6) — the field is a Select over `carrier`, never an input. New and watchlist vendors force HUB regardless of other rules; the UI shows that override and its reason. Simulation reports the cost and SLA delta before saving. |
| `/admin/logistics/rate-cards` | Carrier pricing. | ADMIN_LOGISTICS, ADMIN_FINANCE | Create; version; set effective dates; upload a slab CSV | `logistics.carrier_rate_card` | Empty per carrier. | **Overlapping effective ranges for the same (carrier, zone-pair, weight slab) are rejected** (schema gap #7) — the form shows the conflicting existing row. Freight quoted to buyers comes from here; a missing rate is an explicit "freight unavailable", never a guess (§3A.1 offers grid). |
| `/admin/logistics/carriers` | Carrier adapters and their health. | ADMIN_LOGISTICS, ADMIN_SUPER | Enable/disable; set credentials; test connection; view the integration log | `logistics.carrier`, `platform.integration_log` | **Error:** a failing adapter shows the last 20 calls with status codes. | Adapters: Delhivery (anchor), Blue Dart, DTDC, Shiprocket (fallback), Porter (intra-city 2-wheeler only — the UI enforces a weight/volume cap), In-house fleet. Disabling a carrier with live shipments is blocked and names them. |
| `/admin/logistics/riders` · `/vehicles` | In-house fleet. | ADMIN_LOGISTICS | Add rider; assign vehicle; set zone; activate/suspend; view performance | `logistics.rider`, `vehicle` | Empty first-run. | Rider needs a verified licence and ID before activation. Performance: on-time %, first-attempt success, POD completeness, seal-scan accuracy. |
| `/admin/logistics/route-plans` | Daily route planning. | ADMIN_LOGISTICS | Auto-plan; drag to reorder stops (with a keyboard equivalent); assign rider; publish; recall | `logistics.route_plan`, `route_stop`, `pickup_task`, `delivery_task` | **Loading:** map + list skeleton. **Empty:** "No tasks for this date." **Error:** geocoding failure names the address and offers manual pin placement. | A stop cannot be scheduled outside the site's receiving hours. Published plans push to the Rider app; recalling a published plan notifies the rider and states that in the confirm. Reordering must be doable from the keyboard (2.5.7). |
| `/admin/logistics/ndr` | Non-delivery reports — failed attempts. | ADMIN_LOGISTICS, ADMIN_SUPPORT | Contact the buyer; reschedule; change the address (with buyer confirmation); return to origin; escalate | `logistics.delivery_attempt`, `delivery_task`, `platform.ticket` | **Empty (success-terminal):** "No open NDRs." | Every attempt shows the carrier's reason code translated into plain words, the attempt count, and the RTO deadline. Three failed attempts force a decision; the screen does not let an NDR age silently. Under Rule 7(4) late delivery is our liability, so an NDR that is our fault (wrong address on our side, missed pickup) is tagged separately from a buyer-caused one. |
| `/admin/logistics/hubs` | Hub master and capacity. | ADMIN_LOGISTICS | Add/edit; set capacity, hours, serviceable pincodes | `logistics.hub`, `serviceability` | Empty first-run. | Pincode serviceability import with a per-row error report. |

### 3C.6 After-sale, support, vendor standing

| Route | Purpose | Roles | Primary actions | Reads | Empty / loading / error | Validation & rules |
|---|---|---|---|---|---|---|
| `/admin/returns` · `/[id]` | Returns within the inspection window and beyond. | ADMIN_OPS, ADMIN_SUPPORT | Approve; schedule reverse pickup; record the return inspection; refund or credit-note; recover from the vendor; reject with reason | `platform.return_request`, `qc`, `payment.refund`, `credit_note`, `procurement.vendor_payable` | Empty (success-terminal); loading skeletons. | **Rule 7(4) is non-delegable**: the UI never offers "refer to vendor" as a way to close a return. Vendor recovery is a *separate*, later action against the vendor payable and cannot be a precondition of the buyer's refund. Return-inspection outcome decides recovery, not the buyer's refund. Status set CHECK-constrained (gap #5). |
| `/admin/warranty` · `/claims/[id]` | Warranty claims. | ADMIN_SUPPORT, ADMIN_OPS | Triage; schedule pickup/on-site; approve repair/replacement; reject with the contradicting finding; close | `platform.warranty`, `warranty_claim`, `qc_report` | Empty (success-terminal). | Triage compares the claimed fault against the original QC report's area results — a claim about an area we measured as good is not automatically rejected, but the divergence is surfaced. Rejection must cite the finding. |
| `/admin/disputes` · `/[id]` | Vendor disputes (grade corrections, penalties) and buyer disputes. | ADMIN_OPS, ADMIN_SUPER | Assign; request evidence; decide with a written rationale; adjust the ledger | `platform.dispute`, `audit_recheck`, `penalty` | Empty (success-terminal). | A decision writes a reasoned outcome visible to the other party verbatim. Ledger adjustments from a dispute are balanced pairs and are audit-logged with the dispute ID. |
| `/admin/support` · `/tickets/[id]` | Support desk. | ADMIN_SUPPORT | Claim; reply; attach; merge; escalate; set SLA; close; reopen | `platform.ticket` | Empty-filtered standard. | SLA clock per priority; breach is visible on the row. Merge preserves both threads. Grievance-officer escalations are a distinct priority with a statutory clock (48h acknowledgement, 1 month resolution) shown as a countdown. |
| `/admin/vendors` · `/[id]` | The vendor 360. | ADMIN_OPS, ADMIN_SUPER | View everything; suspend; change tier; add a note; adjust sampling | `vendor.*`, `kyc.*`, `listing`, `qc`, `procurement`, `platform.vendor_scorecard` | Loading per panel. | The only screen where a vendor's legal identity, listings, QC history, money and score appear together. Suspension names its effects: listings paused, POs unaffected, payouts held or not. |
| `/admin/vendors/scorecards` | Scorecard board and tiering. | ADMIN_OPS, ADMIN_SUPER | Recompute; override a tier with justification; export | `platform.vendor_scorecard` | Empty: "Not enough history." | Weights are configuration, not code, and the screen shows the current weights and when they last changed. A tier override expires after a configured period and reverts automatically — stated on the override form. |

### 3C.7 Platform administration

| Route | Purpose | Roles | Primary actions | Reads | States | Rules |
|---|---|---|---|---|---|---|
| `/admin/reports` | Reporting and BI. | ADMIN_SUPER, ADMIN_FINANCE, ADMIN_OPS | Pick a report; set the range; drill down; schedule an email; export | Read models across modules | Loading (long-running reports show a job progress toast, not a frozen page); empty range; error with the failing metric named | Standard set: GMV and margin by brand/grade/channel · QC pass rate and divergence · vendor performance · inventory ageing · QC expiry runway · order funnel · payment ageing · payout summary · TDS accrual · return and claim rates by vendor and by SKU · logistics cost per unit · NDR causes. Every chart follows §2.1 #30 shells; series are directly labelled. |
| `/admin/notifications/templates` | Email / SMS / WhatsApp templates. | ADMIN_SUPER | Edit; version; preview with sample data; send a test; activate | `platform.notification_template`, `notification_log` | Draft / active / archived; preview error on an unknown variable | Variables are typed and validated; an unknown variable blocks activation. WhatsApp templates carry their Meta approval status. Every template states its channel's opt-out mechanism. Transactional and marketing templates are separate categories and **marketing cannot be sent to a user without a recorded opt-in consent** (DPDP + TRAI). |
| `/admin/notifications/log` | What was sent, to whom, and whether it landed. | ADMIN_SUPPORT, ADMIN_SUPER | Search; resend; view the provider response | `platform.notification_log` | Empty-filtered | Read-only. PII masked by default with a "reveal" action that is itself audit-logged. |
| `/admin/feature-flags` | Flags. | ADMIN_SUPER | Toggle; set rollout %; scope to org/role/environment; view change history | `platform.feature_flag` | — | Every toggle is audit-logged with actor and reason. A flag change that affects buyer-facing pricing or claims requires a second-person approval. |
| `/admin/config` | Platform configuration. | ADMIN_SUPER | Edit a key; view history; export | `platform.config` | — | **`platform_config.key` must be UNIQUE** (schema gap #4) — the form rejects a duplicate key and shows the existing row. Values are typed (number / bool / string / JSON / duration / money) and validated against the type. Sensitive keys are write-only with a masked read. Keys that change legal behaviour (inspection-window hours, TDS rate, QC validity days, penalty amounts) require a reason and are shown in a dedicated "legal-effect" section. |
| `/admin/audit-log` | The audit-log viewer. | ADMIN_AUDIT, ADMIN_SUPER | Filter by actor / entity / action / date; open an entry; export | `identity.audit_log` | Loading (virtualised, partitioned by month); empty-filtered; **error: "This range is in a partition that does not exist"** — an explicit state, because of schema gap #1 | Read-only, append-only, no delete action exists in the UI at all. Each entry shows actor, role, IP, entity, action, before/after diff and any justification text. Export is itself audit-logged. |
| `/admin/users` · `/roles` | Platform staff and the permission matrix. | ADMIN_SUPER | Invite; assign role; force MFA; deactivate; view sessions; revoke | `identity.user`, `role`, `permission`, `session` | — | TOTP MFA is mandatory for every admin role and cannot be disabled. Role edits require a second-person approval. Deactivation revokes sessions immediately. Last ADMIN_SUPER protection. |
| `/admin/dpdp/requests` · `/[id]` | Data-subject requests under the DPDP Act. | ADMIN_DPO, ADMIN_SUPER | Verify the requester; classify (access / correction / erasure / nomination / consent withdrawal); execute; respond; close | `platform.data_subject_request`, `identity`, `kyc` | **SLA countdown to 30 days**, warn at 7 days remaining; empty (success-terminal) | Identity verification is mandatory and recorded before any data moves. Erasure is checked against statutory retention (tax records 8 years, KYC under PMLA, invoice records) and the response states exactly which data cannot be erased and under which law, rather than a blanket refusal. Every request produces a downloadable response pack and a full audit trail. Status set CHECK-constrained (gap #5). |
| `/admin/system/partitions` | Partition runway and creation jobs. | ADMIN_SUPER | View runway; create the next N partitions; enable the auto-creation job | `pg_catalog` via an ops endpoint | **Alert state when runway <60 days** | Exists because of schema gap #1 (`order_event`, `shipment_tracking`, `notification_log`, `integration_log` run out 2026-10-01; `audit_log` 2026-11-01, and there is no DEFAULT partition). This screen is the human backstop for the automated job, and its status tile appears on `/admin`. |
| `/admin/system/integrations` | Integration health. | ADMIN_SUPER, ADMIN_OPS | View per-provider status; replay a failed call; rotate a credential | `platform.integration_log` | Per-provider up/degraded/down with the last successful call | Providers: GST portal, PAN, penny-drop, NIC e-way bill, Razorpay, each carrier, WhatsApp BSP, S3, the QC tool ingestion endpoint. Degradation shows what the user-facing consequence is ("GSTIN verification is queued; registrations can continue"). |

---

## 3D. `apps/mobile` — Expo / React Native

Two apps from one Expo monorepo target, shipped separately (different bundle IDs, different app-store listings) because a technician and a rider have different device profiles and permissions. Shared: auth, offline queue, camera/scan, the design tokens (a React Native token module generated from the same source as `globals.css`), and the sync engine.

**Cross-cutting rules for both apps**
- **Offline-first.** Every screen reads from a local SQLite (`expo-sqlite`) mirror and writes to an outbound mutation queue. The network is treated as absent by default — a warehouse basement has no signal, and that is the normal case, not an error.
- The sync state is always visible in the header: `Synced · 2 min ago` / `12 changes queued` / `Syncing 4 of 12` / `Sync failed — will retry`. Never a silent failure, never a blocking spinner.
- Mutations are **idempotent** (client-generated UUID per mutation) and **ordered per entity**. A conflict returns the server's version and opens a conflict screen naming the field, both values and who changed it — it never last-write-wins silently on money, grades or seals.
- Photographs are captured at full resolution to the device, queued, uploaded as WebP at ≤1600px long edge over Wi-Fi by preference, and never blocked on upload — the visit closes with photos still queued, and the queue is visible.
- Minimum target 48×48 dp; the primary per-unit action is 56 dp. High-contrast mode and a large-text mode are shipped, not deferred: field lighting is bad and screens get read at arm's length.
- Hardware permissions requested **in context with a reason**, never on first launch: camera at the first photo, location at check-in, notifications after the first assignment.
- English + Hindi from day one, device-locale default, switchable in Settings.
- Screen-lock, session expiry after 12 h idle, and biometric unlock. A lost device is remotely revocable from `/admin/users`.

### 3D.1 Technician QC app (`TECHNICIAN`)

| Screen | Route | Purpose | Primary actions | Reads / writes | States | Rules |
|---|---|---|---|---|---|---|
| Sign in | `/(auth)/login` | Mobile + OTP, then biometric thereafter. | Enter mobile, OTP | `identity.session` | OTP states as §2.1 #9; offline → "You must be online to sign in" with a clear reason | Session bound to the device; a second device forces re-auth and alerts admin. |
| Today | `/(tabs)/today` | The day's route: up to 3 stops. | Start day; open a stop; call the site contact; navigate | `qc.qc_visit`, `vendor_facility`, `route` | Loading (cached first, refresh in background) · empty ("No visits assigned today") · error (stale banner with last-sync time) | Shows planned units per stop, facility hours, and the unit count already declared. The vendor's legal name **is** shown here — the technician is our staff at their premises. |
| Kit check | `/visit/[id]/kit` | Confirm what the day requires before leaving. | Tick each item; report a shortfall | `qc.qc_visit`, `qc_seal` roll issue | Blocked if seals issued < units planned, with the shortfall number | Checklist: laptop + charger, licensed tool seat, seal roll(s) with the issued number range, label printer, cleaning kit, ID card. Reporting a shortfall notifies the QC console before the technician travels. |
| Check-in | `/visit/[id]/checkin` | Arrive, prove it, start the clock. | Capture geo + timestamp; photograph the premises; note the contact met | `qc.qc_visit` (checked_in_at, geo) | **Geo denied:** blocked with an explanation, and a supervisor-override path that is audit-logged. **Geo outside the facility radius:** allowed but flagged, with the distance shown and a mandatory reason. | Radius default 300 m from the facility pin. Offline check-in queues with the device timestamp and the GPS fix — both are recorded, and the server records its own receipt time; all three are visible in the admin view. |
| Manifest | `/visit/[id]/units` | The list of serials to inspect. | Scan or type a serial; open a unit; mark not-produced | `visit_unit`, `listing.unit` | Empty (vendor produced nothing) · partial | A scanned serial not on the manifest is a hard stop: "Serial NXH4429 is not on this visit. Do not inspect it." with an "Add to visit" action that requires the vendor's confirmation and is logged. |
| Per-unit: tool run | `/visit/[id]/unit/[serial]/tool` | Run the QC executable and ingest its signed report. | Launch/pair the tool; wait for the report; retry | `qc.tool_run`, `hardware_detected` | pairing · running (progress from the tool) · completed · **signature invalid** (hard stop, quarantine) · timeout · mismatch (tool serial ≠ scanned serial → hard stop) | The tool's reading is authoritative for hardware, battery health and cycle count. The technician cannot type these numbers. If the tool cannot run, the unit is marked `TOOL_FAILED` and is not gradeable — it never becomes sellable on a human's opinion alone. |
| Per-unit: cosmetic grade | `/visit/[id]/unit/[serial]/cosmetic` | The part a machine cannot judge. | Score each area against the structured checklist; add defect notes | `qc.qc_area_result` | in-progress · complete · blocked (a required area unscored) | Areas: lid, palmrest, keyboard, display panel, hinges, base, ports, screen bezel. Each area is scored against **the platform's own reference images shown side by side** — the same library as `/admin/catalog/condition-images` — so the technician grades against a picture, not a word. The app computes the grade from the area scores plus the tool's battery reading against `qc_tolerance_rule`; the technician cannot override it, only add a note and flag for audit. |
| Per-unit: photos | `/visit/[id]/unit/[serial]/photos` | Six photographs, fixed angles. | Capture each slot; retake; confirm | `qc.qc_photo` | per-slot: empty · captured · queued · uploaded · rejected (blur/dark detected on-device) | Six fixed slots: lid closed, open front, left ports, right ports, base with the service tag legible, worst defect. Grade B requires the worst-defect frame to be non-empty. On-device blur and exposure checks reject a bad frame immediately with the reason, because a re-shoot at the site costs seconds and a re-visit costs a day. |
| Per-unit: verdict | `/visit/[id]/unit/[serial]/verdict` | Pass as declared / pass at a corrected grade / fail. | Confirm; continue to sealing or to fail | `qc.qc_report`, `unit.grade_actual`, `is_sellable`, `grade_correction` | computed (not chosen) · confirming · saved | The verdict is computed, shown with the reasons that produced it, and confirmed. A corrected grade creates a `grade_correction` and notifies the vendor immediately, before the technician leaves. A failed unit is never sealed and never listed. |
| Per-unit: sealing | `/visit/[id]/unit/[serial]/seal` | Apply and bind a numbered seal. | Scan the seal code; photograph it in place; confirm | `qc.qc_seal`, `unit.sealed_at` | scanning · bound · **damaged during application** (void + apply replacement, both codes recorded and linked) · photo required | The seal photo must have the code legible; an on-device OCR check compares the read code to the scanned one and blocks a mismatch. Seal codes must come from the roll issued to this technician today — a code outside the issued range is rejected on the spot. |
| Wipe | `/visit/[id]/unit/[serial]/wipe` | Record the data wipe. | Confirm the standard and pass count from the tool | `qc.wipe_certificate` | pending · certified · failed | Certificate is generated from the tool's output, not typed. |
| Close visit | `/visit/[id]/close` | The vendor signs for what we found. | Show the summary; capture the vendor's OTP; capture a signature; submit | `qc.qc_visit`, `visit_unit`, vendor OTP | **blocked** if any unit is unresolved · signing · **offline** (queues, and the screen says the vendor's copy will send on sync) · submitted | The summary shown to the vendor lists, per unit: declared grade, actual grade, verdict, seal code. The OTP goes to the vendor's registered mobile. On sync: units go live, grade corrections open with their response windows, seal roll reconciles, the visit fee posts. |
| Seal reconciliation | `/(tabs)/seals` | End-of-day roll accounting. | Account for every issued number | `qc.qc_seal` | balanced · **gap** (blocks day-close, requires a written explanation) | Every issued number must end applied, voided, damaged or returned. A gap raises an incident on the QC console. |
| Sync & queue | `/(tabs)/sync` | What is waiting to go up. | Force sync; view a failed item; retry | Local queue | idle · syncing · failed with per-item reason · conflict | Never auto-discards a queued item. A permanently failing item escalates to the QC console with the payload preserved. |
| Profile | `/(tabs)/profile` | Shift, availability, kit, language, help. | View schedule; report unavailability; switch language; call dispatch | `qc.technician_availability` | — | — |

### 3D.2 Rider app (`RIDER`)

| Screen | Route | Purpose | Primary actions | Reads / writes | States | Rules |
|---|---|---|---|---|---|---|
| Sign in | `/(auth)/login` | Mobile + OTP, then biometric. | — | `identity.session` | As above | — |
| Tasks | `/(tabs)/tasks` | The day's pickups and deliveries in route order. | Start the route; open a task; navigate; call the contact | `logistics.route_plan`, `route_stop`, `pickup_task`, `delivery_task` | loading-from-cache · empty ("No tasks assigned") · stale (last sync) · reordered-by-dispatch (a toast, not a silent reshuffle) | Each card shows: type, site name, address, landmark, **the gate/security instruction verbatim as the buyer typed it**, contact name + call button, receiving hours, unit count, and whether an OTP is required. |
| Pickup: manifest scan | `/task/[id]/scan` | Scan serial + seal against the manifest at the vendor's door. | Scan each unit; mark an exception | `logistics.shipment_unit`, `qc.qc_seal`, `order_line_unit` | scanning · **match** · **not on manifest** (hard stop) · **seal broken** (excluded, reason recorded) · **seal code mismatch** (hard stop) · short (fewer units produced than the PO) | Two scans per unit: the machine's serial and the seal code, checked as a pair against the manifest. A mismatch cannot be overridden by the rider — it escalates to dispatch. "Two minutes at the door decides whether it ships." |
| Pickup: handover | `/task/[id]/handover` | Take custody. | Capture the vendor's OTP; photograph the loaded consignment; confirm | `logistics.custody_event`, `pickup_task` | blocked until every unit is resolved · offline queues | Custody transfer is a recorded event with time, geo, OTP and photo. |
| Delivery: arrival | `/task/[id]/arrive` | Prove arrival at the right site. | Capture geo; confirm the site | `delivery_task` | geo denied → supervisor override, logged; outside radius → flagged with distance | — |
| Delivery: verification | `/task/[id]/verify` | Serial + seal scan against the manifest, in front of the buyer. | Scan each unit; show the buyer the seal status | Same as pickup | match · mismatch (do not hand over) · seal broken in transit (do not hand over; opens a replacement/refund immediately) | The buyer is shown an intact seal with a number matching their invoice. A broken seal at this point is our liability under Rule 7(4) and the app opens the remedy rather than asking the rider to negotiate. |
| Delivery: OTP + POD | `/task/[id]/pod` | Complete the delivery. | Capture the recipient's OTP; capture name + designation; photograph the delivered consignment; capture a signature | `delivery_task`, `custody_event`, POD photo | blocked until scans complete · submitting · offline queues with a local receipt the rider can show | OTP goes to the order's site contact. POD photo is mandatory. Partial delivery is explicit: the app records exactly which serials were accepted and which were not, and why. |
| Failed attempt | `/task/[id]/failed` | Record a genuine failure. | Choose a reason; photograph the evidence; add a note; set a next-attempt preference | `logistics.delivery_attempt` | — | Reason list is fixed and specific (site closed · recipient unavailable · address not found · refused: seal broken · refused: wrong item · refused: no PO on invoice · security refused entry · vehicle breakdown). A photo is required for "site closed" and "address not found" — this is the field where fake attempts happen, and the evidence requirement is the control. |
| Cash / document collection | `/task/[id]/documents` | Collect a signed delivery challan copy where the buyer requires one. | Photograph the stamped copy | `logistics` attachment | optional per task | No cash-on-delivery in v1. If the flag is off, the screen does not exist. |
| Sync & queue | `/(tabs)/sync` | Same contract as the technician app. | — | — | — | — |
| Profile | `/(tabs)/profile` | Shift, vehicle, zone, language, help, SOS. | — | `logistics.rider`, `vehicle` | — | SOS places a call to dispatch and shares live location for 30 minutes; it is a persistent, always-reachable control. |

---

# PART 4 — KEY FLOWS

Notation: `→` next step · `⟂` decision · `✗` failure path · `⏱` a clock the user can see · `⚙` a server transaction that is all-or-nothing.

## 4.1 Customer registration and verification

1. `/register/account` — name, work email, mobile, password. → mobile OTP → email OTP.
   - ⟂ free-mail domain → soft warning, not a block.
   - ✗ OTP wrong 5× → number locked 30 min, message states the unlock time. ✗ email already registered → sign-in link. ✗ mobile already registered → generic "we've sent a code" (no enumeration) and the code goes to the existing account with a "someone tried to register with your number" note.
   - ⚙ writes `registration_lead`, `user_account`, `organization` (shell), `otp_request`, `consent_record`.
2. `/register/company` — legal name, constitution, industry, size, expected volume. Step 1 collapses to a summary line.
3. `/register/statutory` — GSTIN → live portal check.
   - ⟂ Active → verified state shows legal name, taxpayer type, state, registration date.
   - ✗ not found / cancelled / suspended → the specific reason; the buyer may continue to step 4 with the GSTIN unverified, but **checkout is blocked** until it verifies, and the screen says so now rather than at checkout.
   - ✗ portal down → queued check, buyer continues, verification completes asynchronously and notifies.
   - PAN auto-derived from GSTIN chars 3–12; a mismatch against a typed PAN is a hard block showing both values.
4. `/register/contacts` — billing address per GSTIN (state must match the GSTIN), delivery sites with gate instructions and receiving hours.
   - ✗ unserviceable pincode → not a block; flagged "we'll confirm serviceability within a working day" and routed to ops.
5. `/register/documents` — GST certificate, PAN, authorised-purchaser ID; preferences; consents (all unticked).
   - ✗ document rejected by automated checks → specific reason, Replace in place, other documents unaffected.
6. Submit → `/register/status`.
   - ⟂ all automated checks green and no risk flags → **auto-approve** (target: within an hour, as promised on screen).
   - ⟂ any check amber, a name mismatch, or a high-value credit request → `/admin/onboarding` queue, ⏱ 48h SLA.
   - ✗ blacklist match → neutral decline + grievance route; the reason is never disclosed.
   - ✗ rejected → the exact failing item(s), the fix, and the re-apply rule.
7. Approved → account active. Browsing was available throughout; cart and checkout unlock now.
   - *Optional branch:* credit application → `/account/credit`, 3–5 working days, prepay remains available meanwhile.

## 4.2 Vendor registration and approval

1. Steps 1–3 (contact → business → statutory) with OTP and GSTIN/PAN/CIN/Udyam verification. Progress % and blocker banner live from step 1.
2. Step 4 capability — grade mix must total 100%; sourcing channels attach consequences (auction → purchase documents above ₹5 lakh; imports → bill of entry + customs check).
3. Step 5 facility & contacts — hours and holidays become the QC scheduling calendar.
4. Step 6 documents & bank.
   - Penny-drop: ⟂ name matches legal name → verified. ✗ mismatch → payouts blocked, both names shown, resolution path stated. ✗ bank API down → retry queued, application continues, payout eligibility flagged.
   - ✗ address proof older than 3 months → rejected with that exact reason.
5. Step 7 agreements — four documents, Aadhaar e-Sign.
   - ✗ e-Sign failure → provider reason shown; retry; fallback to a wet-signed upload with ops review.
6. Submit → ⏱ 48h SLA in `/admin/onboarding`.
   - Reviewer works the split view; automatic field-vs-document mismatches are pre-highlighted.
   - ⟂ approve → vendor active, listing unlocked, tier = new (forces hub routing and a higher QC sampling rate; both stated to the vendor).
   - ⟂ more info → the specific items, deep-linked to their step; SLA clock pauses and the vendor sees why.
   - ✗ reject → the specific failed item from the controlled list + the 30-day re-apply rule.
   - ✗ blacklist → neutral decline.

## 4.3 Listing → QC visit → live

1. `/vendor/listings/new` step 1 — pick from the master catalog.
   - ✗ no matching SKU → SKU request → `/admin/catalog/sku-requests`; the draft listing waits and the vendor is told what it is waiting on.
2. Step 2 — declare grade against the platform's condition images. Screen states the declaration will be verified.
3. Step 3 — serials, typed / pasted / CSV.
   - ✗ duplicate serial globally → hard block naming the conflict ("this serial is already listed"). ✗ blacklisted serial → hard block, silent escalation to ops.
4. Step 4 — expected net payout; live preview of the resulting retail price and the net after TDS.
   - ⟂ within the guardrail band → proceeds. ⟂ outside → routed to `/admin/listings` with the breach type named to the vendor.
5. Submit → **does not publish**. Creates a QC visit request. `/vendor/qc/requests`.
6. Scheduling — admin assigns technician + tool seat + slot inside facility hours; vendor confirms or proposes an alternative ⏱ accept-by deadline.
   - ✗ vendor cancels inside the notice window → visit fee, stated on the confirm.
   - ✗ technician no-show → visit rescheduled at our cost, vendor notified, no fee.
7. Visit (§3D.1): kit check → check-in (geo) → per unit: tool run → cosmetic grading → six photos → computed verdict → seal → wipe certificate.
   - ✗ tool cannot run → unit marked `TOOL_FAILED`, not gradeable, not listed.
   - ✗ scanned serial not on the manifest → blocked; may be added only with vendor confirmation, logged.
   - ✗ seal damaged on application → voided, replacement applied, both codes linked, roll reconciles at day end.
8. ⚙ **QC verdict transaction** — write report + area results + hardware detected + photos → compute the verdict against `qc_tolerance_rule` → update `unit.status`, `grade_actual`, `is_sellable` → on mismatch create `grade_correction` → apply seal → emit `qc.report.completed`.
9. Close visit — vendor OTP sign-off on the per-unit summary. Offline: queues, and the screen says the vendor's copy sends on sync.
10. Outcomes per unit:
    - **Passed as declared** → live immediately (after listing approval where a guardrail was breached).
    - **Passed at a lower grade** → `grade_correction` opens, ⏱ 48h vendor response: accept · accept-and-reprice · withdraw · dispute. ✗ no response → auto-withdraw, stated in advance.
    - **Failed** → never listed; returns to the vendor's own stock with the measured reason.
    - **Dispute** → audit recheck by a second technician → `/admin/qc/divergence`. Outcome adjusts the unit, the vendor's score, or our technician's sampling rate — the screen keeps "vendor declared wrongly" and "our technicians disagree" separate.
11. Live. ⏱ QC report valid 90 days; warn chip at T−14 days; non-sellable automatically at T−0.

## 4.4 Search → compare → order

1. `/search` with facets. ⟂ nothing matches → save the search with a target price; alert when matching stock passes inspection.
2. `/laptops/[slug]` → set the delivery pincode → the offer grid resolves landed prices (p95 < 500 ms).
   - ✗ freight service unavailable → ex-freight price with an explicit note; freight resolves at checkout. Never a guessed number.
3. Compare supply points. ⟂ qty available at one supply point ≥ requested → add. ⟂ not enough → the "combine supply points" panel with the blended landed price.
4. `/cart` — splits by (supply point × valuation_method); the split is stated in words with the number of deliveries and invoices.
   - ✗ stock dropped since add → inline per-line warning with Reduce / Find elsewhere; never a silent quantity change.
   - ✗ price changed → explicit diff the buyer must acknowledge.
5. `/checkout` — billing GSTIN (⟂ decides IGST vs CGST+SGST, tax lines recompute visibly) → delivery site per sub-order → PO number (⟂ mandatory if the org requires it) → payment mode.
   - ⟂ above the user's spend limit → `/checkout/approval-required`; stock is **not** reserved; the screen says so and shows the live sellable count.
   - ⟂ credit terms → checked against the approved limit and utilisation, both shown.
6. Place order → ⚙ **order confirmation transaction**: validate cart → check `qty_available` under a Redis lock → decrement stock → create `order` + `sub_order` + `order_line` → allocate specific `unit` rows into `order_line_unit` → set units `RESERVED` → **raise a `purchase_order` to each vendor** → write `order_event` → emit `order.confirmed`.
   - ✗ lock contention / stock gone between review and submit → the whole transaction rolls back and the buyer is returned to the cart with the exact line and quantity that failed. No partial order ever exists.
   - ✗ payment failure → order stays `PENDING_PAYMENT` with the units reserved for a configured hold; the buyer can retry or change method.
7. `/checkout/confirmation/[orderNo]` — the assigned serials and seal codes are shown. The 48-hour inspection window is explained at the same visual weight as the confirmation.

## 4.5 Order → PO → pickup → delivery

1. `order.confirmed` → the vendor sees the PO at `/vendor/orders/[poId]` with specific serials and seal codes, and an acceptance deadline with its penalty stated.
   - ✗ vendor does not accept in time → penalty, escalation to ops, and re-allocation from another supply point if stock exists; the buyer is told before the ETA is affected.
2. Routing — `/admin/logistics/routing-rules` decides DIRECT vs HUB.
   - New / watchlist vendors force HUB regardless of other rules.
3. `/vendor/orders/[poId]/handover` — the vendor produces the named sealed machines.
   - ✗ seal broken → unit excluded, replacement drawn from the same listing; if none remain the line reduces and the buyer is notified immediately.
   - ✗ unit cannot be found or was sold elsewhere → penalty + score impact; buyer notified with a replacement or refund offer, not a delay.
4. Rider pickup (§3D.2) — serial + seal scanned as a pair against the manifest → vendor OTP → custody event.
   - ✗ any mismatch → rider cannot override; escalates to dispatch.
5. ⚙ Documents — tax Invoice-2 to the buyer with serials printed on it; **one e-way bill, Case 2**, Dispatch-From = the vendor's address (so the vendor's price never travels with the goods).
   - ✗ NIC portal down → retry queue with visible depth; goods do not move without a valid e-way bill above the threshold, and dispatch shows that as the blocking reason.
6. Transit → `/account/orders/[id]/tracking`. Carrier API down → last known scan + timestamp, never a fabricated status.
7. Delivery (§3D.2) — arrival geo → serial + seal scan in front of the buyer → recipient OTP → POD photo + signature.
   - ✗ seal broken in transit → do not hand over; replacement or refund opens immediately (Rule 7(4), ours, non-delegable).
   - ✗ failed attempt → reason from the fixed list + mandatory photo for "site closed" / "address not found" → `/admin/logistics/ndr`; three attempts force a decision.
8. Delivered → ⏱ the 48-hour inspection window opens; the buyer can verify seals themselves at `/account/orders/[id]/delivery`.
9. Window closes → the vendor payable becomes eligible (§4.8).

## 4.6 Warranty claim

1. `/account/warranty` → pick a serial → `/account/warranty/claims/new`.
   - ✗ out of warranty → the exact expiry date and a paid-repair option, not a dead end.
2. Fault category (mapped to QC area codes) + description + evidence.
3. `/admin/warranty` triage — the claimed fault is compared against the original QC report's area results.
   - ⟂ consistent → approve.
   - ⟂ divergent (we measured that area as good) → surfaced, not auto-rejected; a technician review is ordered.
   - ✗ reject → must cite the contradicting finding, verbatim to the buyer.
4. Approved → pickup or on-site visit scheduled → repair / part replacement / unit replacement.
   - ✗ parts unavailable → `AWAITING_PARTS` with a stated date; if it slips past the commitment, the claim converts to a replacement or refund automatically.
5. Resolution → buyer confirms → closed. Vendor recovery (if the fault traces to the vendor) is a **separate** action against the vendor payable and never gates the buyer's remedy.
6. ✗ buyer disputes the outcome → `/admin/disputes` → decision with a written rationale → grievance officer if still unresolved.

## 4.7 Return within the inspection window

1. Delivered → ⏱ 48 h per sub-order, from POD, shown as information (no urgency styling, no pressure copy).
2. `/account/returns/new` — select units, reason, evidence (≥2 photos for damage; seal photo mandatory for a broken-seal claim).
   - ✗ window closed → the exact closing timestamp, routed to warranty.
   - ✗ serial not on this order → hard block naming the order it belongs to.
3. ⚙ Return request created → reverse pickup scheduled. **We do not ask the buyer to contact the vendor** — the UI has no such path.
4. Return inspection at our hub or at the vendor's premises by our technician.
   - ⟂ confirms the buyer's claim → refund or credit note issued on the stated timeline; vendor recovery raised separately.
   - ⟂ contradicts the claim (e.g. damage post-delivery) → the finding, its photographs and the original QC report are shown to the buyer with a reasoned decision; the buyer may dispute.
   - ✗ unit not returned / different serial returned → escalation, not a silent close.
5. Refund → `/admin/payments` → executed to the original instrument, or a credit note for credit-term buyers. Timeline stated in working days and honoured; a slip triggers a proactive notification, not silence.
6. Vendor side — `/vendor/payables` shows the recovery against the specific PO with the return inspection as evidence; disputable within 7 days.

## 4.8 Payout run

1. Eligibility per PO — delivered **and** inspection window closed **and** three-way match complete **and** bank account verified **and** no unresolved dispute. `/vendor/payables` shows which of the five each row is waiting on.
2. `/admin/payouts` → create a run for a cycle/vendor set → **preview**.
3. Preview renders the full statement per vendor: `Gross (sum of PO values) → less TDS 0.1% u/s 393(1) Sl.8(ii) on value excluding GST (5% if no PAN, ₹0 with the reason if below the ₹50 lakh per-vendor-per-year threshold) → less penalties (each itemised with cause, date and evidence) → less adjustments and credit notes → Net payable`.
   - MSME (Udyam-verified) vendors carry their 45-day clock; a run that would breach it is flagged in the preview.
4. ⟂ two-person approval above the configured amount.
5. ⚙ **Payout run transaction** — for each eligible PO: gross → TDS → penalties → adjustments → net → write balanced `ledger_entry` pairs → create `payout` → mark the run executed, with a **batch-sums-to-zero assertion inside the same transaction**.
   - ✗ assertion fails → the run does not execute and the failing entry pair is named on screen. No partial run.
6. Bank file generated / API payout initiated. Idempotent on the run ID.
   - ✗ a line fails at the bank → isolated; the rest of the run stands; the failed line retries with the bank's reason shown to both ops and the vendor.
   - ✗ account-name mismatch discovered at payment → payout held, vendor notified with both names, run continues.
7. `/vendor/payouts/[id]` — statement PDF/CSV, TDS line with section code 1031 and Form 26Q reference, every deduction itemised. A query on any line opens a dispute with that line attached.

---

# PART 5 — CONTENT AND MICROCOPY

## 5.1 The rules the whole interface follows

The prototypes already carry three. A fourth is added here because a merchant-of-record model puts every claim on us.

**01 · Never ask twice.** Completed steps collapse to a summary line and stay editable. Nothing already verified is requested again, on any screen. This is also WCAG 3.3.7 (Redundant Entry), so it is a conformance requirement, not a preference.

**02 · Say what actually failed.** *"This bill is dated January 2025, send one from the last three months"* — not "invalid document". Specific errors get correct re-uploads; vague ones get support tickets.

**03 · Show the consequence before the click.** Every checkbox that changes how the account behaves carries a line explaining what it changes. No setting is discovered later.

**04 · Every claim names its evidence.** *(new)* We are the merchant of record and we vouch for authenticity under Rule 7(5). So no adjective appears in the product without the record that produced it, one click away. "Grade A" links to the area scores that produced it. "Battery 91%" comes from a tool run, not a person. "Inspected 12 Aug" links to the report and shows when it expires. "Sealed" shows the seal number and its photograph. If a number cannot be traced to a record, it does not go on the screen. Corollary: **we never write a marketing adjective a QC report cannot support** — no "like new", no "premium condition", no "fully refurbished". A+ / A / B, and the measurements.

## 5.2 Error-message patterns

Shape: **what happened → why → what to do now.** Never blame the user, never say "invalid", never say "something went wrong", never expose a stack trace or an internal code without a human sentence beside it.

| Situation | ✗ Never | ✓ Write |
|---|---|---|
| GSTIN not found | "Invalid GSTIN" | "No taxpayer found for this GSTIN. Check the last two characters — they are the most commonly mistyped." |
| GSTIN cancelled | "GSTIN verification failed" | "This GSTIN was cancelled with effect from 12 Jun 2025. Use an active registration, or contact us if this is wrong." |
| PAN mismatch | "PAN mismatch" | "The PAN inside this GSTIN is AAFFN8812K. The PAN you entered is AAFFN8912K. One of the two has a typo." |
| Document too old | "Invalid document" | "This electricity bill is dated January 2025. We need one from the last three months — any bill dated after 25 May 2026 works." |
| Wrong document type | "Upload failed" | "This looks like a photograph of a printed GST certificate. Upload the PDF you download from the GST portal — a photo cannot be verified." |
| File too large | "File exceeds limit" | "This file is 24 MB. The limit is 10 MB. A PDF scanned in black and white is usually under 2 MB." |
| Stock changed in cart | "Item unavailable" | "Only 12 of the 20 you wanted are still sellable at Supply Point A. Reduce to 12, or add 8 from Supply Point C at ₹24,980 landed." |
| Payment declined | "Payment failed" | "Your bank declined this payment: insufficient funds. Try another method, or ask your bank to authorise the amount and retry." |
| Serial already listed | "Duplicate" | "Serial NXH4429AB is already listed by another account. If this machine is yours, contact us with the purchase document — we check these." |
| Seal not on the manifest (rider) | "Scan error" | "Seal 88-041992 is not on this delivery. Do not accept this machine. Call dispatch on 1800-XXX-XXXX." |
| QC failed a unit | "Failed inspection" | "Battery health measured 71%. Grade A requires 80% or higher. This unit is not listable at the grade you declared." |
| Approval needed | "You cannot place this order" | "This order is ₹4,20,000, above your ₹2,00,000 per-order limit. Sending it to Priya Nair for approval will take it out of your hands — the machines are not reserved while it waits." |
| Session expired | "Unauthorised" | "You were signed out after 15 minutes of inactivity. Sign in and we'll bring you back to this page — your draft is saved." |
| Server error | "Error 500" | "Something on our side failed while confirming your order. Nothing was charged and no order was created. Try again, or call us on 1800-XXX-XXXX with reference GF-8842A." |
| Carrier API down | "Tracking unavailable" | "The carrier's tracking has not updated since 14:20 today. Your shipment is still moving — carrier updates are delayed, not the delivery." |

Rules: errors appear adjacent to the field, in text, with `aria-invalid` and `aria-describedby`, never only in a toast, never colour-only. A form with errors moves focus to the first invalid field and announces the count ("3 fields need attention"). An error that a user cannot fix themselves always includes the channel that can (a phone number, not a chat bubble that opens a bot).

## 5.3 Empty-state copy

An empty state has a job: say what would fill this, and give the one action that starts it. It never scolds and never sells.

| Surface | Copy |
|---|---|
| Search, filtered to nothing | **"No inspected stock matches all six filters."** · "Battery 90%+ and Grade A+ together are cutting out 214 results. Remove either one to see them." · [Remove battery filter] [Remove grade filter] [Save this search] |
| Cart | **"Nothing in the cart yet."** · "Everything here is inspected, sealed and ready to ship." · [Browse laptops] · below: last-ordered SKUs |
| Buyer orders, first run | **"No orders yet."** · "Your orders, their serial numbers and their tax invoices will live here." · [Browse laptops] |
| Approval inbox, clear | **"Nothing waiting on you."** · "Orders above ₹2,00,000 will appear here for approval." — no exclamation mark, no celebration graphic |
| Vendor listings, first run | **"No stock listed yet."** · "Pick a machine from our catalog, declare its grade, and enter your serials. We inspect at your warehouse before anything goes live." · [List stock] |
| Vendor QC expiring, clear | **"Nothing expiring in the next 30 days."** · "Inspection reports are valid for 90 days. We'll warn you 14 days before any expire." |
| Vendor penalties, clear | **"No penalties."** · "Penalties come from missed handovers, grade mismatches and broken seals. Each one shows its evidence." |
| Admin onboarding queue, clear | **"Queue clear."** · "New applications appear here within a minute of submission. The SLA is 48 hours." |
| Admin divergence, clear | **"No open divergences."** · "A divergence opens when an audit recheck disagrees with the original inspection." |
| Buyer warranty, first run | **"No machines under warranty yet."** · "Every unit you buy appears here with its coverage dates and what is covered." |
| Rider tasks, none | **"No tasks assigned."** · "Your route is published the evening before. Pull down to check again." |
| Technician today, none | **"No visits today."** · "Your route is published the evening before." |
| Permission denied | **"You don't have access to payouts."** · "Ask an owner in your organisation to give you the Finance role." — names the role and who can grant it |
| Account pending | **"Your account is being reviewed."** · "You can browse and save searches now. Ordering unlocks once your GSTIN check completes — usually within an hour." |

## 5.4 Labels, tone and units

- **Sentence case** for everything: buttons, headings, labels, table headers. No Title Case, no ALL CAPS except the mono eyebrow.
- Buttons name the outcome, not the mechanism: "Place order", "Request inspection", "Send for approval", "Confirm handover". Never "Submit", "OK", "Proceed".
- Second person for the user, first person plural for us: "You can stop anywhere. Everything is saved as you type." / "We inspect at your warehouse."
- Money: `₹1,24,900` — Indian grouping, tabular figures, no decimals unless paise are non-zero. Always say whether a price includes GST, on every surface it appears.
- Dates: `12 Aug 2026` in prose, `12 Aug 2026, 18:30 IST` where a deadline matters, relative time only for events inside 24 hours ("14 minutes ago"). Never `12/08/26`.
- Quantities: "40 units", never "40 pcs" or "40 nos".
- Never use "seller" in buyer-facing copy — we are the seller. The buyer-facing word for a dispatch origin is **supply point**. In vendor- and admin-facing copy, "vendor" is correct.
- Never use "marketplace" in product copy or legal pages. We are an inventory e-commerce entity; the word is a legal characterisation we do not want in our own materials.
- The word "certified" is reserved for the QC report. Nothing else is "certified".

## 5.5 CCPA Dark Patterns Guidelines 2023 — what we design against

The Guidelines for Prevention and Regulation of Dark Patterns, 2023 list thirteen specified practices. Each is banned below with the design consequence. As an inventory e-commerce entity we author every listing, so there is no third party to blame for any of these.

| Practice | Prohibition, concretely |
|---|---|
| **False urgency / scarcity** | No countdown timers on prices or offers. No "only 3 left" counters. No "12 people are viewing this". Stock depth is shown as a **fact needed to place a bulk order** ("40 units available at this supply point") in neutral styling, never in `--bad` or with a flame icon. The 48-hour inspection window and the grade-correction window are shown as plain countdowns because they are the buyer's or vendor's own right expiring — they are never styled to pressure, never accompanied by "hurry", and lengthening them is always offered where operationally possible. |
| **Basket sneaking** | Nothing is ever added to a cart or order that the user did not add. No auto-added warranty, insurance, service plan, donation or "handling". Add-ons, if they ever exist, are opt-in with a visible price and can be removed on the same screen. |
| **Confirm shaming** | Decline options are neutral and equally weighted: "No thanks" not "No, I don't want to save money". Unsubscribe, decline-credit, skip-a-step and cancel controls use the same visual treatment as their positive counterpart — a `ghost` button beside a `primary`, never a grey link hidden in a corner. |
| **Forced action** | No account required to browse, search or view a unit passport. No forced newsletter, no forced app install, no forced WhatsApp opt-in to track an order. Sign-in is required only at cart, checkout and account. |
| **Subscription trap / forced continuity** | No auto-renewing subscription exists in v1. If credit terms or a service plan is ever added, cancellation must be as easy as sign-up, available in-product without contacting anyone, and confirmed in writing. |
| **Interface interference** | The primary action is the primary action. No decoy buttons, no pre-selected higher-value option, no visual trick making "Continue with the more expensive choice" look like the only option. Grades, prices and taxes are never de-emphasised typographically. |
| **Bait and switch** | The "From ₹14,900" line must be the true current minimum, recomputed hourly, or the line is hidden. A price shown on a listing is the price at checkout for that quantity; any change is surfaced as an explicit diff the buyer acknowledges. |
| **Drip pricing** | **The entire price is visible before the pay button.** Unit price, freight to the buyer's pincode, GST and the total are all on `/checkout` and available from the offer-row breakdown popover before adding to cart. No fee, convenience charge, handling charge or "platform fee" is revealed after payment begins. The homepage's "₹0 hidden charges at checkout" is a promise the checkout must keep. |
| **Disguised advertisement** | No sponsored placement in search or on the PDP in v1. If it ever exists it carries a persistent "Sponsored" label in text, and sorting by "relevance" never silently means "by our margin" — a margin-weighted sort must be labelled as such. |
| **Nagging** | One notification-permission prompt, one app-install prompt, one review request per order. A dismissed prompt is not re-shown for 90 days. No interstitial on repeat visits. |
| **Trick wording** | No double negatives on consent ("Untick to not receive…"). No ambiguous "Continue" that also accepts terms — acceptance is a separate, explicit, unticked checkbox. |
| **SaaS billing** | Not applicable in v1; if a vendor subscription is added, the same cancellation-parity rule applies. |
| **Rogue malware/adware** | N/A. |

**Consent rules that follow from DPDP 2023 as well as the dark-pattern guidelines:** every consent checkbox ships unticked; consent is granular per purpose (transactional / marketing / WhatsApp / partner) and never bundled; withdrawal is one screen away at `/account/settings` and takes effect immediately; every consent is stored in `consent_record` with timestamp, IP, notice version hash and the exact text shown. A cookie/consent banner has a "Reject all" of equal prominence to "Accept all".

**Enforcement:** a checklist in the PR template covers this table, and Playwright asserts the absence of countdown elements, `only N left` strings and pre-checked consent inputs on `/`, `/search`, `/laptops/[slug]`, `/cart` and `/checkout`.

---

# PART 6 — RESPONSIVE AND PERFORMANCE BUDGETS

## 6.1 Breakpoints and what collapses

Tailwind defaults, with a named intent for each. Container queries (`@tailwindcss/container-queries`) are used for cards and rails so a ListingCard behaves the same in a 3-column grid and a 420px drawer.

| Token | Min width | Primary device | What changes |
|---|---|---|---|
| `base` | 0 | Phone, portrait | Single column. Header collapses to logo + search icon + menu. FilterRail becomes a bottom-sheet Drawer with an "Apply (14)" button. **OfferRow table → stacked `<article>` cards** (§1.9.4). DataTable → a card list showing the 4 primary columns, with the rest behind "Details". Stepper → "Step 2 of 5" + a progress bar. Checkout panels stack; the price summary becomes a sticky bottom bar showing the total and the pay button. Modals become full-screen sheets. |
| `sm` | 640 | Phone landscape, small tablet | 2-column card grids. Two-up form fields where both are short (city + pincode). |
| `md` | 768 | Tablet portrait | **OfferRow becomes a real table.** DataTable shows 6–7 columns with horizontal scroll inside its own `overflow-x:auto` container. Vendor handover list gets a two-column layout. PDP splits gallery / spec. |
| `lg` | 1024 | Tablet landscape, small laptop | **FilterRail becomes a persistent 268px left rail.** Console sidebar expands from icons to icons + labels. PDP shows the offer grid inline below the fold. Drawer detail panels (420px) appear beside the board instead of over it. |
| `xl` | 1280 | Laptop / desktop — the primary console target | Content max-width 1240px. 3–4 column card grids. Console boards get a persistent right-hand detail Drawer (560px) without covering the list. Two-pane KYC review (document + form) becomes possible; below `xl` it is tabbed. |
| `2xl` | 1536 | Large desktop | Max-width caps at 1400px for console boards only (`--maxw-wide`); the storefront stays at 1240px so line lengths stay readable. Charts get more horizontal room, never more series. |

Hard rules:
- The page body never scrolls horizontally at any width. Wide content (tables, charts, code, route maps) scrolls inside its own `overflow-x:auto` container with a visible edge shadow.
- Every layout must survive **320px width** and **400% zoom** (WCAG 1.4.10 Reflow) without a two-dimensional scroll. The console's DataTable is exempt from reflow only where it qualifies as data requiring 2-D layout, and even then the card fallback exists below `md`.
- Touch targets stay 44px at every breakpoint — compact density reduces padding, never hit area.
- The technician and rider apps are portrait-locked; the technician's photo capture screen is the single landscape-permitted view.

## 6.2 Core Web Vitals targets

Measured on a **mid-range Android on a 4G connection (Moto G Power class, 1.6 Mbps, 150 ms RTT)** — the realistic device for a procurement manager checking an order from a warehouse, not a MacBook on office fibre. p75 field data via `web-vitals` → our own RUM endpoint, plus a Lighthouse CI gate on every PR.

| Metric | Target (p75) | Gate (fails CI) | Notes |
|---|---|---|---|
| **LCP** | ≤ 2.0 s | > 2.5 s | LCP element on `/` is the hero heading (text, not an image). On `/laptops/[slug]` it is the primary condition image — preloaded, `fetchpriority="high"`, correctly sized, AVIF. |
| **CLS** | ≤ 0.02 | > 0.05 | Every async surface has a skeleton with the final box dimensions. Images always carry `width`/`height`. Fonts use `size-adjust` metric overrides so the Inter→Poppins swap does not shift. No injected banners after paint. |
| **INP** | ≤ 150 ms | > 200 ms | Filter changes, quantity steppers and the OTP input are the risky interactions. Facet updates are transitions (`useTransition`) so typing never blocks. No synchronous layout reads in scroll handlers. |
| **TTFB** | ≤ 400 ms | > 600 ms | SSR/ISR from ap-south-1, CloudFront in front. |
| **FCP** | ≤ 1.2 s | > 1.8 s | — |
| **TBT** (lab) | ≤ 200 ms | > 350 ms | — |

Bundle budgets, gated in CI by `@next/bundle-analyzer` thresholds:

| Surface | First-load JS (gzip) | Notes |
|---|---|---|
| Storefront public routes (`/`, `/search`, `/laptops/*`) | ≤ 130 KB | RSC-first. Client components only for the filter rail, quantity steppers, the pincode box and the cart. |
| Storefront account routes | ≤ 180 KB | |
| Console (per route) | ≤ 220 KB | Charts, DocumentViewer and the CSV mapper are dynamically imported and never in the shared chunk. |
| Shared vendor chunk | ≤ 90 KB | |

Server budgets: p95 API response ≤ 250 ms for reads, ≤ 600 ms for the transactional writes in §4 (order confirmation, QC verdict, payout run). A p99 above 1 s on any read paginates or denormalises — it does not get a spinner.

## 6.3 The offers-grid latency budget — < 500 ms

This is the number the product lives on: a buyer sets a pincode and expects landed prices for every supply point. Total p95 from interaction to painted prices: **500 ms**, allocated as:

| Stage | Budget (p95) | How it is held |
|---|---|---|
| Client → edge (RTT + TLS reuse) | 80 ms | CloudFront ap-south-1; connection kept warm by the PDP's own SSR request. |
| Aggregate query: listings + sellable unit counts + QC validity + tier prices for one SKU | 120 ms | A single covering query per SKU. Composite indexes on `(sku_id, is_sellable, status)` for `unit` and `(sku_id, status, valid_until)` for the listing/QC join. **No cross-schema JOIN** — `listing` exposes a service method that returns the aggregate; `qc` validity is denormalised onto `listing.unit` as `qc_valid_until` and kept current by the QC verdict transaction. |
| Freight lookup for the pincode across N supply-point origins | 60 ms | Zone-pair rate cards are loaded into Redis at deploy and on change; the lookup is `O(N)` hash reads, never a carrier API call at render time. A cache miss falls back to the DB rate card, and a total miss renders the explicit "freight unavailable" state rather than waiting. |
| Landed-price computation + margin rules + tax | 40 ms | Pure function over already-loaded data. Margin rules and price books are cached in Redis with a version key busted on `/admin/pricing/rules` save. |
| **DTO whitelist + serialisation** | 20 ms | The anonymity projection is part of the query's select list, not a post-filter over a fat object — nothing sensitive is ever loaded into memory on this path. |
| Response transfer | 60 ms | ≤ 12 KB gzipped for 8 offers. |
| Render + hydrate | 120 ms | The offer grid is a server component streamed into a Suspense boundary; only the quantity stepper and the compare checkboxes hydrate. |

Caching: the full offer set for `(sku_id, pincode_zone)` is cached in Redis for **120 s**, keyed with a version stamp bumped by `qc.report.completed`, `order.confirmed`, listing price changes and rate-card changes — so a sold-out unit never survives in cache. The cached payload is the already-anonymised DTO, so a cache read cannot leak a vendor identity. Stock depth is read live and merged over the cache, because it is the one field where staleness costs an order.

Measurement: a k6 scenario replaying real SKU/pincode pairs runs against staging on every merge and fails the build above 500 ms p95 or 900 ms p99.

## 6.4 Image strategy

The platform owns every buyer-facing image (vendors upload none), so image performance is fully within our control and there is no user-generated variability to defend against.

- **Pipeline.** Original masters (condition library and QC photographs) land in S3 ap-south-1. On upload: magic-byte validation → AV scan → **EXIF strip** (mandatory — QC photographs are taken at a vendor's premises and their GPS tags would defeat the anonymity rule) → derivative generation.
- **Formats and sizes.** AVIF primary, WebP fallback, no JPEG served to a modern browser. Widths generated: 160, 320, 480, 640, 960, 1280, 1920. `next/image` with a custom CloudFront loader; `sizes` set per surface (card: `(max-width:640px) 50vw, 240px`; PDP gallery: `(max-width:1024px) 100vw, 640px`).
- **Priority.** Exactly one `priority`/`fetchpriority="high"` image per route — the PDP's first gallery frame. Everything else lazy-loads with `loading="lazy"` and `decoding="async"`. Card grids preload only the first row.
- **Placeholders.** A 20px blurred AVIF data-URI (`placeholder="blur"`) generated at upload and stored on the row, so there is no runtime cost and no layout shift. Never a grey box that pops.
- **Condition images** are cached at the edge for 1 year with an immutable, version-hashed URL, because they are retired-not-overwritten (§3C.2) — a new version is a new URL, which is also what makes "prove what the buyer saw on 12 Aug" answerable.
- **QC photographs** (six per unit, plus the seal frame) are served through **short-lived signed CloudFront URLs** — 15 minutes for the buyer-facing passport, 5 minutes inside the admin console — and are never public-cacheable. The DocumentViewer refetches a signed URL once on expiry before showing an error.
- **Never** a raster image for a logo, an icon, a grade badge or the score ring — all inline SVG, and the ring is drawn with `stroke-dasharray`, not an image sprite.
- Total image weight budget: ≤ 380 KB for the storefront homepage above the fold, ≤ 260 KB for a search results page's first viewport, ≤ 520 KB for the PDP gallery's first frame plus thumbnails.

---

## Appendix A — build checklist gates

A route is not "done" until all of the following are true.

1. Renders at 320px and at 400% zoom with no horizontal body scroll.
2. `axe-core` clean; contrast values taken only from the §1.9.1 table.
3. Loading, empty (first-run **and** filtered), error and permission states all implemented and reachable in Storybook.
4. Keyboard-only walkthrough completes the primary action; the focus ring is visible and unobscured at every stop.
5. Every error string follows §5.2 — a reviewer can point at the record that produced it.
6. Money, dates and quantities use the §5.4 formats and `tabular-nums`.
7. Any surface that touches supply-point data is covered by the anonymity assertion test (§2.2).
8. No countdown, scarcity counter, pre-ticked consent or post-payment fee (§5.5), asserted in Playwright where the route is buyer-facing.
9. Bundle and CWV budgets (§6.2) unbroken by the change.
10. Every mutating action writes an audit-log entry with actor and reason where §3C requires one.
