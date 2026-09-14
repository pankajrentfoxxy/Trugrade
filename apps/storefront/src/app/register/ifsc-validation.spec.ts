import { IFSC } from '@trugrade/contracts';
import { typeIfsc, validateIfsc } from './validation';

/**
 * Real branch codes from RBI's IFSC list whose six-character branch code holds
 * letters. The pattern has always accepted them; the input used to strip the
 * letters, so a supplier banking at these branches could not add a payout
 * account at all.
 */
const REAL_CODES_WITH_LETTERS = ['SBIN0RRDCGB', 'KKBK0RTGSMI'];

describe('an IFSC with letters in its branch code', () => {
  it.each(REAL_CODES_WITH_LETTERS)('%s can be typed, pasted and passes validation', (code) => {
    expect(typeIfsc(code)).toBe(code);
    expect(typeIfsc(code.toLowerCase())).toBe(code);
    expect(typeIfsc(` ${code.slice(0, 4)}-${code.slice(4)} `)).toBe(code);
    expect(validateIfsc(code)).toBeUndefined();
    expect(IFSC.pattern!.test(code)).toBe(true);
  });

  it('still keeps the rule itself: four letters, then the digit zero', () => {
    expect(typeIfsc('HD1C0001234')).toBe('HDC');
    expect(validateIfsc('HDFCO001234')).toBe(
      'The fifth character of an IFSC is the digit zero, not the letter O.',
    );
    expect(validateIfsc('HDFC1001234')).toBe(
      'The fifth character of an IFSC is the digit zero, not the letter O.',
    );
  });
});
