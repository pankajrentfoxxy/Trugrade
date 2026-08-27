'use client';

import * as React from 'react';

/**
 * A two-option question with **no default answer**.
 *
 * This exists because a checkbox cannot ask it. An unticked box says "no" and
 * "nobody has answered" in the same pixel, and on the two questions that use it
 * here the difference is the whole point: `can_dropship` decides whether we can
 * work with a supplier the way our model works at all, and the column defaults
 * to `true`, so an unticked box would quietly assert the commercially
 * convenient answer on behalf of someone who never gave it.
 *
 * A pair of radios with `value === null` until one is pressed is the honest
 * shape: unanswered is visible, unanswered is refusable, and neither answer is
 * chosen for anybody. It is also what CP e-Comm Rule 4(9) is really asking for
 * on a question that changes what happens to the account.
 *
 * `consequence` is what the chosen answer does — rendered for whichever answer
 * is currently selected, so it is a statement of fact rather than a warning
 * attached to the option we would prefer they did not pick.
 */
export interface YesNoProps {
  /** The question, as a question. Becomes the group's accessible name. */
  legend: React.ReactNode;
  /** Same for every radio in this group; must be unique on the page. */
  name: string;
  /** `null` is unanswered and is the only initial value this component accepts. */
  value: boolean | null;
  onChange: (value: boolean) => void;
  yesLabel: string;
  noLabel: string;
  /** What each answer means, shown once that answer is the one selected. */
  yesConsequence?: React.ReactNode;
  noConsequence?: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  required?: boolean;
  onFocus?: () => void;
}

export function YesNo({
  legend,
  name,
  value,
  onChange,
  yesLabel,
  noLabel,
  yesConsequence,
  noConsequence,
  description,
  error,
  required,
  onFocus,
}: YesNoProps): React.JSX.Element {
  const options: Array<{ answer: boolean; label: string }> = [
    { answer: true, label: yesLabel },
    { answer: false, label: noLabel },
  ];
  const consequence = value === true ? yesConsequence : value === false ? noConsequence : null;

  return (
    <fieldset
      className="flex flex-col gap-3"
      data-testid={`yesno-${name}`}
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

      <div className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => (
          <label
            key={option.label}
            className={`flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded border-l-2 border-y border-r border-y-rule border-r-rule px-4 py-2 text-body-sm ${
              // The amber marker is an active state, which is one of the three
              // things the accent is allowed to mean.
              value === option.answer
                ? 'border-l-acc bg-sheet-2 text-ink'
                : 'border-l-rule bg-sheet text-ink-2'
            }`}
          >
            <input
              type="radio"
              name={name}
              className="h-4 w-4 accent-acc"
              value={option.answer ? 'yes' : 'no'}
              checked={value === option.answer}
              onChange={() => onChange(option.answer)}
            />
            {option.label}
          </label>
        ))}
      </div>

      {/* Never a tick and never a blank: until somebody presses one of the two,
          the screen says out loud that nothing has been answered. */}
      {value === null && !error && <p className="text-body-sm text-ink-4">Not answered yet.</p>}
      {consequence && <p className="text-body-sm text-ink-2">{consequence}</p>}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      )}
    </fieldset>
  );
}
