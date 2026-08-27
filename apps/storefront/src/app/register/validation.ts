import {
  EMAIL,
  FULL_NAME,
  MOBILE_E164,
  PASSWORD_BLOCKLIST_WORDS,
  normaliseEmail,
  normaliseMobile,
} from '@trugrade/contracts';

/**
 * Client-side validation for registration.
 *
 * Every rule here also runs on the server — this is the round trip saved, never
 * the enforcement. What it must NOT do is disagree with the server, so each
 * function is built from the shared rule object rather than from a regex
 * retyped next to the field.
 *
 * The messages say what failed and how to fix it. "Invalid input" is not a
 * message, and a red border with no text is not an error state.
 */

/** Free webmail domains. Not a blocklist — see `workEmailNote`. */
const CONSUMER_MAILBOXES = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.in',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'rediffmail.com',
  'protonmail.com',
  'proton.me',
  'icloud.com',
  'aol.com',
  'zoho.com',
];

export function validateFullName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter your full name — this is the name on the account.';
  return FULL_NAME.pattern?.test(trimmed) ? undefined : FULL_NAME.message;
}

export function validateCompanyName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter the company name. It appears on every invoice we raise.';
  if (trimmed.length < 2) return 'That is too short to be a company name.';
  if (trimmed.length > 200) return 'That is too long for a company name.';
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter the email address you use at work.';
  const normalised = normaliseEmail(trimmed);
  if (!normalised || !EMAIL.pattern?.test(normalised)) return EMAIL.message;
  if (normalised.length > (EMAIL.max ?? 254)) return EMAIL.message;
  return undefined;
}

/**
 * Not an error, and deliberately not a refusal.
 *
 * VR-032b refuses *temporary* mailboxes and is enforced server-side; a free
 * mailbox at a real provider is a different thing and plenty of small Indian
 * traders genuinely run on one. Blocking it here would invent an enforcement
 * that does not exist and lock out real buyers, so this says what the address
 * costs them and lets them decide.
 */
export function workEmailNote(value: string): string | undefined {
  const normalised = normaliseEmail(value.trim());
  if (!normalised) return undefined;
  const domain = normalised.slice(normalised.lastIndexOf('@') + 1);
  if (!CONSUMER_MAILBOXES.includes(domain)) return undefined;
  return (
    `${domain} is a personal mailbox, and we can accept it. A company-domain address is ` +
    'verified faster and survives the person who opened the account leaving.'
  );
}

export function validateMobile(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter the mobile number that receives the delivery updates.';
  return normaliseMobile(trimmed) ? undefined : MOBILE_E164.message;
}

/** `+919876543210`, the only form the server stores. Empty when it is not one yet. */
export const toE164 = (value: string): string => normaliseMobile(value.trim()) ?? '';

/* ==========================================================================
 * Password — a meter that measures rather than decorates
 * ======================================================================== */

export interface PasswordStrength {
  /** 0–4. 3 is the floor the server's blocklist rule (VR-046) describes. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Every requirement not yet met, worded as the fix. Empty means accepted. */
  missing: string[];
}

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl'];

/**
 * The bases the server refuses, mirrored from `PasswordService.COMMON_BASES`.
 *
 * Copied, not imported: it lives inside the API module and there is no seam to
 * reach it through. It is here because a meter that reads "very strong" and is
 * then refused by the server is worse than no meter — the two must agree. It
 * belongs in `@trugrade/contracts` beside `PASSWORD_BLOCKLIST_WORDS`, and is
 * reported as such.
 */
const COMMON_BASES = [
  'password', 'passw0rd', 'welcome', 'admin', 'letmein', 'qwerty', 'abc123',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'master', 'shadow', 'superman', 'trustno1', 'starwars', 'whatever', 'freedom',
  'secret', 'summer', 'winter', 'spring', 'autumn', 'january', 'december',
  'india', 'delhi', 'mumbai', 'bharat', 'ganesh', 'krishna', 'shivam', 'aadhaar',
  'company', 'business', 'office', 'default', 'changeme', 'temporary', 'test123',
];

