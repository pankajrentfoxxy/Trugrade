import { describe, it, expect } from 'vitest';
import { DEVICESURE_FIELD_MAP } from '@trugrade/contracts';
import { validateFieldMap } from './fieldMap';

const VALID = JSON.stringify(DEVICESURE_FIELD_MAP);

describe('the seeded DeviceSure map', () => {
  it('passes, with nothing to warn about', () => {
    const check = validateFieldMap(VALID);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
    expect(check.map).toEqual({ ...DEVICESURE_FIELD_MAP });
  });
});

describe('direction', () => {
  it('refuses a map written their-path-to-our-field', () => {
    // The reversal that looks entirely reasonable in a diff, and parses to
    // garbage the first time the generic parser is reused across providers.
    const reversed = JSON.stringify(
      Object.fromEntries(Object.entries(DEVICESURE_FIELD_MAP).map(([k, v]) => [v, k])),
    );
    const check = validateFieldMap(reversed);
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0]).toMatch(/wrong way round/);
    expect(check.map).toBeNull();
  });

  it('states the direction with an example rather than in the abstract', () => {
    const reversed = '{"device.serial":"serial","certificate.id":"tool_run_id"}';
    expect(validateFieldMap(reversed).errors[0]).toContain('{"serial": "device.serial"}');
  });
});

describe('the fields ingestion cannot work without', () => {
  it('refuses a map with no tool_run_id, and says what breaks', () => {
    const { tool_run_id: _dropped, ...rest } = DEVICESURE_FIELD_MAP;
    const check = validateFieldMap(JSON.stringify(rest));
    expect(check.errors.join(' ')).toMatch(/"tool_run_id" is missing/);
    expect(check.errors.join(' ')).toMatch(/same run submitted twice becomes two reports/);
  });

  it('refuses a map with no serial', () => {
    const { serial: _dropped, ...rest } = DEVICESURE_FIELD_MAP;
    expect(validateFieldMap(JSON.stringify(rest)).errors.join(' ')).toMatch(
      /label does not belong to the laptop/,
    );
  });

  it('refuses a map with no nonce', () => {
    const { nonce: _dropped, ...rest } = DEVICESURE_FIELD_MAP;
    expect(validateFieldMap(JSON.stringify(rest)).errors.join(' ')).toMatch(/replayed certificate/);
  });
});

describe('the failures that would otherwise be silent', () => {
  it('refuses a key nothing reads', () => {
    const check = validateFieldMap(
      JSON.stringify({ ...DEVICESURE_FIELD_MAP, battery_temperature: 'battery.tempC' }),
    );
    expect(check.errors.join(' ')).toMatch(/Nothing reads "battery_temperature"/);
    expect(check.errors.join(' ')).toMatch(/silently ignored on every certificate/);
  });

  it('refuses a value that is not a path', () => {
    const check = validateFieldMap(
      JSON.stringify({ ...DEVICESURE_FIELD_MAP, serial: 'device serial!' }),
    );
    expect(check.errors.join(' ')).toMatch(/not a path into a JSON document/);
  });

  it('accepts an indexed path', () => {
    const check = validateFieldMap(
      JSON.stringify({ ...DEVICESURE_FIELD_MAP, photos: 'attachments[0].images' }),
    );
    expect(check.errors).toEqual([]);
  });

  it('refuses a non-string value', () => {
    const check = validateFieldMap(JSON.stringify({ ...DEVICESURE_FIELD_MAP, qc_score: 42 }));
    expect(check.errors.join(' ')).toMatch(/must be a path string/);
  });

  it('refuses an empty path', () => {
    const check = validateFieldMap(JSON.stringify({ ...DEVICESURE_FIELD_MAP, qc_score: '' }));
    expect(check.errors.join(' ')).toMatch(/empty path/);
  });
});

describe('warnings, which are not refusals', () => {
  it('says what will never be recorded, and still allows the save', () => {
    const minimal = {
      tool_run_id: 'certificate.id',
      nonce: 'session.nonce',
      raw_report_hash: 'certificate.sha256',
      serial: 'device.serial',
    };
    const check = validateFieldMap(JSON.stringify(minimal));
    expect(check.errors).toEqual([]);
    expect(check.map).toEqual(minimal);
    expect(check.warnings.join(' ')).toMatch(/Not mapped: signature/);
    expect(check.warnings.join(' ')).toMatch(/nothing will ever be recorded for them/);
  });
});

describe('the shape of the document itself', () => {
  it('names the JSON error rather than saying "invalid"', () => {
    const check = validateFieldMap('{"serial": "device.serial",}');
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0]).toMatch(/^This is not valid JSON: .+/);
  });

  it('refuses an array', () => {
    expect(validateFieldMap('[]').errors[0]).toMatch(/JSON object of our field name/);
  });

  it('refuses an empty object', () => {
    expect(validateFieldMap('{}').errors[0]).toMatch(/parses nothing at all/);
  });
});
