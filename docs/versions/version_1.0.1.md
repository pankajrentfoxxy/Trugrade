# Version 1.0.1

**Date:** 11 September 2026

Work from 10–11 September 2026. Written in short points.

---

## 1. Flow changes

### Vendor registration (`/sell/register`)

1. Statutory step no longer asks which GSTIN is primary. One GSTIN is enough.
2. Website is not collected and is not saved.
3. Headcount (people on payroll) is not asked.
4. Monthly laptop capacity and quality band are not asked.
5. Typical lowest / highest price are not asked.
6. “What you supply” and “Where stock comes from” are optional.
7. Lead time is hours (4 / 8 / 12 / 24), not days.
8. Operating hours: Mon–Sat default 10:00–19:00. Sunday starts as closed.
9. “Can you dispatch directly to the customer?” is not asked.
10. Authorised signatory ID is optional.
11. Board resolution is not asked.
12. Minimum payout amount is not asked.
13. Address proof is optional. Its date is also optional.
14. Cancelled cheque and cheque date are not asked.
15. CPCB e-waste registration is not asked.

### New listing (`/vendor/listings/new`)

1. Vendor searches the catalog by **brand + model** (example: Dell Latitude 3420).
2. Dropdown shows brand and model only. SKU id is hidden in the list.
3. After a model is picked, vendor chooses memory, storage, graphics, screen.
4. SKU id appears only when every config field is filled.
5. Grade step is a short card with photos. Click a photo to open a lightbox. No caption in the lightbox.
6. Serial step does not show Dell-shape / “worn label” warnings. Real errors (duplicate, already listed) still show.
7. Net payout per machine is required. Type is number.
8. “Request the inspection” stays disabled until the form is valid, and stays disabled while the API is running.
9. Payout API errors show on the payout field, not only as “Some of the details need fixing.”
10. If the batch is below the visit minimum, the visit-fee paragraph is hidden. The button says **Inspect now**.

### Buyer order → vendor purchase order

**Old flow:** buyer places an order → a specific machine (unit + serial + QC report) is written on the PO and on the order at once.

**New flow:**

1. Buyer places an order for a SKU + grade + quantity.
2. Stock is held (reserved). No serial is named to the buyer.
3. Purchase order is raised with empty machine slots (`unit_id` and `qc_report_id` are null).
4. Order line units are also empty (`unit_id`, `serial_number`, `qc_report_id` are null).
5. Vendor sees the PO, then **Accepts** it.
6. After accept, vendor **Attaches** a matching listed machine (same SKU + grade).
7. Attach writes the unit, serial and QC report on the PO line and on the matching vacant order line.
8. Buyer confirmation shows a unit count, not serials. Serials appear after attach.

### Buyer registration (`/register`)

1. Statutory step comes before Company step (same idea as vendor).
2. Website is not collected or saved for buyers.
3. Billing address can prefill from GST verify on the Contacts step.
4. Pincode lookup uses live India Post data (no mock/fake areas).

---

## 2. Schema / database changes

1. `vendor.vendor_capability.monthly_capacity_units` — no longer required (nullable).
2. `kyc.onboarding_field_requirement` — board resolution row removed for vendors.
3. Document rules updated: address proof optional; cancelled cheque and CPCB e-waste dropped from the vendor checklist.
4. `procurement.purchase_order_line.unit_id` — now optional (nullable).
5. Open POs (`RAISED`, `ACKNOWLEDGED`) — existing `unit_id` and `qc_report_id` cleared so the vendor must attach.
6. `ordering.order_line_unit.unit_id` — now optional.
7. `ordering.order_line_unit.serial_number` — now optional.
8. `ordering.order_line_unit.qc_report_id` was already optional; checkout now leaves it null until attach.
9. Buyer onboarding step order — statutory before business (migration `20260914010000`).

**New / updated APIs**

- `GET /api/vendor/purchase-orders/:poId/attachable-units?skuId=&grade=` — listed (or reserved-for-this-order) machines that match.
- `POST /api/vendor/purchase-orders/:poId/attach` `{ skuId, grade, unitId }` — bind a machine after the PO is accepted.
- Checkout / confirm no longer allocates a named unit. Buyer payload has `units` and empty `serials`.
- `GET /api/onboarding/pincodes/:pincode` — always live India Post lookup; `Cache-Control: no-store`.

**Seed**

- Northgate demo user (`owner@northgate.example`) has raised POs with vacant lines, so attach can be tested (example: PO-26-00015, PO-26-00016).

