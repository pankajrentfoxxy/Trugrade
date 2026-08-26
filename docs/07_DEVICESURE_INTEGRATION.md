# DeviceSure — review of v0.1.0, and how the marketplace consumes it

**25 August 2026.** Based on the certificate `fe486d18` (HP Victus 16-s0xxx, serial CND4233328), the master build specification, and the repo at `C:\Users\bibha\Downloads\Laptop_QC_Report`. **Supersedes `02_ARCHITECTURE.md` §5.3 and rewrites `PHASE_04_QC.md` Task 2.**

---

## 1. The correction this makes to the build pack

I had assumed a QC **executable** that emits a signed report file, which the marketplace ingests. That is wrong, and the real thing is better.

**DeviceSure is a product, not a tool.** It has its own NestJS API under `/api/v1`, its own Postgres, its own multi-tenancy on `organization_id`, its own licensing with `INTERNAL` and `VENDOR` keys, its own device passport with component history, its own offline sync, and its own public verification page. It already anticipates exactly the thing Gorefurbo needs: *"Internal warehouse first. The same core is designed for later licensed vendor access."*

So the integration is **not** "parse a file". It is:

```
DeviceSure (tenant: gorefurbo-ops)  ──webhook: qc.session.certified──▶  Gorefurbo qc module
                                    ◀──REST: GET /certificates/:id────
                                    ◀──REST: GET /passports/:fp───────
```

Gorefurbo becomes a **licensed organization inside DeviceSure**, and each of your vendors becomes a `VENDOR`-mode organization under a license you issue. That is a far stronger position than a file drop: you get tenancy, revocation, seat limits, feature flags and an audit trail for free, and you can switch a vendor's QC access off the moment they are suspended.

**Keep the two products separate.** Do not merge DeviceSure into the Gorefurbo monolith. It has a different release cadence, a different risk profile, a native Rust/Tauri layer, and — importantly — a plausible business of its own selling QC licences to refurbishers who never list on your marketplace. The `qc_tool_provider.field_map_json` abstraction stays: DeviceSure becomes provider code `DEVICESURE`, integration type `API` + `WEBHOOK`.

---

## 2. What is genuinely good, and worth protecting

I want to be specific, because these are the parts that would be expensive to rebuild if a later refactor eroded them.

**`never-fabricate.md` is the best document in the repo.** *"A missing value is not a passing value."* That single rule is what makes the certificate defensible under CP e-Comm r.7(5), and it is the discipline most diagnostic tools get wrong. The per-phase restatement — Phase 2 turns `To Be Filled By O.E.M.` into `UNSUPPORTED`, Phase 3 computes battery health only from measured full-charge and design capacities, Phase 6 leaves temperature `UNSUPPORTED` when there is no sensor — shows it is being applied, not just declared.

**PASS/FAIL separated from condition grade** (§18). A 65% battery is functionally PASS and cosmetically C. Most tools conflate these and produce nonsense. You didn't.

**Versioned rules, stored on every certificate.** The sample shows `Rules 1.0.0`. This is exactly what the marketplace needs: when a buyer disputes a grade in six months, the certificate says which rule set was in force. My `catalog.grade_definition` versioning was designed for this and now has a real counterpart.

**`hardware-matrix.md` defaulting every family to `UNKNOWN`**, with *"Do not mark a device PASS because a similar model worked."* That is unusually honest engineering and it will save you a class of bug that is nearly impossible to find later.

**Multi-tenancy done properly** — `organization_id` on every tenant-owned row, organization resolved from the token or the enrollment license, and *"a vendor-supplied organization id is ignored."* That last clause is the one people forget, and it is the difference between multi-tenancy and a data breach.

**The device passport with component history.** This is the sleeper feature. It detects that the 512 GB drive in this machine last month is a 256 GB drive today. For a marketplace where units sit at a vendor's premises between inspection and sale, that is a second, independent anti-swap control alongside the tamper seal — and it is worth surfacing in Gorefurbo explicitly.

---

## 3. Defects in the sample certificate

Ordered by how much they would hurt once this certificate is the basis of a sale. Every one is fixable and none is architectural.

### 3.1 The grade is A+ and the USB ports FAILED — **fix this first**

```
USB Ports    FAIL    30    ports.manual FAIL
Network/WiFi C       65    Connected (Wi-Fi); Not connected; Unreachable
Thermal      UNSUPPORTED
→ Overall: A+ · Excellent Condition · 98.24
```

A machine with a dead USB port is not in excellent condition, and your own §16 provides for hard-fail rules. They are not gating the grade. Two things are wrong:

