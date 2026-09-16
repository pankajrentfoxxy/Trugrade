import { EmptyState } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';

/** Archetype E — workspace. */

interface EscrowState {
  provider: string | null;
  connected: boolean;
  held: string;
  released: string;
  accounts: number;
}

/**
 * Escrow, with nothing connected.
 *
 * **The empty state earns its second line.** A finance user looking at "₹0 held"
 * would reasonably assume the number came from a provider and that we are
 * holding nothing today. We are not holding nothing — we are not holding, full
 * stop, because no escrow provider has signed. Those are different facts and the
 * screen has to say which one it is showing.
 *
 * The numbers below, when they appear, are the platform's own record of what
 * *would* be held. They are not a provider's balance and the screen says so
 * rather than letting the layout imply otherwise.
 */
export default function Escrow(): React.JSX.Element {
  const { data, error } = useResource<EscrowState>(
    '/api/finance/escrow',
    'We could not load the escrow state.',
  );

  if (error) return <EmptyState title="Escrow did not load" body={error} />;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-h1 text-ink">Escrow</h1>
        {data && (
          <span className="text-body-sm text-ink-3">
            {data.connected ? data.provider : 'No provider'}
          </span>
        )}
      </header>

      {data && !data.connected && (
        <EmptyState
          title="No escrow provider connected"
          body="These are the platform's own records of what would be held."
        />
      )}

      {data && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="Would hold" value={data.held} />
          <Figure label="Would release" value={data.released} />
          <Figure label="Accounts" value={String(data.accounts)} />
        </dl>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded border border-rule bg-sheet p-4">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mono tnum text-h2 text-ink">{value}</dd>
    </div>
  );
}
