import { EmptyState } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';

/** Archetype E — workspace. */

interface CreditState {
  provider: string | null;
  connected: boolean;
  buyersOnTerms: number;
  exposure: string;
}

/**
 * Buyer credit, with no underwriter.
 *
 * Same rule as the escrow screen: the numbers are ours, not a provider's, and
 * the screen says which. "Exposure" here is the value of live orders — what we
 * would be carrying if every buyer were on terms — not a limit anybody has
 * underwritten, and labelling it as a limit would turn an internal estimate
 * into a commitment somebody could act on.
 */
export default function Credit(): React.JSX.Element {
  const { data, error } = useResource<CreditState>(
    '/api/finance/credit',
    'We could not load the credit state.',
  );

  if (error) return <EmptyState title="Credit did not load" body={error} />;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-h1 text-ink">Credit</h1>
        {data && (
          <span className="text-body-sm text-ink-3">
            {data.connected ? data.provider : 'No underwriter'}
          </span>
        )}
      </header>

      {data && !data.connected && (
        <EmptyState
          title="No credit provider connected"
          body="Every buyer pays up front. These figures are our own exposure, not an underwritten limit."
        />
      )}

      {data && (
        <dl className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 rounded border border-rule bg-sheet p-4">
            <dt className="text-caption uppercase tracking-wide text-ink-3">Buyers</dt>
            <dd className="mono tnum text-h2 text-ink">{data.buyersOnTerms}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded border border-rule bg-sheet p-4">
            <dt className="text-caption uppercase tracking-wide text-ink-3">Live order value</dt>
            <dd className="mono tnum text-h2 text-ink">{data.exposure}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
