# Vendor panel — MANIFEST implementation

**Repo:** `pankajrentfoxxy/Trugrade` · branch off `refurbo_V-1.0.1`
**Scope:** `apps/console` vendor surface only (`seller.rentfoxxy.com`)
**Direction:** B — MANIFEST (paper ledger)

---

## HOW TO RUN THIS

**Do not paste this whole file into Cursor.** That is exactly what produced a
32,000-line backend and a 1,400-line storefront the first time. A phase-sized
prompt gets phase-sized attention, and the screens get skimmed.

There are **nine stages** below. Each one is a single Cursor session:

1. Open a fresh Cursor chat.
2. Paste **Stage 0** once, at the start of every session.
3. Paste **one stage** after it.
4. Let it finish, review the screenshots it took, commit, close the chat.
5. New chat for the next stage.

```bash
git checkout refurbo_V-1.0.1
git pull
git checkout -b feat/vendor-manifest
```

---

# STAGE 0 — Context. Paste this at the top of EVERY session.

```
You are working on the Trugrade console, a pnpm monorepo.

  apps/console      Vite + React 19 + react-router 7 + TypeScript. Vendor AND admin.
  apps/api          NestJS. Do not modify unless a stage explicitly says to.
  packages/ui       Shared components + design tokens (globals.css).
  packages/config   Tailwind preset, ESLint config.
  packages/contracts Shared types, roles, permissions.

You are implementing the VENDOR surface in a visual direction called MANIFEST.
The ADMIN surface keeps its current look and must not change.

## Absolute rules

1. NO EXPLANATORY PROSE IN THE UI. This is the whole point of the work. No
   paragraph under a heading. No sentence under a KPI tile. No "why we ask"
   text. No helper text under a field longer than 8 words. The current vendor
   panel carries roughly 3,000 words of interface copy and the target is under
   400. If a screen needs a sentence to be understood, the LAYOUT is wrong —
   fix the layout, do not write the sentence.

   Allowed: labels (1-3 words), values, units, column headers, state chips,
   button text, and a `?` button that opens a popover. Long explanations move
   INTO the popover, they are not deleted from the product.

2. DO NOT CHANGE ANY EXISTING ROUTE PATH. Every path in apps/console/src/
   routes/vendor/index.ts stays exactly as it is. New paths may be added.
   Renaming a path breaks bookmarks, the nav, and the e2e fixtures.

3. DO NOT TOUCH apps/console/src/shell/Shell.tsx. That is the admin frame. The
   vendor surface gets its own frame. If you find yourself adding an `if
   (orgType === 'VENDOR')` to Shell.tsx, stop — you are doing it wrong.

4. DO NOT modify the API unless the stage says so. If a screen needs an
   endpoint that does not exist, build ONLY that endpoint and say so in the
   ledger.

5. House rules already enforced by CI and not negotiable: no `any`, no
   `@ts-ignore`, no disabled lint rules, no literal hex outside
   packages/ui/src/globals.css, conventional commits.

## The ledger

Create `docs/VENDOR_MANIFEST_LEDGER.md` on the first stage if it does not
exist. Re-read it at the start of every session; update it at the end of every
stage, in the same commit as the work.

| Stage | What | Status | Commit | Screenshots | Notes |
|-------|------|--------|--------|-------------|-------|

Status: TODO / DOING / DONE / BLOCKED.

## Definition of done, every stage

- `pnpm dev` runs, you opened every route the stage touched, and you LOOKED at it.
- Playwright screenshot of every touched route at 1440, 900 and 600, saved to
  `docs/review/vendor-manifest/<stage>-<route>.png`.
- Every state built: loading, empty, error, success.
- `pnpm lint && pnpm typecheck && pnpm test` all pass.
- Ledger updated, work committed.

A passing test on an unstyled screen is not a completed stage.
```

---

# STAGE 1 — The MANIFEST token layer

No screens change in this stage. You are building the surface the screens will
sit on.

