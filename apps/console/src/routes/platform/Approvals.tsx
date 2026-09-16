import { useState } from 'react';
import { Button, Drawer } from '@trugrade/ui';
import { MAKER_CHECKER, ROLES, ROLE_PERMISSIONS } from '@trugrade/contracts';
import { useResource } from '../../lib/useResource';
import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { inr, when } from '../fulfilment/api';

/** Archetype B — board. */

interface ApprovalRow {
  id: string;
  docType: string;
  docId: string;
  amount: string | null;
  makerId: string;
  makerName: string | null;
  madeAt: string;
  requiredPermission: string;
  status: string;
  checkerId: string | null;
  checkerName: string | null;
  decision: string | null;
  canDecide: boolean;
  blockedReason: string | null;
}

interface Band {
  id: string;
  doc_type: string;
  min_amount: string;
  max_amount: string | null;
  required_role: string;
  requires_second_checker: boolean;
}

const config: BoardConfig<ApprovalRow> = {
  kind: 'approval',
  title: 'Approvals',
  endpoint: '/api/ops/platform/approvals',
  rowKey: (r) => r.id,
  searchHint: 'Document id',
  empty: {
    head: 'Nothing waiting for a signature',
    why: 'Ten kinds of document need a second person before they take effect.',
  },
  columns: [
    { key: 'doc', header: 'Document', cell: (r) => r.docType.replace(/_/g, ' ').toLowerCase() },
    { key: 'id', header: 'Reference', cell: (r) => <Id>{r.docId.slice(0, 8)}</Id> },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (r) => (r.amount ? inr(r.amount) : <Unmeasured label="No amount" />),
    },
    { key: 'maker', header: 'Raised by', cell: (r) => r.makerName ?? '—' },
    { key: 'made', header: 'Raised', cell: (r) => when(r.madeAt) },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'checker', header: 'Decided by', cell: (r) => r.checkerName ?? <Unmeasured label="—" /> },
  ],
};

export default function Approvals(): React.JSX.Element {
  const [open, setOpen] = useState<ApprovalRow | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <BoardScreen config={config} onOpen={setOpen} />
      <SeparationMatrix />
      <Ladder />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.docType.replace(/_/g, ' ').toLowerCase() ?? 'Approval'}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={word(open.status)} />
              <span>Raised by {open.makerName ?? '—'}</span>
            </span>
          )
        }
        footer={open && <Decide approval={open} onDone={() => setOpen(null)} />}
      >
        {open && (
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Reference" value={open.docId} />
            <Fact label="Amount" value={open.amount ? inr(open.amount) : 'None'} />
            <Fact label="Raised" value={when(open.madeAt)} />
            <Fact label="Needs" value={open.requiredPermission} />
          </dl>
        )}
      </Drawer>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mono text-body-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * The control, carrying its own reason as its label.
 *
 * "You raised this" in the place the eye is already looking beats "Approve"
 * with an explainer underneath it. Three words, and the button is still
 * focusable so a screen reader reads the reason rather than skipping a disabled
 * control entirely.
 */
function Decide({
  approval,
  onDone,
}: {
  approval: ApprovalRow;
  onDone: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (decision: 'APPROVED' | 'REJECTED'): Promise<void> => {
    const reason = decision === 'REJECTED' ? (window.prompt('Why are you rejecting it?') ?? '') : '';
    // A rejection with no stated reason leaves the maker nothing to fix, so the
    // server refuses it too — this is the same rule said earlier and kindlier.
    if (decision === 'REJECTED' && !reason.trim()) return;
    setBusy(decision);
    setFailed(null);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? 'That was refused.');
      }
      onDone();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const blocked = approval.blockedReason;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        size="sm"
        loading={busy === 'APPROVED'}
        onClick={() => void send('APPROVED')}
        {...(blocked ? { disabledReason: blocked } : {})}
      >
        {blocked ?? 'Approve'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={busy === 'REJECTED'}
        onClick={() => void send('REJECTED')}
        {...(blocked ? { disabledReason: blocked } : {})}
      >
        Reject
      </Button>
      {failed && <span className="text-body-sm text-fail">{failed}</span>}
    </div>
  );
}

/**
 * Who may raise, and who may sign.
 *
 * Rendered from the same `MAKER_CHECKER` table the server checks against, so
 * the screen cannot describe a separation the API does not enforce. A seat
 * appearing in both columns of a row would be a violation, and the test suite
 * fails before it could ever render here.
 */
function SeparationMatrix(): React.JSX.Element {
  const seatsWith = (permission: string): string[] =>
    ROLES.filter(
      (role) =>
        role !== 'PLATFORM_SUPERADMIN' &&
        (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission),
    );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-h2 text-ink">Separation of duties</h2>
      <div className="overflow-x-auto rounded-lg border border-rule bg-sheet">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="bg-sheet-3">
              {['Document', 'Raised by', 'Signed by'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-left text-caption uppercase tracking-wide text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(MAKER_CHECKER).map(([doc, pair]) => (
              <tr key={doc} className="border-t border-rule-2">
                <td className="px-3 py-2 text-body-sm text-ink">
                  {doc.replace(/_/g, ' ').toLowerCase()}
                </td>
                <td className="px-3 py-2 text-body-sm text-ink-2">
                  {seatsWith(pair.maker).join(', ') || '—'}
                </td>
                <td className="px-3 py-2 text-body-sm text-ink-2">
                  {seatsWith(pair.checker).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The delegation ladder: amount decides who signs. */
function Ladder(): React.JSX.Element {
  const { data } = useResource<Band[]>('/api/approvals/bands', 'We could not load the ladder.');
  if (!data?.length) return <></>;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-h2 text-ink">Authority</h2>
      <div className="overflow-x-auto rounded-lg border border-rule bg-sheet">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-sheet-3">
              {['Document', 'From', 'To', 'Signed by', 'Second'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-left text-caption uppercase tracking-wide text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((band) => (
              <tr key={band.id} className="border-t border-rule-2">
                <td className="px-3 py-2 text-body-sm text-ink">
                  {band.doc_type.replace(/_/g, ' ').toLowerCase()}
                </td>
                <td className="mono tnum px-3 py-2 text-body-sm">{inr(band.min_amount)}</td>
                <td className="mono tnum px-3 py-2 text-body-sm">
                  {band.max_amount ? inr(band.max_amount) : 'No ceiling'}
                </td>
                <td className="px-3 py-2 text-body-sm text-ink-2">{band.required_role}</td>
                <td className="px-3 py-2">
                  {band.requires_second_checker ? (
                    <StatusDot tone="warn" label="Two" />
                  ) : (
                    <span className="text-body-sm text-ink-4">One</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
