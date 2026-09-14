import {
  measurePassword,
  mobileSubscriberDigits,
  typeFullName,
  validateEmail,
  validateFullName,
  validateMobile,
  toE164,
} from '../../../../storefront/src/app/register/validation';

export {
  mobileSubscriberDigits,
  typeFullName,
  validateEmail,
  validateFullName,
  validateMobile,
  toE164,
  measurePassword,
};

export interface SignupPasswordContext {
  email?: string;
  mobile?: string;
}

/** Matches VR-044/045 and the server `measurePassword` checks. */
export function validateSignupPassword(
  password: string,
  context: SignupPasswordContext = {},
): string | undefined {
  const { missing } = measurePassword(password, context);
  return missing[0];
}

export interface SignupPasswordRule {
  id: string;
  label: string;
  met: boolean;
}

const SYMBOL = /[!@#$%^&*()_+\-=[\]{};':",./<>?]/;

export function signupPasswordRules(password: string): SignupPasswordRule[] {
  return [
    { id: 'len', label: '12+ characters', met: password.length >= 12 },
    { id: 'lower', label: 'one lowercase', met: /[a-z]/.test(password) },
    { id: 'cap', label: 'one capital', met: /[A-Z]/.test(password) },
    { id: 'num', label: 'one number', met: /[0-9]/.test(password) },
    { id: 'sym', label: 'one symbol', met: SYMBOL.test(password) },
  ];
}

export function signupPasswordStrength(
  password: string,
  context: SignupPasswordContext = {},
): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  const measured = measurePassword(password, context);
  return { score: measured.score, label: measured.label };
}

export type SignupFieldKey = 'mobile' | 'email' | 'fullName' | 'password' | 'confirm';

/** Live validation: surfaces once the field is focused and the user has typed. */
export function liveFieldError(
  key: SignupFieldKey,
  value: string,
  validate: (value: string) => string | undefined,
  focused: SignupFieldKey | null,
  active: Partial<Record<SignupFieldKey, boolean>>,
): string | undefined {
  const engaged = focused === key || active[key];
  if (!engaged) return undefined;
  if (!active[key] && value.length === 0) return undefined;
  return validate(value);
}
