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
}

@Global()
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class ConfigModule {}
