import {
  assessCertificate,
  canonicalise,
  signablePayload,
  DEVICESURE_FIELD_MAP,
} from '../src/devicesure';
import type { DeviceSureCertificate } from '../src/devicesure';

/**
 * What Gorefurbo will and will not accept from DeviceSure.
 *
 * The certificate is where a third party's arithmetic becomes our legal claim. A
 * grade we publish is ours under CP e-Comm r.7(5), not the tool's — so the tests
 * that matter are the ones proving we refuse a certificate that contradicts
 * itself, rather than quietly correcting it into something sellable.
 */

function cert(over: Partial<DeviceSureCertificate> = {}): DeviceSureCertificate {
  return {
    certificate: { id: 'ds-1', sha256: 'abc', signature: 'sig' },
    session: { nonce: 'n-1', rulesVersion: '2026.08' },
    device: { serial: '4XK2LM9' },
    score: 92,
    grade: 'A+',
    testResults: [
      { area: 'chassis', status: 'PASS' },
      { area: 'ports', status: 'PASS' },
    ],
    ...over,
  };
}

describe('the §3.1 defect — a grade that survives a component failure', () => {
  it('REJECTS an A+ certificate that reports a failed port', () => {
    const r = assessCertificate(
      cert({
        grade: 'A+',
        testResults: [
          { area: 'chassis', status: 'PASS' },
          { area: 'ports', status: 'FAIL', detail: 'USB-A right side dead' },
        ],
      }),
    );
    expect(r.accept).toBe(false);
    expect(r.defects.map((d) => d.code)).toContain('GRADE_CONTRADICTS_FAILED_COMPONENT');
  });

  it('does not silently re-grade it into something sellable', () => {
    // The tempting fix — downgrade A+ to B and carry on — would publish our
    // arithmetic as the tool's finding. The certificate is incoherent; refuse it.
    const r = assessCertificate(
      cert({ grade: 'A+', testResults: [{ area: 'ports', status: 'FAIL' }] }),
    );
    expect(r.accept).toBe(false);
    const defect = r.defects.find((d) => d.code === 'GRADE_CONTRADICTS_FAILED_COMPONENT');
    expect(defect?.message).toMatch(/fix the weighting in DeviceSure/i);
  });

  it('rejects it at B as well — the rule is about the contradiction, not the grade', () => {
    const r = assessCertificate(
      cert({ grade: 'B', testResults: [{ area: 'storage', status: 'FAIL' }] }),
    );
    expect(r.accept).toBe(false);
  });

  it('accepts a clean certificate', () => {
    const r = assessCertificate(cert());
    expect(r.accept).toBe(true);
    expect(r.hardStop).toBe(false);
    expect(r.gradeProposed).toBe('A_PLUS');
    expect(r.defects).toEqual([]);
  });

  it('accepts a WARN — a warning is not a failure', () => {
    const r = assessCertificate(
      cert({ grade: 'A', testResults: [{ area: 'lid', status: 'WARN' }] }),
    );
    expect(r.accept).toBe(true);
    expect(r.gradeProposed).toBe('A');
  });
});

describe('grade scale mapping', () => {
  it.each(['C', 'D', 'FAIL'])('maps %s to not listable, and hard-stops the unit', (g) => {
    const r = assessCertificate(cert({ grade: g }));
    // Ingested — it is a real finding about a real machine — but not sellable.
    expect(r.accept).toBe(true);
    expect(r.hardStop).toBe(true);
    expect(r.gradeProposed).toBeNull();
    expect(r.defects.map((d) => d.code)).toContain('GRADE_NOT_LISTABLE');
  });

  it('rejects a grade that is not on DeviceSure own scale', () => {
    const r = assessCertificate(cert({ grade: 'AA' }));
    expect(r.accept).toBe(false);
    expect(r.defects.map((d) => d.code)).toContain('GRADE_UNKNOWN_SCALE');
  });

  it('rejects a certificate with no grade at all', () => {
    const r = assessCertificate(cert({ grade: undefined }));
    expect(r.accept).toBe(false);
    expect(r.defects.map((d) => d.code)).toContain('GRADE_ABSENT');
  });
});

