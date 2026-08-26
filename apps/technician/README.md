# @trugrade/technician

The field-inspection app. Expo (SDK 57) + expo-router, native only.

A technician arrives at a vendor's warehouse, inspects up to forty machines,
grades each against `@trugrade/contracts`, applies a numbered tamper seal,
photographs it on the machine, and gets the vendor's OTP sign-off — **with no
signal for most of the day.**

## The one thing to understand first

**The outbox is the app.** Every action is a row in SQLite before it is a network
call, including the photographs. Read `src/queue/outbox.ts` and `src/queue/sync.ts`
before anything else; the screens are a way of putting rows into that table.

Three rules carry the whole offline guarantee:

1. **The nonce is minted once, at enqueue, and every retry re-sends it unchanged.**
   `qc_tool_run.nonce UNIQUE` and `UNIQUE (tool_provider_id, tool_run_id)` then
   make a replay one row and a `200`. Minting a fresh nonce per attempt turns a
   flaky connection into duplicate inspections and defeats the entire mechanism.
2. **Delivery is strict FIFO by row id.** Photographs are enqueued before the
   result that cites their object keys, and the seal photograph before the seal
   row whose `applied_photo_key` is NOT NULL. Insertion order *is* the dependency
   graph, so there is no dependency graph to get wrong. The cost is head-of-line
   blocking, which rule 3 pays for.
3. **Permanent failures step aside; transient ones hold the line.** A 4xx parks
   as `BLOCKED` and the queue continues — a technician with thirty-nine good units
   must not lose them behind one bad payload. A dropped connection, a 5xx or an
   expired token backs off and waits, because none of those is a reason to discard
   a day's work.

The pending count is in the navigation header of every screen (`headerRight` on
the single `Stack`, so a new screen cannot be added without it). A silent queue is
how a day's work gets lost.

## Layout

```
app/                      expo-router routes, one file per screen
  _layout.tsx             the Stack, the provider, the always-visible badge
  index.tsx               sign in + device binding
  route.tsx               today's visits — also pre-downloads every snapshot
  sync.tsx                what has not reached the server, and why
  visit/[visitId]/        kit check · check-in · manifest · sign-off · expenses
  unit/[visitUnitId].tsx  the seven-step inspection
src/
  db/db.ts                the Db port + schema (no expo import — see Testing)
  db/expo-db.ts           the production driver
  queue/outbox.ts         enqueue, head, mark, count
  queue/sync.ts           drain: order, backoff, permanent vs transient
  queue/actions.ts        one function per action — and every dedupe key
  api/routes.ts           every server path, in one file
  api/transport.ts        outbox row → HTTP (pure; testable)
  api/client.ts           fetch, tokens, signed-URL PUT (the only expo bit)
  domain/model.ts         snapshot, draft, areas, photo angles
  domain/verdict.ts       the bridge into @trugrade/contracts — no rules of its own
  unit/                   certificate handover, and the step components
```

## Grading lives in `@trugrade/contracts`

Nothing in this app decides a grade. `assessDraft` arranges inputs and calls
`evaluateQcReport`, `assessCertificate`, `compareSpec` and `normalisePastedSerial`.
That is why a technician seeing "this will not list" is seeing the server's answer
rather than an approximation of it — and why a threshold change is a config change
rather than an app release.

Two consequences worth knowing:

- **The area vocabularies are split.** `qc_area_result` allows twelve *functional*
  codes (DISPLAY, MEMORY_CPU, BIOS_SECURITY…), while `QC_AREAS` in contracts names
  twelve *cosmetic* areas (CHASSIS, LID, PALMREST…). They do not map onto each
  other. The functional results come off the DeviceSure certificate and are judged
  by `assessCertificate` (which takes `area` as a string and already implements the
  07 §3.1 floor rule); the cosmetic ones are the technician's own judgement and are
  what `evaluateQcReport` is typed for. `QC_AREA_CODES` in `src/domain/model.ts` is
  a local copy pending a fix in contracts.
- **Nothing is corrected in transit.** DeviceSure v0.1.0 reports 15 GB for a 16 GB
  machine (07 §3.4). `detectedFromCertificate` passes that straight through as
  `ramUsableGb`; `compareSpec` already knows the difference and renders both
  numbers. There is no `+1` anywhere and there must not be one.

## Testing

`pnpm --filter @trugrade/technician test` — 28 tests, no simulator, no native build.

The queue is plain TypeScript over a three-method `Db` port, so the tests run it
against `node:sqlite`: the same schema and the same SQL the device runs, with the
`UNIQUE (dedupe_key)` conflict and the `ORDER BY id` head-of-line rule enforced by
the engine rather than by a fixture. `node:sqlite` ships with Node 22, so this
costs no dependency and no native build.

Nothing under `test/` imports an `expo-*` module, and neither does anything it
imports. Keep it that way — it is the reason the offline layer has real coverage.

## Notes on the toolchain

- **No `build` script.** The artifact is a native binary produced by EAS, not a
  `dist/` directory, so turbo has no `build` task for this package. `typecheck`,
  `lint` and `test` all run in CI.
- **`customConditions: ["react-native-legacy-deep-imports"]` in `tsconfig.json`.**
  RN 0.87 ships two type surfaces. Under the default generated set, `expo/types`'
  react-native-web augmentation widens `ViewStyle`/`TextStyle` with web-only values
  (`position: 'fixed'`), which the generated component props then refuse — so every
  `<Text style={…}>` fails against styles `StyleSheet.create` itself produced. This
  selects the hand-written types instead. It is type-only; Metro resolves the
  runtime. Revisit when Expo reconciles the two upstream.
- **`metro.config.js` is required, not optional.** pnpm does not flatten
  `node_modules`, so Metro needs the workspace root in `watchFolders` and
  `nodeModulesPaths`, with `disableHierarchicalLookup` so it cannot pick up a
  second React from a nested tree.

## Not built here

`src/api/routes.ts` names endpoints that do not exist yet — the QC HTTP surface is
a different lane of Phase 4. They are in one file precisely so reconciling them is
one edit.
