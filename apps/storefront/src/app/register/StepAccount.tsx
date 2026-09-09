'use client';

import * as React from 'react';
import { Button, Input, cn } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { ContactVerifier } from './ContactVerifier';
import { HEARD_FROM } from './picklists';
import {
  measurePassword,
  MOBILE_PREFIX,
  toE164,
  typeMobile,
  validateEmail,
  validateFullName,
  validateMobile,
  workEmailNote,
} from './validation';

/**
 * Step 1 — Account, for both flows.
 *
 * This step is where the account actually comes into existence: both codes are
 * proved here, and `POST /auth/register` refuses without them. Everything after
 * it is an authenticated draft.
 *
 * **Company legal name is step 2**, not here. Registration creates the org shell
 * with a pending placeholder; `BUSINESS_PROFILE` promotion writes the real name.
 *
 * **The vendor flow uses this component, not a copy of it.** The identity half —
 * the two OTP exchanges and the strength meter — is the half that has to be
 * right, and `POST /auth/register` refuses without both proofs whichever kind of
 * organisation is being created. What differs between a buyer and a supplier is
 * three or four extra fields and some wording, so those are a slot and a copy
 * object rather than a second file that only one of them gets the next fix to.
 */

/** Everything that differs in wording between the two flows. */
export interface AccountCopy {
  submitLabel: string;
}

export const BUYER_ACCOUNT_COPY: AccountCopy = {
  submitLabel: 'Create account and continue',
};

export interface AccountValues {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  heardFrom: string;
}

const EMPTY: AccountValues = {
  fullName: '',
  email: '',
  mobile: MOBILE_PREFIX,
  password: '',
  heardFrom: '',
};

function readDraft(answers: Record<string, unknown>): AccountValues {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  return {
    fullName: str('fullName'),
    email: str('email'),
    mobile: typeMobile(str('mobile')),
    password: '',
    heardFrom: str('heardFrom'),
  };
}

/* ==========================================================================
 * The strength meter
 * ======================================================================== */

/**
 * Four segments, and the amber is legitimate: this is a measured value, not
 * decoration. It never shows green — a strong password is not a PASS verdict —
 * and an empty field reads "Not measured" rather than an empty bar that looks
 * like a zero score.
 */
