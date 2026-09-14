import {
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
};

export function validateSignupPassword(password: string): string | undefined {
  if (password.length < 8) return 'Use at least eight characters.';
  if (!/[A-Z]/.test(password)) return 'Include one capital letter.';
  if (!/[0-9]/.test(password)) return 'Include one number.';
  return undefined;
}

export function signupPasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (password.length === 0) return { score: 0, label: 'Not measured' };
  const missing = validateSignupPassword(password);
  if (!missing) return { score: 3, label: 'Ready' };
  if (password.length >= 6) return { score: 2, label: 'Almost there' };
  if (password.length >= 1) return { score: 1, label: 'Too short' };
  return { score: 0, label: 'Not measured' };
}
