import * as React from 'react';
import { NotMeasured } from '../../lib/controls';
import type { VendorListing, VendorListingSku } from './api';

/**
 * The machine a listing is, as the wizard showed it before payout.
 *
 * Shared by the units record and the reprice screen so those two views cannot
 * drift from each other — a vendor who opens Reprice must see the same
 * specification they saw when they listed the stock.
 */

export function machineTitle(listing: VendorListing): string {
  const sku = listing.sku;
  if (sku?.brandName && sku.modelName) return `${sku.brandName} ${sku.modelName}`;
  return 'This listing';
}

function processorLabel(sku: VendorListingSku): string {
  return [sku.cpuBrand, sku.cpuFamily, sku.cpuModel, sku.cpuGeneration]
    .filter(Boolean)
    .join(' ');
}

function graphicsLabel(sku: VendorListingSku): string {
  return sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType;
}

function Spec({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-body-sm font-medium text-ink-2">{label}</p>
      {empty ? (
        <NotMeasured
          why={`${label} was not recorded on this catalog entry`}
          label="Not measured"
        />
      ) : (
        <p className="text-body-sm text-ink">{value}</p>
      )}
    </div>
  );
}

export function ListingMachineCard({
  listing,
}: {
  listing: VendorListing;
}): React.JSX.Element {
  const sku = listing.sku;
  if (!sku) {
    return (
      <div className="tg-card rounded-lg border border-rule bg-sheet">
        <NotMeasured
          why="The catalog entry for this machine could not be read"
          label="No catalog entry"
        />
      </div>
    );
  }

  return (
    <div className="tg-card rounded-lg border border-rule bg-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-h3 text-ink">
          {sku.brandName} {sku.modelName}
        </h2>
        <p className="font-mono text-data tnum text-ink-2">{sku.skuCode}</p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Spec label="Processor" value={processorLabel(sku)} />
        <Spec
          label="Memory"
          value={
            <>
              <span className="font-mono tnum">{sku.ramGb}</span> GB
            </>
          }
        />
        <Spec
          label="Storage"
          value={
            <>
              <span className="font-mono tnum">{sku.storageGb}</span> GB{' '}
              {sku.storageType.replace(/_/g, ' ')}
            </>
          }
        />
        <Spec label="Graphics" value={graphicsLabel(sku)} />
        <Spec
          label="Screen"
          value={
            <>
              <span className="font-mono tnum">{sku.screenSizeIn}</span>
              {`" ${sku.resolution}`}
              {sku.isTouch ? ' touch' : ''}
            </>
          }
        />
        <Spec label="Operating system" value={sku.osSupported} />
      </div>
    </div>
  );
}
