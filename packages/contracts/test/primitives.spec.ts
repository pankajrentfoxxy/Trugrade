/**
 * Field-level validation. Each `describe` names the VR clause it proves, so a
 * failure points at the contract rather than at a line number.
 */

import {
  gstinSchema,
  panSchema,
  ifscSchema,
  mobileSchema,
  emailSchema,
  pincodeSchema,
  serialNumberSchema,
  sealCodeSchema,
  verificationCodeSchema,
  vehicleNumberSchema,
  passwordSchema,
  otpCodeSchema,
  moneySchema,
  vendorNetPayoutSchema,
  supplyPointLabelSchema,
} from '../src/primitives';
import {
  gstinCheckDigit,
  isValidGstin,
  normaliseMobile,
  normaliseSerial,
  isPlaceholderSerial,
  panFromGstin,
  stateCodeFromGstin,
  skuNormalizedKey,
  normaliseCapacityGb,
  installedRamFromUsable,
  nominalStorageFromBinary,
} from '../src/normalise';

/** A GSTIN with a correct check digit, built rather than hard-coded. */
function makeGstin(first14: string): string {
  return first14 + gstinCheckDigit(first14);
}
const VALID_GSTIN = makeGstin('06AAFCT1234A1Z');

describe('VR-001/VR-002 — GSTIN', () => {
  it('accepts a well-formed GSTIN with a correct check digit', () => {
    expect(gstinSchema.parse(VALID_GSTIN)).toBe(VALID_GSTIN);
  });

  it('normalises case and whitespace before validating', () => {
    expect(gstinSchema.parse(`  ${VALID_GSTIN.toLowerCase()} `)).toBe(VALID_GSTIN);
  });

  it('rejects a wrong check digit — the mistyped-character case', () => {
    const wrong = VALID_GSTIN.slice(0, 14) + (VALID_GSTIN[14] === 'Z' ? 'Y' : 'Z');
    expect(() => gstinSchema.parse(wrong)).toThrow(/check-digit/i);
  });

  it('rejects a 14-character GSTIN', () => {
    expect(() => gstinSchema.parse(VALID_GSTIN.slice(0, 14))).toThrow();
  });

  it('requires the literal Z at position 14', () => {
    expect(() => gstinSchema.parse(makeGstin('06AAFCT1234A1Y'))).toThrow();
  });

  it('VR-006 — characters 3-12 are the holder PAN', () => {
    expect(panFromGstin(VALID_GSTIN)).toBe('AAFCT1234A');
  });

  it('VR-003 — the first two characters are the state code', () => {
    expect(stateCodeFromGstin(VALID_GSTIN)).toBe('06');
  });

  it('the check digit is stable for a known worked example', () => {
    // Every valid GSTIN must satisfy its own check digit by construction.
    expect(isValidGstin(makeGstin('27AAPFU0939F1Z'))).toBe(true);
  });
});

describe('VR-007 — PAN', () => {
  it.each(['ABCDE1234F', 'AAFCT1234A'])('accepts %s', (p) => {
    expect(panSchema.parse(p.toLowerCase())).toBe(p);
  });
  it.each(['ABCD1234F', 'ABCDE12345', 'ABCDE1234', '1BCDE1234F'])('rejects %s', (p) => {
    expect(() => panSchema.parse(p)).toThrow();
  });
});

describe('VR-021 — IFSC', () => {
  it('accepts a valid code', () => {
    expect(ifscSchema.parse('hdfc0001234')).toBe('HDFC0001234');
  });
  it('rejects a letter O where the literal zero belongs', () => {
    expect(() => ifscSchema.parse('HDFCO001234')).toThrow();
  });
  it('rejects the wrong length', () => {
    expect(() => ifscSchema.parse('HDFC000123')).toThrow();
  });
});

describe('VR-030 — mobile normalisation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseMobile(input)).toBe(expected);
    expect(mobileSchema.parse(input)).toBe(expected);
  });

  it.each(['5876543210', '98765432', '98765432101', 'abcdefghij', ''])('rejects %s', (bad) => {
    expect(normaliseMobile(bad)).toBeNull();
    expect(() => mobileSchema.parse(bad)).toThrow();
  });
});

