/**
 * ARCHETYPE B — Board. Data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The tax documents on one order — `03_UX_SPEC.md` §3A.3,
 * `/account/orders/[id]/documents`. The second sub-route of the order record;
 * the tab strip that reaches it lives in the record's layout, so this screen
 * inherits it rather than growing its own.
 *
 * **The empty state is the most important part of this screen, and the spec is
 * emphatic about it:** *"documents not yet generated → each row shows when it
 * will exist"*. So there is no empty state in the usual sense at all. Every
 * document is a row on every order, and one that does not exist yet says which
 * moment brings it — a proforma when the order is confirmed, a tax invoice when
 * the machines leave the supply point (s.31(1)(a) puts it at removal, not at
 * payment), an e-way bill at pickup. A blank cell, or worse a greyed-out
 * download, would tell a buyer a file exists. That is the same rule as "a
 * missing value never renders as a passing one", one document up.
 *
 * **A document's existence is not a verdict.** Green and red are PASS and FAIL
 * and nothing else on this platform, so an issued invoice is a neutral chip and
 * an awaited one is `--ink-4` prose. Amber appears exactly once, on the single
 * action a buyer came here to take.
 *
 * **There is no vendor anywhere.** The endpoint behind it reads
 * `payment.invoice` through an allow-list; the only thing on the payload that
 * describes where machines come from is the anonymised `Supply Point A ·
 * Gurugram` label, which is a city and no finer. Neither the JSON nor the PDF
 * bytes carry a supplier name, GSTIN or org id — `invoice-anonymity.spec.ts`
 * plants a vendor's GSTIN in the database and sweeps the rendered file for it.
 *
 * **Filters are deliberately absent for an archetype B screen.** There are
 * never more than about eight rows and a buyer reads all of them; a filter rail
 * over eight rows is chrome. Sort is absent for the same reason — the order is
 * the order the documents come into existence in, which is the order a finance
 * team thinks about them in.
 */
import type { Metadata } from 'next';
import { DocumentsBoard } from './DocumentsBoard';

/** One organisation's tax documents. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Documents on your order',
  robots: { index: false, follow: false },
};

export default async function OrderDocumentsPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <DocumentsBoard orderNumber={decodeURIComponent(orderNumber)} />
      </div>
    </div>
  );
}
