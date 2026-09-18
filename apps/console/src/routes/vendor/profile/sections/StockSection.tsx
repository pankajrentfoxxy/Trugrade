import * as React from 'react';
import { persistInOrder } from '../persist';
import { Chip, SectionDialog, SelectTile } from '@trugrade/ui';
import { completeStep, saveStep } from '../../../../../../storefront/src/app/register/api';
import { apiFetch } from '../../../../lib/auth';

const VOLUMES = [
  { id: '1-10', label: 'Up to 10 / month' },
  { id: '11-50', label: '11–50 / month' },
  { id: '51-200', label: '51–200 / month' },
  { id: '201-500', label: '201–500 / month' },
  { id: '500+', label: '500+ / month' },
] as const;

const GRADES = ['A_PLUS', 'A', 'B'] as const;

export interface StockSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
}

export function StockSection({
  open,
  onClose,
  onSaved,
  initial,
}: StockSectionProps): React.JSX.Element {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [brands, setBrands] = React.useState<string[]>(
    Array.isArray(initial.brands) ? (initial.brands as string[]) : [],
  );
  const [volume, setVolume] = React.useState(String(initial.monthlyVolume ?? ''));
  const [canDropship, setCanDropship] = React.useState<boolean | null>(
    typeof initial.canDropship === 'boolean' ? (initial.canDropship as boolean) : null,
  );
  const [grades, setGrades] = React.useState<string[]>(
    Array.isArray(initial.grades) ? (initial.grades as string[]) : [],
  );
  const [brandOptions, setBrandOptions] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!open) return;
    void apiFetch('/api/public/brands')
      .then((r) => r.json())
      .then((body: { name?: string }[]) => {
        if (Array.isArray(body)) setBrandOptions(body.map((b) => b.name ?? '').filter(Boolean));
      })
      .catch(() => setBrandOptions(['Dell', 'HP', 'Lenovo', 'Apple']));
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setBrands(Array.isArray(initial.brands) ? (initial.brands as string[]) : []);
      setVolume(String(initial.monthlyVolume ?? ''));
      setCanDropship(
        typeof initial.canDropship === 'boolean' ? (initial.canDropship as boolean) : null,
      );
      setGrades(Array.isArray(initial.grades) ? (initial.grades as string[]) : []);
      setError(undefined);
    }
  }, [open, initial]);

  const save = async (): Promise<void> => {
    if (step === 1) {
      if (brands.length === 0 || !volume) {
        setError('Pick at least one brand and a monthly volume.');
        return;
      }
      setStep(2);
      return;
    }
    if (canDropship === null || grades.length === 0) {
      setError('Answer dispatch and pick at least one grade.');
      return;
    }
    setBusy(true);
    const failed = await persistInOrder([
      () =>
        saveStep(
          'CAPABILITY',
          {
            brands,
            monthlyVolume: volume,
            canDropship,
            grades,
            categories: ['LAPTOP'],
          },
          100,
        ),
      () => completeStep('CAPABILITY'),
    ]);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onSaved();
  };

  const toggle = (list: string[], value: string, on: (next: string[]) => void): void => {
    on(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="What you stock"
      subtitle="Recommended — helps us route enquiries."
      stepIndex={step}
      stepCount={2}
      primaryLabel={step === 1 ? 'Continue' : 'Save'}
      primaryLoading={busy}
      onPrimary={() => void save()}
      onBack={step === 2 ? () => setStep(1) : undefined}
    >
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-body-sm font-medium text-ink-2">Brands</p>
            <div className="flex flex-wrap gap-2">
              {brandOptions.map((brand) => (
                <Chip
                  key={brand}
                  label={brand}
                  selected={brands.includes(brand)}
                  onToggle={() => toggle(brands, brand, setBrands)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-body-sm font-medium text-ink-2">Monthly volume</p>
            <div className="flex flex-wrap gap-2">
              {VOLUMES.map((v) => (
                <Chip
                  key={v.id}
                  label={v.label}
                  selected={volume === v.id}
                  onToggle={() => setVolume(v.id)}
                />
              ))}
            </div>
          </div>
          {error ? (
            <p className="text-body-sm text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-body-sm font-medium text-ink-2">Dispatch direct to customer?</p>
            <SelectTile
              label="Yes — we can ship direct"
              selected={canDropship === true}
              indicator="radio"
              onToggle={() => setCanDropship(true)}
            />
            <div className="mt-2">
              <SelectTile
                label="No — hub dispatch only"
                selected={canDropship === false}
                indicator="radio"
                onToggle={() => setCanDropship(false)}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-body-sm font-medium text-ink-2">Grade mix</p>
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => (
                <Chip
                  key={g}
                  label={g.replace('_PLUS', '+')}
                  selected={grades.includes(g)}
                  onToggle={() => toggle(grades, g, setGrades)}
                />
              ))}
            </div>
          </div>
          {error ? (
            <p className="text-body-sm text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SectionDialog>
  );
}