- **The aggregate is swallowing the failure.** Eleven components at 100 and one at 30 averages to ~94 — the failure disappears into the mean. Weighted averaging cannot express "one critical component failed"; you need a **floor rule**: any component at `FAIL` or `CRITICAL_FAIL` caps the grade regardless of the mean.
- **`UNSUPPORTED` is being treated as neutral.** Thermal was not measured, and the grade is unaffected. For a marketplace that is not acceptable — an unmeasured thermal system on a gaming laptop is a material unknown. `UNSUPPORTED` on a **required** component should cap the grade at A (never A+) and be disclosed on the certificate face.

**Suggested rule shape, as configuration:**

| Condition | Effect on grade |
|---|---|
| Any `CRITICAL_FAIL` | Grade = FAIL, not certifiable |
| Any `FAIL` on a required component | Cap at C |
| Any `WARN` on a required component | Cap at A |
| Any `UNSUPPORTED` on a required component | Cap at A, and print "not measured" on the face |
| Component score below its own floor | Cap at that component's band |

This matters more for Gorefurbo than for internal warehouse use, because **the grade sets the price and is a legal claim.** Under CP e-Comm r.7(5) we vouch for it; under r.7(4) a buyer who receives an A+ with a dead USB port has a not-as-described return we cannot refuse.

### 3.2 The score block reads "24 / 100" — on a certificate

```
DEVICESURE SCORE:  A+   Excellent Condition   24 / 100      ← header block
CERTIFICATE:       Score 98.24                              ← page 2
```

`98.24` is being rendered as `24`. A field-binding or truncation bug, on a legal document, in the largest type on the page. Whatever else you do this week, do this.

### 3.3 Battery health is reported three different ways on one page

| Where | Value |
|---|---|
| Hardware Details | `78% (wear 23%)` |
| Diagnostic Results | `Battery 1 health SUPPORTED=77.5%` |
| Implied by wear 23% | `77%` |

