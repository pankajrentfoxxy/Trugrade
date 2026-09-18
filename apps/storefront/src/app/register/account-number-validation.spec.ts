import { BANK_ACCOUNT_NUMBER } from '@trugrade/contracts';
import {
  ACCOUNT_NUMBER_MAX_DIGITS,
  toAccountNumber,
  typeAccountNumber,
  validateAccountNumber,
} from './validation';

/**
 * The field cannot hold what it will not accept.
 *
 * The console's Bank account dialog took a 59-digit account number happily and
 * only argued about it afterwards — a long red sentence about something the
 * field should never have let happen. The registration wizard had already
 * capped the same field; `typeAccountNumber` is that rule lifted out so the two
 * screens cannot say different things about one number.
 *
 * The cap is the upper bound of VR-023 itself, so the field and the rule cannot
 * drift apart.
 */

describe('the typed account number', () => {
  it('stops at the longest account number the rule allows', () => {
    expect(ACCOUNT_NUMBER_MAX_DIGITS).toBe(BANK_ACCOUNT_NUMBER.max);
    // The 59 digits from the report.
    const typed = typeAccountNumber('34256786543216543213456789654321345678908765432134987076543');
    expect(typed).toHaveLength(18);
    expect(typed).toBe('342567865432165432');
    expect(validateAccountNumber(typed)).toBeUndefined();
  });

  it('takes nothing but digits', () => {
    expect(typeAccountNumber('0012 3456-789')).toBe('00123456789');
    expect(typeAccountNumber('ABC123')).toBe('123');
    expect(typeAccountNumber('₹123')).toBe('123');
  });

  it('leaves a normal account number exactly as it was entered', () => {
    for (const n of ['123456789', '00123456789012', '342567865432165432']) {
      expect(typeAccountNumber(n)).toBe(n);
      expect(validateAccountNumber(n)).toBeUndefined();
    }
  });

  it('keeps leading zeros, which are part of the number', () => {
    expect(typeAccountNumber('000123456789')).toBe('000123456789');
  });

  it('is the same rule the contract enforces server-side', () => {
    expect(BANK_ACCOUNT_NUMBER.pattern!.source).toBe('^[0-9]{9,18}$');
    expect(BANK_ACCOUNT_NUMBER.pattern!.test(typeAccountNumber('9'.repeat(40)))).toBe(true);
  });
});

describe('what the field still has to say for itself', () => {
  it('names a number that is too short, because the cap cannot prevent that', () => {
    expect(validateAccountNumber('1234')).toBe(
      'That is 4 digits. An Indian account number is between 9 and 18.',
    );
  });

  it('asks for one at all when the field is empty', () => {
    expect(validateAccountNumber('')).toBe('Enter the account number we should pay into.');
  });

  /**
   * `toAccountNumber` is what goes to the penny-drop and the commit, and it is
   * deliberately NOT the typing rule: it strips only spaces and hyphens, exactly
   * as the server's schema does. Widening it to drop every non-digit would let a
   * mistyped "12A34" reach the bank silently as "1234".
   */
  it('does not let the submit path quietly repair a bad number', () => {
    expect(toAccountNumber('0012 3456-789')).toBe('00123456789');
    expect(toAccountNumber('12A34')).toBe('12A34');
    expect(validateAccountNumber('12A34')).toBe(
      'An account number is digits only. Take out any letters or symbols.',
    );
  });
});
