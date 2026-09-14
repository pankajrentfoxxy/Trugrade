import { describe, it, expect } from 'vitest';
import {
  liveFieldError,
  signupPasswordRules,
  validateSignupPassword,
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
