import {
  emailSchema,
  fullNameSchema,
  mobileSchema,
  passwordSchema,
} from '@trugrade/contracts';

/** Shown in every empty mobile field — the country code is not editable. */
export const MOBILE_PREFIX = '+91 ';

/** The ten subscriber digits after +91. */
export function mobileSubscriberDigits(value: string): string {
  let digits = value.replace(/[^\d]/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('91')) digits = digits.slice(2);
  return digits.slice(0, 10);
}

export function isMobileBlank(value: string): boolean {
  return mobileSubscriberDigits(value).length === 0;
}

/** Digits only, +91 prefix kept, never more than ten subscriber digits. */
export function typeMobile(value: string): string {
  const sub = mobileSubscriberDigits(value);
  return sub.length === 0 ? MOBILE_PREFIX : `${MOBILE_PREFIX}${sub}`;
}

export function validateMobileInput(value: string): string | undefined {
  if (isMobileBlank(value)) return 'Enter the 10-digit mobile number.';
  const sub = mobileSubscriberDigits(value);
  if (sub.length < 10) {
    return `Enter all 10 digits — ${sub.length} so far. Numbers start with 6, 7, 8, or 9.`;
  }
  const parsed = mobileSchema.safeParse(toE164Mobile(value));
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Enter a valid mobile number.';
  return undefined;
}

/** `+919876543210` — the only form the server stores. */
export function toE164Mobile(value: string): string {
  const sub = mobileSubscriberDigits(value);
  return sub.length === 10 && /^[6-9]\d{9}$/.test(sub) ? `+91${sub}` : '';
}

export interface AddUserFormInput {
  fullName: string;
  email: string;
  mobile: string;
  jobTitle: string;
  password: string;
  roles: string[];
}

export function validateAddUserForm(input: AddUserFormInput): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = fullNameSchema.safeParse(input.fullName.trim());
  if (!name.success) errors.fullName = name.error.issues[0]?.message ?? 'Enter a full name.';

  const email = emailSchema.safeParse(input.email.trim());
  if (!email.success) errors.email = email.error.issues[0]?.message ?? 'Enter a valid work email.';

  const mobileErr = validateMobileInput(input.mobile);
  if (mobileErr) errors.mobile = mobileErr;

  const title = input.jobTitle.trim();
  if (title.length === 0) errors.jobTitle = 'Enter this person\'s job title.';
  else if (title.length > 80) errors.jobTitle = 'Job title must be 80 characters or fewer.';

  const password = passwordSchema.safeParse(input.password);
  if (!password.success) {
    errors.password = password.error.issues[0]?.message ?? 'Enter a stronger password.';
  }

  if (input.roles.length === 0) {
    errors.roles = 'Pick at least one role — somebody with none can sign in and see nothing.';
  }

  return errors;
}

export function addUserFormValid(input: AddUserFormInput): boolean {
  return Object.keys(validateAddUserForm(input)).length === 0;
}
