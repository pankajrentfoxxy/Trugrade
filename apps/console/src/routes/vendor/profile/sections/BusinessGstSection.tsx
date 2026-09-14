import * as React from 'react';
import { INDIAN_STATES, panFromGstin, stateCodeFromGstin } from '@trugrade/contracts';
import { Button, Input, SectionDialog, SelectTile } from '@trugrade/ui';
import {
  completeStep,
  saveStep,
  verifyGstin,
  type VerificationOutcomeView,
} from '../../../../../../storefront/src/app/register/api';
import { ProviderProblem, isProviderProblem, useRetryLadder } from '../../../../../../storefront/src/app/register/verification';
import { toGstin, validateGstin, validateIdentifier } from '../../../../../../storefront/src/app/register/validation';
import { liveFieldError } from '../live-field';

const CONSTITUTIONS = [
  { value: 'PROPRIETORSHIP', label: 'Proprietorship', description: 'Single owner, no separate legal entity.' },
  { value: 'PARTNERSHIP', label: 'Partnership', description: 'Registered or unregistered firm.' },
  { value: 'LLP', label: 'LLP', description: 'Limited liability partnership.' },
  { value: 'PVT_LTD', label: 'Private Limited', description: 'Private limited company.' },
] as const;

export interface BusinessGstDraft {
  constitution: string;
  gstin: string;
  udyam: string;
  verified: VerificationOutcomeView | null;
  confirmed: boolean;
}

function stateName(code: string | null): string {
  if (!code) return 'Not measured';
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
}

export interface BusinessGstSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
  initialConstitution: string | null;
}

