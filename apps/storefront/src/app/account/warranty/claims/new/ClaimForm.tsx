'use client';

import * as React from 'react';
import { EmptyState, WhyRail, type WhyRailItem } from '@trugrade/ui';
import type { ApiFailure } from '../../../../register/api';
import {
  FAULT_AREAS,
  FAULT_AREA_LABEL,
  getWarrantyRegister,
  raiseClaim,
  type CoveredMachine,
  type FaultArea,
} from '../../api';

/**
 * The claim form. See `page.tsx` for the archetype and the rules.
 *
 * **The serial is a select, not a free-text box.** A buyer who mistypes one
 * character would otherwise be told the machine is not theirs, which is the most
 * alarming thing this screen can say wrongly. The list is the machines that are
 * actually claimable — in cover, delivered, no claim already open — and the ones
 * that are not appear underneath with the reason, so nothing silently vanishes.
 */

const WHY: readonly WhyRailItem[] = [
  {
    term: 'Which machine',
    explanation:
      'The serial ties the claim to the inspection we did before we sold it. That report is what an engineer reads first, so a claim with the right serial gets a visit with the right part.',
  },
  {
    term: 'What is wrong',
    explanation:
      'These are the same twelve areas we inspected. Picking one puts your claim beside what we measured on that exact machine — which is how a claim is approved in hours rather than after an argument.',
  },
  {
    term: 'What it does',
    explanation:
      'In your own words. "Battery drops to 20% in an hour" tells an engineer what to bring; "not working" sends them empty-handed. We do not edit what you write.',
  },
  {
    term: 'Who handles it',
    explanation:
      'We do. You bought from us, we inspected the machine and we carry the warranty for the whole term. There is nobody else for you to chase.',
  },
];

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; machines: CoveredMachine[] };

/** Why a machine cannot be claimed on. Never a machine that silently disappears. */
const blockedReason = (m: CoveredMachine): string | null => {
  if (m.openClaim) return `already has claim ${m.openClaim.claimNumber} open`;
  if (m.cover === null) return 'has not been delivered yet, so cover has not started';
  if (!m.cover.inWarranty) return `cover ended on ${m.cover.endDate}`;
  return null;
};

