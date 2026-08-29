/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Public certificate verification. Somebody is standing over an open laptop
 * with the printed QC report in one hand and a phone in the other; they have
 * scanned the QR on that report and landed here. They have no account and will
 * never make one. The screen answers ONE question — **is this real** — and
 * everything else on it is subordinate to that answer being unmistakable at
 * arm's length.
 *
 * That is why the frame is `AuthShell`, the same centred, navigation-free
 * column the sign-in screens use: a header, a search box and a category strip
 * are three invitations to leave a page somebody arrived at on purpose, in a
 * warehouse, with a delivery note waiting to be signed.
 *
 * **This is not a second passport.** `/unit/[serial]` is the full record — the
 * twelve areas, the detected hardware, the wipe certificate — and it is one tap
 * away. Restating it here would put two renderings of one document in the
 * product and make the phone screen scroll for a minute before it answered the
 * only question being asked of it. What is here is what a clerk at a door needs
 * before signing: the verdict, the seal code to read against the sticker, the
 * serial, the dates, and the photographs to compare with the object.
 *
 * Five states, and the difference between them is the point:
 *
 *   - **VERIFIED** — the verdict, large, with the seal code, serial and dates.
 *   - **EXPIRED** — the report is real and past its validity. That is *not* a
 *     failure and must not be painted as one: the verdict keeps its own colour
 *     and the staleness is a `--warn` band of its own, because "this machine
 *     failed" and "this reading is old" are different sentences.
 *   - **UNKNOWN CODE** — we hold no record. Said plainly, without implying the
 *     machine is fake: a mistyped character is far likelier than a forgery, and
 *     the alphabet excludes I, L, O and U precisely because people mistype.
 *   - **MALFORMED CODE** — not even the right shape, and the screen says what
 *     the shape is. A code that cannot exist and a code we have not issued are
 *     different answers; conflating them sends somebody hunting for a fraud
 *     when they dropped a character.
 *   - **RATE LIMITED** — the server's own sentence and its own remaining
 *     seconds, counting down honestly. No invented number.
 *
 * Caching: the photograph links are signed and expire after 900 seconds, and a
 * rate-limit answer is true for one caller for a few minutes. Both make this
 * `force-dynamic` with a `no-store` fetch.
 */
import type { Metadata } from 'next';
import { Barcode, BatteryBar, GradeBadge, SealChip, StatusPill, type SealStatus } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import type { Grade } from '@trugrade/contracts';
import { getVerification, type PassportResult, type UnitPassport } from '../../../../lib/api';
import { AuthShell } from '../../../AuthShell';
import { Qr } from './Qr';
import { Shots, Waiting } from './Shots';

/** The photograph links carry a 900-second signature. Nothing here is cacheable. */
export const dynamic = 'force-dynamic';

type Params = { code: string };

/**
 * PHASE_05 Task 9: verification and passport pages are for buyers, not for
 * scrapers assembling a picture of our inventory. The API sets `X-Robots-Tag`
 * on its own response; this is the half a crawler reading the HTML sees, and
 * neither depends on `robots.txt` being fetched first.
 *
 * The storefront still has no `sitemap.ts`, so there is nothing to keep this
 * route out of — when one is written, this route stays out of it.
 *
 * The code itself is deliberately **not** in the title. A verification code is
 * a 70-bit secret printed on a document, and a title is the string that ends up
 * in a browser history, a tab-sharing screenshot and a screen reader's window
 * list.
 */
export const metadata: Metadata = {
  title: 'Certificate check',
  robots: { index: false, follow: false, nocache: true },
};

const SITE_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3000';

export default async function VerifyPage({
  params,
}: {
  params: Promise<Params>;
}): Promise<React.JSX.Element> {
  const { code } = await params;
  const result = await getVerification(code);

  return (
    // `wide`: one column, no claim panel. The claim panel is the right half of a
    // sign-in page because a credential form is 460px wide; this screen carries
    // photographs somebody is comparing against an object, and squeezing six of
    // them into 460px to make room for marketing copy would be the wrong half of
    // the page winning.
    <AuthShell
      wide
      title="Certificate check"
      lede="Scanned from the report that travels with the machine. This is what we hold against that code."
    >
      <div className="verify">
        <Verdict code={code} result={result} />
        {result.kind === 'FOUND' && <Certificate code={code} passport={result.passport} />}
        {result.kind !== 'FOUND' && <Advice result={result} />}
      </div>
    </AuthShell>
  );
}

/* ==========================================================================
 * The answer, largest thing on the page
 * ======================================================================== */

/**
 * One block, five shapes. The kicker above the headline is what changes between
 * verified and expired; the headline itself stays the verdict, so a machine that
 * passed does not read as a machine that failed because its paperwork went
 * stale.
 */
