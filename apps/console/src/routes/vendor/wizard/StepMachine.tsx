import * as React from 'react';
import { Link } from 'react-router';
import { cn } from '@trugrade/ui';
import { MachinePicker } from '../MachinePicker';
import type { SkuDetail } from '../api';
import type { WizardDraft } from './draft';

/**
 * Step 1 of ARCHETYPE D — `Wizard.tsx` owns the shape; this is its content.
 *
 * The machine is chosen by cascading dropdowns rather than by searching the
 * catalog: brand, model, processor, generation, RAM, hard disk. A vendor who
 * cannot spell "EliteBook 840 G8" got nothing from a trigram search and had no
 * way to tell a typo from a machine we have not catalogued. `MachinePicker`
 * carries the cascade; this step carries the wizard's contract with it.
 */

function osLabel(sku: SkuDetail): string {
  return sku.osLicenceType ? `${sku.osSupported} · ${sku.osLicenceType} licence` : sku.osSupported;
}

export function StepMachine({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const [sku, setSku] = React.useState<SkuDetail | null>(draft.sku);

  // `patch` writes through to sessionStorage, so a vendor who leaves to request
  // a SKU comes back to the machine they had already narrowed down.
  const select = React.useCallback(
    (picked: SkuDetail | null): void => {
      setSku(picked);
      patch({
        sku: picked,
        catalogModel:
          picked && picked.modelId
            ? {
                modelId: picked.modelId,
                brandName: picked.brandName,
                modelName: picked.modelName,
              }
            : null,
      });
    },
    [patch],
  );

  return (
    <div className="max-w-xl">
      <MachinePicker
        initialSku={draft.sku}
        onSelect={select}
        footer={
          <p className="text-body-sm text-ink-2">
            Not in the list? That is a machine we have not catalogued yet.{' '}
            <Link className="text-acc-ink underline underline-offset-4" to="/vendor/sku-request">
              Request this SKU
            </Link>{' '}
            — everything you have entered so far is kept and you come straight back here.
          </p>
        }
      />

      {sku && (
        <div className="tg-card mt-5 rounded-lg border border-rule bg-sheet">
          {/* The SKU code is not repeated here — `MachinePicker` names it once,
              directly under the dropdowns that produced it. */}
          <h3 className="text-h3 text-ink">
            {sku.brandName} {sku.modelName}
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-body-sm font-medium text-ink-2">Graphics</p>
              <p className="text-body-sm text-ink">
                {sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType}
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-body-sm font-medium text-ink-2">Screen</p>
              <p className="text-body-sm text-ink">
                <span className="font-mono tnum">{sku.screenSizeIn}</span>
                {`" ${sku.resolution}`}
                {sku.isTouch ? ' touch' : ''}
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-body-sm font-medium text-ink-2">Operating system</p>
              <p className={cn('text-body-sm', sku.osSupported ? 'text-ink' : 'text-ink-4')}>
                {sku.osSupported ? osLabel(sku) : 'Not measured'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