```
Implement the MANIFEST token scope. Screens come later; this stage is tokens,
fonts and the contrast test only.

## 1.1 — Why a new scope and not a new theme

packages/ui/src/globals.css already has five `data-t` theme scopes (dark,
light, slate, olive, sand). MANIFEST is NOT a sixth theme — it is a different
design language for one surface, and it must be able to coexist with whatever
theme the admin console is on.

So: a new root attribute, `data-surface`. It composes with `data-t` and with
`data-density`, and none of the three knows about the others.

  <html data-t="light" data-surface="manifest" data-density="default">

When `data-surface="manifest"` is absent, NOTHING changes anywhere. That is the
safety property — verify it before you finish this stage.

## 1.2 — Add the token block to packages/ui/src/globals.css

Append inside `@layer base`, AFTER the `[data-density]` blocks so it wins. Copy
this verbatim — every value has been checked against WCAG 2.2 AA arithmetic and
Stage 1.6 asserts them.

  /**
   * MANIFEST — the vendor surface. The shipping manifest and the bound ledger.
   * Paper ground, hairline rules, square corners, NO cards. Authority comes
   * from typography and rules, never from boxes.
   *
   * Composes with data-t and data-density; knows about neither. Absent, this
   * block changes nothing.
   *
   * Three rules:
   *   1. Radius is 0 everywhere. A rounded corner in MANIFEST is a bug.
   *   2. No box-shadow. Ever. Separation is a rule or a background step.
   *   3. --acc is viridian and means the same three things the amber meant:
   *      a primary action, a measured value, an active state.
   */
  :root[data-surface='manifest'] {
    --chrome: #14170f;
    --chrome-2: #1e2318;
    --chrome-3: #2c3325;
    --on-chrome: #f2f3ee;
    --on-chrome-2: rgba(242, 243, 238, 0.82);
    --on-chrome-3: rgba(242, 243, 238, 0.62);
    --chrome-line: rgba(242, 243, 238, 0.12);
    --chrome-line-2: rgba(242, 243, 238, 0.22);

    --ground: #edeeea;
    --sheet: #ffffff;
    --sheet-2: #f7f8f5;
    --sheet-3: #e4e6e0;

    --ink: #191b18;
    --ink-2: #4a4f4a;
    --ink-3: #666c66;
    --ink-4: #82887f;

    --rule: #d6d8d1;
    --rule-2: #e4e6e0;

    --acc: #1d5c4a;
    --acc-dk: #164638;
    --acc-on: #ffffff;
    --acc-ink: #144537;
    --acc-wash: #e2ede8;
    --acc-glow: rgba(29, 92, 74, 0.18);
    --scan: rgba(29, 92, 74, 0.7);

    --pass: #1d5c4a;
    --warn: #7a4e0a;
    --fail: #9b2c21;
    --pass-wash: #e2ede8;
    --warn-wash: #f6eddd;
    --fail-wash: #f7e6e4;

    /* Square. Every corner. */
    --r-xs: 0px;
    --r-sm: 0px;
    --r: 0px;
    --r-lg: 0px;
    --r-xl: 0px;

    /* No elevation exists in this language. */
    --shadow: none;

    --font-sans: 'Public Sans', system-ui, sans-serif;
    --font-display: 'Newsreader', Georgia, 'Times New Roman', serif;
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;

    --maxw: 1360px;
  }

Add `--font-display` to the OTHER five theme scopes too, pointing at the
existing sans stack, so `font-display` is never undefined:

    --font-display: 'Inter', system-ui, sans-serif;

## 1.3 — Density

MANIFEST rows are 40px. Add inside the same block:

  :root[data-surface='manifest'][data-density='default'] { --d-row-h: 40px; }
  :root[data-surface='manifest'][data-density='compact'] { --d-row-h: 34px; }

## 1.4 — Tailwind preset

packages/config/tailwind-preset.js — ONE additive change, nothing else:

  fontFamily: {
    sans: [...],           // unchanged
    deva: [...],           // unchanged
    mono: [...],           // unchanged
    display: ['var(--font-display)', 'Inter', 'system-ui', 'sans-serif'],  // NEW
  }

Also add the three wash colours to `colors`, since MANIFEST uses them and the
other themes will simply inherit undefined-safe fallbacks — add them to every
theme block in globals.css with sensible values first:

  'pass-wash': v('pass-wash'),
  'warn-wash': v('warn-wash'),
  'fail-wash': v('fail-wash'),

Do not change anything else in the preset. No new colour names, no new sizes.

## 1.5 — Fonts

apps/console/index.html — add to the existing Google Fonts link (one request,
not four):

  family=Newsreader:opsz,wght@6..72,500;6..72,600
  family=Public+Sans:wght@400;500;600;700
  family=JetBrains+Mono:wght@400;500;600;700

Keep Inter, IBM Plex Mono and IBM Plex Sans Devanagari — the admin console and
Hindi still need them.

## 1.6 — Extend the contrast test

packages/ui/src/tokens.spec.ts already recomputes WCAG ratios from the tokens
actually present in globals.css. Extend it with a MANIFEST block, parsed the
same way, asserting at minimum:

  ink       on sheet   >= 4.5      ink      on ground  >= 4.5
  ink-2     on sheet   >= 4.5      ink-2    on ground  >= 4.5
  ink-3     on sheet   >= 4.5      ink-3    on ground  >= 4.5
  ink-4     on sheet   >= 3.0
  acc-ink   on sheet   >= 4.5      acc-ink  on acc-wash >= 4.5
  acc-on    on acc     >= 4.5
  pass/warn/fail on sheet >= 4.5
  on-chrome on chrome  >= 4.5

The values above pass. If your parse says otherwise, your parse is wrong —
check you are reading the manifest block and not a neighbouring one.

## 1.7 — Prove the safety property

Add `packages/ui/src/manifest-scope.spec.ts`:

  - Every declaration inside `:root[data-surface='manifest']` is a custom
    property. No element selectors, no utilities.
  - Every custom property it declares also exists in `:root[data-t='light']`,
    so the scope only ever OVERRIDES and never introduces a token the rest of
    the system does not have.

## Acceptance

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] Add `data-surface="manifest"` to <html> by hand in devtools on the ADMIN
      console: the page turns into paper and nothing breaks. Remove it: the page
      returns exactly as it was. Screenshot both.
- [ ] `grep -rE "#[0-9a-fA-F]{6}"` across apps/ and packages/ excluding
      globals.css returns nothing new.
- [ ] Commit: `feat(ui): MANIFEST token scope for the vendor surface`
```

