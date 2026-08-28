/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The unit passport: what we found when we opened THIS machine, readable by
 * anyone holding it or thinking about buying it, **before** they pay and without
 * an account.
 *
 * This screen is the reason the product's photographs are allowed to be
 * representative rather than per-unit. A grade photograph is a picture of a
 * *different laptop*, and showing one is only honest if the buyer can reach the
 * actual machine's actual inspection first — which is the CP e-Commerce Rules
 * 2020 r.7(2) and r.7(5) defence, and the whole reason the route is public.
 *
 * Four things it must never do, each of which is a way of turning an absence
 * into a claim:
 *
 *   - **Never render fewer than twelve areas.** An unmeasured area is stored as
 *     an absent row and is served as `NOT_MEASURED` with null scores precisely
 *     so a screen cannot iterate nine rows and imply the other three passed.
 *   - **Never render a null as a zero.** `score: null` is "nobody looked", not
 *     "it scored nothing". Ten of the fourteen detected-hardware fields are null
 *     on a real seeded inspection, and ten "Not measured" cells is the honest
 *     rendering of that.
 *   - **Never draw a viewfinder bracket over something that was not captured.**
 *     The brackets assert *this unit was photographed and identified*, which is
 *     why `ViewfinderFrame` requires the serial and why an absent photograph
 *     gets an empty state rather than a framed placeholder.
 *   - **Never draw a scan line here.** That motif means "this feed is live". A
 *     still photograph taken three days ago is not a live feed.
 *
 * And one thing about caching: the photograph links are signed and expire after
 * **900 seconds**. A cached passport outlives its own pictures, so the route is
 * `force-dynamic` and the fetch is `no-store`.
 */
import type { Metadata } from 'next';
import {
  Barcode,
  GradeBadge,
  RecordHeader,
  ScoreRing,
  SealChip,
  SidePanel,
  StatusPill,
  ViewfinderFrame,
  type SealStatus,
} from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import type { Grade } from '@trugrade/contracts';
import { getUnitPassport, type PassportResult, type UnitPassport } from '../../../lib/api';
import { CategoryStrip } from '../../CategoryStrip';
import { Areas } from './Areas';
import { Hardware, NotMeasured, WipeCertificate } from './panels';

/** The photograph links carry a 900-second signature. Nothing here is cacheable. */
export const dynamic = 'force-dynamic';

type Params = { serial: string };