---

## 3. UI changes

### Vendor registration

1. Primary GSTIN radio removed.
2. Website field removed.
3. People on payroll removed.
4. Monthly capacity / quality block removed.
5. Typical price fields removed.
6. “Optional” written on optional labels.
7. “All” is the first brand chip.
8. Lead time dropdown: 4 hr, 8 hr, 12 hr, 24 hr.
9. Hours labels: Morning / Evening. Sunday closed by default.
10. Direct-dispatch question removed.
11. Board resolution, cancelled cheque, CPCB e-waste, minimum payout removed from documents / bank.
12. Signatory ID and address proof marked optional.

### Listing wizard

1. Right-side “Why we ask” card removed on step 1.
2. Intro copy under “Pick the machine” removed.
3. Config fields sit in one full-width row (three fields per row).
4. Resolved SKU id shown on the right card, green and bold.
5. Long grade help text removed. Grade cards are smaller, centred, smaller type.
6. Grade photos in a row. Hover enlarges. Click opens a modal. Modal has no text.
7. Serial step heading / helper line removed.
8. Serial shape warning block hidden.
9. “What you want to receive” and payout helper lines removed.
10. Below-minimum visit fee sentence commented out. Button label: **Inspect now**.

### Listings board (`/vendor/listings`)

1. New **Machine** column: brand + model.
2. View modal shows full spec (processor, memory, storage, graphics, screen), same idea as before reprice.

### Reprice (`/vendor/listings/:id/reprice`)

1. Payout field is type number.
2. Validation error shows on the field.

### Vendor purchase orders

1. “Open the pick list” is hidden on the board and the record.
2. Table no longer shows serial or seal on each line.
3. Columns: SKU, Grade, Machine, Qty (attached of needed), You are owed, Attach device.
4. **Attach device** is disabled until the vendor accepts the PO.
5. Attach picker lists matching machines. Serial is only inside that picker.

### Buyer registration (`/register`)

1. Statutory step comes **before** Company step.
2. Website is not collected on the Company step.
3. URL `?step=` updates when you move between steps.
4. Unchecking “Use my account details” clears name, email and mobile.
5. Billing address prefills from the verified GSTIN registered address on Contacts.

### Pincode lookup

1. Fake pincode mock removed. Lookup always uses India Post (`postalpincode.in`).
2. Area/city fills while you type a valid 6-digit pincode. Delivery address does not auto-lookup on every digit.
3. Post-office **Name** is used for the area label (not district or block).

### Storefront product page (`/laptops/[slug]`)

1. “Pick a supply point to see its serials” hidden (commented out).
2. Supply point chips above the board hidden (commented out). The compare table stays.
3. “Lowest landed” and “Price break-up” stack with space — they no longer run together as one word.

---

## 4. Flow changes — Platform Users (admin console)

### Who can do what

| Action | Permission |
|---|---|
| See the board | `identity.user.read` |
| Add user, change password, reset MFA | `identity.user.write` |
| Change roles, change permissions, inactive / reactivate / remove | `identity.role.assign` |

### Add user

1. Admin opens **Add user**.
2. Required: full name, work email, mobile (`+91` prefix locked, 10 subscriber digits), job title, password, at least one role.
3. Validation runs while typing after a field is first edited, and on submit.
4. `POST /api/account/team/members` creates `identity.user_account`, inserts `identity.user_role` rows, sets password via `PasswordService`.
5. Email and mobile must be globally unused on the platform.

### Change roles

1. Admin picks one or more roles from the org’s role catalogue (platform / vendor / buyer vocabulary depends on org type).
2. A role is **not assignable** if it grants any permission the admin does not hold.
3. `PATCH /api/account/team/:userId` with `{ roles: [...] }` replaces the full role set.
4. Takes effect on the member’s next request.

### Change permissions

1. Admin opens **Change permissions** for a member.
2. Modal lists every permission any org role can grant, grouped by module (Identity, KYC, Catalog, etc.).
3. Initial checkboxes reflect the union of permissions from the member’s current roles.
4. Admin can only **grant** permissions they themselves hold; they can always **revoke**.
5. `PATCH /api/account/team/:userId` with `{ permissions: [...] }` — not stored on the user row.
6. Server finds the smallest assignable role combination whose permission union matches the selection **exactly**.
7. If no role bundle matches exactly, the API refuses with a clear message — use **Change roles** instead.
8. Cannot send `roles` and `permissions` in the same request.

