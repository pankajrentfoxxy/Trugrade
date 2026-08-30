import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumb, Button, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { PageHeader } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  gradeLabel,
  postJson,
  type AddUnitsOutcome,
  type SerialCsvReport,
  type VendorListing,
} from './api';
import { SerialCsvPanel } from './wizard/StepSerials';

/**
 * ARCHETYPE F — Focus. One task, no competing controls.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * Bulk serial upload against an existing listing — dry run first, always.
 *
 * ## The dry run is the screen, and its counts have to be true
 *
 * The useful question is never "did it work" but "what is about to happen to my
 * 440 rows", answered before anything is written and keyed by the line number in
 * the vendor's own file. That only means anything if the promise is kept, and
 * this screen used to break it three ways — every one of them a whole-file
 * refusal the vendor met only AFTER committing:
 *
 *   1. **Warned rows were not counted in the promise.** `willAdd` was the count
 *      of clean rows; the commit was handed clean + warned. The sentence said
 *      412 and the button said 440.
 *   2. **The dry run did not know the listing.** `addUnits` refuses a listing
 *      that is not a DRAFT outright, and this screen is reachable from any
 *      listing row.
 *   3. **Nor its capacity.** `addUnits` refuses the ENTIRE batch when it would
 *      take the listing past 5,000 machines, so a big file onto a nearly-full
 *      listing promised 5,000 and delivered nothing.
 *
 * All three are now answers the dry run gives, because it runs against
 * `POST /listings/:id/serials/validate-csv` rather than the wizard's unscoped
 * route. What is left is the one divergence no dry run can remove: a serial can
 * go live somewhere else between the check and the insert. So the commit's
 * outcome is **reconciled against the promise** and the difference is named, by
 * serial — see `Reconciliation`.
 *
 * Deliberately scoped to **serials on one listing**. `03_UX_SPEC` §3B.2 also
 * describes a cross-SKU importer whose rows carry a SKU code, a grade, a battery
 * figure and a payout — that is a different screen at a different route, needing
 * an endpoint that creates listings from a file. It is not this one, and a grade
 * column here would be actively wrong: a listing carries ONE declared grade and
 * is priced at it, so a B machine under an A listing sells at the A price.
 */

/** The file's promise, kept between the dry run and the commit. */
interface Promised {
  serials: string[];
  report: SerialCsvReport;
}

const EMPTY_REPORT: SerialCsvReport = {
  rows: [],
  willAdd: 0,
  warnings: 0,
  errors: 0,
  fileErrors: [],
  errorReportCsv: '',
};

/** VR-080. Stated on the screen because the vendor has to plan around it. */
const LISTING_MAX_UNITS = 5000;

/**
 * What the commit did, against what the dry run said it would do.
 *
 * **A count that matches is stated as plainly as one that does not.** "430 of
 * 430" is the sentence that makes the dry run worth reading; printing it only
 * when something went wrong teaches people that silence means nothing happened.
 */
