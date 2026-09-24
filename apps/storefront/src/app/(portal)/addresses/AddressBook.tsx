'use client';

import * as React from 'react';
import { Drawer, EmptyState, Input, Skeleton, useToast } from '@trugrade/ui';
import { normaliseMobile, normalisePincode } from '@trugrade/contracts';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { PincodeLocalityFields } from '../../register/PincodeLocalityFields';
import { STATES as STATE_OPTIONS } from '../../register/picklists';
import { MOBILE_PREFIX, typeMobile } from '../../register/validation';
import type { ApiFailure } from '../../register/api';
import { usePortal } from '../shell/PortalContext';
import {
  addAddress,
  getAddresses,
  updateAddress,
  type AddressBook as Book,
  type NewAddress,
  type OrgAddress,
} from '../api';

/**
 * The address book. See `page.tsx` for the archetype and the rules.
 *
 * A client component: the read is authenticated and can come back 401, and the
 * form writes.
 */

/** The state's name for the payload, from the same picklist the pincode lookup fills. */
const stateName = (code: string): string | undefined =>
  STATE_OPTIONS.find((o) => o.value === code && o.value !== '')?.label;

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; book: Book };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your account just now. That is our problem, not yours — nothing about your addresses has changed.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function AddressBook(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getAddresses();
    if (result.ok) setPhase({ k: 'ready', book: result.data });
    else if (result.status === 401) setPhase({ k: 'signed-out' });
    else setPhase({ k: 'error', message: problem(result) });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (phase.k === 'loading') return <BookSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  return <Record book={phase.book} onChanged={load} />;
}