describe('serial mismatch is a hard stop, not a rejection', () => {
  it('hard-stops when the certificate describes a different machine', () => {
    const r = assessCertificate(cert(), { expectedSerial: '7BC1DE2' });
    // Still ingested: the raw payload is evidence that the wrong machine was
    // scanned. But the unit stops — we do not know what we are looking at.
    expect(r.accept).toBe(true);
    expect(r.hardStop).toBe(true);
    const d = r.defects.find((x) => x.code === 'SERIAL_MISMATCH');
    expect(d?.message).toMatch(/do not grade it, do not seal it, do not list it/i);
  });

  it('compares case-insensitively and ignores surrounding space', () => {
    const r = assessCertificate(cert({ device: { serial: ' 4xk2lm9 ' } }), {
      expectedSerial: '4XK2LM9',
    });
    expect(r.hardStop).toBe(false);
  });
});

describe('signature and score guards', () => {
  it('rejects an unsigned certificate when a signature is required', () => {
    const c = cert();
    const unsigned: DeviceSureCertificate = {
      ...c,
      certificate: { id: c.certificate.id, sha256: c.certificate.sha256 },
    };
    expect(assessCertificate(unsigned, { requireSignature: true }).accept).toBe(false);
    // The manual-entry path is a service-level decision, so with the requirement
    // off the same payload is fine.
    expect(assessCertificate(unsigned).accept).toBe(true);
  });

  it('rejects a score outside 0–100', () => {
    expect(assessCertificate(cert({ score: 240 })).accept).toBe(false);
  });

  it('rejects a certificate with no area results behind the grade', () => {
    const r = assessCertificate(cert({ testResults: [] }));
    expect(r.accept).toBe(false);
    expect(r.defects.map((d) => d.code)).toContain('NO_AREAS_REPORTED');
  });
});

describe('UNSUPPORTED areas are flagged, never scored as passes', () => {
  it('flags them without blocking ingestion', () => {
    const r = assessCertificate(
      cert({
        testResults: [
          { area: 'chassis', status: 'PASS' },
          { area: 'thermals', status: 'UNSUPPORTED' },
        ],
      }),
    );
    expect(r.accept).toBe(true);
    expect(r.hardStop).toBe(false);
    const d = r.defects.find((x) => x.code === 'UNSUPPORTED_AREAS_PRESENT');
    expect(d?.disposition).toBe('FLAG');
    expect(d?.message).toMatch(/never score them as passes/i);
  });
});

describe('canonicalisation', () => {
  it('sorts object keys so two orderings hash identically', () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
    expect(canonicalise({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it('omits undefined but keeps null', () => {
    expect(canonicalise({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('excludes the signature from the bytes that are signed', () => {
    // Verifying over a payload that contains the signature always fails, and
    // always looks like a key problem rather than a payload problem.
    const payload = signablePayload(cert());
    expect(payload).not.toContain('"signature"');
    expect(payload).toContain('"sha256"');
  });

  it('produces the same signable bytes regardless of the signature value', () => {
    const a = signablePayload(cert());
    const b = signablePayload(
      cert({ certificate: { id: 'ds-1', sha256: 'abc', signature: 'different' } }),
    );
    expect(a).toBe(b);
  });
});

describe('the field map', () => {
  it('routes the idempotency key and the raw hash to the tool run', () => {
    // Our field first, their path second — the convention the three already-seeded
    // providers use. Reversed, the generic parser reads garbage.
    expect(DEVICESURE_FIELD_MAP.tool_run_id).toBe('certificate.id');
    expect(DEVICESURE_FIELD_MAP.raw_report_hash).toBe('certificate.sha256');
    expect(DEVICESURE_FIELD_MAP.serial).toBe('device.serial');
  });

  it('routes the tool grade to grade_proposed, never to grade_final', () => {
    // grade_final is ours. The tool proposes; chk_override_reason forces a
    // written reason if we land anywhere else.
    expect(DEVICESURE_FIELD_MAP.grade_proposed).toBe('grade');
    expect(Object.keys(DEVICESURE_FIELD_MAP)).not.toContain('grade_final');
  });
});