function Reconciliation({
  promised,
  outcome,
}: {
  promised: number;
  outcome: AddUnitsOutcome;
}): React.JSX.Element {
  const added = outcome.added.length;
  const short = promised - added;
  // Every verdict the commit produced that is not among the serials it wrote: a
  // serial that went live somewhere else in the seconds between the two.
  const taken = outcome.batch.errors.filter((e) => !outcome.added.includes(e.serial));

  return (
    <div className="tg-card rounded-lg border border-rule bg-sheet" role="status">
      <p className="text-body text-ink">
        <span className="font-mono tnum">{added}</span> of the{' '}
        <span className="font-mono tnum">{promised}</span>{' '}
        {promised === 1 ? 'machine' : 'machines'} the dry run promised{' '}
        {added === 1 ? 'was' : 'were'} added.
      </p>

      {short > 0 ? (
        <>
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">
            The other <span className="font-mono tnum">{short}</span> went live somewhere else in
            the seconds between the check and the write. A serial can be active in exactly one
            place, and that is the one thing no dry run can promise in advance.
          </p>
          {taken.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {taken.map((e) => (
                <li key={e.serial} className="text-body-sm text-ink-2">
                  <code className="font-mono text-data text-ink">{e.serial}</code> — {e.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-2 text-body-sm text-ink-2">
          Exactly what the dry run said, which is the point of running one.
        </p>
      )}

      <p className="mt-4">
        <Link className="text-acc-ink underline underline-offset-4" to={`/vendor/listings`}>
          Back to your stock
        </Link>
      </p>
    </div>
  );
}

export function BulkUploadRoute(): React.JSX.Element {
  const { id } = useParams();
  const listing = useResource<VendorListing>(
    id ? API.listing(id) : '',
    'This listing did not load',
  );

  const [promised, setPromised] = React.useState<Promised>({
    serials: [],
    report: EMPTY_REPORT,
  });
  const [outcome, setOutcome] = React.useState<AddUnitsOutcome | null>(null);
  const [promisedAtCommit, setPromisedAtCommit] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const onAccepted = React.useCallback((serials: string[], report: SerialCsvReport): void => {
    setPromised({ serials, report });
    // A new file is a new promise. Leaving the previous outcome on screen would
    // put "430 machines added" above a table describing a different file.
    setOutcome(null);
    setError(null);
  }, []);

  async function commit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<AddUnitsOutcome>(API.listingUnits(id ?? ''), {
        serials: promised.serials,
      });
      // Captured before the panel is cleared, so the reconciliation compares
      // against the number this file actually promised.
      setPromisedAtCommit(promised.serials.length);
      setOutcome(result);
      setPromised((p) => ({ ...p, serials: [] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (listing.error) {
    return (
      <EmptyState
        title="This listing did not load"
        body={`${listing.error}. Nothing has been changed — reload to try again.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            Open your listings
          </Link>
        }
      />
    );
  }
  if (!listing.data) return <Skeleton lines={8} />;

  const l = listing.data;
  const isDraft = l.status === 'DRAFT';
  const room = Math.max(0, LISTING_MAX_UNITS - l.qtyTotal);

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[
          { label: 'Your stock', href: '/vendor/listings' },
          { label: 'Units', href: `/vendor/listings/${l.id}` },
          { label: 'Add serials' },
        ]}
      />

      <PageHeader
        title="Add serials from a file"
        action={
          <StatusPill
            tone={isDraft ? 'processing' : 'warn'}
            label={l.status.replaceAll('_', ' ')}
          />
        }
      >
        One column of serial numbers. Every row is checked against every live listing on the
        platform before anything is written, and the count you are shown is the count you get.
      </PageHeader>

      {/* Said before the file is chosen, not discovered inside the report. The
          dry run repeats both as row-level or file-level outcomes, because a
          vendor who scrolled past this paragraph still has to be told. */}
      <p className="max-w-prose text-body-sm text-ink-2">
        These machines go on a listing declared{' '}
        <span className="font-mono tnum text-ink">{gradeLabel(l.grade)}</span>, which is the grade
        every serial in this file will be declared at — a machine in a different condition belongs
        on its own listing, at its own price.{' '}
        {isDraft ? (
          <>
            It holds <span className="font-mono tnum text-ink">{l.qtyTotal}</span> of the{' '}
            <span className="font-mono tnum text-ink">{LISTING_MAX_UNITS}</span> machines one
            listing may carry, so there is room for{' '}
            <span className="font-mono tnum text-ink">{room}</span> more.
          </>
        ) : (
          <>
            Serial numbers can only be added while a listing is still a draft, and this one has
            already gone for inspection. The dry run below will say so on any file you upload.
          </>
        )}
      </p>

      {outcome && <Reconciliation promised={promisedAtCommit} outcome={outcome} />}

      <SerialCsvPanel endpoint={API.validateSerialsCsvFor(l.id)} onAccepted={onAccepted} />

      {error && (
        <p className="text-body-sm text-fail" role="alert">
          {error} Nothing has been added.
        </p>
      )}

      <div className="border-t border-rule pt-6">
        <Button
          variant="primary"
          loading={busy}
          disabledReason={
            promised.serials.length === 0
              ? 'Upload a file first — nothing is written until you do.'
              : ''
          }
          onClick={() => void commit()}
        >
          {/* The button's number IS the dry run's number. They were two different
              counts, and a screen that offers to add more machines than it just
              said it would is a screen nobody can check. */}
          {promised.serials.length === 0
            ? 'Nothing to add yet'
            : `Add ${promised.serials.length} ${promised.serials.length === 1 ? 'machine' : 'machines'}`}
        </Button>
      </div>
    </div>
  );
}
