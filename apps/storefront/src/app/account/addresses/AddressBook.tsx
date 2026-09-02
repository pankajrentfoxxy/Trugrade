'use client';

import * as React from 'react';
import {
  AddressCard,
  Button,
  EmptyState,
  Input,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  type Address,
} from '@trugrade/ui';
import { PINCODE, normaliseMobile } from '@trugrade/contracts';
import { MOBILE_PREFIX, typeMobile } from '../../register/validation';
import type { ApiFailure } from '../../register/api';
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

/** The two-digit GST state codes we can price a lane to today, plus the rest. */
const STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '08', name: 'Rajasthan' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '19', name: 'West Bengal' },
  { code: '24', name: 'Gujarat' },
];

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

function Record({ book, onChanged }: { book: Book; onChanged: () => Promise<void> }): React.JSX.Element {
  const active = book.delivery.filter((a) => a.isActive);
  const retired = book.delivery.filter((a) => !a.isActive);

  return (
    <>
      <RecordHeader
        title="Where we deliver, and who we bill"
        subtitle={
          <>
            Every site your organisation takes delivery at, and the registered address on your
            invoices. A driver is shown the contact, the landmark and the gate instruction on the
            site they are delivering to, exactly as they are written here.
          </>
        }
        identifiers={[
          { label: 'Delivery sites', value: String(active.length) },
          { label: 'Retired', value: String(retired.length) },
          { label: 'Billing addresses', value: String(book.billing.length) },
        ]}
      />

      {/* Same override as the approval record: on a phone the sites you already
          have come before the form for another one. */}
      <div className="rec apprrec">
        <main className="evid">
          <section aria-labelledby="delivery">
            <div className="sh">
              <div className="shrow">
                <h2 id="delivery">Delivery sites</h2>
                <span className="sub">
                  {active.length === 0
                    ? 'None yet'
                    : `${active.length} in use · one is the default at checkout`}
                </span>
              </div>
            </div>

            {active.length === 0 ? (
              <div className="empty">
                <h3>No delivery site yet</h3>
                <p>
                  Checkout needs somewhere to send machines to. Add the first one on the right — the
                  contact and the gate instruction go straight to the driver, so the more exact they
                  are, the fewer failed deliveries.
                </p>
              </div>
            ) : (
              <div className="adrgrid">
                {active.map((a) => (
                  <SiteCard
                    key={a.id}
                    address={a}
                    canRetire={active.length > 1}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            )}

            {retired.length > 0 && (
              <details className="adrretired">
                <summary>
                  {retired.length} retired site{retired.length === 1 ? '' : 's'}
                </summary>
                <p className="fnote off">
                  Nothing is deleted. Orders already delivered to these still name them, which is
                  what keeps an old invoice readable.
                </p>
                <div className="adrgrid">
                  {retired.map((a) => (
                    <SiteCard key={a.id} address={a} canRetire={false} onChanged={onChanged} />
                  ))}
                </div>
              </details>
            )}
          </section>

          <section aria-labelledby="billing">
            <div className="sh">
              <div className="shrow">
                <h2 id="billing">Billing</h2>
                <span className="sub">Bound to your GST registration</span>
              </div>
            </div>

            {book.billing.length === 0 ? (
              <p className="fnote off">
                We hold no separate billing address for you, so invoices are addressed to the
                registered address on your GST certificate.
              </p>
            ) : (
              <div className="adrgrid">
                {book.billing.map((a) => (
                  <div className="adrcard locked" key={a.id}>
                    <AddressCard
                      address={asAddress(a)}
                      badge={<StatusPill tone="neutral" label="On your invoices" />}
                    />
                    <p className="adrlock">{a.lockedReason}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <div className="sidep">
          <AddSite onAdded={onChanged} first={active.length === 0} />
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
 * One site
 * ======================================================================== */

function SiteCard({
  address,
  canRetire,
  onChanged,
}: {
  address: OrgAddress;
  canRetire: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
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

  return (
    <div className={address.isActive ? 'adrcard' : 'adrcard off'}>
      <AddressCard
        address={asAddress(address)}
        badge={
          address.isDefault ? (
            // An active state, which is one of the three things amber means.
            <StatusPill tone="info" label="Default at checkout" />
          ) : !address.isActive ? (
            <StatusPill tone="neutral" label="Retired" />
          ) : undefined
        }
        actions={
          address.isActive ? (
            <>
              {!address.isDefault && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void patch({ isDefault: true })}
                >
                  Make this the default
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                {...(canRetire
                  ? {}
                  : {
                      disabledReason:
                        'This is your only delivery site, and checkout needs one. Add another first.',
                    })}
                onClick={() => {
                  // `disabledReason` leaves the button focusable and therefore
                  // clickable on purpose, so the guard is here as well as printed.
                  if (!canRetire) return;
                  void patch({ isActive: false });
                }}
              >
                Retire this site
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void patch({ isActive: true })}>
              Put it back in use
            </Button>
          )
        }
      />
      {!canRetire && address.isActive && (
        <p className="adrnote">
          This is your only delivery site. Checkout needs one, so it cannot be retired until there
          is another.
        </p>
      )}
      {failure !== null && (
        <p className="adrfail" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * Adding one — the screen's single primary action
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

function AddSite({
  onAdded,
  first,
}: {
  onAdded: () => Promise<void>;
  first: boolean;
}): React.JSX.Element {
  const [form, setForm] = React.useState<NewAddress>(BLANK);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState<string | null>(null);

  const set = (key: keyof NewAddress, value: string): void =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * The client's own refusals, in the server's words where they overlap.
   *
   * Validated here so somebody typing gets the sentence beside the field rather
   * than after a round trip — but the server runs the identical constants from
   * `@trugrade/contracts`, and it is the server's answer that binds.
   */
  const check = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!form.label.trim()) out.label = 'Give this site a name your team will recognise.';
    if (form.line1.trim().length < 4) out.line1 = 'We need the street address, not just a number.';
    if (!form.city.trim()) out.city = 'Which city is this site in?';
    if (!PINCODE.pattern!.test(form.pincode.trim())) {
      out.pincode = 'A pincode is six digits and never starts with a zero — 122002, for example.';
    }
    if (form.contactName.trim().length < 2) {
      out.contactName = 'Who does the driver ask for when they arrive?';
    }
    if (normaliseMobile(form.contactMobile) === null) {
      out.contactMobile =
        'We need a ten-digit Indian mobile the driver can ring — 98123 45678, or +91 98123 45678.';
    }
    return out;
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const problems = check();
    setFields(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    setFailure(null);
    const result = await addAddress({
      ...form,
      state: STATES.find((s) => s.code === form.stateCode)?.name ?? form.state,
      // Empty is what a form posts when nobody typed. It is not a landmark.
      line2: form.line2?.trim() || null,
      landmark: form.landmark?.trim() || null,
      gateInstructions: form.gateInstructions?.trim() || null,
    });
    setBusy(false);

    if (result.ok) {
      setSaved(result.data.label ?? result.data.city);
      setForm(BLANK);
      setFields({});
      await onAdded();
    } else {
      setFailure(result.message);
      setFields(result.fields);
    }
  };

  return (
    <SidePanel
      title={first ? 'Add your first delivery site' : 'Add a delivery site'}
      description="Everything below the address is what the driver is shown on the day. A landmark and a gate instruction are the difference between a delivery and a second attempt."
    >
      <form className="adrform" onSubmit={(e) => void submit(e)} noValidate>
        {saved !== null && (
          <p className="adrok" role="status">
            <b>{saved}</b> is on your account and can be chosen at checkout.
          </p>
        )}
        {failure !== null && (
          <p className="adrfail" role="alert">
            {failure}
          </p>
        )}

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
        <Input
          label="City"
          value={form.city}
          onChange={(e) => set('city', e.target.value)}
          {...(fields.city ? { error: fields.city } : {})}
          required
        />

        <label className="adrsel">
          <span className="l">State</span>
          <span className="d">
            The state decides the tax split on the invoice, not your GSTIN.
          </span>
          <select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
            {STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} · {s.code}
              </option>
            ))}
          </select>
        </label>

        <Input
          label="Pincode"
          mono
          inputMode="numeric"
          maxLength={6}
          value={form.pincode}
          onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
          {...(fields.pincode ? { error: fields.pincode } : {})}
          required
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

        {/* Asked for by the spec, and there is no column. Said rather than
            offered — a field whose value we throw away is worse than none. */}
        <p className="adrmissing">
          <b className="notmeasured">Receiving hours: not recorded</b>
          <span>
            We do not yet hold the hours a site will accept goods, so we cannot promise a driver
            arrives inside them. Put them in the gate instruction and they reach the driver.
          </span>
        </p>

        <Button type="submit" variant="primary" block loading={busy}>
          Save this site
        </Button>
      </form>
    </SidePanel>
  );
}

/* ==========================================================================
 * Bits
 * ======================================================================== */

/**
 * `OrgAddress` in `AddressCard`'s vocabulary.
 *
 * A field we do not hold is left off rather than passed as an empty string, so
 * the card prints its own "Not provided" in `--ink-4`. Receiving hours are never
 * passed at all, because there is no column behind them.
 */
function asAddress(a: OrgAddress): Address {
  return {
    label: a.label ?? `${a.city} site`,
    line1: a.line1,
    ...(a.line2 ? { line2: a.line2 } : {}),
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    ...(a.landmark ? { landmark: a.landmark } : {}),
    contactName: a.contactName,
    contactMobile: a.contactMobile,
    ...(a.gateInstructions ? { gateInstructions: a.gateInstructions } : {}),
  };
}

function BookSkeleton(): React.JSX.Element {
  return (
    <div className="oskel">
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="oskelrec">
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
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
          <a className="pill acc" href="/sign-in?next=%2Faccount%2Faddresses">
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
