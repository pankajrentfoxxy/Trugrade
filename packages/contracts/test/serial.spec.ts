import {
  normalisePastedSerial,
  splitSerialBlock,
  validateSerialBatch,
  checkSerialPattern,
} from '../src/serial';

/**
 * The serial validator's contract with a person standing in a warehouse.
 *
 * The spec is unusually blunt about the priority here: "Warn, do not block, on
 * an unrecognised pattern — you will meet machines whose labels are worn." So
 * the tests that matter most are the ones proving the validator lets a real
 * machine through while still catching the two things that are never
 * recoverable: the same laptop entered twice, and a serial that is already live
 * somewhere else.
 */

describe('normalisePastedSerial', () => {
  it('uppercases and trims', () => {
    expect(normalisePastedSerial('  4xk2lm9  ')).toBe('4XK2LM9');
  });

  it('strips the label prefixes a scanner or a paste drags along', () => {
    for (const raw of ['S/N: 4XK2LM9', 'SN 4XK2LM9', 'Serial No. 4XK2LM9', 'Service Tag: 4XK2LM9']) {
      expect(normalisePastedSerial(raw)).toBe('4XK2LM9');
    }
  });

  it('strips zero-width characters, which survive a copy from a web page', () => {
    expect(normalisePastedSerial('4XK\u200B2LM9\uFEFF')).toBe('4XK2LM9');
  });

  it('does NOT guess between O and 0 on a worn label', () => {
    // Correcting this would invent a serial belonging to a different machine.
    expect(normalisePastedSerial('4XKO2LM')).toBe('4XKO2LM');
    expect(normalisePastedSerial('4XK02LM')).toBe('4XK02LM');
  });
});

describe('splitSerialBlock', () => {
  it('accepts every shape a vendor actually pastes', () => {
    const oneLine = splitSerialBlock('4XK2LM9\n7BC1DE2\n9ZZ8QW3');
    const fromExcel = splitSerialBlock('4XK2LM9\t7BC1DE2\t9ZZ8QW3');
    const fromCsv = splitSerialBlock('4XK2LM9,7BC1DE2,9ZZ8QW3');
    const ragged = splitSerialBlock('  4XK2LM9 ;\n\n 7BC1DE2,9ZZ8QW3  \n');
    for (const got of [oneLine, fromExcel, fromCsv, ragged]) {
      expect(got).toEqual(['4XK2LM9', '7BC1DE2', '9ZZ8QW3']);
    }
  });
});

describe('checkSerialPattern', () => {
  it('recognises the shapes it knows', () => {
    expect(checkSerialPattern('4XK2LM9', 'Dell').verdict).toBe('MATCH');
    expect(checkSerialPattern('5CD1234ABC', 'HP').verdict).toBe('MATCH');
    expect(checkSerialPattern('PF0ABCDE', 'Lenovo').verdict).toBe('MATCH');
    expect(checkSerialPattern('C02X1234JGH5', 'Apple').verdict).toBe('MATCH');
  });

  it('reports UNKNOWN — not MISMATCH — for a brand it has no pattern for', () => {
    // An invented pattern produces confident false warnings on real machines.
    expect(checkSerialPattern('ANYTHING123', 'Acer').verdict).toBe('UNKNOWN');
    expect(checkSerialPattern('ANYTHING123', null).verdict).toBe('UNKNOWN');
  });

  it('matches the brand name case-insensitively', () => {
    expect(checkSerialPattern('4XK2LM9', 'dell').verdict).toBe('MATCH');
  });
});

describe('validateSerialBatch', () => {
  it('warns on a wrong-shaped serial but still accepts it', () => {
    const r = validateSerialBatch({ serials: ['4XK2LM9XYZ'], brandName: 'Dell' });
    expect(r.accepted).toEqual(['4XK2LM9XYZ']);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings[0]?.message).toMatch(/does not look like a Dell serial/i);
  });

  it('rejects a duplicate inside one paste and names the line it first appeared on', () => {
    const r = validateSerialBatch({
      serials: ['4XK2LM9', '7BC1DE2', '4xk2lm9'],
      brandName: 'Dell',
    });
    expect(r.accepted).toEqual(['4XK2LM9', '7BC1DE2']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 3, serial: '4XK2LM9' });
    expect(r.errors[0]?.message).toMatch(/duplicate of line 1/i);
  });

  it('rejects a serial already live elsewhere', () => {
    const r = validateSerialBatch({
      serials: ['4XK2LM9', '7BC1DE2'],
      brandName: 'Dell',
      alreadyLive: ['7bc1de2'],
    });
    expect(r.accepted).toEqual(['4XK2LM9']);
    expect(r.errors[0]?.message).toMatch(/exactly one place/i);
  });

  it('rejects a blacklisted serial', () => {
    const r = validateSerialBatch({
      serials: ['4XK2LM9'],
      brandName: 'Dell',
      blacklisted: ['4XK2LM9'],
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.errors[0]?.message).toMatch(/blocked/i);
  });

  it('rejects a paste that swept up surrounding text', () => {
    const r = validateSerialBatch({ serials: ['Dell Latitude 5420 (4XK2LM9)'], brandName: 'Dell' });
    expect(r.errors).toHaveLength(1);
    expect(r.accepted).toHaveLength(0);
  });

  it('reports every bad row, not just the first', () => {
    // The wizard shows the whole error list at once; a fail-fast validator would
    // make the vendor fix fifty serials one round trip at a time.
    const r = validateSerialBatch({
      serials: ['', '4XK2LM9', '4XK2LM9', 'BAD*CHAR'],
      brandName: 'Dell',
    });
    expect(r.errors.map((e) => e.line)).toEqual([1, 3, 4]);
    expect(r.accepted).toEqual(['4XK2LM9']);
  });

  it('strips internal spaces rather than rejecting them — VR-076, and labels are printed with them', () => {
    const r = validateSerialBatch({ serials: ['4XK 2LM9', '7BC-1DE2'], brandName: 'Dell' });
    expect(r.errors).toHaveLength(0);
    expect(r.accepted).toEqual(['4XK2LM9', '7BC1DE2']);
  });

  it('rejects a firmware placeholder and a repeated-character serial', () => {
    // isPlaceholderSerial covers both: a whole vendor batch arriving as
    // TOBEFILLEDBYOEM, and the AAAAAAA a tired hand types into a form.
    const r = validateSerialBatch({ serials: ['TOBEFILLEDBYOEM', 'AAAAAAA'], brandName: 'Dell' });
    expect(r.accepted).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]?.message).toMatch(/placeholder|repeated/i);
  });

  it('is unaffected by brand when no pattern is known — no false warnings', () => {
    const r = validateSerialBatch({ serials: ['NXHF2SI0091230A12B34500'], brandName: 'Acer' });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.accepted).toHaveLength(1);
  });
});