/** The same de-leeting the server does before it looks for a common base. */
function containsCommonBase(password: string): boolean {
  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z]/g, '').replace(/0/g, 'o').replace(/1/g, 'l');
  const deleeted = lower
    .replace(/[@4]/g, 'a')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z]/g, '');
  return COMMON_BASES.some((base) => stripped.includes(base) || deleeted.includes(base));
}

function hasRun(value: string): boolean {
  const lower = value.toLowerCase();
  if (/(.)\1{2,}/.test(lower)) return true;
  return SEQUENCES.some((seq) => {
    for (let i = 0; i + 4 <= seq.length; i += 1) {
      if (lower.includes(seq.slice(i, i + 4))) return true;
    }
    return false;
  });
}

/**
 * What the meter measures, in order of how often each one is what is wrong:
 * length, the four character classes, then the three things that make a long
 * password guessable anyway — a brand word, the applicant's own address or
 * number, and a keyboard run.
 *
 * `missing` is the point of the return value. A bar that fills up tells someone
 * they failed; the list tells them what to type next.
 */
export function measurePassword(
  password: string,
  context: { email?: string; mobile?: string } = {},
): PasswordStrength {
  const missing: string[] = [];

  if (password.length < 12) missing.push('Make it at least twelve characters long.');
  if (!/[a-z]/.test(password)) missing.push('One lower-case letter.');
  if (!/[A-Z]/.test(password)) missing.push('One capital letter.');
  if (!/[0-9]/.test(password)) missing.push('One digit.');
  if (!/[!@#$%^&*()_+\-=[\]{};':",./<>?]/.test(password))
    missing.push('One symbol, such as ! or #.');

  const lower = password.toLowerCase();

  if (PASSWORD_BLOCKLIST_WORDS.some((word) => lower.includes(word)))
    missing.push('Do not use our name in it — that is the first thing anyone tries.');

  const local = context.email ? normaliseEmail(context.email)?.split('@')[0] : undefined;
  if (local && local.length >= 3 && lower.includes(local.toLowerCase()))
    missing.push('Do not use your email address in it.');

  const digits = context.mobile ? normaliseMobile(context.mobile)?.slice(3) : undefined;
  if (digits && password.includes(digits)) missing.push('Do not use your mobile number in it.');

  if (hasRun(password)) missing.push('Avoid keyboard runs and straight number sequences.');

  if (containsCommonBase(password))
    missing.push('It is built on a common word, which is the first thing a guess tries.');

  if (password.length === 0) return { score: 0, label: 'Not measured', missing };

  // Length past the 12-character floor is the only thing that still adds
  // strength once every rule above is satisfied, so it is what separates 3 from 4.
  let score: PasswordStrength['score'] = 0;
  if (missing.length === 0) score = password.length >= 16 ? 4 : 3;
  else if (missing.length === 1) score = 2;
  else if (missing.length === 2) score = 1;

  const LABELS = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  return { score, label: LABELS[score], missing };
}

/* ==========================================================================
 * Company
 * ======================================================================== */

/**
 * `currentYear` is a parameter, not a read of the clock: the rule is "not in the
 * future", and a function that decides what "now" is cannot be tested against a
 * year boundary.
 */
export function validateYearEstablished(value: string, currentYear: number): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d{4}$/.test(trimmed)) return 'Enter the year as four digits.';
  const year = Number(trimmed);
  if (year > currentYear)
    return 'That year has not happened yet. Enter the year the business was established.';
  if (year < 1850) return 'That is too far back. Enter the year the business was established.';
  return undefined;
}

/**
 * Optional, and a URL typed without a scheme is a URL.
 *
 * People type `acme.co.in`, and refusing that for want of `https://` is the
 * validator being right about a specification and wrong about a person. The
 * scheme is added here and the normalised value is what gets saved.
 */
export function normaliseWebsite(value: string): { url?: string; error?: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return {};
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: 'That is not a web address. Try something like acme.co.in.' };
  }
  if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.'))
    return { error: 'That is not a web address. Try something like acme.co.in.' };
  return { url: parsed.toString() };
}
