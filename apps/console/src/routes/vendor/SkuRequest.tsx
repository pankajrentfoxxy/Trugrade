import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, EmptyState, Input, StatusPill } from '@trugrade/ui';
import { PageHeader } from '../../lib/controls';
import { API, postJson } from './api';

/**
 * ARCHETYPE F — Focus. One task, centred, three fields.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The vendor half of the Phase 2 SKU-request flow.
 *
 * This exists because step 1 of the wizard needs somewhere to send a vendor
 * whose machine is not catalogued, and "without losing wizard state" is the
 * requirement that matters. The state is already safe — it lives in
 * `sessionStorage` (see `wizard/draft.ts`) — so this screen only has to send
 * them back, which the link at the bottom does.
 *
 * Near matches come back with the submission and are shown immediately. A vendor
 * who has just asked for a SKU we already carry under another name would
 * otherwise wait a day to be told so.
 */

interface NearMatch {
  skuId: string;
  skuCode: string;
  label: string;
  similarity: number;
  exact: boolean;
}

export function SkuRequestRoute(): React.JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [brand, setBrand] = React.useState(params.get('brand') ?? '');
  const [model, setModel] = React.useState('');
  const [config, setConfig] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<NearMatch[] | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ id: string; nearMatches: NearMatch[] }>(API.skuRequests, {
        rawBrand: brand.trim(),
        rawModel: model.trim(),
        rawConfig: config.trim(),
      });
      setMatches(res.nearMatches);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (matches) {
    const exact = matches.find((m) => m.exact);
    return (
      <div>
        <EmptyState
          title={exact ? 'We already carry this machine' : 'Request sent'}
          body={
            exact
              ? `${exact.skuCode} has exactly this specification under another name. Use it and you can list today, rather than waiting for a new SKU to be created.`
              : 'Our catalog team reviews new configurations and will add it or tell you which existing SKU it matches. Everything you had entered in the wizard is still there.'
          }
          action={
            <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
              Back to your draft listing
            </Link>
          }
        />
        {matches.length > 0 && (
          <ul className="mt-6">
            {matches.map((m) => (
              <li
                key={m.skuId}
                className="flex flex-wrap items-center gap-3 border-b border-rule-2 py-3"
              >
                {/* A similarity is a measured value, so it is amber and it
                    carries its scale. A bare "94%" reads as a proportion of
                    something it is not. */}
                <span className="font-mono text-data tnum text-acc-ink">
                  {Math.round(m.similarity * 100)}%
                </span>
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">
                  match
                </span>
                <code className="font-mono text-data text-ink-2">{m.skuCode}</code>
                <span className="text-body-sm text-ink">{m.label}</span>
                {m.exact && <StatusPill tone="info" label="Same specification" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="Ask us to add this machine">
        Your draft listing is saved. Send this and come straight back to it — nothing you have
        entered is lost.
      </PageHeader>

      <div className="flex max-w-lg flex-col gap-5">
        <Input label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} required />
        <Input
          label="Model"
          placeholder="Latitude 5420"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        />
        <Input
          label="Configuration"
          hint="Processor, memory, storage, screen — as printed on the machine or the invoice."
          placeholder="i5-1145G7, 16 GB, 512 GB NVMe, 14in FHD"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          loading={busy}
          disabledReason={
            brand.trim() && model.trim() && config.trim()
              ? ''
              : 'Brand, model and configuration — all three, or we cannot match it against what we carry.'
          }
          onClick={() => void submit()}
        >
          Send the request
        </Button>
        <Button variant="ghost" onClick={() => navigate('/vendor/listings/new')}>
          Back to my draft
        </Button>
      </div>
    </div>
  );
}