function Record({
  book,
  onChanged,
}: {
  book: Book;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { session, profile } = usePortal();
  // POST /account/addresses checks `ordering.order.create` — an ordering
  // permission by design, because the spec names a procurer who holds no
  // identity permission at all. An approver, a finance seat and a viewer hold
  // none of it and used to open the form and be refused on save.
  const canAdd = session.permissions.includes('ordering.order.create');
  const active = book.delivery.filter((a) => a.isActive);
  const retired = book.delivery.filter((a) => !a.isActive);
  // One drawer at a time: adding and editing are the same panel with a
  // different form in it, so opening one closes the other.
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = book.delivery.find((a) => a.id === editingId && a.isActive) ?? null;

  const openAdd = (): void => {
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (id: string): void => {
    setAdding(false);
    setEditingId(id);
  };

  return (
    <div className="ad">
      <div className="ad-head">
        <div>
          <h1 className="ad-title">Addresses</h1>
          <p className="ad-sub">
            Where we deliver your machines, and the address we put on your invoices.
          </p>
        </div>
        {canAdd ? (
          <button type="button" className="ad-btn ad-btn--primary ad-btn--lg" onClick={openAdd}>
            <PlusIcon size={18} />
            Add delivery site
          </button>
        ) : null}
      </div>

      <section className="ad-section" aria-labelledby="delivery" data-testid="delivery-sites">
        <div className="ad-section__head">
          <div>
            <h2 id="delivery">
              Delivery sites
              <span className="ad-count mono">{active.length}</span>
            </h2>
            <p>
              The default site is picked for you at checkout. Drivers see the site details on the
              delivery day.
            </p>
          </div>
          <span className="ad-retired-count">
            {retired.length === 0
              ? 'No retired sites'
              : `${retired.length} retired site${retired.length === 1 ? '' : 's'} below`}
          </span>
        </div>

        <div className="ad-grid">
          {active.map((a) => (
            <SiteCard
              key={a.id}
              address={a}
              canRetire={active.length > 1}
              onChanged={onChanged}
              onEdit={() => startEdit(a.id)}
              editing={editingId === a.id}
            />
          ))}
          {canAdd ? (
            <button type="button" className="ad-add" onClick={openAdd}>
              <span className="ad-add__icon">
                <PlusIcon size={22} />
              </span>
              <span className="ad-add__title">
                {active.length === 0 ? 'Add your first delivery site' : 'Add a delivery site'}
              </span>
              <span className="ad-add__meta">
                {active.length === 0
                  ? 'Checkout needs somewhere to send machines to. The contact and the gate instruction go straight to the driver.'
                  : 'An office, warehouse or branch where machines should arrive.'}
              </span>
            </button>
          ) : active.length === 0 ? (
            <div className="ad-add ad-add--static">
              <span className="ad-add__title">No delivery site yet</span>
              <span className="ad-add__meta">
                Checkout needs somewhere to send machines to. Someone on your account who places
                orders can add one.
              </span>
            </div>
          ) : null}
        </div>

        {retired.length > 0 && (
          <details className="ad-retired">
            <summary>
              {retired.length} retired site{retired.length === 1 ? '' : 's'}
            </summary>
            <p className="ad-retired__note">
              Nothing is deleted. Orders already delivered to these still name them, which is what
              keeps an old invoice readable.
            </p>
            <div className="ad-grid">
              {retired.map((a) => (
                <SiteCard
                  key={a.id}
                  address={a}
                  canRetire={false}
                  onChanged={onChanged}
                  onEdit={() => undefined}
                  editing={false}
                />
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="ad-section" aria-labelledby="billing">
        <div className="ad-section__head">
          <div>
            <h2 id="billing">Billing address</h2>
            <p>Printed on every invoice. It comes from your GST registration.</p>
          </div>
        </div>

        {book.billing.length === 0 ? (
          <div className="ad-bill">
            <div className="ad-bill__main">
              <p className="ad-bill__name">{profile?.legalName ?? 'Your organisation'}</p>
              <GstinLine gstin={profile?.gstin ?? null} />
              <p className="ad-addr ad-addr--absent">
                Invoices go to the registered address on your GST certificate.
              </p>
            </div>
            <ChangeAside />
          </div>
        ) : (
          book.billing.map((a) => (
            <div className="ad-bill" key={a.id} data-testid="billing-address">
              <div className="ad-bill__main">
                <p className="ad-bill__name">{profile?.legalName ?? a.label ?? 'Billing address'}</p>
                <GstinLine gstin={profile?.gstin ?? null} />
                <AddressLines address={a} />
                <ContactLine address={a} />
              </div>
              <ChangeAside reason={a.lockedReason} />
            </div>
          ))
        )}
      </section>

      {canAdd ? (
        <AddSite
          open={adding}
          first={active.length === 0}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await onChanged();
          }}
        />
      ) : null}

      <EditSite
        address={editing}
        onClose={() => setEditingId(null)}
        onSaved={async () => {
          setEditingId(null);
          await onChanged();
        }}
      />
    </div>
  );
}

/* ==========================================================================
 * One site
 * ======================================================================== */

function SiteCard({
  address,
  canRetire,
  onChanged,
  onEdit,
  editing,
}: {
  address: OrgAddress;
  canRetire: boolean;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  editing: boolean;
}): React.JSX.Element {
  /**
   * PATCH /account/addresses/:id checks `identity.user.write`, which only an
   * owner and an admin hold — while POST checks `ordering.order.create`, which
   * a buyer holds too. The split is deliberate and matches 03_UX_SPEC §3A: a
   * procurer may add a delivery site and may not change one. It was invisible,
   * so a buyer added a site and then pressed Edit on the one they had just made
   * and got a 403. Now the control is absent and the reason is in words.
   */
  const { session } = usePortal();
  const canEdit = session.permissions.includes('identity.user.write');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const patch = async (body: Parameters<typeof updateAddress>[1]): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await updateAddress(address.id, body);
    setBusy(false);
    if (result.ok) await onChanged();
    else setFailure(result.message);
  };

  const classes = ['ad-card'];
  if (address.isDefault && address.isActive) classes.push('ad-card--default');
  if (!address.isActive) classes.push('ad-card--off');

  /**
   * "Add" only where there is a field behind it and a person who may fill it.
   * Receiving hours have no column, so they are "Not recorded" for everyone —
   * a link that opened a form with no such field would be a promise the
   * schema cannot keep.
   */
  const addLink = (label: string): React.ReactNode =>
    canEdit && address.isActive ? (
      <button type="button" className="ad-kv__add" onClick={onEdit} aria-label={`Add ${label}`}>
        Add
      </button>
    ) : (
      <span className="ad-kv__absent">Not recorded</span>
    );

  return (
    <article className={classes.join(' ')} data-editing={editing || undefined}>
      <div className="ad-card__top">
        <h3 className="ad-card__name">
          {address.label ?? `${address.city} site`}
          {address.isDefault && address.isActive ? (
            // An active state, which is one of the three things the accent means.
            <span className="ad-badge">
              <CheckIcon />
              Default
            </span>
          ) : !address.isActive ? (
            <span className="ad-badge ad-badge--off">Retired</span>
          ) : null}
        </h3>
        <AddressLines address={address} />
        <ContactLine address={address} />
      </div>

      <div className="ad-driver">
        <div className="ad-driver__label">For the driver</div>
        <dl className="ad-kv">
          <div>
            <dt>Receiving hours</dt>
            <dd>
              <span className="ad-kv__absent">Not recorded</span>
            </dd>
          </div>
          <div>
            <dt>Gate instructions</dt>
            <dd>{address.gateInstructions ?? addLink('gate instructions')}</dd>
          </div>
          <div>
            <dt>Landmark</dt>
            <dd>{address.landmark ?? addLink('a landmark')}</dd>
          </div>
        </dl>
      </div>

      {!canRetire && address.isActive && (
        <p className="ad-warn" role="note">
          <InfoIcon />
          <span>
            <strong>Your only delivery site.</strong> Checkout needs one, so it cannot be retired
            until there is another.
          </span>
        </p>
      )}
      {failure !== null && (
        <p className="ad-fail" role="alert">
          {failure}
        </p>
      )}

      <div className="ad-card__actions">
        {address.isActive ? (
          <>
            {canEdit ? (
              <button type="button" className="ad-link-btn" disabled={busy} onClick={onEdit}>
                Edit
              </button>
            ) : null}
            {!address.isDefault && (
              <button
                type="button"
                className="ad-link-btn ad-link-btn--muted"
                disabled={busy}
                onClick={() => void patch({ isDefault: true })}
              >
                Make default
              </button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="ad-link-btn ad-link-btn--danger"
              disabled={busy}
              // Focusable and clickable on purpose, so the reason above is read
              // rather than guessed at; the guard is here as well as printed.
              aria-disabled={!canRetire || undefined}
              onClick={() => {
                if (!canRetire) return;
                void patch({ isActive: false });
              }}
            >
              Retire
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ad-link-btn"
            disabled={busy}
            onClick={() => void patch({ isActive: true })}
          >
            Put it back in use
          </button>
        )}
      </div>
    </article>
  );
}

/* ==========================================================================
 * The pieces a card and the billing block share
 * ======================================================================== */

function AddressLines({ address }: { address: OrgAddress }): React.JSX.Element {
  return (
    <address className="ad-addr">
      {address.line1}
      {address.line2 ? `, ${address.line2}` : null}
      <br />
      {address.city}, {address.state} <span className="mono">{address.pincode}</span>
    </address>
  );
}

/** `+91XXXXXXXXXX`, the normalised form the column holds, printed the way people read it. */
function formatMobile(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

function ContactLine({ address }: { address: OrgAddress }): React.JSX.Element {
  return (
    <div className="ad-contact">
      <PersonIcon />
      <span>
        {address.contactName} ·{' '}
        <a href={`tel:${address.contactMobile}`} className="mono">
          {formatMobile(address.contactMobile)}
        </a>
      </span>
    </div>
  );
}

/** The GSTIN the invoice is raised under, or the honest absence of one. */
function GstinLine({ gstin }: { gstin: string | null }): React.JSX.Element {
  return (
    <div className="ad-gstin">
      {gstin ? (
        <span className="mono">{gstin}</span>
      ) : (
        <span className="ad-kv__absent">GSTIN not verified yet</span>
      )}
      <span className="ad-lock">
        <LockIcon />
        GSTIN
      </span>
    </div>
  );
}

/**
 * Why the billing address is read-only, and the one route to changing it.
 * There is no self-serve change request yet, so the route is customer care
 * with the updated certificate — and the panel says that, rather than showing
 * a button to a flow that does not exist.
 */
function ChangeAside({ reason }: { reason?: string | null }): React.JSX.Element {
  return (
    <div className="ad-bill__side">
      <h3>Need to change this?</h3>
      <p>
        {reason ??
          'We cannot edit it here, because it must match your GST registration. Send us your updated GST certificate and we will update it for you.'}
      </p>
      <a
        className="ad-btn"
        href={`mailto:${LEGAL_DISCLOSURE.customerCare.email}?subject=${encodeURIComponent('Billing address change')}`}
      >
        Email customer care
      </a>
    </div>
  );
}

function PlusIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function PersonIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

function InfoIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

function LockIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/* ==========================================================================
 * Adding and editing one — the drawer forms
 * ======================================================================== */

const BLANK: NewAddress = {
  label: '',
  line1: '',
  line2: '',
  city: '',
  state: 'Haryana',
  stateCode: '06',
  pincode: '',
  contactName: '',
  contactMobile: MOBILE_PREFIX,
  landmark: '',
  gateInstructions: '',
};

function orgToForm(address: OrgAddress): NewAddress {
  return {
    label: address.label ?? '',
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city,
    state: address.state,
    stateCode: address.stateCode,
    pincode: address.pincode,
    contactName: address.contactName,
    contactMobile: address.contactMobile,
    landmark: address.landmark ?? '',
    gateInstructions: address.gateInstructions ?? '',
  };
}

function validateSiteForm(form: NewAddress): Record<string, string> {
  const out: Record<string, string> = {};
  if (!form.label.trim()) out.label = 'Give this site a name your team will recognise.';
  if (form.line1.trim().length < 4) out.line1 = 'We need the street address, not just a number.';
  if (!normalisePincode(form.pincode)) {
    out.pincode = 'A pincode is six digits and never starts with a zero — 122002, for example.';
  }
  if (!form.city.trim()) out.city = 'Which city is this site in?';
  if (!form.stateCode) out.stateCode = 'Which state is this site in? The pincode usually tells us.';
  if (form.contactName.trim().length < 2) {
    out.contactName = 'Who does the driver ask for when they arrive?';
  }
  if (normaliseMobile(form.contactMobile) === null) {
    out.contactMobile =
      'We need a ten-digit Indian mobile the driver can ring — 98123 45678, or +91 98123 45678.';
  }
  return out;
}

function sitePayload(form: NewAddress): NewAddress {
  return {
    ...form,
    pincode: normalisePincode(form.pincode) ?? form.pincode,
    state: stateName(form.stateCode) ?? form.state,
    line2: form.line2?.trim() || null,
    landmark: form.landmark?.trim() || null,
    gateInstructions: form.gateInstructions?.trim() || null,
  };
}

function SiteFormFields({
  form,
  set,
  patch,
  fields,
}: {
  form: NewAddress;
  set: (key: keyof NewAddress, value: string) => void;
  /** Several fields at once — the pincode lookup fills city and state together. */
  patch: (values: Partial<NewAddress>) => void;
  fields: Record<string, string>;
}): React.JSX.Element {
  return (
    <>
      <Input
        label="Name this site"
        hint="What your own team calls it — “Gurugram office”, “Warehouse 2”."
        value={form.label}
        onChange={(e) => set('label', e.target.value)}
        {...(fields.label ? { error: fields.label } : {})}
        required
      />
      <Input
        label="Address"
        value={form.line1}
        onChange={(e) => set('line1', e.target.value)}
        {...(fields.line1 ? { error: fields.line1 } : {})}
        required
      />
      <Input
        label="Floor, unit or building"
        hint="Optional."
        value={form.line2 ?? ''}
        onChange={(e) => set('line2', e.target.value)}
      />
      {/*
        The same pincode lookup every other address form uses: the directory
        fills the city and the state, and the state is what decides the tax
        split on the invoice — not the buyer's GSTIN. A saved address is not
        looked up on open, so an edit never silently rewrites a city the buyer
        chose; the lookup runs once they touch the pincode.
      */}
      <PincodeLocalityFields
        value={{ pincode: form.pincode, city: form.city, state: form.stateCode }}
        autoLookup={false}
        onChange={(next) =>
          patch({
            ...(next.pincode !== undefined ? { pincode: next.pincode } : {}),
            ...(next.city !== undefined ? { city: next.city } : {}),
            ...(next.state !== undefined
              ? { stateCode: next.state, state: stateName(next.state) ?? '' }
              : {}),
          })
        }
        errors={{
          ...(fields.pincode ? { pincode: fields.pincode } : {}),
          ...(fields.city ? { city: fields.city } : {}),
          ...(fields.stateCode ? { state: fields.stateCode } : {}),
        }}
        onFocus={() => {}}
        onBlur={() => {}}
      />
      <Input
        label="Who the driver asks for"
        value={form.contactName}
        onChange={(e) => set('contactName', e.target.value)}
        {...(fields.contactName ? { error: fields.contactName } : {})}
        required
      />
      <Input
        label="Their mobile"
        mono
        inputMode="tel"
        hint="Indian mobile. We store it as +91XXXXXXXXXX."
        value={form.contactMobile}
        onChange={(e) => set('contactMobile', typeMobile(e.target.value))}
        {...(fields.contactMobile ? { error: fields.contactMobile } : {})}
        required
      />
      <Input
        label="Landmark"
        hint="Optional, and it is what a driver actually navigates by."
        value={form.landmark ?? ''}
        onChange={(e) => set('landmark', e.target.value)}
      />

      <label className="adrsel">
        <span className="l">Gate or security instruction</span>
        <span className="d">
          Shown to the driver word for word. “Goods gate is at the rear, ask for security desk 2.”
        </span>
        <textarea
          rows={3}
          maxLength={300}
          value={form.gateInstructions ?? ''}
          onChange={(e) => set('gateInstructions', e.target.value)}
        />
      </label>

      <p className="adrmissing">
        <b className="notmeasured">Receiving hours: not recorded</b>
        <span>Put them in the gate instruction and the driver sees them.</span>
      </p>
    </>
  );
}

/**
 * The drawer both forms open in. The same `Drawer` every board's record panel
 * uses — a `<dialog showModal()>` pinned right, full-height, full-width on a
 * phone — with the actions pinned to its foot, where a long form cannot bury
 * them. The submit sits in the foot and reaches the form through `form=`,
 * so pressing Enter in a field and pressing Save do the same thing.
 */
function SiteDrawer({
  open,
  onClose,
  title,
  subtitle,
  formId,
  busy,
  saveLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  formId: string;
  busy: boolean;
  saveLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="md"
      className="ad-drawer"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="ad-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="ad-btn ad-btn--primary"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Saving…' : saveLabel}
          </button>
        </>
      }
    >
      {children}
    </Drawer>
  );
}

function AddSite({
  open,
  first,
  onClose,
  onAdded,
}: {
  open: boolean;
  first: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}): React.JSX.Element {
  const formId = React.useId();
  const toast = useToast();
  const [form, setForm] = React.useState<NewAddress>(BLANK);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});

  // A drawer that reopens shows a fresh form, not the half-typed one that was
  // cancelled — cancelling is "forget this", and a stale draft says otherwise.
  React.useEffect(() => {
    if (!open) {
      setForm(BLANK);
      setFields({});
      setFailure(null);
    }
  }, [open]);

  // Once a save has been refused, every edit re-runs the check, so a message
  // leaves the moment its field is fixed rather than waiting for the next save.
  React.useEffect(() => {
    setFields((prev) => (Object.keys(prev).length > 0 ? validateSiteForm(form) : prev));
  }, [form]);
  const set = (key: keyof NewAddress, value: string): void =>
    setForm((f) => ({ ...f, [key]: value }));
  const patch = (values: Partial<NewAddress>): void => setForm((f) => ({ ...f, ...values }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const problems = validateSiteForm(form);
    setFields(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    setFailure(null);
    const result = await addAddress(sitePayload(form));
    setBusy(false);

    if (result.ok) {
      toast({
        tone: 'success',
        title: `${result.data.label ?? result.data.city} is on your account`,
        body: 'It can be chosen at checkout from now on.',
      });
      await onAdded();
    } else {
      setFailure(result.message);
      setFields(result.fields);
    }
  };

  return (
    <SiteDrawer
      open={open}
      onClose={onClose}
      title={first ? 'Add your first delivery site' : 'Add a delivery site'}
      subtitle="The driver is shown the contact and the gate instruction on the day."
      formId={formId}
      busy={busy}
      saveLabel="Save site"
    >
      <form id={formId} className="adrform" onSubmit={(e) => void submit(e)} noValidate>
        {failure !== null && (
          <p className="adrfail" role="alert">
            {failure}
          </p>
        )}

        <SiteFormFields form={form} set={set} patch={patch} fields={fields} />
      </form>
    </SiteDrawer>
  );
}

function EditSite({
  address,
  onClose,
  onSaved,
}: {
  /** Null closes the drawer. The last address stays mounted so it can slide out. */
  address: OrgAddress | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const formId = React.useId();
  const [form, setForm] = React.useState<NewAddress>(() =>
    address ? orgToForm(address) : BLANK,
  );
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [last, setLast] = React.useState<OrgAddress | null>(address);

  React.useEffect(() => {
    if (!address) return;
    setLast(address);
    setForm(orgToForm(address));
    setFields({});
    setFailure(null);
  }, [address]);

  // Once a save has been refused, every edit re-runs the check, so a message
  // leaves the moment its field is fixed rather than waiting for the next save.
  React.useEffect(() => {
    setFields((prev) => (Object.keys(prev).length > 0 ? validateSiteForm(form) : prev));
  }, [form]);
  const set = (key: keyof NewAddress, value: string): void =>
    setForm((f) => ({ ...f, [key]: value }));
  const patch = (values: Partial<NewAddress>): void => setForm((f) => ({ ...f, ...values }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const target = address ?? last;
    if (!target) return;
    const problems = validateSiteForm(form);
    setFields(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    setFailure(null);
    const result = await updateAddress(target.id, sitePayload(form));
    setBusy(false);

    if (result.ok) await onSaved();
    else {
      setFailure(result.message);
      setFields(result.fields);
    }
  };

  const shown = address ?? last;
  const label = shown ? (shown.label ?? shown.city) : '';

  return (
    <SiteDrawer
      open={address !== null}
      onClose={onClose}
      title={`Edit ${label}`}
      subtitle="Changes here are what the driver sees on the next delivery. Orders already placed keep the address they were raised with."
      formId={formId}
      busy={busy}
      saveLabel="Save changes"
    >
      <form id={formId} className="adrform" onSubmit={(e) => void submit(e)} noValidate>
        {failure !== null && (
          <p className="adrfail" role="alert">
            {failure}
          </p>
        )}

        <SiteFormFields form={form} set={set} patch={patch} fields={fields} />
      </form>
    </SiteDrawer>
  );
}

/* ==========================================================================
 * Bits
 * ======================================================================== */

function BookSkeleton(): React.JSX.Element {
  return (
    <div className="oskel">
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your addresses"
        body="Addresses belong to the organisation that holds them, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a className="pill acc" href="/sign-in?next=%2Faddresses">
            Sign in
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not open your addresses</h3>
        <p>{message}</p>
        <p>Nothing has changed, and every site on your account is where it was.</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
