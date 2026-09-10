import {
  mobileSubscriberDigits,
  toE164,
  typeMobile,
  validateMobile,
} from './validation';

describe('mobileSubscriberDigits', () => {
  it('peels +91 off and caps at ten digits', () => {
    expect(mobileSubscriberDigits('+91 98765432')).toBe('98765432');
    expect(mobileSubscriberDigits('+91 9876543210')).toBe('9876543210');
    expect(mobileSubscriberDigits('+91 987654321099')).toBe('9876543210');
  });

  it('strips letters while typing', () => {
    expect(typeMobile('+91 98ab76cd5432')).toBe('+91 98765432');
    expect(typeMobile('+91 DDSDFDSF')).toBe('+91 ');
  });

  it('treats country code alone as blank', () => {
    expect(mobileSubscriberDigits('+91 ')).toBe('');
  });
});

describe('validateMobile', () => {
  it('refuses eight digits after +91', () => {
    expect(validateMobile('+91 98765432')).toMatch(/Enter all 10 digits/);
    expect(toE164('+91 98765432')).toBe('');
  });

  it('accepts exactly ten digits starting 6–9', () => {
    expect(validateMobile('+91 9876543210')).toBeUndefined();
    expect(toE164('+91 9876543210')).toBe('+919876543210');
  });
});