function Verdict({ code, result }: { code: string; result: PassportResult }): React.JSX.Element {
  if (result.kind === 'FOUND') {
    const p = result.passport;
    const tone = p.verdict === null ? 'none' : VERDICT_TONE[p.verdict];
    return (
      <div className={`vdict ${p.expired ? 'stale' : tone}`} data-testid="verdict">
        <span className={p.expired ? 'vkick warn' : 'vkick'}>
          {p.expired ? 'Certificate expired' : 'Certificate verified'}
        </span>
        <strong className={`vbig ${tone}`}>
          {p.verdict === null ? <span className="notmeasured">No verdict recorded</span> : VERDICT_LABEL[p.verdict]}
        </strong>
        <p className="vsub">
          We issued this certificate. It records the inspection of{' '}
          <span className="mono">{p.serialNumber}</span>, carried out on{' '}
          <span className="mono">{p.inspectedOn ?? 'a date we did not record'}</span> and sealed
          afterwards.
        </p>
        {/* Colour is never the only signal: the verdict word is in the pill as
            well as in the headline, per 09_FRONTEND_LOCKED §9. */}
        <span className="vpills">
          {p.verdict && <StatusPill tone={PILL_TONE[p.verdict]} label={VERDICT_LABEL[p.verdict]} />}
          {/* Neutral, always. A+, A and B are all sellable and colouring a
              position on a scale would make the verdict beside it mean less. */}
          {p.grade && GRADE_LABEL[p.grade] && <GradeBadge grade={p.grade as Grade} />}
        </span>
        {/*
          A broken seal outranks everything above it, so it is said here rather
          than only down in the seal panel. The headline is still the verdict —
          the machine passed, and it did — but the record stopped describing the
          machine at the moment the case was opened, and a reader who took
          "PASS" at face value and signed would have been misled by a true
          statement. `--fail` rather than `--warn` because a seal status IS a
          pass/fail signal: `SealChip` in packages/ui maps BROKEN and MISSING to
          the fail tone for the same reason.
        */}
        {p.seal && SEAL_VOID.has(p.seal.status) && (
          <div className="voidseal" role="status">
            <b>Do not sign for this machine.</b> Its seal is recorded as{' '}
            <span className="mono">{p.seal.status.toLowerCase()}</span>. Everything below was true
            of this laptop when we closed it on <span className="mono">{p.seal.appliedOn}</span>;
            the case has been open since, and nothing here describes what is inside it now. Refuse
            the delivery and tell us.
          </div>
        )}
        {p.expired && (
          <div className="expired" role="status">
            <b>This inspection is out of date.</b> The certificate was valid to{' '}
            <span className="mono">{p.validUntil}</span>. The machine did not fail anything &mdash;
            we measured it on <span className="mono">{p.inspectedOn}</span> and we are no longer
            standing behind those readings as current. It goes back through inspection before it can
            be sold again.
          </div>
        )}
      </div>
    );
  }

  const shape: Record<Exclude<PassportResult['kind'], 'FOUND'>, { kick: string; big: string }> = {
    NOT_FOUND: {
      kick: 'No such certificate',
      big: 'We hold no record of this code',
    },
    MALFORMED: {
      kick: 'Not a certificate code',
      big: 'That is not the shape of one of our codes',
    },
    RATE_LIMITED: {
      kick: 'Too many checks from here',
      // Not 'give it a moment'. The wait can be an hour, and a headline that
      // says otherwise is contradicted by the countdown two lines below it.
      big: 'Checks from here are paused',
    },
    ERROR: {
      kick: 'We could not check',
      big: 'Our fault, not the machine’s',
    },
  };
  const { kick, big } = shape[result.kind];

  return (
    <div className="vdict none" data-testid="verdict">
      <span className="vkick">{kick}</span>
      <strong className="vbig sentence">{big}</strong>
      <p className="vsub">
        You checked <span className="mono">{code.toUpperCase()}</span>.
      </p>
    </div>
  );
}

/* ==========================================================================
 * The certificate itself
 * ======================================================================== */

