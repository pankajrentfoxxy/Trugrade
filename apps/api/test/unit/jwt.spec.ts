/**
 * The JWT layer, tested for the attacks it exists to stop.
 *
 * The published attack surface of JWT libraries is almost entirely algorithm
 * confusion — `{"alg":"none"}`, or an RS256 verifier tricked into HS256 with the
 * public key as the HMAC secret. This implementation hard-codes the header and
 * never reads `alg` from the token, so those attacks are closed by construction.
 * These tests prove that, rather than assuming it.
 */

import { generateKeyPairSync } from 'node:crypto';
import {
  importPrivateKey,
  importPublicKey,
  signJwt,
  verifyJwt,
  JwtError,
  safeEqual,
} from '../../src/shared/auth/jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = importPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
const pub = importPublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString());

const OTHER = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPriv = importPrivateKey(
  OTHER.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
);

const NOW = 1_787_000_000;
const claims = (over: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  iss: 'https://api.trugrade.in',
  iat: NOW,
  exp: NOW + 900,
  jti: 'jti-1',
  ...over,
});

const verify = (token: string, over: Record<string, unknown> = {}) =>
  verifyJwt(token, pub, { issuer: 'https://api.trugrade.in', nowSeconds: NOW, ...over });

describe('round trip', () => {
  it('signs and verifies, preserving custom claims', () => {
    const token = signJwt(claims({ org_id: 'org-1', roles: ['VENDOR_OWNER'] }), priv);
    const out = verify(token);
    expect(out.sub).toBe('user-1');
    expect(out.org_id).toBe('org-1');
    expect(out.roles).toEqual(['VENDOR_OWNER']);
  });
});

describe('algorithm confusion — the whole reason this file exists', () => {
  it('rejects alg:none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims())).toString('base64url');
    expect(() => verify(`${header}.${payload}.`)).toThrow(JwtError);
  });

  it('rejects a token claiming HS256', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims())).toString('base64url');
    expect(() => verify(`${header}.${payload}.anything`)).toThrow(/Unexpected token header/);
  });

  it('rejects a header that is merely reordered, because only the exact header is accepted', () => {
    const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims())).toString('base64url');
    expect(() => verify(`${header}.${payload}.sig`)).toThrow(/Unexpected token header/);
  });
});

describe('signature', () => {
  it('rejects a token signed with a different key', () => {
    expect(() => verify(signJwt(claims(), otherPriv))).toThrow(/Bad signature/);
  });

  it('rejects a payload edited after signing', () => {
    const token = signJwt(claims({ org_id: 'org-1' }), priv);
    const [h, , s] = token.split('.');
    const tampered = Buffer.from(JSON.stringify(claims({ org_id: 'org-2' }))).toString('base64url');
    expect(() => verify(`${h}.${tampered}.${s}`)).toThrow(/Bad signature/);
  });

  it('rejects a malformed token', () => {
    expect(() => verify('not.a.jwt.at.all')).toThrow(/Malformed token/);
    expect(() => verify('onlyonepart')).toThrow(/Malformed token/);
  });
});

describe('time', () => {
  it('rejects an expired token', () => {
    const token = signJwt(claims({ exp: NOW - 1 }), priv);
    expect(() => verify(token, { nowSeconds: NOW + 10 })).toThrow(/expired/);
  });

  it('allows a small clock skew, because two servers never agree exactly', () => {
    const token = signJwt(claims({ exp: NOW }), priv);
    expect(() => verify(token, { nowSeconds: NOW + 3 })).not.toThrow();
    expect(() => verify(token, { nowSeconds: NOW + 60 })).toThrow(/expired/);
  });

  it('rejects a token that is not yet valid', () => {
    const token = signJwt(claims({ nbf: NOW + 600 }), priv);
    expect(() => verify(token)).toThrow(/not yet valid/);
  });

  it('rejects a token with no expiry at all', () => {
    const token = signJwt(claims({ exp: undefined }) as never, priv);
    expect(() => verify(token)).toThrow(/expired/);
  });
});

describe('issuer', () => {
  it('rejects a token from another issuer', () => {
    const token = signJwt(claims({ iss: 'https://evil.example' }), priv);
    expect(() => verify(token)).toThrow(/Wrong issuer/);
  });
});

describe('safeEqual', () => {
  it('compares equal strings as equal and unequal as unequal', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false on a length mismatch rather than throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
