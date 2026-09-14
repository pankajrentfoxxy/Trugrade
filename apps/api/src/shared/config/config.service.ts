import { Injectable, Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

/**
 * The pgcrypto key for PAN, bank account and MFA-secret columns, or a throw.
 *
 * Three call sites used to fall back to a key committed to this repository when
 * the variable was unset, and the live server never set it — so every stored PAN
 * was protected by a string anyone with the source could read. A missing key is
 * now an error at the moment it is needed, never a silent default.
 */
export function requirePiiEncryptionKey(env: Pick<Env, 'PII_ENCRYPTION_KEY'>): string {
  if (!env.PII_ENCRYPTION_KEY) {
    throw new Error(
      'PII_ENCRYPTION_KEY is not set, so PAN and bank details cannot be encrypted or read. Set it in the environment (generate one with `openssl rand -base64 32`).',
    );
  }
  return env.PII_ENCRYPTION_KEY;
}

@Injectable()
export class AppConfig {
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get all(): Readonly<Env> {
    return this.env;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  /** `OTP_DEV_CODE_IN_RESPONSE`. Independent of NODE_ENV on purpose — see `OtpService.issue`. */
  get exposeOtpDevCode(): boolean {
    return this.env.OTP_DEV_CODE_IN_RESPONSE;
  }

  /** Throws when unset. See `requirePiiEncryptionKey`. */
  get piiEncryptionKey(): string {
    return requirePiiEncryptionKey(this.env);
  }
}

@Global()
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class ConfigModule {}
