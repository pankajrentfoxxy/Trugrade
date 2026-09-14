import {
  DEV_SQL_CONSOLE_OPT_IN,
  DevSqlModule,
  isDevSqlConsoleEnabled,
} from '../../src/platform/dev/dev-sql.module';
import { DevSqlController } from '../../src/platform/dev/dev-sql.controller';
import { loadEnv } from '../../src/shared/config/env';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;

describe('DevSqlModule registers the raw-SQL console only on an explicit opt-in', () => {
  it('is off when NODE_ENV=development and nothing else is set — the live misconfiguration', () => {
    const mod = DevSqlModule.register(env({ NODE_ENV: 'development' }));
    expect(mod.controllers).toEqual([]);
    expect(mod.providers).toEqual([]);
  });

  it('is off when NODE_ENV is unset', () => {
    expect(isDevSqlConsoleEnabled(env({}))).toBe(false);
  });

  it('is off for a truthy-looking value that is not the opt-in sentence', () => {
    expect(isDevSqlConsoleEnabled(env({ NODE_ENV: 'development', DEV_SQL_CONSOLE: 'true' }))).toBe(
      false,
    );
  });

  it('is on only for the exact opt-in outside production', () => {
    const mod = DevSqlModule.register(
      env({ NODE_ENV: 'development', DEV_SQL_CONSOLE: DEV_SQL_CONSOLE_OPT_IN }),
    );
    expect(mod.controllers).toEqual([DevSqlController]);
  });

  it('stays off in production even with the opt-in', () => {
    expect(
      isDevSqlConsoleEnabled(
        env({ NODE_ENV: 'production', DEV_SQL_CONSOLE: DEV_SQL_CONSOLE_OPT_IN }),
      ),
    ).toBe(false);
  });
});

describe('the API listens on loopback unless told otherwise', () => {
  const dev = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('defaults API_HOST to 127.0.0.1, so the bare port is not published past nginx', () => {
    expect(loadEnv(env(dev)).API_HOST).toBe('127.0.0.1');
  });

  it('honours an explicit API_HOST', () => {
    expect(loadEnv(env({ ...dev, API_HOST: '0.0.0.0' })).API_HOST).toBe('0.0.0.0');
  });
});

describe('the env loader refuses DEV_SQL_CONSOLE in production', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    PII_ENCRYPTION_KEY: 'k',
    JWT_PRIVATE_KEY: 'x',
    JWT_PUBLIC_KEY: 'y',
  };

  it('boots a production environment without it', () => {
    expect(() => loadEnv(env({ ...base, NODE_ENV: 'production' }))).not.toThrow();
  });

  it('throws at boot when it is set', () => {
    expect(() =>
      loadEnv(env({ ...base, NODE_ENV: 'production', DEV_SQL_CONSOLE: DEV_SQL_CONSOLE_OPT_IN })),
    ).toThrow(/DEV_SQL_CONSOLE must not be set when NODE_ENV=production/);
  });
});