export function StrengthMeter({
  password,
  email,
  mobile = '',
}: {
  password: string;
  email: string;
  /** Optional: a password reset knows the address but not the number. */
  mobile?: string;
}): React.JSX.Element {
  const { score, label, missing } = measurePassword(password, { email, mobile });
  const measured = password.length > 0;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex h-1 min-w-0 flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn(
                'block flex-1 rounded-xs',
                measured && score >= segment ? 'bg-acc' : 'bg-rule',
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            'font-mono text-label uppercase tracking-[0.13em]',
            measured ? 'text-ink' : 'text-ink-4',
          )}
        >
          {measured ? (
            <>
              {label} · <span className="tnum">{score}</span> of <span className="tnum">4</span>
            </>
          ) : (
            'Not measured'
          )}
        </span>
      </div>

      {/* Before a key is pressed there is nothing to measure, so the meter shows
          the rule once rather than five outstanding failures against an empty
          field. Once there is a password, every unmet requirement is listed. */}
      {measured ? (
        missing.length > 0 && (
          <ul className="flex flex-col gap-1 text-body-sm text-ink-2">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-body-sm text-ink-2">
          Twelve characters or more, with a capital, a lower-case letter, a digit and a symbol.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepAccountProps {
  answers: Record<string, unknown>;
  /** True when the account already exists — a resumed applicant sent back here. */
  registered: boolean;
  /** Registers if needed, then saves and completes. Returns a message on refusal. */
  onContinue: (values: AccountValues) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  copy?: AccountCopy;
  /**
   * Fields this flow asks on step 1 that the other does not. The caller owns
   * their state, their errors and their validation, and merges them into the
   * draft in its own `onContinue` — this component neither knows nor stores them.
   */
  extras?: React.ReactNode;
  /** Returns false to hold the submit. The caller renders its own messages. */
  validateExtras?: () => boolean;
  /** When true, Continue does not run the step's own checks. */
  skipValidation?: boolean;
}

export function StepAccount({
  answers,
  registered,
  onContinue,
  busy,
  onFieldFocus,
  copy = BUYER_ACCOUNT_COPY,
  extras,
  validateExtras,
  skipValidation = false,
}: StepAccountProps): React.JSX.Element {
  const [values, setValues] = React.useState<AccountValues>(() =>
    Object.keys(answers).length > 0 ? readDraft(answers) : EMPTY,
  );
  const [emailVerified, setEmailVerified] = React.useState(
    answers.emailVerified === true || registered,
  );
  const [mobileVerified, setMobileVerified] = React.useState(
    answers.mobileVerified === true || registered,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const set = <K extends keyof AccountValues>(key: K, value: AccountValues[K]): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  const strength = measurePassword(values.password, {
    email: values.email,
    mobile: values.mobile,
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!skipValidation) {
      const name = validateFullName(values.fullName);
      if (name) found.fullName = name;
      if (!emailVerified) found.email = 'Verify this address before you continue.';
      if (!mobileVerified) found.mobile = 'Verify this number before you continue.';
      const weakness = strength.missing[0];
      if (!registered && weakness) found.password = weakness;
    }

    // Both halves are checked before either refuses, so a submit never reports
    // the identity fields and then, on the next press, the extras.
    const extrasOk = skipValidation || (validateExtras ? validateExtras() : true);
    if (Object.keys(found).length > 0 || !extrasOk) {
      setErrors(found);
      return;
    }

    const refusal = await onContinue(values);
    if (refusal) setErrors(refusal);
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex flex-col gap-5">
        <Input
          label="Your full name"
          autoComplete="name"
          required
          value={values.fullName}
          onFocus={() => onFieldFocus('Account')}
          onChange={(e) => set('fullName', e.target.value)}
          error={errors.fullName}
        />
      </div>

      <div className="flex flex-col gap-5">
        <ContactVerifier
          channel="EMAIL"
          label="Work email"
          type="email"
          inputMode="email"
          autoComplete="username"
          hint={workEmailNote(values.email)}
          value={values.email}
          onValueChange={(v) => {
            set('email', v);
            setEmailVerified(false);
          }}
          validate={validateEmail}
          verified={emailVerified}
          onVerified={() => setEmailVerified(true)}
          error={errors.email}
        />

        <ContactVerifier
          channel="MOBILE"
          label="Mobile"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          mono
          value={values.mobile}
          onValueChange={(v) => {
            set('mobile', typeMobile(v));
            setMobileVerified(false);
          }}
          validate={validateMobile}
          normalise={toE164}
          verified={mobileVerified}
          onVerified={(normalised) => {
            set('mobile', normalised);
            setMobileVerified(true);
          }}
          error={errors.mobile}
        />
      </div>

      {!registered && (
        <div className="flex flex-col gap-5">
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={values.password}
            onFocus={() => onFieldFocus('Account')}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
          />
          <StrengthMeter
            password={values.password}
            email={values.email}
            mobile={values.mobile}
          />
        </div>
      )}

      {extras}

      <Select
        label="How did you hear about us?"
        options={HEARD_FROM}
        value={values.heardFrom}
        onFocus={() => onFieldFocus('Account')}
        onChange={(e) => set('heardFrom', e.target.value)}
      />

      <div className="flow-actions flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          {copy.submitLabel}
        </Button>
        <p className="text-body-sm text-ink-3">
          Already registered?{' '}
          <a className="text-acc-ink underline underline-offset-4" href="/sign-in">
            Sign in
          </a>{' '}
          and pick up where you left off.
        </p>
      </div>
    </form>
  );
}