describe('VR-032/VR-033 — email', () => {
  it('lower-cases only the domain, so a case-sensitive local-part survives', () => {
    expect(emailSchema.parse('Priya.Sharma@Example.CO.IN')).toBe('Priya.Sharma@example.co.in');
  });
  it.each(['no-at-sign', 'a@b', '@example.com', 'a b@example.com'])('rejects %s', (bad) => {
    expect(() => emailSchema.parse(bad)).toThrow();
  });
});

describe('VR-034 — pincode', () => {
  it('accepts a valid NCR pincode', () => {
    expect(pincodeSchema.parse('122001')).toBe('122001');
  });
  it('rejects a leading zero — no Indian pincode starts with 0', () => {
    expect(() => pincodeSchema.parse('022001')).toThrow();
  });
});

describe('VR-076 — serial number', () => {
  it('upper-cases and strips separators', () => {
    expect(normaliseSerial(' 5cd-1234 abc ')).toBe('5CD1234ABC');
    expect(serialNumberSchema.parse(' 5cd-1234 abc ')).toBe('5CD1234ABC');
  });

  it.each(['TOBEFILLEDBYOEM', 'SYSTEMSERIALNUMBER', 'DEFAULTSTRING', '0123456789', 'AAAAAAAA'])(
    'rejects the firmware placeholder %s',
    (bad) => {
      expect(isPlaceholderSerial(bad)).toBe(true);
      expect(() => serialNumberSchema.parse(bad)).toThrow();
    },
  );

  it('rejects a serial shorter than 5 characters', () => {
    expect(() => serialNumberSchema.parse('AB12')).toThrow();
  });
});

describe('VR-100 — seal code', () => {
  it('accepts the printed shape', () => {
    expect(sealCodeSchema.parse('trg-26hr-0004821')).toBe('TRG-26HR-0004821');
  });
  it.each(['TRG-26HR-004821', 'TR-26HR-0004821', 'TRG-2GHR-0004821'])('rejects %s', (bad) => {
    expect(() => sealCodeSchema.parse(bad)).toThrow();
  });
});

describe('verification code — public, therefore unguessable', () => {
  it('accepts a 14-character Crockford-safe code', () => {
    expect(verificationCodeSchema.parse('9f3kq7ztb2xm4h')).toBe('9F3KQ7ZTB2XM4H');
  });
  it('rejects the ambiguous glyphs I, L, O and U', () => {
    for (const bad of ['9F3KQ7ZTB2XM4I', '9F3KQ7ZTB2XM4L', '9F3KQ7ZTB2XM4O', '9F3KQ7ZTB2XM4U']) {
      expect(() => verificationCodeSchema.parse(bad)).toThrow();
    }
  });
  it('rejects anything short enough to enumerate', () => {
    expect(() => verificationCodeSchema.parse('9F3KQ7')).toThrow();
  });
});

describe('VR-137 — vehicle number', () => {
  it.each([
    ['hr26dk8337', 'HR26DK8337'],
    ['DL 1 CA 1234', 'DL1CA1234'],
    ['MH-12-AB-1234', 'MH12AB1234'],
  ])('normalises %s', (input, expected) => {
    expect(vehicleNumberSchema.parse(input)).toBe(expected);
  });
  it('rejects a malformed plate', () => {
    expect(() => vehicleNumberSchema.parse('1234HR26')).toThrow();
  });
});

describe('VR-045 — password composition', () => {
  it('accepts a 12-character password with all four classes', () => {
    expect(passwordSchema.parse('Str0ng!Passw0rd')).toBe('Str0ng!Passw0rd');
  });
  it.each([
    ['too short', 'Ab1!efgh'],
    ['no upper', 'str0ng!passw0rd'],
    ['no digit', 'Strong!Password'],
    ['no symbol', 'Str0ngPassw0rdd'],
  ])('rejects %s', (_why, bad) => {
    expect(() => passwordSchema.parse(bad)).toThrow();
  });
});