export function BusinessGstSection({
  open,
  onClose,
  onSaved,
  initial,
  initialConstitution,
}: BusinessGstSectionProps): React.JSX.Element {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [draft, setDraft] = React.useState<BusinessGstDraft>(() => ({
    constitution: initialConstitution ?? String(initial.constitutionType ?? ''),
    gstin: String(initial.primaryGstin ?? ''),
    udyam: String((initial.captured as { udyam_number?: string } | undefined)?.udyam_number ?? ''),
    verified: null,
    confirmed: false,
  }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [focused, setFocused] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Partial<Record<string, boolean>>>({});
  const verifyRef = React.useRef<() => void>(() => undefined);
  verifyRef.current = () => void verify();
  const retry = useRetryLadder(() => verifyRef.current());

  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setDraft({
      constitution: initialConstitution ?? String(initial.constitutionType ?? ''),
      gstin: String(initial.primaryGstin ?? ''),
      udyam: String((initial.captured as { udyam_number?: string } | undefined)?.udyam_number ?? ''),
      verified: null,
      confirmed: false,
    });
    setError(undefined);
  }, [open, initial, initialConstitution]);

  const pan = panFromGstin(toGstin(draft.gstin));
  const stateCode = stateCodeFromGstin(toGstin(draft.gstin));

  const gstError =
    liveFieldError('gstin', draft.gstin, validateGstin, focused, active) ?? error;

  const verify = async (): Promise<void> => {
    const msg = validateGstin(draft.gstin);
    if (msg) {
      setError(msg);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await verifyGstin({ gstin: toGstin(draft.gstin), expectedPan: pan ?? undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft((d) => ({ ...d, verified: result.data, confirmed: false }));
    retry.note('gstin', result.data);
  };

  const save = async (): Promise<void> => {
    if (step === 1) {
      if (!draft.constitution) {
        setError('Choose your business type.');
        return;
      }
      setStep(2);
      return;
    }
    if (!draft.verified || draft.verified.outcome !== 'PASS' || !draft.confirmed) {
      setError('Verify your GSTIN and confirm the legal name before saving.');
      return;
    }
    const gstin = toGstin(draft.gstin);
    const legalName =
      (draft.verified.resolved?.legalName as string | undefined) ??
      (draft.verified.resolved as { legalName?: string } | undefined)?.legalName ??
      '';
    setBusy(true);
    await saveStep('BUSINESS_PROFILE', { constitutionType: draft.constitution }, 100);
    await saveStep(
      'STATUTORY',
      {
        legalName,
        pan: pan ?? '',
        primaryGstin: gstin,
        gstins: [
          {
            key: 'primary',
            gstin,
            isPrimary: true,
            confirmed: true,
            deferred: false,
          },
        ],
        captured: draft.udyam.trim()
          ? { udyam_number: draft.udyam.trim().toUpperCase() }
          : {},
      },
      100,
    );
    await completeStep('BUSINESS_PROFILE');
    await completeStep('STATUTORY');
    setBusy(false);
    onSaved();
  };

  const taxpayer = draft.verified?.resolved as
    | { legalName?: string; registeredAddress?: { line1?: string; city?: string; state?: string; pincode?: string } }
    | undefined;

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Business & GST"
      subtitle={step === 1 ? 'How your business is registered.' : 'Primary GSTIN for invoices and payouts.'}
      stepIndex={step}
      stepCount={2}
      primaryLabel={step === 1 ? 'Continue' : 'Save'}
      primaryLoading={busy}
      onPrimary={() => void save()}
      onBack={step === 2 ? () => setStep(1) : undefined}
    >
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          {CONSTITUTIONS.map((item) => (
            <SelectTile
              key={item.value}
              label={item.label}
              description={item.description}
              selected={draft.constitution === item.value}
              indicator="radio"
              onToggle={() => {
                setDraft((d) => ({ ...d, constitution: item.value }));
                setError(undefined);
              }}
            />
          ))}
          {error ? (
            <p className="text-body-sm text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input
            label="GSTIN"
            mono
            required
            value={draft.gstin}
            maxLength={15}
            error={gstError}
            onFocus={() => setFocused('gstin')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, gstin: true }));
              setDraft((d) => ({
                ...d,
                gstin: e.target.value.toUpperCase(),
                verified: null,
                confirmed: false,
              }));
              setError(undefined);
            }}
            action={
              <Button type="button" variant="secondary" loading={busy} onClick={() => void verify()}>
                Verify
              </Button>
            }
          />
          {draft.verified && isProviderProblem(draft.verified) ? (
            <ProviderProblem
              view={draft.verified}
              provider="the GST portal"
              retryIn={retry.pending.gstin?.secondsLeft}
              retryAttempt={retry.pending.gstin?.attempt}
              exhausted={retry.exhausted('gstin', draft.verified, busy)}
              onRetryNow={() => void verify()}
            />
          ) : null}
          {draft.verified?.outcome === 'PASS' && taxpayer ? (
            <div className="profile-hub-pass-block">
              <p className="text-body-sm font-medium text-ink">{taxpayer.legalName}</p>
              {taxpayer.registeredAddress ? (
                <p className="mt-1 text-body-sm text-ink-2">
                  {[
                    taxpayer.registeredAddress.line1,
                    taxpayer.registeredAddress.city,
                    taxpayer.registeredAddress.pincode,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              ) : null}
              <dl className="mt-3 flex flex-col gap-2 border-t border-pass-line pt-3 text-body-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">State of registration</dt>
                  <dd className="font-mono tnum text-ink">{stateName(stateCode)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">PAN, from the GSTIN</dt>
                  <dd className="font-mono tnum text-ink">{pan ?? 'Not measured'}</dd>
                </div>
              </dl>
              <label className="mt-3 flex items-start gap-2 text-body-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={draft.confirmed}
                  onChange={(e) => setDraft((d) => ({ ...d, confirmed: e.target.checked }))}
                />
                This is our registered business name.
              </label>
            </div>
          ) : null}
          {draft.verified && draft.verified.outcome === 'FAIL' ? (
            <p className="text-body-sm text-fail" role="alert">
              {draft.verified.message}
            </p>
          ) : null}
          <Input
            label="Udyam (optional)"
            hint="MSME registration means payment inside 45 days by law."
            mono
            value={draft.udyam}
            onFocus={() => setFocused('udyam')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, udyam: true }));
              setDraft((d) => ({ ...d, udyam: e.target.value.toUpperCase() }));
            }}
            error={
              draft.udyam.trim()
                ? validateIdentifier('udyam_number', draft.udyam, false, 'Udyam') ?? undefined
                : undefined
            }
          />
        </div>
      )}
    </SectionDialog>
  );
}