Compute once, store, render everywhere from the stored value — the same discipline as the GST amounts in the marketplace design, and for the same reason: a document that disagrees with itself is a document nobody trusts. Pick a rounding rule (I'd store the raw ratio and render one decimal) and state whether "wear" is `1 − health` or something else.

### 3.4 `RAM 15 GB` will create a false mismatch on every machine

Windows `Win32_ComputerSystem.TotalPhysicalMemory` reports memory **usable by the OS**, not installed — firmware and integrated graphics take the difference. On this Ryzen 7 7840HS with Radeon 780M, 16 GB installed shows as 15 GB.

This is a direct problem for Gorefurbo: a vendor declares 16 GB, the tool detects 15 GB, and the grade-correction engine fires a mismatch **on every unit**. Sum `Win32_PhysicalMemory.Capacity` for installed capacity instead, and report both:

```
RAM: 16 GB installed (15.0 GB usable) · 2 modules · DDR5-5600
```

Same class of issue on storage: `KBG50ZNV512G KIOXIA (477 GB)` is a 512 GB drive measured in binary. Report the nominal marketed capacity alongside the actual — `512 GB (477 GiB usable)` — because the vendor declared 512 and the buyer expects 512.

### 3.5 `Cycle Count 0` violates your own never-fabricate rule

A cycle count of exactly 0 on a machine with 23% battery wear is not credible. WMI almost certainly did not expose it, and the collector is defaulting to zero. **`0` is a measurement; "not reported" is the truth.** Per `never-fabricate.md` this must be `UNSUPPORTED`, and the certificate should print `Cycle count — not reported by this system` rather than a number a buyer will rely on.

Audit every numeric collector for the same failure mode: a zero-value default is indistinguishable from a measurement, and it is the one way a never-fabricate policy leaks.

### 3.6 SHA-256 is integrity, not authenticity

The certificate carries `SHA-256 2fa7aff187e5ba52942102c4bc68436f8c048cf59cedb56752fbf65ddb2076d4`, and the spec says *"if practical, digitally sign."*

For internal warehouse use a hash is fine — you trust the operator. **For Gorefurbo it is not sufficient, and this is the single most important change on this list after 3.1.** A hash proves the document has not changed since it was written; it proves nothing about *who* wrote it, because anyone can author a payload and compute its hash. Once a vendor-run agent produces certificates that set the price we pay and the price a buyer pays, that agent is an untrusted party with a financial interest in the result.

What is needed:
- **Asymmetric signature** (Ed25519) over the canonicalised payload, signed **server-side** at certification — never in the desktop agent, exactly as your §29 already says about private keys.
- A **nonce** and a monotonic `issued_at` inside the signed payload, so a certificate cannot be replayed against a different unit or re-submitted.
- **Publish the public key** at a stable URL so Gorefurbo — and eventually a buyer — can verify independently rather than by asking DeviceSure whether DeviceSure is telling the truth.
- Keep the SHA-256 as well; it is useful and cheap.

### 3.7 Two rendering bugs in the PDF

- The Thermal row overprints `UNSUPPORTED` on itself — the grade and score cells are colliding.
- The QR code overlaps the *"Scan to verify public certificate fields only"* caption and the SHA-256 footer.

Small, but this document goes to a customer who is deciding whether to trust you, and a misaligned certificate reads as a careless one.

### 3.8 `Physical condition: A+` is one field where the marketplace needs twelve

The certificate captures cosmetics as a single technician judgement. Gorefurbo grades against **twelve inspection areas** — chassis, lid, palmrest, keyboard, trackpad, screen, hinges, ports, battery, storage, memory, thermals — each `PASS | WARN | FAIL` with a note, because that is what `catalog.grade_definition.allowed_defects_json` evaluates and what a buyer sees on the unit passport.

Extend the manual QC step to capture per-area results with a photograph per area. Your Phase 7 manual test system already has the right shape; it needs the area breakdown.

---

## 4. What DeviceSure needs to add for marketplace use

Beyond the fixes above. None of these are useful for internal warehouse QC, which is why they are absent — they exist only because the certificate is now a commercial instrument.

| # | Addition | Why |
|---|---|---|
| 1 | **`valid_until`** — certification date + 90 days | Stock sits at the vendor between inspection and sale. A six-month-old inspection is not a current claim. Gorefurbo auto-unlists on expiry and warns the vendor at 14 days |
| 2 | **`seal_code`** and a photograph of the seal on the machine | The tamper seal is what makes a 12-minute inspection meaningful three weeks later. `applied_photo_key` must be non-null — no seal without a photograph |
| 3 | **Photographs, six minimum** — lid, palmrest, screen on, ports, base, seal | The marketplace shows platform-owned representative images on listings; the **real** photographs on the unit passport are what makes that honest |
| 4 | **Wipe certificate** — standard (NIST SP 800-88 Purge), method, timestamp, technician | Every corporate buyer with a data-security policy asks for this per machine |
| 5 | **Declared-versus-detected** — accept a `declared_spec` on session creation and emit a structured diff | This is the grade-correction engine's entire input. Today the tool reports detected only, and the comparison has to be rebuilt downstream |
| 6 | **Inspection location** — facility ID, and geo at check-in | Anti-fraud. A technician checking in 40 km from the registered warehouse is a signal. Gorefurbo's `geo_variance_metres` expects this |
| 7 | **`UNSUPPORTED` count on the certificate face** | "Certified A+, 1 of 15 components not measurable" is honest. Silence is not |
| 8 | **Grade-scale mapping** | DeviceSure grades A+/A/B/C/D/FAIL. **Gorefurbo sells A+/A/B only — nothing worse than B is listed.** C, D and FAIL must map to *not listable*, explicitly, in `field_map_json`, not by convention |

---

## 5. The integration contract

Replaces `PHASE_04_QC.md` Task 2 in full.

### 5.1 Tenancy and licensing

- Gorefurbo Ops is a DeviceSure organization with an `INTERNAL` license.
- **Each vendor is a `VENDOR`-mode organization**, with a license Gorefurbo issues, `maxAgents` matching their approved technician count, and feature flags `BASIC_QC`, `FULL_QC`, `CERTIFICATES`, `QR_VERIFICATION`, `OFFLINE_MODE`.
- **Vendor suspension in Gorefurbo revokes the DeviceSure license** — one event, `vendor.suspended`, and their agents stop certifying. This is worth building on day one; it is the enforcement mechanism the whole quality model rests on.
- `API_ACCESS` is enabled only for the Gorefurbo Ops organization.

### 5.2 Session creation — Gorefurbo pushes the declaration

```http
POST /api/v1/qc/sessions
{
  "external_ref": "<gorefurbo unit_id>",
  "organization_id": "<vendor org>",
  "mode": "FULL",
  "declared_spec": {
    "sku_code": "DEL-LAT5320-I5-16-512",
    "ram_gb": 16, "storage_gb": 512, "storage_type": "NVMe",
    "cpu_model": "i5-1145G7", "screen_size_in": 13.3,
    "declared_grade": "A"
  },
  "seal_code_range": ["GF-8841-QK", "GF-8890-QK"]
}
```

`declared_spec` is what makes the diff possible. Without it the mismatch engine has nothing to compare against.

### 5.3 Certification — DeviceSure pushes back

Webhook `qc.session.certified` → `POST /qc/tool-runs` on Gorefurbo, carrying the full certificate payload plus the Ed25519 signature and nonce.

Gorefurbo then does what `PHASE_04_QC.md` Task 2 already specifies, unchanged: **store the raw payload verbatim first**, verify the signature, reject a replayed nonce, enforce `UNIQUE (tool_provider_id, tool_run_id)` for idempotency, compare `serial_from_tool` against the visit manifest and **hard-stop on mismatch**, then map through `field_map_json`.

### 5.4 The field map

`qc_tool_provider` row: `code = 'DEVICESURE'`, `integration_type = 'API'` + `WEBHOOK`, `report_format = 'JSON'`, `supports_wipe = true`.

| DeviceSure | Gorefurbo | Note |
|---|---|---|
| `certificate.id` | `qc_tool_run.tool_run_id` | idempotency key |
| `certificate.sha256` | `qc_tool_run.raw_report_hash` | |
| `certificate.signature` | `qc_tool_run.signature` | Ed25519, **to be added** |
| `session.rulesVersion` | `qc_report.rules_version` | already present — good |
| `device.serial` | `qc_tool_run.serial_from_tool` | drives `serial_matches` |
| `device.fingerprint` | `qc_report.device_fingerprint` | passport link |
| `score` | `qc_report.qc_score` | **after the 3.2 fix** |
| `grade` | `qc_report.grade_proposed` | **after the 3.1 fix**, and mapped per §4 item 8 |
| `testResults[]` | `qc_area_result` | one row per area, `UNIQUE (qc_report_id, area)` |
| `hardware.*` | `qc_hardware_detected` | RAM per §3.4, storage per §3.4 |
| `battery.healthPct` | `unit.battery_health_pct` | one canonical value, per §3.3 |
| `certificate.validUntil` | `qc_report.valid_until` | **to be added** |
| `seal.code` | `qc_seal.seal_code` | **to be added** |
| `photos[]` | `qc_photo` | **to be added** |
| `wipe.*` | `wipe_certificate` | **to be added** |

### 5.5 Two verification pages, one QR code

DeviceSure already serves `/verify/:certificateId` showing only safe fields. Gorefurbo has `/qc/verify/:verification_code` for the unit passport. **Do not build two competing public pages.**

Recommendation: **DeviceSure's page is canonical for the certificate; Gorefurbo's passport embeds it and adds commercial context** — warranty, order, seal status. The QR code on the printed certificate points at DeviceSure. The QR code on the shipping label points at the Gorefurbo passport, which links back.

**One hardening note that applies to both:** `certificateId` in the sample is a full UUID, which is fine — unguessable. Keep it that way, never a sequence, rate-limit the endpoint, and exclude it from `robots.txt`. It is a public URL, and an enumerable one publishes your entire inventory to a competitor with a for-loop.

---

## 6. On the name

You asked me to apply Chaldean numerology to the marketplace name, so it seems worth telling you the QC product's number rather than letting you find out later.

| Name | Chaldean | Reduced | Meets 5/6/9 |
|---|---|---|---|
| **DeviceSure** | 40 | **4** | ✗ |
| Pramaan | 22 | 4 | ✗ *(there is a `Pramaan.pdf` in the repo — I assume you tried it)* |
| Praman | 21 | 3 | ✗ |
| **DeviceSeal** | 36 | **9** | ✓ — `.com`, `.in` and `.co.in` all free |
| **DeviceCheck** | 42 | **6** | ✓ |
| Devicesafe | 41 | 5 | ✓ |

`devicesure.com` is taken; `devicesure.in` and `devicesure.co.in` are free.

**I would keep DeviceSure.** It is a good product name, it is already in the code, the binaries, the PDF and the brand mark, and renaming a product mid-build to satisfy a numerology rule you applied to a *different* company is a poor trade. If the number genuinely matters to you, **DeviceSeal** is the closest alternative that passes — and it happens to describe the tamper-seal step that makes the whole marketplace model work.

---

## 7. What I need from you next

1. **The `@devicesure/contracts` package** — the Zod schemas are the real contract, and they will let me write the exact field map instead of inferring it from a PDF.
2. **A sample JSON certificate payload**, not the PDF render.
3. **Confirmation on the vendor-licensing model** — is each Gorefurbo vendor a separate `VENDOR` organization, as §5.1 assumes?
4. **Who runs the agent at a vendor site** — your technician on a company laptop, or the vendor's own staff under a licence? This is still Q15 from `01_DECISIONS_AND_COMPLIANCE.md`, it is still the highest-value open question in the pack, and it is now also a DeviceSure licensing question.

**Nothing in Gorefurbo Phases 0–3 or 5–10 is blocked by any of this.** Only Phase 4's ingestion layer waits on the contract, and it has a working mock in the meantime.
