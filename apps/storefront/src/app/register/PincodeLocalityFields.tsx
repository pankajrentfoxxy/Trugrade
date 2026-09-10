'use client';

import * as React from 'react';
import { Input } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { normalisePincode } from '@trugrade/contracts';
import { lookupPincode, type PincodeArea } from './api';
import { STATES } from './picklists';
import { validatePincode } from './validation';

export interface LocalityValues {
  pincode: string;
  city: string;
  state: string;
}

export interface PincodeLocalityFieldsProps {
  value: LocalityValues;
  onChange: (patch: Partial<LocalityValues>) => void;
  errors: {
    pincode?: string;
    city?: string;
    state?: string;
  };
  readOnly?: boolean;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * PIN code, then city and state.
 *
 * When the pincode passes format validation we ask the server, which reads
 * India Post and returns the state plus the block or district choices for city.
 */
export function PincodeLocalityFields({
  value,
  onChange,
  errors,
  readOnly,
  onFocus,
  onBlur,
}: PincodeLocalityFieldsProps): React.JSX.Element {
  const [areas, setAreas] = React.useState<readonly PincodeArea[]>([]);
  const [stateLocked, setStateLocked] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [lookingUp, setLookingUp] = React.useState(false);
  const lastLookup = React.useRef<string | null>(null);

  React.useEffect(() => {
    const normalised = normalisePincode(value.pincode);
    if (readOnly || !normalised || validatePincode(normalised) !== undefined) return;
    if (lastLookup.current === normalised) return;
    void runLookup(normalised);
    // Resume: a saved draft may already hold a pincode; look it up once.
  }, [value.pincode, readOnly]);

  const resetLookup = (): void => {
    setAreas([]);
    setStateLocked(false);
    setLookupError(null);
    lastLookup.current = null;
  };

  const runLookup = async (pincode: string): Promise<void> => {
    if (readOnly || pincode === lastLookup.current) return;
    setLookingUp(true);
    setLookupError(null);
    const result = await lookupPincode(pincode);
    setLookingUp(false);
    if (!result.ok) {
      resetLookup();
      setLookupError(result.message);
      return;
    }

    lastLookup.current = pincode;
    setAreas(result.data.areas);
    setStateLocked(true);
    // City stays empty until the applicant picks — even when only one area exists.
    const nextCity = result.data.areas.some((a) => a.value === value.city) ? value.city : '';
    onChange({
      state: result.data.stateCode,
      city: nextCity,
    });
  };

  const handlePincodeBlur = (): void => {
    const normalised = normalisePincode(value.pincode);
    if (normalised && normalised !== value.pincode) onChange({ pincode: normalised });
    if (normalised && validatePincode(normalised) === undefined) {
      void runLookup(normalised);
    } else {
      resetLookup();
    }
    onBlur();
  };

  const cityOptions = React.useMemo(
    () => [
      { value: '', label: areas.length > 0 ? 'Choose the area for this pincode' : 'Enter the city' },
      ...areas.map((a) => ({ value: a.value, label: a.label })),
    ],
    [areas],
  );

  const pincodeError = errors.pincode ?? lookupError ?? undefined;
  const cityError =
    errors.city ?? (areas.length > 0 && !value.city ? 'Choose the area this pincode covers.' : undefined);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="PIN code"
          mono
          inputMode="numeric"
          maxLength={7}
          required
          readOnly={readOnly}
          value={value.pincode}
          onFocus={onFocus}
          onBlur={handlePincodeBlur}
          onChange={(e) => {
            const next = e.target.value.replace(/[^\d\s]/g, '').replace(/\s+/g, ' ').slice(0, 7);
            const normalised = normalisePincode(next);
            if (normalised !== lastLookup.current) {
              setAreas([]);
              setStateLocked(false);
              setLookupError(null);
            }
            onChange({ pincode: next });
          }}
          error={pincodeError}
          hint={lookingUp ? 'Looking up areas for this pincode…' : undefined}
        />
        {areas.length > 0 && !readOnly ? (
          <Select
            label="City"
            required
            options={cityOptions}
            value={value.city}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(e) => onChange({ city: e.target.value })}
            error={cityError}
          />
        ) : (
          <Input
            label="City"
            required
            readOnly={readOnly}
            value={value.city}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(e) => onChange({ city: e.target.value })}
            error={cityError}
          />
        )}
      </div>
      <Select
        label="State"
        required
        disabled={readOnly || (stateLocked && value.state.length > 0)}
        options={STATES}
        value={value.state}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange({ state: e.target.value })}
        error={errors.state}
        hint={
          stateLocked && value.state.length > 0
            ? 'Filled from the pincode directory.'
            : undefined
        }
      />
    </>
  );
}
