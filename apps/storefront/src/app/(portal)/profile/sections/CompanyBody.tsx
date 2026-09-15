'use client';

import * as React from 'react';
import { completeStep, saveStep } from '../../../register/api';
import { Select } from '../../../../lib/controls';
import { ANNUAL_VOLUMES, EMPLOYEE_BANDS } from '../../../register/picklists';
import { prefillCompanyFromVerifiedGst } from '../../../register/gst-company-prefill';
import type { StepBodyProps } from './step-body';

/**
 * The Company card: the two things the GST portal cannot tell us.
 *
 * Legal name, trade name, constitution and the year the business was
 * registered all come back with the verified GSTIN, so they are written from
 * that response rather than asked for again. What is left to ask is the size
 * of the buyer — headcount, and how many laptops a year — which is what the
 * pricing desk reads.
 */

export interface CompanyBodyProps extends StepBodyProps {
  /** The saved BUSINESS_PROFILE answers. */
  initial: Record<string, unknown>;
  /** The saved STATUTORY answers, which carry the verified GST response. */
  statutory: Record<string, unknown> | undefined;
  blockingReason?: string | null;
}

const str = (answers: Record<string, unknown>, key: string): string =>
  typeof answers[key] === 'string' ? (answers[key] as string) : '';

export function CompanyBody({
  initial,
  statutory,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: CompanyBodyProps): React.JSX.Element {
  const [employeeBand, setEmployeeBand] = React.useState(() => str(initial, 'employeeBand'));
  const [annualVolume, setAnnualVolume] = React.useState(() => str(initial, 'annualVolume'));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  // From the verified GSTIN, or from what an earlier save already wrote.
  const fromGst = React.useMemo(() => prefillCompanyFromVerifiedGst(statutory), [statutory]);
  const legalName = fromGst?.values.legalName ?? str(initial, 'legalName');
  const tradeName = fromGst?.values.tradeName ?? str(initial, 'tradeName');
  const constitution = fromGst?.values.constitution ?? str(initial, 'constitution');
  const yearEstablished = fromGst?.values.yearEstablished ?? str(initial, 'yearEstablished');

  const save = async (): Promise<void> => {
    const found: Record<string, string> = {};
    if (!employeeBand) found.employeeBand = 'Choose the headcount band.';
    if (!annualVolume) found.annualVolume = 'Choose how many laptops you buy in a year.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!legalName) {
      setError('Verify your GSTIN on the Statutory card first — the company details come from it.');
      return;
    }
    setError(undefined);
    onBusy(true);
    const saved = await saveStep(
      'BUSINESS_PROFILE',
      {
        legalName,
        tradeName,
        constitution,
        yearEstablished,
        industry: str(initial, 'industry'),
        employeeBand,
        annualVolume,
      },
      100,
    );
    if (!saved.ok) {
      onBusy(false);
      setError(Object.values(saved.fields)[0] ?? saved.message);
      return;
    }
    const completed = await completeStep('BUSINESS_PROFILE');
    onBusy(false);
    if (!completed.ok) {
      setError(completed.message);
      return;
    }
    onSaved();
  };

  const saveRef = React.useRef(save);
  saveRef.current = save;
  React.useEffect(() => {
    registerSubmit(() => void saveRef.current());
  }, [registerSubmit]);

  return (
    <div className="flex flex-col gap-5">
      {blockingReason ? (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      ) : null}

      {legalName ? (
        <div>
          <p className="mb-1 block text-body-sm font-medium text-ink-2">Registered as</p>
          <p className="text-body text-ink">{legalName}</p>
          {tradeName && tradeName !== legalName ? (
            <p className="text-body-sm text-ink-3">Trading as {tradeName}</p>
          ) : null}
        </div>
      ) : null}

      <Select
        label="Employees"
        required
        options={EMPLOYEE_BANDS}
        value={employeeBand}
        onChange={(e) => {
          setEmployeeBand(e.target.value);
          setErrors(({ employeeBand: _dropped, ...rest }) => rest);
        }}
        error={errors.employeeBand}
      />
      <Select
        label="Laptops bought in a year"
        required
        options={ANNUAL_VOLUMES}
        value={annualVolume}
        onChange={(e) => {
          setAnnualVolume(e.target.value);
          setErrors(({ annualVolume: _dropped, ...rest }) => rest);
        }}
        error={errors.annualVolume}
      />

      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