function Certificate({
  code,
  passport: p,
}: {
  code: string;
  passport: UnitPassport;
}): React.JSX.Element {
  const measured = p.areas.filter((a) => a.status !== 'NOT_MEASURED').length;
  const verifyUrl = `${SITE_URL.replace(/\/+$/, '')}/qc/verify/${code.toUpperCase()}`;

  return (
    <>
      {/* --- THE SEAL, which is what the phone is actually being held up to --- */}
      <section className="vseal" aria-labelledby="seal-h">
        <h2 id="seal-h">Seal code</h2>
        {p.seal === null ? (
          <div className="empty">
            <h3>No seal is recorded against this unit</h3>
            <p>
              Every machine we sell is sealed after inspection and the code is printed on the report
              that travels with it. If you are holding a sealed machine whose code is not here, do
              not sign for it &mdash; tell us and we will stop the delivery.
            </p>
          </div>
        ) : (
          <>
            <span className="vsealcode mono" data-testid="seal-code">
              {p.seal.code}
            </span>
            <div className="vsealrow">
              {/* The strip sits beside the code it stands for. On its own it
                  would be decoration, which is the one thing §4 forbids. */}
              <Barcode code={p.seal.code} />
              <SealChip status={p.seal.status as SealStatus} />
            </div>
            <p className="vsealnote">
              Read this against the sticker on the lid <b>before</b> you sign. A seal that is
              broken, missing or carrying a different code means the case has been open since we
              inspected it, and nothing on this page describes what is inside it any more. Applied{' '}
              <span className="mono">{p.seal.appliedOn}</span>.
            </p>
          </>
        )}
      </section>

      {/* --- THE FACTS --------------------------------------------------- */}
      <section className="vfacts" aria-labelledby="facts-h">
        <h2 id="facts-h">What we measured</h2>
        <dl>
          <Fact label="Serial" value={p.serialNumber} />
          <Fact
            label="Our grade"
            value={p.grade === null ? null : (GRADE_LABEL[p.grade] ?? p.grade)}
          />
          <Fact
            label="Inspection score"
            value={
              p.qcScore === null ? null : (
                <>
                  {p.qcScore}
                  <span className="denom"> / 100</span>
                </>
              )
            }
          />
          <Fact
            label="Areas measured"
            value={
              <>
                {measured}
                <span className="denom"> of {p.areas.length}</span>
              </>
            }
          />
          <Fact
            label="Battery health"
            value={
              p.hardware === null || p.hardware.batteryHealthPct === null ? null : (
                <BatteryBar
                  healthPct={p.hardware.batteryHealthPct}
                  {...(p.hardware.cycleCount === null ? {} : { cycleCount: p.hardware.cycleCount })}
                />
              )
            }
          />
          <Fact label="Inspected on" value={p.inspectedOn} />
          <Fact
            label="Certificate valid to"
            value={
              p.validUntil === null ? null : (
                <>
                  {p.validUntil}
                  {p.expired && <span className="denom"> expired</span>}
                </>
              )
            }
          />
          <Fact label="Rule set" value={p.rulesVersion} />
          {p.deviceSure && (
            <Fact label={`${BRAND.qcProduct} certificate`} value={p.deviceSure.certificateId} />
          )}
        </dl>
      </section>

      {/* --- THE PHOTOGRAPHS, which are being held up against an object --- */}
      <section className="vphotos" aria-labelledby="photos-h">
        <h2 id="photos-h">
          Photographs of this machine
          <span className="sub">
            {p.photos.length} taken at inspection
          </span>
        </h2>
        {p.photos.length === 0 ? (
          <div className="empty">
            <h3>No photographs were kept for this inspection</h3>
            <p>
              The readings above are the record we hold. We are not going to show you a picture of
              another machine of the same model and let it stand in for this one.
            </p>
          </div>
        ) : (
          <Shots photos={p.photos} serial={p.serialNumber} />
        )}
      </section>

      {/* --- WHERE TO GO NEXT -------------------------------------------- */}
      <section className="vactions" aria-labelledby="next-h">
        <h2 id="next-h">The rest of the record</h2>
        <div className="vbtns">
          {/* The one amber control on this screen. Everything else amber here is
              a measured value, which is the other thing the accent may mean. */}
          <a className="sel" href={`/unit/${encodeURIComponent(p.serialNumber)}`}>
            Open the full inspection
          </a>
          <a
            className="sel gh"
            href={`/api/unit/${encodeURIComponent(p.serialNumber)}/report.pdf`}
          >
            Printed report (PDF)
          </a>
        </div>
        <p className="fnote">
          The full record carries all {p.areas.length} inspected areas including the ones nobody
          measured, everything the tool read off the machine, and the data-wipe certificate.
        </p>
      </section>

      {/* --- HAND THE PHONE OVER ----------------------------------------- */}
      <section className="vshare" aria-labelledby="share-h">
        <Qr value={verifyUrl} />
        <div>
          <h2 id="share-h">Check it from another phone</h2>
          <p>
            The same code, so a colleague standing beside you reaches the same page rather than
            taking your word for it. No account is needed on either phone.
          </p>
          <span className="vcode mono">{code.toUpperCase()}</span>
        </div>
      </section>

      <p className="fnote off">
        You would be buying from {BRAND.legalEntity}, who is the seller of record. Who supplies the
        machine is our business; what was measured on it is yours, which is why this page shows the
        second and not the first.
      </p>
    </>
  );
}

