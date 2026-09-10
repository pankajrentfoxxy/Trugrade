import { typeFullName, validateFullName } from './validation';

describe('typeFullName', () => {
  it('strips digits while typing', () => {
    expect(typeFullName('Rohan123 Deshpande')).toBe('Rohan Deshpande');
    expect(typeFullName('9876543210')).toBe('');
  });

  it('keeps letters, spaces, and name punctuation', () => {
    expect(typeFullName("Mary O'Brien-Smith")).toBe("Mary O'Brien-Smith");
    expect(typeFullName('अनanya')).toBe('अनanya');
  });
});

describe('validateFullName', () => {
  it('accepts a typed name with no digits', () => {
    expect(validateFullName('Rohan Deshpande')).toBeUndefined();
  });
});