---

# STAGE 2 — The vendor frame and the navigation

This is the stage that fixes "everything looks clubbed". Still no screen
content — the frame only.

```
Build the vendor shell and restructure vendor navigation.

## 2.1 — New file: apps/console/src/shell/VendorShell.tsx

A SEPARATE component from Shell.tsx. Do not modify Shell.tsx.

Reason: MANIFEST has a paper masthead, not the dark chrome bar. Forking the
component is a 200-line file; forking it with conditionals is a permanent tax on
every future change to either surface.

Structure, top to bottom:

  MASTHEAD — two tiers, paper, closed by a DOUBLE RULE (2px + 1px, 3px apart).
    Tier 1 (utility, 30px, --sheet-2 ground, hairline under):
      left   — "TRUEGRADE SUPPLIER PORTAL" in mono, 10px, letter-spacing .14em
      right  — org legal name · city · a mono "UDYAM" chip when registered ·
               the signed-in person's name · sign out
    Tier 2 (identity, 58px, --sheet ground):
      left   — Logo, then the wordmark in font-display 600 at 20px
      centre — search input, square, 1px --rule border, no radius, no shadow,
               placeholder "Search listings, POs, serials"
      right  — a 28px square avatar with initials, mono, 1px border

  BODY — max-width var(--maxw), 2-column grid:
    RAIL 238px, sticky, its own scroll, --sheet ground, 1px --rule right border
    MAIN flex-1, --ground, padding 28px 32px

  FOOTER — --chrome band, 3 columns of links, then a hairline, then a mono line:
    "TrueTech Services Pvt. Ltd. · CIN · GSTIN · Grievance officer"

## 2.2 — The rail

  - Section headings: mono, 9.5px, letter-spacing .11em, uppercase, --ink-4,
    with a 1px --rule-2 under, 16px above / 6px below.
  - Items: 30px high, 13px, --ink-2. Active = --acc-wash background, --acc-ink
    text, and a 2px --acc bar on the LEFT edge. No radius.
  - Count on the right: mono 11px in a 1px --rule-2 bordered box, --ink-3.
    A count that represents WORK WAITING (corrections, POs to acknowledge)
    uses --fail border/text instead. Zero renders as nothing, not as "0".
  - Money counts render as "₹4.2L", not "₹4,21,300" — the rail is a glance.

## 2.3 — Restructure the vendor nav

apps/console/src/shell/nav.ts. The seven vendor entries currently all carry
`group: 'Vendor'`. `visibleGroups()` run-length groups by that field, so
changing the group strings — in order — gives the six sections for free.

Add ONE field to `NavEntry`:

  /** Which frame renders this entry. Absent means the admin Shell. */
  surface?: 'VENDOR';

Replace the vendor entries with this list, IN THIS ORDER (order is the
grouping — do not sort, do not interleave):

  group 'Today'
    /vendor                      Dashboard        listing.own.read
  group 'Sell'
    /vendor/listings             Listings         listing.own.read       count: liveListings
    /vendor/listings/new         Create listing   listing.own.write
    /vendor/sku-request          Request a SKU    listing.own.write
  group 'Inspect'
    /vendor/qc/visits            Inspections      listing.own.read       count: openVisits
    /vendor/corrections          Grade corrections listing.own.read      count: openCorrections  WORK
  group 'Fulfil'
    /vendor/orders               Purchase orders  procurement.po.read_own count: unacknowledgedPos WORK
    /vendor/dispatch             Dispatch         procurement.po.read_own count: awaitingDispatch
  group 'Money'
    /vendor/payables             Payables         procurement.payable.read_own  count: netDue (money)
    /vendor/payouts              Payout history   procurement.payable.read_own
  group 'Account'
    /vendor/team                 Team & access    listing.own.read       count: memberCount
    /vendor/facilities           Facilities       listing.own.read
    /vendor/documents            Documents        listing.own.read
    /vendor/profile              Profile          listing.own.read

Every one carries `orgType: 'VENDOR'` and `surface: 'VENDOR'`, as today.

TWO THINGS THAT WILL BREAK IF YOU MISS THEM:

  a) `Landing` in App.tsx picks `NAV.find(canSee)`. `/vendor` must remain the
     FIRST vendor entry or signing in as a vendor lands somewhere else.

  b) TopBar in Shell.tsx filters `group !== 'Vendor'` to keep vendors out of the
     section tabs. That string no longer matches. Change the filter to
     `entry.surface !== 'VENDOR'` — this is the ONLY edit permitted to
     Shell.tsx in this whole piece of work, and it is a filter predicate.

## 2.4 — Live counts in the rail

New file: `apps/console/src/shell/useVendorCounts.ts`

  - One call to `GET /api/vendor/dashboard`, cached for 60s, shared across the
    rail via context so the rail does not refetch per item.
  - Returns `{ liveListings, openVisits, openCorrections, unacknowledgedPos,
    awaitingDispatch, netDue, memberCount } | undefined`.
  - While undefined, render NO count. Never render a skeleton or a zero in the
    rail — a flickering number is worse than a late one.
  - If the dashboard response does not carry a field yet, omit that count and
    record it in the ledger. Do not invent it and do not add an endpoint in
    this stage.

## 2.5 — Wiring data-surface

New file: `apps/console/src/lib/vendor-surface.tsx`

  export function VendorSurfaceSync(): null

  useLayoutEffect: set `data-surface="manifest"` and `data-density="default"`
  on document.documentElement on mount; REMOVE both on unmount. Mount it inside
  VendorShell so admin routes never carry the attribute.

  Guard against the flash: in apps/console/index.html, extend the existing
  pre-paint script so a first paint on a /vendor/* URL already has the
  attribute:

    try{
      document.documentElement.setAttribute('data-t','light');
      localStorage.setItem('tg-console-theme','light');
      if(location.pathname.indexOf('/vendor')===0){
        document.documentElement.setAttribute('data-surface','manifest');
        document.documentElement.setAttribute('data-density','default');
      }
    }catch(e){}

## 2.6 — Routing: ONE line in App.tsx

Change only this:

    {vendorRoutes.map((r) => (
      <Route key={r.path} path={r.path} element={<Shell>{r.element}</Shell>} />
    ))}

to:

    {vendorRoutes.map((r) => (
      <Route key={r.path} path={r.path} element={<VendorShell>{r.element}</VendorShell>} />
    ))}

Import VendorShell. Nothing else in App.tsx changes. The vendor barrel's
elements already carry their own RequirePermission — do not add a second guard.

## 2.7 — Register the new routes

apps/console/src/routes/vendor/index.ts — ADD these. Existing entries keep their
paths, their order and their permissions untouched.

  /vendor/team          listing.own.read            VendorTeamRoute
  /vendor/facilities    listing.own.read            VendorFacilitiesRoute
  /vendor/documents     listing.own.read            VendorDocumentsRoute
  /vendor/dispatch      procurement.po.read_own     VendorDispatchRoute
  /vendor/payouts       procurement.payable.read_own VendorPayoutsRoute

For this stage each new route may be a placeholder that renders a PageHeader and
an EmptyState. They get built in stages 6-8. A placeholder that renders the
frame correctly is the point — it proves the routing before the content exists.

## Acceptance

- [ ] Sign in as owner@northgate.example. The rail shows six groups with
      headings and counts. Screenshot at 1440, 900, 600.
- [ ] Sign in as admin@trugrade.in. The admin console is PIXEL-IDENTICAL to
      before this stage. Screenshot-diff it against a `git stash` build.
- [ ] Hard-reload on /vendor/payables — no flash of the admin palette.
- [ ] Every existing vendor URL still resolves. Walk all 19 by hand.
- [ ] ops@northgate.example (VENDOR_OPS) sees no Money group. finance@
      faridabad.example sees Money but no Sell actions.
- [ ] Commit: `feat(console): MANIFEST vendor shell and grouped navigation`
```