/**
 * A missing value never renders as a passing one. Every row prints "Not
 * measured" in `--ink-4` rather than a zero, a dash or nothing at all.
 */
function Fact({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mono">
        {value === null || value === undefined ? (
          <span className="notmeasured">Not measured</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/* ==========================================================================
 * The four refusals, said as four different things
 * ======================================================================== */

function Advice({
  result,
}: {
  result: Exclude<PassportResult, { kind: 'FOUND' }>;
}): React.JSX.Element {
  return (
    <section className="vadvice" aria-labelledby="advice-h">
      <h2 id="advice-h">What to do</h2>
      {result.kind === 'NOT_FOUND' && (
        <>
          <p>
            Nothing we have issued carries that code. Read it again off the printed report &mdash;
            our codes never contain <span className="mono">I</span>, <span className="mono">L</span>
            , <span className="mono">O</span> or <span className="mono">U</span>, so a character
            that looks like one of those is a <span className="mono">1</span>,{' '}
            <span className="mono">0</span> or <span className="mono">V</span>.
          </p>
          <p>
            <b>This does not mean the machine is fake.</b> A dropped character is far likelier than
            a forgery. If the code is right and this page still says this, do not sign for the
            machine &mdash; ring us with the seal code from the lid and we will tell you what we
            hold.
          </p>
        </>
      )}

      {result.kind === 'MALFORMED' && (
        <>
          <p>
            A certificate code is <b>14 characters</b>: digits and capital letters, with{' '}
            <span className="mono">I</span>, <span className="mono">L</span>,{' '}
            <span className="mono">O</span> and <span className="mono">U</span> left out so it can
            be retyped off paper without guessing at a glyph. What you checked is not that shape, so
            there is nothing to look up &mdash; it is not a code we have refused, it is a code we
            could not have issued.
          </p>
          <p>
            The code is printed under the QR on the report, and it looks like{' '}
            <span className="mono">F2R8CX064PKTEQ</span>. A machine&rsquo;s <em>serial</em> is a
            different thing &mdash; it is on the sticker underneath the laptop, it is shorter, and
            it starts <span className="mono">TGD</span>. If that is what you have, the record is at{' '}
            <span className="mono">/unit/</span> followed by the serial.
          </p>
        </>
      )}

      {result.kind === 'RATE_LIMITED' && (
        <>
          {/* The server's sentence and the server's seconds, ticking. Nothing
              here invents a number: without a `Retry-After` the notice shows no
              timer at all. */}
          <Waiting message={result.message} retryAfterSeconds={result.retryAfterSeconds} />
          <p>
            The limit exists because a page that answers an unlimited number of guesses is a way to
            map our stock. A receiving bay working through a pallet will not reach it; a script
            will. Your check is not lost &mdash; the same code will answer when the wait is up.
          </p>
        </>
      )}

      {/*
        Careful about what this state may claim. We did not reach our own record,
        so we do not know whether the code is one of ours — saying "the
        certificate exists" here would be asserting the very thing the check
        failed to establish.
      */}
      {result.kind === 'ERROR' && (
        <p>
          We could not reach our own records just now, so we have not checked this code at all
          &mdash; this is neither a yes nor a no about it. It is our problem and it is not a
          statement about the machine. Reload the page &mdash; if it keeps happening,{' '}
          <a className="ulink" href="/help">
            our team can read the report to you
          </a>
          .
        </p>
      )}

      <p className="fnote">
        {BRAND.legalEntity} is the seller of record on every machine we sell. This page needs no
        account and never has.
      </p>
    </section>
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

/** Green and red are PASS and FAIL and nothing else. A mismatch is neither. */
const VERDICT_TONE: Record<NonNullable<UnitPassport['verdict']>, string> = {
  PASS: 'pass',
  PASS_WITH_NOTE: 'pass',
  MISMATCH: 'none',
  FAIL: 'fail',
};

const PILL_TONE: Record<NonNullable<UnitPassport['verdict']>, 'pass' | 'fail' | 'warn'> = {
  PASS: 'pass',
  PASS_WITH_NOTE: 'pass',
  MISMATCH: 'warn',
  FAIL: 'fail',
};

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/**
 * The seal states in which this document no longer describes the object.
 * `REPLACED` is in here too: a seal we did not apply is not our seal.
 */
const SEAL_VOID = new Set(['BROKEN', 'MISSING', 'REPLACED', 'NOT_APPLIED']);
