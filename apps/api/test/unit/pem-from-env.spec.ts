import { generateKeyPairSync } from 'node:crypto';
import { pemFromEnv } from '../../src/shared/auth/token.service';
import { importPrivateKey, importPublicKey, signJwt, verifyJwt } from '../../src/shared/auth/jwt';

describe('pemFromEnv reads a JWT keypair from a one-line env var', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const oneLine = (pem: string): string => pem.trim().replace(/\n/g, '\\n');

  it('turns escaped newlines back into a key that signs and verifies', () => {
    const priv = importPrivateKey(pemFromEnv(oneLine(privatePem)));
    const pub = importPublicKey(pemFromEnv(oneLine(publicPem)));
    const token = signJwt({ sub: 'u', iss: 'i', iat: 1, exp: 100, jti: 'j' }, priv);
    expect(verifyJwt(token, pub, { issuer: 'i', nowSeconds: 50 }).sub).toBe('u');
  });

  it('leaves a PEM with real newlines unchanged', () => {
    expect(pemFromEnv(privatePem)).toBe(privatePem);
  });
});