/**
 * PHASE_05 Task 9: passports are for buyers, not for scrapers assembling a
 * picture of our inventory from a serial range. The API sets `X-Robots-Tag` on
 * its own response; this is the half a crawler reading the HTML sees, and
 * neither depends on `robots.txt` being fetched first.
 *
 * The storefront has no `sitemap.ts` at all today, so there is nothing to keep
 * this route out of — when one is written, this route stays out of it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { serial } = await params;
  return {
    title: `Unit ${serial.toUpperCase()}`,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function UnitPassportPage({
  params,
}: {
  params: Promise<Params>;
}): Promise<React.JSX.Element> {
  const { serial } = await params;
  const result = await getUnitPassport(serial);

  if (result.kind !== 'FOUND') return <Refusal serial={serial} result={result} />;

  const p = result.passport;
  const measured = p.areas.filter((a) => a.status !== 'NOT_MEASURED').length;

  return (
    <>
      <CategoryStrip query="" />

      <div className="body">
        <div className="wrap passport">
          <RecordHeader
            title={p.serialNumber}
            subtitle={
              <>
                Opened at the supply point by our technician, measured, graded against the published
                bands and sealed. This is that inspection &mdash; the machine&rsquo;s own, not a
                sample of its model.
              </>
            }
            status={
              <>
                {p.verdict && (
                  <StatusPill
                    tone={p.verdict === 'PASS' || p.verdict === 'PASS_WITH_NOTE' ? 'pass' : 'fail'}
                    label={VERDICT_LABEL[p.verdict]}
                  />
                )}
                {/* Neutral, always. A+, A and B are all sellable, and colouring
                    a position on a scale would make the PASS beside it mean
                    less. */}
                {p.grade && <GradeBadge grade={p.grade as Grade} />}
              </>
            }
            identifiers={[
              {
                label: 'Inspection score',
                value:
                  p.qcScore === null ? (
                    <NotMeasured />
                  ) : (
                    <>
                      {p.qcScore}
                      <span className="denom"> / 100</span>
                    </>
                  ),
              },
              { label: 'Inspected', value: p.inspectedOn ?? <NotMeasured /> },
              {
                label: 'Certificate valid to',
                value: p.validUntil ?? <NotMeasured />,
              },
              {
                label: 'Seal',
                value: p.seal ? p.seal.code : <span className="notmeasured">No seal recorded</span>,
              },
              {
                label: 'Areas measured',
                value: (
                  <>
                    {measured}
                    <span className="denom"> of {p.areas.length}</span>
                  </>
                ),
              },
            ]}
            action={
              // The one amber control on this page. Everything else that is
              // amber here is a measured value, which is the other thing the
              // accent is allowed to mean.
              <a className="sel" href={`/api/unit/${encodeURIComponent(p.serialNumber)}/report.pdf`}>
                Printed report (PDF)
              </a>
            }
          />

          {/*
            An expired certificate is the loudest thing on the page when it
            happens, because every number below it is a reading from a machine
            that has since been sitting in a warehouse. It is not a failure and
            is not painted as one.
          */}
          {p.expired && (
            <div className="expired" role="status">
              <b>This inspection is out of date.</b> The certificate was valid to{' '}
              <span className="mono">{p.validUntil}</span>. Everything below is what we measured on{' '}
              <span className="mono">{p.inspectedOn}</span> and we are no longer standing behind it
              as current &mdash; the machine goes back through inspection before it can be sold
              again.
            </div>
          )}

          <div className="rec">
            <main className="evid">
              {/* --- THE PHOTOGRAPHS ---------------------------------------- */}
              <Section
                id="photos"
                heading="Inspection photographs"
                sub={
                  p.photos.length > 0
                    ? `${p.photos.length} taken of this machine at inspection`
                    : 'Taken of this machine at inspection'
                }
              >
                {p.photos.length === 0 ? (
                  <div className="empty">
                    <h3>No photographs were kept for this inspection</h3>
                    <p>
                      The areas and the readings below are the record we hold. We are not going to
                      show you a picture of another machine of the same model and let the brackets
                      imply it is this one.
                    </p>
                  </div>
                ) : (
                  <div className="shots">
                    {p.photos.map((photo) => (
                      <div className="shot" key={photo.angle}>
                        {/* The brackets say "this unit was captured and
                            identified", and the component prints the real serial
                            underneath so the claim is checkable against the
                            sticker on the lid. No scan line: this is a still. */}
                        <ViewfinderFrame serial={p.serialNumber}>
                          {/*
                            A plain <img>, not next/image. The URL is an opaque
                            signed token that expires in 900 seconds, so putting
                            it through an image optimiser would cache a picture
                            behind a key that stops resolving — and the optimiser
                            would need the API host allow-listed to boot. The
                            Next ESLint plugin is deliberately not installed here
                            (see `eslint.config.js`), so there is no rule to
                            disable.
                          */}
                          <img
                            src={photo.url}
                            alt={`${ANGLE_LABEL[photo.angle] ?? photo.angle} of unit ${p.serialNumber}, photographed at inspection`}
                            loading="lazy"
                          />
                        </ViewfinderFrame>
                        <span className="ang">{ANGLE_LABEL[photo.angle] ?? photo.angle}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* --- THE TWELVE AREAS --------------------------------------- */}
              <Section
                id="areas"
                heading="The twelve areas"
                sub={`${measured} of ${p.areas.length} measured at this inspection`}
              >
                <Areas areas={p.areas} />
                <p className="fnote">
                  An area with no score was not tested on this visit &mdash; it is listed here with
                  nothing in its score column rather than left out, because a list of nine passes
                  reads as a machine that passed twelve things.{' '}
                  {p.rulesVersion && (
                    <>
                      The bands were applied under rule set{' '}
                      <span className="mono">{p.rulesVersion}</span>, so the grade can be re-derived
                      against the rules in force on the day rather than today&rsquo;s.
                    </>
                  )}
                </p>
              </Section>

              {/* --- DETECTED HARDWARE -------------------------------------- */}
              <Section
                id="hardware"
                heading="What the tool detected"
                sub="Read off the machine, not off the listing"
              >
                <Hardware hardware={p.hardware} />
              </Section>

              {/* --- THE SEAL ----------------------------------------------- */}
              <Section
                id="seal"
                heading="Seal record"
                sub="The sticker on the lid, and what it says"
              >
                {p.seal === null ? (
                  <div className="empty">
                    <h3>No seal is recorded against this unit</h3>
                    <p>
                      Every machine we sell is sealed after inspection and the code is printed on
                      the report that travels with it. If you are holding a sealed machine whose
                      code is not here, do not sign for it &mdash; tell us and we will stop the
                      delivery.
                    </p>
                  </div>
                ) : (
                  <div className="tbl sealcard">
                    <div className="tbh">
                      <b>Tamper-evident seal</b>
                      <span className="m">Applied {p.seal.appliedOn}</span>
                      <div className="r">
                        <SealChip status={p.seal.status as SealStatus} />
                      </div>
                    </div>
                    <div className="sealbody">
                      {/* The strip encodes the code and sits beside it, which is
                          the only arrangement in which it carries information:
                          a barcode with no code next to it is decoration. */}
                      <Barcode code={p.seal.code} />
                      <span className="sealcode mono">{p.seal.code}</span>
                    </div>
                    <div className="tnote">
                      Check this code against the sticker on the lid <b>before</b> you sign for the
                      machine. A seal that is broken, missing or carrying a different code means the
                      case has been open since we inspected it, and nothing on this page describes
                      what is inside it any more.
                    </div>
                  </div>
                )}
              </Section>

              {/* --- THE WIPE ----------------------------------------------- */}
              <Section
                id="wipe"
                heading="Data wipe certificate"
                sub="What happened to the previous owner's data"
              >
                <WipeCertificate certificate={p.wipeCertificate} />
              </Section>
            </main>

            {/* --- THE ACTIONS PANEL -------------------------------------- */}
            <div className="sidep">
              <SidePanel
                title="This inspection"
                description="One machine, one technician visit, one set of readings. Nothing here is averaged across a model."
                footnote={
                  <>
                    You would be buying from {BRAND.legalEntity}, who is the seller of record. Who
                    supplies the machine is our business; what was measured on it is yours, which is
                    why this page shows the second and not the first.
                  </>
                }
              >
                <div className="ringrow">
                  {/* A measured value, which is the second thing amber is allowed
                      to mean. A null score draws a dashed empty ring, not a
                      zero-filled one. */}
                  <ScoreRing value={p.qcScore} size={74} />
                  <div className="ringtext">
                    <b className="mono">
                      {p.qcScore === null ? 'Not measured' : `${p.qcScore} / 100`}
                    </b>
                    <span>
                      {p.qcScore === null
                        ? 'No overall score was recorded for this machine.'
                        : `Overall inspection score, from ${measured} of ${p.areas.length} areas measured.`}
                    </span>
                  </div>
                </div>

                <dl className="facts">
                  <div>
                    <dt>Verdict</dt>
                    <dd className="mono">
                      {p.verdict ? VERDICT_LABEL[p.verdict] : <NotMeasured />}
                    </dd>
                  </div>
                  <div>
                    <dt>Our grade</dt>
                    <dd className="mono">{p.grade ? GRADE_LABEL[p.grade] ?? p.grade : <NotMeasured />}</dd>
                  </div>
                  <div>
                    <dt>Inspected on</dt>
                    <dd className="mono">{p.inspectedOn ?? <NotMeasured />}</dd>
                  </div>
                  <div>
                    <dt>Valid to</dt>
                    <dd className="mono">
                      {p.validUntil ?? <NotMeasured />}
                      {p.expired && <span className="denom"> expired</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Rule set</dt>
                    <dd className="mono">{p.rulesVersion ?? <NotMeasured />}</dd>
                  </div>
                  <div>
                    <dt>Areas measured</dt>
                    <dd className="mono">
                      {measured}
                      <span className="denom"> of {p.areas.length}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Photographs</dt>
                    <dd className="mono">{p.photos.length}</dd>
                  </div>
                  {p.deviceSure && (
                    <div>
                      <dt>{BRAND.qcProduct} certificate</dt>
                      <dd className="mono">{p.deviceSure.certificateId}</dd>
                    </div>
                  )}
                </dl>
              </SidePanel>

              <div className="tbl why">
                <div className="tbh">
                  <b>Why you can read this before you buy</b>
                </div>
                <div className="whybody">
                  <p>
                    The pictures on a model page are of a machine at that grade, not of this one.
                    That is only fair if you can reach this page first &mdash; so every serial we
                    offer links here, and this page needs no account.
                  </p>
                  <p>
                    <b>A missing reading stays missing.</b> Where nothing was measured you will see
                    &ldquo;Not measured&rdquo; rather than a zero or a tick. Nine passes and three
                    silences is not the same machine as twelve passes.
                  </p>
                  <p>
                    Everything on this page is one unit&rsquo;s own record. Nothing is averaged, and
                    no number appears that was not read off this machine.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
 * Pieces
 * ======================================================================== */

/** A section heading with the tick rule under it — a measurement scale edge. */
function Section({
  id,
  heading,
  sub,
  children,
}: {
  id: string;
  heading: string;
  sub: string;
  children: React.ReactNode;
}): React.JSX.Element {
  // The id is the SECTION's, so `#photos` in a link — or in a capture script —
  // resolves to the block a reader wants and not to its two-word heading. The
  // heading carries its own id purely so `aria-labelledby` has something to
  // point at; two elements sharing one id is what makes that ambiguous.
  return (
    <section aria-labelledby={`${id}-h`} id={id}>
      <div className="sh">
        <div className="shrow">
          <h2 id={`${id}-h`}>{heading}</h2>
          <span className="sub">{sub}</span>
        </div>
        <div className="tickrule" aria-hidden="true">
          {Array.from({ length: 31 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * The four ways this page can have nothing to show, said as four different
 * sentences.
 *
 * The 404 is deliberately vague about *why* — the API answers "no such serial",
 * "never inspected" and "withdrawn" identically, because to somebody walking a
 * serial range those are three different answers and to a person holding a
 * laptop they are all "ring us". The screen keeps that property rather than
 * guessing at a friendlier reason.
 */
function Refusal({
  serial,
  result,
}: {
  serial: string;
  result: Exclude<PassportResult, { kind: 'FOUND' }>;
}): React.JSX.Element {
  const panel = ((): { title: string; body: React.ReactNode; error: boolean } => {
    switch (result.kind) {
      case 'NOT_FOUND':
        return {
          title: 'We hold no inspection for that serial',
          error: false,
          body: (
            <>
              <p>
                Nothing we have inspected is numbered{' '}
                <span className="mono">{serial.toUpperCase()}</span>. The serial is on the sticker
                underneath the machine and on the printed report in the box &mdash; it is easy to
                read an <span className="mono">8</span> for a <span className="mono">B</span> or a{' '}
                <span className="mono">0</span> for an <span className="mono">O</span>.
              </p>
              <p>
                If the number is right and this page still says this, do not sign for the machine.
                Ring us with the seal code and we will tell you what we hold.
              </p>
            </>
          ),
        };
      case 'MALFORMED':
        return {
          title: 'That is not a serial we can look up',
          error: false,
          // The API's own sentence, verbatim: it is the half that knows which
          // rule the input broke.
          body: (
            <p>
              {result.message} Serials on our machines look like{' '}
              <span className="mono">TGD000E733</span>.
            </p>
          ),
        };
      case 'RATE_LIMITED':
        return {
          title: 'Too many lookups from here',
          error: false,
          body: (
            <>
              <p>{result.message}</p>
              <p>
                The limit is there because a serial is printed on a case and a page that answers an
                unlimited number of guesses is a way to map our stock. A receiving bay working
                through a pallet will not hit it; a loop will.
                {result.retryAfterSeconds !== null && (
                  <>
                    {' '}
                    This one clears in{' '}
                    <span className="mono">
                      {Math.ceil(result.retryAfterSeconds / 60)} minute
                      {Math.ceil(result.retryAfterSeconds / 60) === 1 ? '' : 's'}
                    </span>
                    .
                  </>
                )}
              </p>
            </>
          ),
        };
      default:
        return {
          title: 'We could not read that inspection',
          error: true,
          body: (
            <p>
              The machine and its report exist; we could not reach our own record of them just now.
              This is our problem, not a statement about the unit. Reload the page &mdash; if it
              keeps happening,{' '}
              <a className="ulink" href="/help">
                our team can pull the report for you
              </a>
              .
            </p>
          ),
        };
    }
  })();

  return (
    <>
      <CategoryStrip query="" />
      <div className="body">
        <div className="wrap passport">
          <div className={panel.error ? 'empty err refusal' : 'empty refusal'}>
            <h3>{panel.title}</h3>
            {panel.body}
            <p className="retry">
              <a className="ulink" href="/search">
                Browse inspected stock
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
 * Pure helpers
 * ======================================================================== */

const VERDICT_LABEL: Record<NonNullable<UnitPassport['verdict']>, string> = {
  PASS: 'PASS',
  PASS_WITH_NOTE: 'PASS with a note',
  MISMATCH: 'Spec mismatch',
  FAIL: 'FAIL',
};

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

const ANGLE_LABEL: Record<string, string> = {
  LID: 'Lid',
  PALMREST: 'Palmrest and keyboard',
  SCREEN_ON: 'Screen, powered on',
  BASE: 'Base',
  PORTS: 'Ports',
  WORST_DEFECT: 'Worst defect found',
};
