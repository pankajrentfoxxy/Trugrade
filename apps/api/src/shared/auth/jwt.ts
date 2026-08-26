import { createPrivateKey, createPublicKey, createSign, createVerify, timingSafeEqual } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * RS256 JWT, on `node:crypto`.
 *
 * We had `jose` here. It is ESM-only from v6, which breaks a CommonJS test
 * runner, and the part of it we actually use is a signature and a base64url
 * decode. Node signs RS256 natively, so this is the smaller and more honest
 * dependency — and it is *safer* than a general-purpose library for one specific
 * reason:
 *
 *   **The algorithm is hard-coded and the token's own `alg` header is never
 *   consulted.** Algorithm confusion — `{"alg":"none"}`, or an RS256 verifier
 *   tricked into HS256 with the public key as the HMAC secret — is the entire
 *   published attack surface of JWT libraries, and it exists only because those
 *   libraries let the token choose. This one does not.
 *
 * Everything else is deliberately strict: `exp` and `nbf` are enforced, `iss` is
 * checked, and the signature comparison is constant-time.
 */

const ALG = 'RS256' as const;
const HEADER = Buffer.from(JSON.stringify({ alg: ALG, typ: 'JWT' })).toString('base64url');

export class JwtError extends Error {}

const b64u = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export interface JwtClaims {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  jti: string;
  [claim: string]: unknown;
}

export function importPrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function importPublicKey(pem: string): KeyObject {
  return createPublicKey(pem);
}

export function signJwt(claims: JwtClaims, privateKey: KeyObject): string {
  const payload = b64u(claims);
  const signingInput = `${HEADER}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export interface VerifyOptions {
  issuer?: string;
  /** Seconds of tolerance for clock skew between issuer and verifier. */
  clockToleranceSeconds?: number;
  /** Injected so expiry is testable without sleeping. */
  nowSeconds: number;
}

export function verifyJwt<T extends JwtClaims = JwtClaims>(
  token: string,
  publicKey: KeyObject,
  opts: VerifyOptions,
): T {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Malformed token');
  const [header, payload, signature] = parts as [string, string, string];

  // The header must be exactly the one we produce. This is what closes off
  // algorithm confusion: we never parse `alg` and act on it.
  if (header !== HEADER) throw new JwtError('Unexpected token header');

  const expected = createSign('RSA-SHA256').update(`${header}.${payload}`);
  const verifier = createVerify('RSA-SHA256').update(`${header}.${payload}`);
  const provided = Buffer.from(signature, 'base64url');
  if (!verifier.verify(publicKey, provided)) throw new JwtError('Bad signature');
  // `expected` is unused beyond keeping the two paths symmetric for readers;
  // Node's verify() already does the constant-time comparison internally.
  void expected;

  let claims: T;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    throw new JwtError('Malformed payload');
  }

  const skew = opts.clockToleranceSeconds ?? 5;
  if (typeof claims.exp !== 'number' || claims.exp + skew < opts.nowSeconds) {
    throw new JwtError('Token expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > opts.nowSeconds) {
    throw new JwtError('Token not yet valid');
  }
  if (opts.issuer && claims.iss !== opts.issuer) throw new JwtError('Wrong issuer');

  return claims;
}

/** Constant-time string compare, for opaque tokens and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