export function ClaimForm({ initialSerial }: { initialSerial: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [serial, setSerial] = React.useState(initialSerial.toUpperCase());
  const [area, setArea] = React.useState<FaultArea | ''>('');
  const [description, setDescription] = React.useState('');
  const [active, setActive] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);
  const [refusal, setRefusal] = React.useState<ApiFailure | null>(null);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getWarrantyRegister();
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', machines: result.data.machines });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: result.message });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (phase.k === 'signed-out') {
    return (
      <div className="ostate">
        <EmptyState
          title="Sign in to raise a claim"
          body="A claim belongs to the organisation that bought the machine. Signing in brings you straight back to this form."
          action={
            <a
              className="pill acc"
              href={`/sign-in?next=${encodeURIComponent('/account/warranty/claims/new')}`}
            >
              Sign in
            </a>
          }
        />
      </div>
    );
  }

  if (phase.k === 'error') {
    return (
      <div className="ostate">
        <div className="empty err" role="alert">
          <h3>We could not load your machines</h3>
          <p>{phase.message}</p>
          <p className="retry">
            <button type="button" className="pill acc" onClick={() => window.location.reload()}>
              Try again
            </button>
          </p>
        </div>
      </div>
    );
  }

  const machines = phase.k === 'ready' ? phase.machines : [];
  const claimable = machines.filter((m) => blockedReason(m) === null);
  const blocked = machines.filter((m) => blockedReason(m) !== null);
  const loading = phase.k === 'loading';

  const trimmed = description.trim();
  const chosen: FaultArea | null = area === '' ? null : area;
  const canSubmit = serial !== '' && chosen !== null && trimmed.length >= 20 && !submitting;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setRefusal(null);
    if (chosen === null) return;
    const result = await raiseClaim({
      serialNumber: serial,
      faultArea: chosen,
      description: trimmed,
    });
    if (result.ok) {
      // A full navigation rather than a router push: the claim record reads the
      // claim back from the server, and arriving there with a stale client cache
      // is how a buyer sees "not found" for a claim they just raised.
      window.location.href = `/account/warranty/claims/${encodeURIComponent(result.data.claimNumber)}`;
      return;
    }
    setSubmitting(false);
    setRefusal(result);
  };

  return (
    <>
      <div className="wshead wthead">
        <h1>Start a warranty claim</h1>
        <p>
          Tell us which machine and what it does. We handle the claim ourselves — you bought from
          us, we inspected the machine before it shipped, and we carry the cover for the whole term.
        </p>
      </div>

      <div className="flow2">
        <form className="claimform" onSubmit={submit} noValidate>
          {refusal && <Refusal failure={refusal} />}

          <fieldset className="cfield">
            <legend>Which machine</legend>
            {loading ? (
              <p className="ink4">Reading your machines…</p>
            ) : claimable.length === 0 ? (
              <p className="cfnone">
                None of your <span className="mono">{machines.length}</span> machines can be claimed
                on today. The reasons are listed below — each one has a different way forward.
              </p>
            ) : (
              <>
                <label className="csel">
                  <span className="l">Serial number</span>
                  <select
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    onFocus={() => setActive('Which machine')}
                    required
                  >
                    <option value="">Choose a machine…</option>
                    {claimable.map((m) => (
                      <option key={m.serialNumber} value={m.serialNumber}>
                        {m.serialNumber} — {m.title ?? 'Model no longer catalogued'} (
                        {m.cover?.daysRemaining} days of cover left)
                      </option>
                    ))}
                  </select>
                  <span className="d">
                    <span className="mono">{claimable.length}</span> of{' '}
                    <span className="mono">{machines.length}</span> machines are in cover and have
                    no claim open.
                  </span>
                </label>
              </>
            )}

            {blocked.length > 0 && (
              <details className="cblocked">
                <summary>
                  <span className="mono">{blocked.length}</span>{' '}
                  {blocked.length === 1 ? 'machine is' : 'machines are'} not claimable — why
                </summary>
                <ul>
                  {blocked.map((m) => (
                    <li key={m.serialNumber}>
                      <span className="mono">{m.serialNumber}</span> {blockedReason(m)}
                      {m.openClaim && (
                        <>
                          {' · '}
                          <a
                            href={`/account/warranty/claims/${encodeURIComponent(m.openClaim.claimNumber)}`}
                          >
                            open it
                          </a>
                        </>
                      )}
                      {m.cover !== null && !m.cover.inWarranty && (
                        <>
                          {' · '}
                          <a href="/account/support">ask for a paid repair</a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>

          <fieldset className="cfield">
            <legend>What is wrong</legend>
            <div
              className="careas"
              role="radiogroup"
              aria-label="Fault category"
              onFocus={() => setActive('What is wrong')}
            >
              {FAULT_AREAS.map((a) => (
                <label key={a} className={area === a ? 'carea on' : 'carea'}>
                  <input
                    type="radio"
                    name="faultArea"
                    value={a}
                    checked={area === a}
                    onChange={() => setArea(a)}
                  />
                  <span className="l">{FAULT_AREA_LABEL[a].label}</span>
                  <span className="d">{FAULT_AREA_LABEL[a].hint}</span>
                </label>
              ))}
            </div>
            <p className="cfhint">
              These are the twelve areas we inspected before selling the machine. Your claim is
              compared against what we measured in that exact area — so the more precisely you pick,
              the faster it is approved.
            </p>
          </fieldset>

          <fieldset className="cfield">
            <legend>What it does</legend>
            <label className="csel">
              <span className="l">Describe the fault</span>
              <textarea
                rows={5}
                value={description}
                maxLength={4000}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => setActive('What it does')}
                placeholder="Battery drops from 100% to about 12% in forty minutes with nothing running."
              />
              <span className={trimmed.length > 0 && trimmed.length < 20 ? 'd short' : 'd'}>
                <span className="mono">{trimmed.length}</span> of at least{' '}
                <span className="mono">20</span> characters. Say what it does, not that it is
                broken — an engineer reads this before they pack the van.
              </span>
            </label>
          </fieldset>

          <div className="cactions">
            <button type="submit" className="pill acc" disabled={!canSubmit}>
              {submitting ? 'Raising the claim…' : 'Raise the claim'}
            </button>
            <a className="pill wire" href="/account/warranty">
              Back to warranty
            </a>
          </div>
          <p className="fnote off">
            We answer every claim ourselves. Nothing on this form goes to whoever supplied the
            machine, and you will never be asked to contact them.
          </p>
        </form>

        <WhyRail items={WHY} title="Why we ask" activeTerm={active} className="claimwhy" />
      </div>
    </>
  );
}

/**
 * The server's refusal, verbatim.
 *
 * `role="alert"` so it is announced the moment it appears — a person who pressed
 * a button and got nothing has no way to know the page answered. The message is
 * the server's own sentence and is never summarised: it is the one that names
 * the exact expiry date, or the claim number that is already open.
 */
function Refusal({ failure }: { failure: ApiFailure }): React.JSX.Element {
  return (
    <div className="cfrefusal" role="alert">
      <h2>We could not raise this claim</h2>
      <p>{failure.message}</p>
      {Object.entries(failure.fields).map(([field, message]) => (
        <p key={field} className="f">
          {message}
        </p>
      ))}
    </div>
  );
}
