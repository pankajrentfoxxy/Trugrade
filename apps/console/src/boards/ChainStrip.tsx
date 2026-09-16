import { Link } from 'react-router';
import { useResource } from '../lib/useResource';

/**
 * Seven steps, the same seven in every drawer.
 *
 * Order → Purchase orders → Packed → Shipment → Delivered → Invoice → Vendor
 * paid. Wherever an operator entered the chain — a failed shipment, a payable
 * on hold, an invoice query — this is the whole of it, and each step is a link
 * to the record behind it when one exists.
 *
 * **A step with no record yet still renders.** The gap is the information: an
 * order with no shipment is an order nobody dispatched, and drawing six steps
 * instead of seven hides precisely the thing somebody opened the record to find.
 */

export type ChainState = 'DONE' | 'ACTIVE' | 'PENDING' | 'FAILED';

interface ChainStep {
  key: string;
  label: string;
  state: ChainState;
  value: string | null;
  href: string | null;
}

const TINT: Record<ChainState, string> = {
  DONE: 'border-pass-line bg-pass-wash text-pass',
  ACTIVE: 'border-acc-2 bg-acc-wash text-acc-ink',
  PENDING: 'border-rule bg-sheet-2 text-ink-4',
  FAILED: 'border-fail-line bg-fail-wash text-fail',
};

export function ChainStrip({ orderNumber }: { orderNumber: string | null }): React.JSX.Element {
  const { data, error } = useResource<{ orderNumber: string; steps: ChainStep[] }>(
    orderNumber ? `/api/ops/chain/${encodeURIComponent(orderNumber)}` : '',
    'We could not trace this order.',
  );

  if (!orderNumber) {
    return (
      <p className="text-body-sm text-ink-4">
        No order behind this record, so there is no chain to trace.
      </p>
    );
  }
  if (error) return <p className="text-body-sm text-ink-4">{error}</p>;

  const steps = data?.steps ?? [];

  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Order chain">
      {(steps.length ? steps : SKELETON).map((step) => {
        const body = (
          <>
            <span className="text-caption uppercase tracking-wide">{step.label}</span>
            <span className="mono tnum text-body-sm">{step.value ?? '—'}</span>
          </>
        );
        return (
          <li key={step.key}>
            {step.href ? (
              <Link
                to={step.href}
                className={`flex min-w-[92px] flex-col gap-0.5 rounded border px-2.5 py-1.5 hover:border-acc ${TINT[step.state]}`}
              >
                {body}
              </Link>
            ) : (
              <div
                className={`flex min-w-[92px] flex-col gap-0.5 rounded border px-2.5 py-1.5 ${TINT[step.state]}`}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Seven boxes while it loads, so the drawer does not change height under the cursor. */
const SKELETON: ChainStep[] = [
  'Order',
  'Purchase orders',
  'Packed',
  'Shipment',
  'Delivered',
  'Invoice',
  'Vendor paid',
].map((label) => ({ key: label, label, state: 'PENDING' as const, value: null, href: null }));
