import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  GradeBadge,
  Input,
  Modal,
  Skeleton,
} from '@trugrade/ui';
import { GRADES, VENDOR_NET_PAYOUT, type Grade } from '@trugrade/contracts';
import { Select } from '../../../lib/controls';
import { useResource } from '../../../lib/useResource';
import {
  API,
  postJson,
  rupees,
  type PayoutPreview,
  type SkuDetail,
  type VendorFacility,
} from '../api';
import { MachinePicker } from '../MachinePicker';

export function CreateListingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const navigate = useNavigate();
  const { data: facilities } = useResource<VendorFacility[]>(API.facilities, 'Facilities unavailable');
  const [sku, setSku] = React.useState<SkuDetail | null>(null);
  const [grade, setGrade] = React.useState<Grade>('A');
  const [qty, setQty] = React.useState('5');
  const [ask, setAsk] = React.useState('');
  const [facilityId, setFacilityId] = React.useState('');
  const [preview, setPreview] = React.useState<PayoutPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const units = Number(qty);
    const amount = ask.trim();
    if (!sku || !Number.isFinite(units) || units < 1 || !/^\d+(\.\d{1,2})?$/.test(amount)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void postJson<PayoutPreview>(API.payoutPreview, {
        skuId: sku.skuId,
        grade,
        vendorWarrantyMonths: 6,
        units,
        ask: { mode: 'NET_PAYOUT', vendorNetPayout: amount },
      })
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setPreviewError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError((e as Error).message);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sku, grade, qty, ask]);

  async function submit(): Promise<void> {
    if (!sku || !facilityId) return;
    setBusy(true);
    setError(null);
    try {
      const listing = await postJson<{ id: string }>(API.listings, {
        skuId: sku.skuId,
        pickupLocationId: facilityId,
        grade,
        conditionType: 'REFURBISHED',
        functionalStatus: 'FULLY_FUNCTIONAL',
        batteryHealthBand: 'GOOD',
        partsStatus: 'ORIGINAL',
        partsReplaced: [],
        repairHistory: 'NONE',
        dataWipeStatus: 'CERTIFIED',
        sellerWarranty: 'M6',
        oemWarrantyRemaining: 'NONE',
        vendorWarrantyMonths: 6,
        vendorAskPrice: ask.trim(),
        moq: 1,
        dispatchSlaHours: 48,
      });
      onClose();
      void navigate(`/vendor/listings/${listing.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const units = Number(qty);
  const askOk =
    /^\d+(\.\d{1,2})?$/.test(ask.trim()) &&
    Number(ask) >= VENDOR_NET_PAYOUT.min &&
    Number(ask) <= VENDOR_NET_PAYOUT.max;

  return (
    <Modal open={open} onClose={onClose} title="Create listing" description="Machine, grade, quantity, ask." size="lg">
      <div className="flex flex-col gap-4">
        {error && (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        )}

        <MachinePicker onSelect={setSku} />

        <div className="flex flex-wrap gap-2">
          {GRADES.map((g) => (
            <button key={g} type="button" onClick={() => setGrade(g)}>
              <GradeBadge grade={g} variant={grade === g ? 'verified' : 'declared'} />
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Quantity"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Your ask (net per machine)"
            mono
            type="number"
            min={VENDOR_NET_PAYOUT.min}
            max={VENDOR_NET_PAYOUT.max}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
          />
        </div>

        {facilities ? (
          <Select
            label="Pickup facility"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            options={[
              { value: '', label: 'Choose facility' },
              ...facilities.map((f) => ({
                value: f.addressId,
                label: `${f.label} · ${f.city}`,
              })),
            ]}
          />
        ) : (
          <Skeleton lines={1} />
        )}

        {previewError && <p className="text-body-sm text-fail">{previewError}</p>}
        {preview && (
          <div className="rounded border border-rule bg-sheet-2 p-4" data-testid="payout-preview">
            <dl className="grid gap-2 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-ink-2">You receive</dt>
                <dd className="font-mono tnum text-ink">{rupees(preview.netPayout.toString())}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-2">Commission</dt>
                <dd className="font-mono tnum text-acc-ink">
                  {preview.commissionPct}% · {rupees(preview.commissionAmount)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-rule-2 pt-2">
                <dt className="text-ink">Buyer pays</dt>
                <dd className="font-mono tnum text-ink">{rupees(preview.buyerPays)}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabledReason={
              !sku
                ? 'Choose the machine.'
                : !facilityId
                  ? 'Pick a facility.'
                  : !askOk
                    ? 'Enter a valid ask.'
                    : units < 1
                      ? 'Quantity must be at least 1.'
                      : ''
            }
            onClick={() => void submit()}
          >
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
