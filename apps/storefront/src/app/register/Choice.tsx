'use client';

import * as React from 'react';

/**
 * A one-of-several question with **no default answer**.
 *
 * `YesNo` is this shape with two fixed options, and exists because a checkbox
 * cannot ask a two-answer question honestly. This is the same argument for three
 * or four: `pricing_mode` and `preferred_cycle` both have column defaults, and a
 * radio that starts on one of them asserts the commercially convenient answer on
 * behalf of somebody who never gave it. `value === null` until a radio is
 * pressed, so "unanswered" is visible and refusable.
 *
 * `consequence` is rendered for whichever option is currently selected — a
 * statement of what the chosen answer does, rather than a warning bolted onto
 * the one we would rather they did not pick.
 *
 * `note` is rendered for the selected option as well, and is where an option
 * that is not simply granted says so. A supplier who asks for a payout cycle
 * their tier has not earned is told, at the moment they ask.
 */
export interface ChoiceOption {
  value: string;
  label: string;
  consequence?: React.ReactNode;
  /** Rendered beside the consequence when this option is chosen. */
  note?: React.ReactNode;
}

export interface ChoiceProps {
  legend: React.ReactNode;
  /** Same for every radio in this group; must be unique on the page. */
  name: string;
  options: readonly ChoiceOption[];
  /** `null` is unanswered and is the only initial value this component accepts. */
  value: string | null;
  onChange: (value: string) => void;
  description?: React.ReactNode;
  error?: string;
  required?: boolean;
  onFocus?: () => void;
  /** What to say while nothing is chosen. Never a blank, never a tick. */
  unansweredNote?: string;
}

export function Choice({
  legend,
  name,
  options,
  value,
  onChange,
  description,
  error,
  required,
  onFocus,
  unansweredNote = 'Not answered yet.',
}: ChoiceProps): React.JSX.Element {
  const chosen = options.find((o) => o.value === value);

  return (
    <fieldset
      className="flex flex-col gap-3"
      data-testid={`choice-${name}`}
      aria-describedby={error ? `${name}-error` : undefined}
      onFocus={onFocus}
    >
      <legend className="text-body-sm font-medium text-ink-2">
        {legend}
        {required && (
          <span className="text-fail" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </legend>
      {description && <p className="text-body-sm text-ink-2">{description}</p>}

      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded border-l-2 border-y border-r border-y-rule border-r-rule px-4 py-2 text-body-sm ${
              // The amber marker is an active state, which is one of the three
              // things the accent is allowed to mean.
              value === option.value
                ? 'border-l-acc bg-sheet-2 text-ink'
                : 'border-l-rule bg-sheet text-ink-2'
            }`}
          >
            <input
              type="radio"
              name={name}
              className="h-4 w-4 shrink-0 accent-acc"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>

      {/* Never a tick and never a blank: until somebody presses one of them,
          the screen says out loud that nothing has been answered. */}
      {value === null && !error && <p className="text-body-sm text-ink-4">{unansweredNote}</p>}
      {chosen?.consequence && <p className="text-body-sm text-ink-2">{chosen.consequence}</p>}
      {chosen?.note}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      )}
    </fieldset>
  );
}
