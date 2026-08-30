'use client';

import * as React from 'react';
import { Button, Input } from '@trugrade/ui';
import { validatePincode } from '../register/validation';
import { FORM_MAX_ROWS, type Grade, type RequirementRow } from './api';

/**
 * The requirement list, typed rather than uploaded.
 *
 * The same six columns as the file, in the same order, so a procurement head who
 * types three lines here and uploads forty next month is answering one question
 * both times. Every field goes to the same endpoint and through the same row
 * schema — the server does not have a second, laxer path for a form.
 *
 * **A row is never silently dropped.** An incomplete row is refused with the
 * fix named beside the field it belongs to; it is not skipped, and it is not
 * sent half-filled for the server to reject as line 4 of something the person is
 * looking at.
 */

/** One row as it is being typed: strings, because an `<input>` holds strings. */
export interface Draft {
  model: string;
  quantity: string;
  grade: string;
  targetPrice: string;
  deliveryPincode: string;
  neededBy: string;
}

export const emptyDraft = (): Draft => ({
  model: '',
  quantity: '',
  grade: '',
  targetPrice: '',
  deliveryPincode: '',
  neededBy: '',
});

export type RowErrors = Partial<Record<keyof Draft, string>>;

const GRADES: ReadonlyArray<{ value: Grade; label: string }> = [
  { value: 'A_PLUS', label: 'A+' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
];

/**
 * One row, checked. Empty optional fields are absences, not zeroes.
 *
 * The limits are the row schema's own — 2 to 160 characters of model text, 1 to
 * 10,000 machines — restated so the refusal arrives beside the field instead of
 * as a line number after a round trip.
 */
export function validateDraft(d: Draft): RowErrors {
  const errors: RowErrors = {};

  const model = d.model.trim();
  if (model.length === 0)
    errors.model = 'Name the machine, or describe the specification you need.';
  else if (model.length < 2) errors.model = 'That is too short to match anything. Give us two characters or more.';
  else if (model.length > 160)
    errors.model = 'Keep the description under 160 characters — the make, model and specification is enough.';

  const qty = d.quantity.trim();
  if (qty.length === 0) errors.quantity = 'How many machines do you need?';
  else if (!/^\d+$/.test(qty))
    errors.quantity = 'Enter the quantity as a whole number of machines, digits only.';
  else if (Number(qty) < 1 || Number(qty) > 10_000)
    errors.quantity = 'We take between 1 and 10,000 machines on one line. Split a larger requirement across lines.';

  const price = d.targetPrice.trim();
  if (price.length > 0 && !/^\d+(\.\d{1,2})?$/.test(price))
    errors.targetPrice = 'Enter your target price per machine in rupees — digits, and at most two decimals.';

  errors.deliveryPincode = validatePincode(d.deliveryPincode);

  const by = d.neededBy.trim();
  if (by.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(by))
    errors.neededBy = 'Enter the needed-by date as YYYY-MM-DD.';

  for (const key of Object.keys(errors) as Array<keyof RowErrors>)
    if (errors[key] === undefined) delete errors[key];
  return errors;
}

/** A checked draft, in the shape the endpoint takes. Absences stay absent. */
export function toRequirementRow(d: Draft): RequirementRow {
  const grade = GRADES.find((g) => g.value === d.grade)?.value;
  const price = d.targetPrice.trim();
  const by = d.neededBy.trim();
  return {
    model: d.model.trim(),
    quantity: Number(d.quantity.trim()),
    ...(grade ? { grade } : {}),
    ...(price ? { targetPrice: price } : {}),
    deliveryPincode: d.deliveryPincode.trim(),
    ...(by ? { neededBy: by } : {}),
  };
}

export interface ManualRowsProps {
  rows: readonly Draft[];
  errors: readonly RowErrors[];
  onChange: (index: number, patch: Partial<Draft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function ManualRows({
  rows,
  errors,
  onChange,
  onAdd,
  onRemove,
  disabled,
}: ManualRowsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <fieldset
          key={i}
          className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-4"
        >
          <legend className="flex items-baseline gap-3 px-1">
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Line <span className="tnum">{i + 1}</span>
            </span>
          </legend>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Input
                label="Model or specification"
                hint="A model name, or the specification in your own words."
                value={row.model}
                error={errors[i]?.model}
                disabled={disabled}
                maxLength={160}
                placeholder="Dell Latitude 5420 i5 16GB 512GB"
                onChange={(e) => onChange(i, { model: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Quantity"
                mono
                inputMode="numeric"
                value={row.quantity}
                error={errors[i]?.quantity}
                disabled={disabled}
                placeholder="40"
                onChange={(e) => onChange(i, { quantity: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label
                htmlFor={`grade-${i}`}
                className="text-body-sm font-medium text-ink-2"
              >
                Grade
              </label>
              <select
                id={`grade-${i}`}
                value={row.grade}
                disabled={disabled}
                onChange={(e) => onChange(i, { grade: e.target.value })}
                className="h-11 rounded border border-rule bg-sheet-2 px-3 text-body-sm text-ink"
              >
                {/* Nothing is preselected. A+, A and B are all sellable, so a
                    default here would narrow a requirement the buyer never
                    narrowed. */}
                <option value="">No preference</option>
                {GRADES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <p className="text-body-sm text-ink-2">A+, A and B are all sellable.</p>
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Target price per machine"
                hint="Optional. Rupees."
                mono
                inputMode="decimal"
                value={row.targetPrice}
                error={errors[i]?.targetPrice}
                disabled={disabled}
                placeholder="42000"
                onChange={(e) => onChange(i, { targetPrice: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Delivery pincode"
                hint="Where the machines are going. It decides the landed price."
                mono
                inputMode="numeric"
                value={row.deliveryPincode}
                error={errors[i]?.deliveryPincode}
                disabled={disabled}
                placeholder="122001"
                onChange={(e) => onChange(i, { deliveryPincode: e.target.value })}
              />
            </div>

            <div className="sm:col-span-3">
              {/* A native date input: the platform already has a picker, a
                  keyboard path and a locale, and it emits YYYY-MM-DD, which is
                  exactly what `ordering.rfq.needed_by` takes. */}
              <Input
                label="Needed by"
                hint="Optional. A requirement stays open until this date."
                type="date"
                mono
                value={row.neededBy}
                error={errors[i]?.neededBy}
                disabled={disabled}
                onChange={(e) => onChange(i, { neededBy: e.target.value })}
              />
            </div>

            {rows.length > 1 && (
              <div className="flex items-end sm:col-span-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onRemove(i)}
                >
                  Remove line {i + 1}
                </Button>
              </div>
            )}
          </div>
        </fieldset>
      ))}

      <div>
        {rows.length < FORM_MAX_ROWS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAdd}
            disabled={disabled}
          >
            Add another line
          </Button>
        ) : (
          <p className="text-body-sm text-ink-3">
            This form takes up to <span className="tnum">{FORM_MAX_ROWS}</span> lines. For a longer
            requirement, upload it as a file above.
          </p>
        )}
      </div>
    </div>
  );
}