### Account status (not deletion)

1. **Inactive** (`SUSPENDED`) — cannot sign in; row and history kept; sessions revoked.
2. **Removed** (`DEACTIVATED`) — permanent off switch; still no row delete.
3. Buyer/vendor: admin cannot change their own roles from this screen. Platform org: can.

---

## 5. Schema / database changes — Platform Users

**No new tables or migrations.** Uses existing identity schema:

- `identity.user_account` — person row and status (`ACTIVE` / `SUSPENDED` / `DEACTIVATED`)
- `identity.user_role` — role grants (org-scoped)
- `identity.role` + `identity.role_permission` + `identity.permission` — role matrix read from DB, not hard-coded in the UI

**New / updated APIs**

- `GET /api/account/team` — members + role catalogue with permissions per role and `assignable` flag (unchanged route; extended service behaviour for platform/vendor/buyer org types).
- `POST /api/account/team/members` — add user `{ fullName, email, mobile, jobTitle, department?, roles, password }` — guard: `identity.user.write`.
- `PATCH /api/account/team/:userId` — `{ roles? }`, `{ permissions? }`, or `{ status? }` — guard: `identity.role.assign`. Roles and permissions are mutually exclusive in one body.
- `POST /api/account/team/:userId/password` — `{ password }` — guard: `identity.user.write`; revokes all sessions.
- `POST /api/account/team/:userId/mfa-reset` — guard: `identity.user.write`; clears MFA enrolment and revokes sessions.

**Service logic (`AccountService`)**

- `orgRoleConfig()` — platform, vendor, or buyer role vocabulary and owner role code.
- `roleOptions()` — permissions per role from `identity.role_permission`; `assignable` when granter holds every permission the role grants.
- `createMember()`, `setMemberPassword()`, `resetMemberMfa()`, `updateMember()`.
- `resolveRolesFromPermissions()` — brute-force smallest exact role set for a permission pick list.
- Platform org: no self-change block on own row for role/password/MFA updates (last-owner rule remains).

**Tests**

- `apps/api/test/integration/account.spec.ts` — test module updated to include `PasswordService` (dependency of `AccountService`).

---

## 6. UI changes — Platform Users (admin console)

### Navigation

1. Route registered at `/platform/users`, label **Users**, group **Platform**.
2. Nav entry gated on `identity.user.read` (matches the API guard on `GET /api/account/team`).

### Users board

1. Columns: Person, Roles, Account (status badge + last login + MFA), Actions.
2. **Account status badges**: Active (green), Inactive (amber), Removed (red) — compact, not full-width.
3. Empty and filtered-empty states with copy pointing to **Add user** or clearing filters.
4. Loading skeleton while team loads.

### Add user modal

1. Required markers on all mandatory fields including **Roles** (`*` on label, red border when invalid).
2. Mobile field: fixed `+91 ` prefix; user types 10 digits only.
3. Roles: checkbox list; at least one required; error on submit even if roles were never touched.
4. Primary button disabled until form valid; tooltip names the first failing field.
5. Modal description states email, mobile, password and at least one role are required.

### Row actions menu

1. Three-dot trigger per row; menu rendered in a portal with fixed coordinates (avoids table `overflow` clipping).
2. Destructive action (**Remove permanently**) styled separately; confirm dialog before deactivate.
3. Removed rows show explanatory text instead of the menu.

### Change roles modal

1. Checkbox per org role with assignability hint when the admin cannot grant that bundle.
2. Save disabled until at least one role is picked.

### Change permissions modal

1. Permissions grouped by module with scrollable body.
2. Permission codes in IBM Plex Mono.
3. Selected count shown (`N of M permissions selected`).
4. Permissions the admin does not hold are disabled with explanation.
5. Save calls `PATCH` with `{ permissions: [...] }`; server-side mapping errors surface in the modal.

### New / updated console files

- `apps/console/src/routes/platform/Users.tsx` — board, modals, row menu.
- `apps/console/src/routes/platform/usersApi.ts` — API client.
- `apps/console/src/routes/platform/team-permissions.ts` — permission catalog helpers.
- `apps/console/src/lib/indian-contact.ts` — add-user validation and mobile formatting.
- `apps/console/src/index.css` — `.row-actions-*` styles for the overflow menu.
- `apps/console/src/lib/controls.tsx` — `Field` component gained optional `required` prop (red asterisk).
