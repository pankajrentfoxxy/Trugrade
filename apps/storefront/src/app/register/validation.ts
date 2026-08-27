import {
  ADDRESS_LINE1,
  CIN,
  LLPIN,
  TAN,
  UDYAM,
  EMAIL,
  FULL_NAME,
  GSTIN,
  MOBILE_E164,
  PAN,
  PINCODE,
  PAN_HOLDER_TYPE,
  PASSWORD_BLOCKLIST_WORDS,
  isValidGstin,
  normaliseEmail,
  normaliseGstin,
  normaliseMobile,
  panFromGstin,
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

/* ==========================================================================
 * Statutory — GSTIN, PAN, CIN
 * ========================================================================
 *
 * Every rule below is the shared one from `@trugrade/contracts`, because the
 * server refuses on exactly these and a client that disagrees either spends a
 * provider call on a string that cannot be a GSTIN or refuses one that can.
 *
 * The order matters: shape, then checksum, then the cross-field check. A value
 * that fails any of them never reaches the GST portal, so a mistyped character
 * costs a keystroke rather than one of five daily attempts.
 */

/** `06abcce1234f6z1` → `06ABCCE1234F6Z1`. What the server stores and compares. */
export const toGstin = (value: string): string => normaliseGstin(value) ?? '';

export const toPan = (value: string): string => value.trim().toUpperCase();

/**
 * Three different messages, because three different things are wrong and only
 * the third one is subtle. "Invalid input" would collapse all three.
 */
export function validateGstin(value: string): string | undefined {
  const gstin = toGstin(value);
  if (gstin.length === 0) return 'Enter the GSTIN of the entity we should invoice.';
  if (gstin.length !== 15)
    return `A GSTIN is 15 characters. This one is ${gstin.length}.`;
  if (!GSTIN.pattern?.test(gstin)) return GSTIN.message;
  // VR-002: the last character is arithmetic over the first fourteen, so a
  // single mistyped character is caught here rather than by the portal.
  if (!isValidGstin(gstin))
    return 'That is not a valid GSTIN — the last character does not match the rest. Check it against your certificate.';
  return undefined;
}

export function validatePan(value: string): string | undefined {
  const pan = toPan(value);
  if (pan.length === 0) return 'Enter the PAN of the entity we should invoice.';
  if (pan.length !== 10) return `A PAN is 10 characters. This one is ${pan.length}.`;
  if (!PAN.pattern?.test(pan)) return PAN.message;
  return undefined;
}

/**
 * VR-006 — characters 3 to 12 of a GSTIN **are** the holder's PAN.
 *
 * A real and common error: someone pastes a group company's GSTIN beside their
 * own PAN. Catching it here names both values instead of letting the portal
 * come back with a legal name nobody recognises.
 */
export function gstinPanConflict(gstinValue: string, panValue: string): string | undefined {
  const gstin = toGstin(gstinValue);
  const pan = toPan(panValue);
  if (gstin.length !== 15 || pan.length !== 10) return undefined;
  const embedded = panFromGstin(gstin);
  if (!embedded || embedded === pan) return undefined;
  return `This GSTIN belongs to PAN ${embedded}, not to ${pan}. One of the two is from a different entity.`;
}

/** VR-008 — the 4th character of a PAN is the holder type. */
export function panHolderType(value: string): string | undefined {
  const pan = toPan(value);
  return pan.length === 10 ? PAN_HOLDER_TYPE[pan[3] as string] : undefined;
}

/**
 * The registry identifiers step 3 captures — CIN, LLPIN, Udyam and TAN.
 *
 * **Shape only, and that is the whole point.** `CheckType` in
 * `verification.service.ts` names UDYAM and CIN, but no route exposes either and
 * TAN is not in the union at all, so nothing on the platform can confirm that
 * one of these belongs to the applicant. The pattern is the strongest thing that
 * can honestly be said about the value, and the screen says exactly that beside
 * it rather than showing a tick it has not earned.
 *
 * Keyed on `field_code` from `onboarding_field_requirement`, so a field seeded
 * there is validated here without a second list to keep in step. An unknown code
 * is accepted as free text — a rule we do not have is not a refusal we can make.
 */
const IDENTIFIER_RULES: Record<string, { pattern?: RegExp; message: string }> = {
  cin: CIN,
  llpin: LLPIN,
  udyam_number: UDYAM,
  tan: TAN,
};

/** Whether a code has a shape rule at all. Drives the mono/uppercase treatment. */
export const hasIdentifierRule = (fieldCode: string): boolean => fieldCode in IDENTIFIER_RULES;

export function validateIdentifier(
  fieldCode: string,
  value: string,
  required: boolean,
  label: string,
): string | undefined {
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) return required ? `Enter the ${label} — it is required for your constitution.` : undefined;
  const rule = IDENTIFIER_RULES[fieldCode];
  if (!rule?.pattern) return undefined;
  return rule.pattern.test(trimmed) ? undefined : rule.message;
}

