import { Injectable, Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

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
}

@Global()
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class ConfigModule {}