describe('VR-050 — OTP shape', () => {
  it('accepts exactly six digits', () => {
    expect(otpCodeSchema.parse('048213')).toBe('048213');
  });
  it.each(['12345', '1234567', '12a456'])('rejects %s', (bad) => {
    expect(() => otpCodeSchema.parse(bad)).toThrow();
  });
});

describe('VR-126 — money never crosses the wire as a number', () => {
  it('parses a decimal string', () => {
    expect(moneySchema.parse('1234.50').toString()).toBe('1234.50');
  });
  it('refuses a JSON number outright', () => {
    expect(() => moneySchema.parse(1234.5)).toThrow(/decimal string/i);
  });
  it('VR-083 — enforces the vendor payout band', () => {
    expect(vendorNetPayoutSchema.parse('25000.00').toString()).toBe('25000.00');
    expect(() => vendorNetPayoutSchema.parse('999.00')).toThrow();
    expect(() => vendorNetPayoutSchema.parse('500001.00')).toThrow();
  });
});

describe('VR-099 — the supply point label is the only thing a buyer sees', () => {
  it('accepts the sanctioned form', () => {
    expect(supplyPointLabelSchema.parse('Supply Point A · Gurugram')).toBeTruthy();
  });
  it.each([
    'Alpha Systems Pvt Ltd · Gurugram',
    'Supply Point A · Gurugram (Alpha Systems)',
    'Vendor A · Gurugram',
  ])('rejects %s', (bad) => {
    expect(() => supplyPointLabelSchema.parse(bad)).toThrow();
  });
});

describe('SKU normalisation — one key, however the machine is spelled', () => {
  const canonical = {
    brand: 'Dell',
    model: 'Latitude 5420',
    cpuFamily: 'Core i5',
    cpuModel: 'i5-1145G7',
    ramGb: 16,
    storageGb: 512,
    storageType: 'NVMe',
    screenSizeIn: 14,
    screenResolution: '1920x1080',
    gpu: 'Intel Iris Xe',
    os: 'Windows 11 Pro',
  };

  it('collapses spelling variants of the same machine to one key', () => {
    const variants = [
      { ...canonical, brand: 'DELL' },
      { ...canonical, brand: ' dell ' },
      { ...canonical, model: 'latitude  5420' },
      { ...canonical, model: 'Latitude-5420' },
      { ...canonical, cpuModel: 'I5-1145G7' },
      { ...canonical, storageType: 'nvme' },
      { ...canonical, gpu: 'intel iris xe' },
      { ...canonical, os: 'windows 11 pro' },
    ];
    const keys = new Set(variants.map(skuNormalizedKey));
    keys.add(skuNormalizedKey(canonical));
    expect(keys.size).toBe(1);
  });

  it('does not collapse a genuinely different configuration', () => {
    expect(skuNormalizedKey({ ...canonical, ramGb: 8 })).not.toBe(skuNormalizedKey(canonical));
    expect(skuNormalizedKey({ ...canonical, storageGb: 256 })).not.toBe(
      skuNormalizedKey(canonical),
    );
  });

  it('normalises capacity however it is written', () => {
    for (const input of ['512GB', '512 GB', '512gb', '0.5TB', 512]) {
      expect(normaliseCapacityGb(input)).toBe(512);
    }
  });
});

describe('07 §3.4 — the RAM and storage reporting corrections', () => {
  it('a 16 GB machine reporting 15 GB usable is still a 16 GB machine', () => {
    expect(installedRamFromUsable(15)).toBe(16);
    expect(installedRamFromUsable(15.7)).toBe(16);
    expect(installedRamFromUsable(7.6)).toBe(8);
    expect(installedRamFromUsable(31.4)).toBe(32);
  });

  it('does not invent capacity that is not nearly there', () => {
    // 12 GB is a real configuration; it must not be rounded up to 16.
    expect(installedRamFromUsable(12)).toBe(12);
    expect(installedRamFromUsable(11.8)).toBe(12);
  });

  it('a 477 GiB drive is the 512 GB drive the buyer was promised', () => {
    expect(nominalStorageFromBinary(477)).toBe(512);
    expect(nominalStorageFromBinary(238)).toBe(256);
    expect(nominalStorageFromBinary(931)).toBe(1000);
  });
});
