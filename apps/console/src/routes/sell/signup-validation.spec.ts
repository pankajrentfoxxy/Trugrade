import { describe, it, expect } from 'vitest';
import {
  liveFieldError,
  signupPasswordRules,
  supplierPasswordRules,
  supplierPasswordStrength,
  validateSignupPassword,
  validateSupplierPassword,
} from './signup-validation';
import { validateMobile } from './signup-validation';

describe('liveFieldError', () => {
  it('stays silent until the field is engaged', () => {
    expect(liveFieldError('mobile', '+91 5123456789', validateMobile, null, {})).toBeUndefined();
  });

  it('surfaces validation once the user has typed', () => {
    expect(
      liveFieldError('mobile', '+91 5123456789', validateMobile, null, { mobile: true }),
    ).toMatch(/starting 6/i);
  });
});

describe('validateSignupPassword', () => {
  it('requires twelve characters, not eight', () => {
    expect(validateSignupPassword('Radhe@123!')).toMatch(/twelve/i);
  });

  it('accepts a password that meets VR-045', () => {
    expect(validateSignupPassword('AlphaBeta1!GoLong')).toBeUndefined();
  });
});

describe('signupPasswordRules', () => {
  it('marks length unmet for a ten-character password', () => {
    const rules = signupPasswordRules('Radhe@123!');
    expect(rules.find((r) => r.id === 'len')?.met).toBe(false);
    expect(rules.find((r) => r.id === 'sym')?.met).toBe(true);
  });
});

describe('validateSupplierPassword — VR-045a, the /sell/register rule', () => {
  it('has no length floor: a letter and a digit is enough', () => {
    expect(validateSupplierPassword('ab1')).toBeUndefined();
  });
  it('still needs a letter', () => {
    expect(validateSupplierPassword('123456')).toMatch(/letter/i);
  });
  it('still needs a number', () => {
    expect(validateSupplierPassword('Zephyr')).toMatch(/number/i);
  });
  it('does not ask for a capital or a symbol', () => {
    expect(validateSupplierPassword('zephyr7')).toBeUndefined();
  });
  it('keeps the brand and own-contact refusals', () => {
    expect(validateSupplierPassword('trugrade1')).toMatch(/our name/i);
    expect(validateSupplierPassword('rahul9', { email: 'rahul@acme.in' })).toMatch(/email/i);
  });
});

describe('supplierPasswordRules', () => {
  it('lists only a letter and a number', () => {
    expect(supplierPasswordRules('').map((r) => r.id)).toEqual(['letter', 'num']);
  });
  it('marks both met for a short mixed password', () => {
    expect(supplierPasswordRules('k9').every((r) => r.met)).toBe(true);
  });
});

describe('supplierPasswordStrength', () => {
  it('is "Not measured" while empty', () => {
    expect(supplierPasswordStrength('').label).toBe('Not measured');
  });
  it('grows with length once both classes are present', () => {
    expect(supplierPasswordStrength('k9').score).toBe(2);
    expect(supplierPasswordStrength('kestrel92').score).toBe(3);
    expect(supplierPasswordStrength('kestrel92harbour').score).toBe(4);
  });
});
