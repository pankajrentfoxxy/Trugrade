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
  /**
   * Billing rows prefilled from a verified GSTIN look themselves up on arrival.
   * Delivery addresses wait until the applicant focuses or edits the pincode —
   * otherwise a half-filled draft from an earlier visit fires lookups the screen
   * never showed them typing.
   */
  autoLookup?: boolean;
  onFocus: () => void;
  onBlur: () => void;
}

/** One in-flight request per pincode — Strict Mode remounts must not double-call. */
const inFlightLookups = new Map<string, Promise<Awaited<ReturnType<typeof lookupPincode>>>>();

const lookupPincodeOnce = (pincode: string): Promise<Awaited<ReturnType<typeof lookupPincode>>> => {
  const existing = inFlightLookups.get(pincode);
  if (existing) return existing;
  const pending = lookupPincode(pincode).finally(() => {
    inFlightLookups.delete(pincode);
  });
  inFlightLookups.set(pincode, pending);
  return pending;
};

/** Match a saved or prefilled city name to a pincode-directory area option. */
export const pickCityFromAreas = (typed: string, areas: readonly PincodeArea[]): string => {
  const trimmed = typed.trim();
  if (!trimmed || areas.length === 0) return '';
  if (areas.some((a) => a.value === trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const byLabel = areas.find((a) => a.label.toLowerCase() === lower);
  if (byLabel) return byLabel.value;
  // GST verify says Gurugram; India Post still lists Gurgaon in post-office names.
  if (lower === 'gurugram' || lower === 'gurgaon') {
    const gurgaon = areas.find((a) => /gurgaon|gurugram/i.test(a.label));
    if (gurgaon) return gurgaon.value;
  }
  return '';
};

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
  autoLookup = true,
  onFocus,
  onBlur,
}: PincodeLocalityFieldsProps): React.JSX.Element {
  const [areas, setAreas] = React.useState<readonly PincodeArea[]>([]);
  const [stateLocked, setStateLocked] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [lookingUp, setLookingUp] = React.useState(false);
  const lastLookup = React.useRef<string | null>(null);
  const engaged = React.useRef(autoLookup);
  const onChangeRef = React.useRef(onChange);
  const valueRef = React.useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const resetLookup = React.useCallback((): void => {
    setAreas([]);
    setStateLocked(false);
    setLookupError(null);
    lastLookup.current = null;
  }, []);

  const runLookup = React.useCallback(
    async (pincode: string, cityHint: string): Promise<void> => {
      if (readOnly || pincode === lastLookup.current) return;
      setLookingUp(true);
      setLookupError(null);
      const result = await lookupPincodeOnce(pincode);
      setLookingUp(false);
      if (!result.ok) {
        resetLookup();
        setLookupError(result.message);
        return;
      }

      lastLookup.current = pincode;
      setAreas(result.data.areas);
      setStateLocked(true);
      // City stays empty until the applicant picks — unless we can match a saved name.
      const nextCity = pickCityFromAreas(cityHint, result.data.areas);
      onChangeRef.current({
        state: result.data.stateCode,
        city: nextCity,
      });
    },
    [readOnly, resetLookup],
  );

  const maybeLookup = React.useCallback(
    (rawPincode: string, cityHint: string): void => {
      const normalised = normalisePincode(rawPincode);
      if (readOnly || !normalised || validatePincode(normalised) !== undefined) return;
      void runLookup(normalised, cityHint);
    },
    [readOnly, runLookup],
  );

  React.useEffect(() => {
    if (!engaged.current) return;
    maybeLookup(value.pincode, valueRef.current.city);
    // Resume: a saved draft or GST prefill may already hold a pincode; look it up once.
  }, [value.pincode, maybeLookup]);

  const handlePincodeBlur = (): void => {
    const normalised = normalisePincode(value.pincode);
    if (normalised && normalised !== value.pincode) onChange({ pincode: normalised });
    if (normalised && validatePincode(normalised) === undefined) {
      void runLookup(normalised, value.city);
    } else {
      resetLookup();
    }
    onBlur();
  };

  const cityOptions = React.useMemo(
    () => [
      {
        value: '',
        label: areas.length > 0 ? 'Choose the area for this pincode' : 'Enter pincode first',
      },
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
          onFocus={() => {
            engaged.current = true;
            onFocus();
          }}
          onBlur={handlePincodeBlur}
          onChange={(e) => {
            engaged.current = true;
            const next = e.target.value.replace(/[^\d\s]/g, '').replace(/\s+/g, ' ').slice(0, 7);
            const normalised = normalisePincode(next);
            const cityHint = normalised !== lastLookup.current ? '' : value.city;
            if (normalised !== lastLookup.current) {
              setAreas([]);
              setStateLocked(false);
              setLookupError(null);
              lastLookup.current = null;
              onChange({ pincode: next, city: '', state: '' });
            } else {
              onChange({ pincode: next });
            }
            if (normalised && validatePincode(normalised) === undefined) {
              void runLookup(normalised, cityHint || value.city);
            }
          }}
          error={pincodeError}
          hint={lookingUp ? 'Looking up areas for this pincode…' : undefined}
        />
        {!readOnly ? (
          <Select
            label="City"
            required
            disabled={areas.length === 0}
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
            readOnly
            value={value.city}
            onFocus={onFocus}
            onBlur={onBlur}
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