export const validateCin = (value: string, required: boolean): string | undefined =>
  validateIdentifier('cin', value, required, 'CIN');

/**
 * A date of incorporation, which is a fact with two edges: a company cannot be
 * incorporated tomorrow, and the Companies Act of 1956 is the earliest registry
 * anything on this platform could come from. Anything between is the applicant's
 * to state and not ours to second-guess.
 */
export function validateIncorporationDate(
  value: string,
  required: boolean,
  today: Date,
): string | undefined {
  if (value.trim().length === 0)
    return required ? 'Enter the date on your certificate of incorporation.' : undefined;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Enter the date as it appears on the certificate.';
  if (parsed.getTime() > today.getTime())
    return 'That date is in the future. Use the date printed on the certificate of incorporation.';
  if (parsed.getFullYear() < 1956)
    return 'That is earlier than the companies register goes. Check the year on the certificate.';
  return undefined;
}

/* ==========================================================================
 * Addresses — VR-034, VR-037
 * ======================================================================== */

export function validateLine1(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter the building and street. A rider reads this line first.';
  return trimmed.length >= (ADDRESS_LINE1.min ?? 5) ? undefined : ADDRESS_LINE1.message;
}

export function validateCity(value: string): string | undefined {
  return value.trim().length === 0 ? 'Enter the city or town.' : undefined;
}

export function validatePincode(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter the 6-digit PIN code. It decides the delivery route.';
  return PINCODE.pattern?.test(trimmed) ? undefined : PINCODE.message;
}

/**
 * The GSTIN says which state it was issued in, and a billing address in a
 * different one is a tax problem rather than a typo we can quietly accept: the
 * place of supply decides IGST against CGST plus SGST.
 *
 * A state code we do not recognise stands the check down rather than guessing —
 * see `STATES` in `picklists.ts` for the two withdrawn codes.
 */
export function billingStateMatchesGstin(
  gstin: string,
  stateCode: string,
  stateNameOf: (code: string) => string | undefined,
): string | undefined {
  const issued = stateNameOf(gstin.slice(0, 2));
  if (!issued || !stateCode) return undefined;
  if (gstin.slice(0, 2) === stateCode) return undefined;
  const chosen = stateNameOf(stateCode) ?? stateCode;
  return (
    `This GSTIN is registered in ${issued}, but you have given a billing address in ${chosen}. ` +
    'The billing address for a registration has to be in the state that issued it.'
  );
}

/**
 * Receiving hours, as a pair of times.
 *
 * Closing before opening is the one combination that reads as valid and is not,
 * and it is what an overnight dock (22:00 to 06:00) types in — so the message
 * says which reading we take rather than refusing them outright.
 */
export function validateReceivingHours(
  opensAt: string,
  closesAt: string,
): string | undefined {
  if (!opensAt || !closesAt) return 'Tell us the hours your dock accepts goods.';
  if (opensAt >= closesAt)
    return 'The closing time has to be after the opening time. For an overnight dock, tell us the daytime window somebody can sign for a delivery.';
  return undefined;
}

/** "Monday to Saturday, 09:30-18:00" — what `AddressCard` prints for a rider. */
export const receivingHoursLabel = (
  daysLabel: string,
  opensAt: string,
  closesAt: string,
): string => `${daysLabel}, ${opensAt}–${closesAt}`;