---

# STAGE 3 — Shared components, MANIFEST behaviour

```
Make the shared components render correctly under data-surface="manifest".

Nothing here is a fork. Every component already styles through tokens, so most
of this is removing assumptions that only held for the amber/dark system.

## 3.1 — Audit first, then fix

Run `pnpm storybook` with `data-surface="manifest"` on the root and walk every
story. Record in the ledger which components are wrong and why. Expect:

  DataTable / DataBoard
    - Add COLUMN RULES: 1px --rule-2 between columns. MANIFEST tables are
      ledgers and the vertical rule is the signature.
    - Header row: --sheet-2, a 2px --ink bottom border (not 1px --rule).
    - Zebra OFF. Rules carry the separation.
    - Row hover: --sheet-2. Selected row: --acc-wash + 2px --acc left inset.
    - Numeric columns right-aligned with tabular-nums. This is already the
      rule; verify it actually holds.

  Button
    - primary: --acc fill, --acc-on text, 0 radius, no shadow.
    - secondary: transparent, 1px --ink border, --ink text.
    - ghost: no border, --ink-2 text, underline on hover.
    - Remove every rounded-* and shadow-* class; they come from tokens now.

  StatusPill  — 0 radius, 1px border, mono 10px, uppercase, .08em tracking.
  GradeBadge  — square, 1px --rule border, --sheet ground, mono. NEVER coloured.
  EmptyState  — headline in font-display, ONE line under it, ONE action. If the
                current copy is a paragraph, cut it to a line.
  Modal       — square, 1px --ink border, no radius, no shadow, a double-rule
                header. MANIFEST has no floating cards; a modal is a sheet.
  Stepper     — numerals in mono inside 22px squares, connected by a hairline.
  Skeleton    — square, --sheet-3, no shimmer.

## 3.2 — New primitives in packages/ui

  ClauseHeading   — the MANIFEST page title. A mono clause number in a 44px
                    left margin, the title in font-display 600 at 22px, and a
                    DOUBLE RULE under the whole block. Props: { n, title,
                    actions?: ReactNode }.

  LedgerRow       — label left, value right, dotted leader between, value in
                    mono. The payables and PO money breakdowns are built from
                    this and from nothing else.

  RegisterStrip   — the MANIFEST KPI row. A single 1px --rule bordered strip
                    divided by column rules into N cells. Each cell:
                    mono label 9.5px uppercase / value in mono 26px / one line
                    of denominator in --ink-3 11px. NO PARAGRAPH. The prop type
                    must make a paragraph impossible: `{ label: string; value:
                    string; sub?: string }` where sub is capped at 40 chars —
                    assert it in the component's spec.

  InfoPopover     — a `?` button, 14px square, 1px --rule border, mono. Opens a
                    popover, max 320px, with the long explanation. THIS IS WHERE
                    ALL THE DELETED PROSE GOES. Keyboard accessible, Escape
                    closes, focus returns to the button.

  PermissionGrid  — capability rows × role columns. Cells render ● full,
                    ◐ limited, – none. Used by Stage 8 and by the admin later.

## 3.3 — The 40-char rule

Add an ESLint rule or a spec that fails the build when a JSX text node inside
`apps/console/src/routes/vendor/**` exceeds 120 characters. It is blunt, it is
correct, and it is the only thing that will stop the prose growing back. Wire
it into the lint job.

## Acceptance

- [ ] Storybook builds; every story correct under manifest AND under the
      existing themes. The admin console must not regress.
- [ ] axe clean in both.
- [ ] `pnpm test` green including the new RegisterStrip cap spec.
- [ ] Commit: `feat(ui): MANIFEST component behaviour and ledger primitives`
```

---

# STAGE 4 — Today, Listings, Units

```
Rebuild the three Sell screens. Read Stage 0 rules again before you start —
particularly rule 1.

## /vendor — Today (ARCHETYPE E)

Current file: apps/console/src/routes/vendor/Dashboard.tsx

DELETE the explanatory copy under every tile. Keep the honesty, move it into an
InfoPopover on the tile label.

  ClauseHeading n="01" title="Today" with the date in mono on the right.

  RegisterStrip, five cells:
    LIVE LISTINGS      34      of 41 submitted
    UNITS ON SALE      187     across 6 SKUs
    AWAITING INSPECTION 12     oldest 4 d
    POs TO FULFIL      5       2 unacknowledged
    DUE TO YOU         ₹4,21,300   net of TDS

  "02 · Needs you" — a QueueList, SLA-ordered worst first. Each row:
    a severity square (8px, --fail / --warn / --acc), the subject, a mono age
    ("41 h"), a mono SLA ("72 h"), a state chip, and a right-aligned "Open →".
    No description line. The subject and the numbers are the description.

  "03 · Money" — a compact LedgerRow stack:
    Gross · TDS · Penalties · QC fees · ruled total · Net due
    with a mono MSME clock chip where a Udyam registration exists.

  One primary action, top right: "Create listing".

Data: GET /api/vendor/dashboard. If a field is missing, omit the cell and say
so in the ledger. Do not invent a number and do not add an endpoint.

## /vendor/listings — Listings (ARCHETYPE B)

  ClauseHeading n="01" title="Listings".
  Filter row: a single bordered strip of square selects — Status, Grade, SKU,
  Facility, and a search input. All state in the URL via lib/urlState.ts, which
  already exists. No filter rail on this screen; the strip is enough for five.
  DataTable, column rules on, 40px rows:
    SKU (mono) · Model · Grade · Units live/total · Ask (mono ₹) · Commission %
    (mono, with denominator) · Status · Updated · actions
  Row click → /vendor/listings/:id. Actions column: Reprice · Bulk upload.
  Empty state: "No listings yet" + "Create listing". One line, one action.

## /vendor/listings/:id — Units (ARCHETYPE C)

  ClauseHeading n="01" with the SKU in mono as the title and the model beneath.
  A RegisterStrip of four: Units · On sale · Ask · Commission.
  "02 · Machines" — DataTable of serials: Serial (mono) · Grade declared ·
  Grade actual · QC score · Battery · Seal · State · Movement.
  Grade actual differing from declared gets a --warn left inset on the row —
  not a sentence, a rule.
  Right side panel: Actions (Reprice, Bulk upload, Request inspection) and a
  LedgerRow stack of the payout preview.

## Acceptance per screen

- [ ] Word count of visible copy under 60 for Today, 40 for the boards. Count it.
- [ ] Every number mono + tabular-nums. Every percentage carries a denominator.
- [ ] Loading / empty / error / success all built and screenshotted.
- [ ] 1440 / 900 / 600. Table scrolls inside its container at 600; page never
      scrolls sideways.
- [ ] Commit: `feat(console): MANIFEST vendor today, listings and units`
```

---

# STAGE 5 — Inspect

```
/vendor/qc/visits, /vendor/qc/visits/:id, /vendor/qc/visits/:id/results,
/vendor/corrections, /vendor/corrections/:id

## Visits board
  ClauseHeading "01 · Inspections". Status filter in the URL (the
  /vendor/qc/requests redirect already depends on ?status=REQUESTED — keep it
  working). Table: Visit · Facility · Requested · Scheduled · Technician ·
  Units · State. A visit with no scheduled date shows "—" in --ink-4, never a
  placeholder date.

## Visit detail
  ClauseHeading with the visit reference in mono. RegisterStrip: Units ·
  Inspected · Passed · Failed. Timeline as a hairline-connected list, mono
  timestamps. Cancel action present only where the role holds listing.own.write
  — absent, not disabled-with-a-paragraph.

## Results
  Per-unit table: Serial · Declared · Actual · Score · Battery · Verdict.
  Verdict PASS/FAIL uses --pass/--fail. Grade columns stay NEUTRAL.
  "Not measured" renders in --ink-4 as "—". Never a tick.

## Corrections board + detail
  The auto-apply countdown is the most important number on the screen: mono,
  22px, with the deadline timestamp under it in --ink-3.

  IMPORTANT — a correctness issue, not a design one: the product tells vendors
  the corrected grade applies automatically when the window closes. It does
  not. GradeCorrectionService.autoApplyDue() in apps/api has no scheduler
  attached and runs nowhere outside its test.

  In this stage: change the copy so it states what is true, and add a line to
  the ledger under "Open questions" flagging that the job needs wiring. Do NOT
  fix the backend here — it is a separate change with its own tests.

  Response panel: four square radio cards — Accept · Reprice · Withdraw ·
  Dispute. A role without listing.grade_correction.respond gets no panel at all.

## Acceptance
- [ ] Copy under 40 words per screen.
- [ ] The countdown matches the server value; it is not computed in the browser.
- [ ] Ledger carries the auto-apply flag.
- [ ] Commit: `feat(console): MANIFEST vendor inspections and grade corrections`
```

---

# STAGE 6 — Fulfil, and two things that do not exist yet

```
/vendor/orders, /vendor/orders/:poId, /vendor/orders/:poId/pick-list,
/vendor/dispatch (new)

## PO board and record — restyle, plus ONE new capability

  ClauseHeading "01". RegisterStrip: Open POs · Unacknowledged · Units to pick ·
  Value. Table with column rules. The record screen carries the money as
  LedgerRows: agreed · TDS (with the section as an InfoPopover, NOT as the
  paragraph currently on screen) · net.

  REJECTING A PURCHASE ORDER DOES NOT EXIST. The columns rejected_at and
  rejection_reason exist in the schema and are rendered, and nothing anywhere
  writes them. Build it:

    API   POST /api/vendor/purchase-orders/:poId/reject
          body { reason: enum, note?: string }
          permission procurement.po.acknowledge — the same right that accepts
          guard: only from ISSUED; a rejected PO cannot be acknowledged later
          writes rejected_at, rejection_reason, an order_event, and an audit row
          integration test: reject → state, event, audit, and a second reject 409s

    UI    a secondary "Reject" beside "Accept", opening a Modal with a reason
          select (Out of stock · Grade mismatch · Price disputed · Cannot meet
          date · Other) and an optional note. Square, no radius.

  This is the one place this whole piece of work touches the API. Keep it to
  this endpoint.

## /vendor/dispatch — new screen

  A board of acknowledged POs awaiting dispatch: PO · Units · Facility ·
  Dispatch address · Ready by · AWB · State.

  There is no carrier integration. The API has no shipment writer. So this
  screen ships as MANUAL dispatch recording only:
    "Mark dispatched" → a Modal capturing carrier (free text), AWB (mono
    input), dispatched date. It records; it does not book.

  If no endpoint exists to record it, build ONLY
  POST /api/vendor/purchase-orders/:poId/dispatch and say so in the ledger. Do
  not build a CarrierPort implementation in this stage.

## Acceptance
- [ ] Reject works end to end with an integration test; a rejected PO cannot
      then be acknowledged.
- [ ] Dispatch records and shows on the PO record.
- [ ] Copy under 40 words per screen. The TDS paragraph is in a popover.
- [ ] Commit: `feat(console,api): MANIFEST fulfilment, PO reject and dispatch`
```

---

# STAGE 7 — Money

```
/vendor/payables, /vendor/payouts (new)

## Payables
  This screen is already the best-built one in the vendor portal and its
  content is right. It is carrying roughly 400 words that should be 60.

  ClauseHeading "01 · Payables".
  RegisterStrip: Gross · Deductions · Net due · Oldest item.
  "02 · Deduction stack" — LedgerRows, right-aligned, dotted leaders, a ruled
  subtotal and a double-ruled total. Each deduction's explanation moves into an
  InfoPopover on its label. The TDS section citation goes in the popover.
  "03 · Open items" — table: Reference · PO · Raised · Due · Age · Amount ·
  MSME clock. A row past the statutory 45 days gets a --fail left inset.
  Bank + penny-drop state as a compact strip of chips, not sentences.

## /vendor/payouts — new screen
  Payout runs do not exist — procurement.payout_run has never been written to.
  So this screen ships as an honest EMPTY STATE, not a fabricated history:
  ClauseHeading, a RegisterStrip of zeros with real denominators, and an empty
  state of ONE line. Do not write a paragraph explaining why it is empty; the
  zero and the label are the explanation.

  When payout runs are built, this screen becomes a table with no redesign.

## Acceptance
- [ ] Payables copy under 60 words visible; every removed sentence is reachable
      from a popover.
- [ ] MSME 45-day clock correct against the server value.
- [ ] Commit: `feat(console): MANIFEST payables and payout history`
```

---

# STAGE 8 — Team & access, and the rest of Account

This is the screen you specifically asked for. It does not exist today, and
today every vendor's warehouse, accountant and owner share one login.

```
/vendor/team (new), /vendor/facilities (new), /vendor/documents (new),
/vendor/profile (restyle)

## 8.1 — API first

Check apps/api/src/modules/identity/internal/account.service.ts — team
endpoints exist for BUYER organisations (GET/PATCH /api/account/team). Reuse
them for vendors if org scoping already permits it; extend only if it does not.

Needed:
  GET    /api/account/team                    list members
  POST   /api/account/team/invites            { email, role, facilityIds[] }
  DELETE /api/account/team/invites/:id        revoke
  POST   /api/account/team/invites/:id/resend
  PATCH  /api/account/team/:userId            { role?, facilityIds?, status? }

Rules the API must enforce — these are the whole point, do not leave them to
the browser:
  - Only VENDOR_OWNER may call any of these. permission: identity.team.manage
    (add it to the vendor owner role if absent).
  - The last owner cannot be demoted or suspended. 409 with a named reason.
  - facilityIds must all belong to the caller's org. Cross-org id → 403.
  - An invite is single-use, expires in 72 hours, and the token is a hash in
    the database, never the token itself.
  - The invited person sets their own password. NEVER email a credential.
  - Every mutation writes an audit row: actor, target, from, to.
  - A VENDOR_FINANCE or VENDOR_OWNER invite cannot complete without MFA
    enrolment — those two roles are already in MFA_REQUIRED_ROLES.

Integration tests for each rule above. The last-owner rule and the cross-org
facility rule are the two that matter most.

## 8.2 — The screen

  ClauseHeading n="01" title="Team & access", action "Invite member".

  "01 · Members" — DataTable, column rules, 40px rows:
    Name (with a mono initials square) · Email · Role · Facilities · Last
    active · 2FA · Status · actions
    Facilities render as up to two square chips then "+2". Not a sentence.
    2FA renders as a mono "ON" / "—". Status chips: ACTIVE / INVITED /
    SUSPENDED. An invited row is --sheet-2 with --ink-3 text.
    Row actions: Change role · Change facilities · Suspend · Remove.
    The last owner's row has those actions absent, not disabled.

  "02 · Pending invites" — only rendered when there are any. Email · Role ·
    Sent · Expires (mono countdown) · Resend · Revoke.

  "03 · What each role can do" — PermissionGrid, the centrepiece. Rows are
    capabilities, columns are the four roles. This grid IS the documentation;
    there is no policy paragraph anywhere on the screen.

      Capability                          Owner  Ops  Finance  Warehouse
      View listings                         ●     ●      ●         ●
      Create & edit listings                ●     ●      –         –
      Reprice                               ●     ◐      –         –
      Request an inspection                 ●     ●      –         ◐
      Respond to grade correction           ●     ●      –         –
      Acknowledge / reject a PO             ●     ●      –         ◐
      Print pick list, mark dispatched      ●     ●      –         ●
      View payables & payouts               ●     –      ●         –
      Edit bank details            [MFA]    ●     –      –         –
      Manage team                  [MFA]    ●     –      –         –
      Sign agreements              [MFA]    ●     –      –         –

      ● full   ◐ assigned facilities only   – none

    Roles map to existing constants in packages/contracts: VENDOR_OWNER,
    VENDOR_ADMIN (Operations), VENDOR_FINANCE, VENDOR_VIEWER (Warehouse).
    Do NOT invent new role names — map the labels onto what exists and record
    the mapping in the ledger.

  "04 · Invite" — a right rail, 376px, permanently docked (not a modal —
    MANIFEST has no floating cards). Fields as underline inputs: email, role
    select, facility multi-select. As a role is chosen, its column in the grid
    above highlights with --acc-wash. That is the preview; no preview text.

## 8.3 — Facilities, Documents, Profile

  Facilities — table: Name · Address · Dispatch address · Type · Hours ·
  Capacity. A facility whose dispatch address is unset shows "—" in --fail,
  because that field prints Dispatch From on every e-way bill.

  Documents — table: Type · File · Uploaded · Expires · State · Replace.
  Expiring within 30 days gets a --warn inset; expired gets --fail.

  Profile — restyle only. Move the paragraph-length field explanations into
  InfoPopovers. Split it so Team, Facilities and Documents are no longer
  clubbed into this one screen.

## Acceptance
- [ ] Invite → email → set password → sign in → see exactly the permitted rail.
      Walk it for all four roles.
- [ ] Last owner cannot be removed; the API refuses and the UI does not offer it.
- [ ] A Warehouse member assigned to one facility cannot see another's POs.
      Prove it with an integration test, not by looking.
- [ ] Copy under 40 words visible on the team screen. The grid carries the rest.
- [ ] Commit: `feat(console,api): vendor team and access management`
```

---

# STAGE 9 — Close-out

```
## 9.1 — The deletion pass
Run this and fix every hit inside apps/console/src/routes/vendor:

  Find every JSX text node over 120 characters. For each: delete it, move it to
  an InfoPopover, or replace it with a label plus a value. Zero may remain.

Then count: total visible words across the vendor surface must be under 400.
Record the before and after in the ledger. It was roughly 3,000.

## 9.2 — Audits
  - Theme: every vendor route, no flash on hard reload, admin untouched.
  - States: loading, empty, error, success on all 24 vendor routes, screenshotted.
  - Responsive: 1440 / 900 / 600. The rail becomes a drawer under 900.
  - Accessibility: axe zero violations. Full keyboard path through invite,
    reject-a-PO, and respond-to-correction. Focus ring never removed.
  - Every number mono + tabular-nums. Every percentage has a denominator.
  - `grep -rE "#[0-9a-fA-F]{6}"` outside globals.css returns nothing.
  - No rounded corner and no box-shadow renders anywhere under manifest.

## 9.3 — Regression proof
  - Sign in as each of: owner@northgate.example, ops@northgate.example,
    finance@faridabad.example, finance@mayapuri.example. Screenshot each rail.
  - Sign in as admin@trugrade.in, qc@trugrade.in, kyc@trugrade.in and confirm
    the admin console is unchanged from before this branch.
  - All 19 original vendor URLs resolve to the same screens they did before.

## 9.4 — Handover
Write docs/VENDOR_MANIFEST_REVIEW.md: every route with its screenshot, the
before/after word count, the API endpoints added, what is deliberately still
empty (payout history, carrier booking) and why, and everything under Open
questions.

Then stop and say: "Vendor MANIFEST complete — see docs/VENDOR_MANIFEST_REVIEW.md."
```

---

## What this touches, at a glance

**New files (13)**
`shell/VendorShell.tsx` · `shell/useVendorCounts.ts` · `lib/vendor-surface.tsx` ·
`routes/vendor/Team.tsx` · `Facilities.tsx` · `Documents.tsx` · `Dispatch.tsx` ·
`Payouts.tsx` · `ui/ClauseHeading` · `LedgerRow` · `RegisterStrip` ·
`InfoPopover` · `PermissionGrid`

**Modified (7)**
`globals.css` (append only) · `tailwind-preset.js` (one fontFamily key) ·
`console/index.html` (fonts + prepaint) · `App.tsx` (one line) ·
`shell/nav.ts` (vendor entries regrouped, one new field) ·
`Shell.tsx` (one filter predicate) · every `routes/vendor/*.tsx` (restyle)

**API added (3 endpoints + team)**
PO reject · PO dispatch · team invite/manage

**Not touched**
Admin console · storefront · every existing vendor route path · the Darkroom
token block · permissions model · org scoping

---

## Two things to decide before Stage 1

**The accent.** MANIFEST's viridian `#1D5C4A` replaces teal on the vendor
surface only. The buyer storefront keeps `#6BB1BE`. If you want one brand colour
everywhere, say so now — swapping it later means re-verifying every contrast
pair.

**The clause numbers.** `01 ·`, `02 ·` in the left margin are MANIFEST's
signature and they carry meaning — the reading order of the screen. If they read
as clutter to your vendors, drop them in Stage 3 rather than after every screen
is built.
