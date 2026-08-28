import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Environment, validated once at boot. A missing or malformed variable stops the
 * process here rather than surfacing as a null three layers down at 3am.
 */

/**
 * Every external integration is selected by mode, per adapter.
 * `live` is impossible outside production — the loader throws — which is what
 * stops a CI run from calling a real carrier and booking a real pickup.
 */
export const INTEGRATION_MODES = ['mock', 'fixture', 'sandbox', 'live'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    STOREFRONT_URL: z.string().url().default('http://localhost:3000'),
    CONSOLE_URL: z.string().url().default('http://localhost:3001'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
    REDIS_URL: z.string().min(1),

    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().default('trugrade-dev'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolish.default(false),

    /**
     * Where `FakeObjectStore` keeps its bytes.
     *
     * Dev and test only — a real store has a bucket. It is a DIRECTORY rather
     * than a Map because `pnpm db:seed` and the API are two processes and an
     * image seeded by one has to be readable by the other. The test harness
     * overrides it per database so a suite asserting an object is ABSENT is not
     * answered by a developer's own seed.
     */
    OBJECT_STORE_DIR: z.string().default(join(tmpdir(), 'trugrade-object-store')),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1026),

    JWT_PRIVATE_KEY_PATH: z.string().default('.keys/jwt.private.pem'),
    JWT_PUBLIC_KEY_PATH: z.string().default('.keys/jwt.public.pem'),
    /** In-line PEM wins over the path, so production reads from Secrets Manager. */
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .default(30 * 24 * 3600),
    SESSION_COOKIE_DOMAIN: z.string().default('localhost'),

    INTEGRATION_MODE: z.enum(INTEGRATION_MODES).default('mock'),

    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

    /** Column-encryption key for PAN, bank account, personal mobile. 32 bytes, base64. */
    PII_ENCRYPTION_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // 04_TEST_PLAN.md §1.4.3: `live` is impossible in CI. Not a warning — a throw.
    if (env.INTEGRATION_MODE === 'live' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRATION_MODE'],
        message:
          'INTEGRATION_MODE=live is only permitted when NODE_ENV=production. A live carrier or payment call from a non-production process books a real pickup or moves real money.',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.PII_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['PII_ENCRYPTION_KEY'],
          message:
            'PII_ENCRYPTION_KEY is required in production — PAN and bank details are encrypted at the column.',
        });
      }
      if (!env.JWT_PRIVATE_KEY && !env.JWT_PUBLIC_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_PRIVATE_KEY'],
          message:
            'Production must supply the JWT keypair from Secrets Manager, not from a file path in the image.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Cross-field rules, run against the RAW source rather than the parsed object.
 *
 * Zod skips `superRefine` entirely when the base object fails, so if a production
 * deploy is missing both DATABASE_URL and PII_ENCRYPTION_KEY it would report only
 * the first — and the operator would discover the second on the next restart.
 * A boot-time config error should name everything wrong at once.
 */
function crossFieldIssues(source: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  const nodeEnv = source.NODE_ENV ?? 'development';

  // 04_TEST_PLAN.md §1.4.3: `live` is impossible in CI. Not a warning — a throw.
  if (source.INTEGRATION_MODE === 'live' && nodeEnv !== 'production') {
    issues.push(
      '  INTEGRATION_MODE: INTEGRATION_MODE=live is only permitted when NODE_ENV=production. A live carrier or payment call from a non-production process books a real pickup or moves real money.',
    );
  }

  if (nodeEnv === 'production') {
    if (!source.PII_ENCRYPTION_KEY) {
      issues.push(
        '  PII_ENCRYPTION_KEY: PII_ENCRYPTION_KEY is required in production — PAN and bank details are encrypted at the column.',
      );
    }
    if (!source.JWT_PRIVATE_KEY && !source.JWT_PUBLIC_KEY) {
      issues.push(
        '  JWT_PRIVATE_KEY: Production must supply the JWT keypair from Secrets Manager, not from a file path in the image.',
      );
    }
  }

  return issues;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  const cross = crossFieldIssues(source);

  if (!parsed.success || cross.length) {
    const base = parsed.success
      ? []
      : parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    // De-duplicate: a rule expressed both in the schema's superRefine and here
    // must not be printed twice.
    const detail = [...new Set([...base, ...cross])].join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return parsed.data;
}
