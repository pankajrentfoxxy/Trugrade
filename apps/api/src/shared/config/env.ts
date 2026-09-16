import { existsSync, readFileSync } from 'node:fs';
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

const DEV_SQL_CONSOLE_IN_PRODUCTION =
  'DEV_SQL_CONSOLE must not be set when NODE_ENV=production. It exposes an unauthenticated endpoint that runs arbitrary SQL.';
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
    /**
     * Interface to listen on. Loopback by default: every deployment sits behind
     * nginx, and listening on all interfaces published the API — and anything
     * nginx refuses, such as the dev SQL console — on the bare port to the
     * internet. Set 0.0.0.0 deliberately, e.g. for a device on the LAN in dev.
     */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    STOREFRONT_URL: z.string().url().default('http://localhost:3000'),
    CONSOLE_URL: z.string().url().default('http://localhost:5173'),
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
    SMTP_SECURE: boolish.default(false),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    SMTP_FROM: z.string().optional().default(''),

    /**
     * Carrier webhook signing secrets.
     *
     * Absent means that carrier's callbacks are not live, and the webhook route
     * refuses every call rather than accepting unsigned ones "until we get the
     * secret" — which is how an endpoint that can mark an order delivered ends
     * up open. Rotated outside the repo; see the launch checklist.
     */
    BLUEDART_WEBHOOK_SECRET: z.string().optional(),
    PORTER_WEBHOOK_SECRET: z.string().optional(),

    /**
     * Carrier credentials. A carrier whose three values are all present is
     * served by its real adapter; anything less keeps the fake, so a
     * half-configured environment falls back rather than throwing on every
     * booking.
     */
    BLUEDART_BASE_URL: z.string().optional(),
    BLUEDART_LOGIN_ID: z.string().optional(),
    BLUEDART_LICENCE_KEY: z.string().optional(),
    BLUEDART_AREA_CODE: z.string().optional(),
    PORTER_BASE_URL: z.string().optional(),
    PORTER_API_KEY: z.string().optional(),
    /** Our own riders need no credentials, so this is an explicit switch. */
    INHOUSE_CARRIER_LIVE: boolish.default(false),

    /** Interakt WhatsApp — phone OTP when set. Empty keeps the fake in dev/test. */
    INTERAKT_API_KEY: z.string().optional().default(''),
    INTERAKT_OTP_TEMPLATE: z.string().default('otp_verification'),

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
    /**
     * Deprecated — session cookies are scoped per client URL (storefront vs console).
     * Only used to clear legacy dev cookies that were set with an explicit domain.
     * Leave unset in normal dev; do not set in production.
     */
    SESSION_COOKIE_DOMAIN: z.string().optional(),

    INTEGRATION_MODE: z.enum(INTEGRATION_MODES).default('mock'),

    /**
     * Zoho Books GSTIN search. When the URL is set, Verify on /register and
     * /sell/register calls it; when it is empty the fake stays in place.
     */
    GST_VERIFY_API_URL: z.string().optional().default(''),
    GST_VERIFY_ORGANIZATION_ID: z.string().optional().default(''),
    GST_VERIFY_REFERER: z.string().optional().default(''),
    GST_VERIFY_ROLE_ID: z.string().optional().default(''),
    GST_VERIFY_CSRF_TOKEN: z.string().optional().default(''),
    GST_VERIFY_COOKIE: z.string().optional().default(''),
    GST_VERIFY_ZB_SOURCE: z.string().optional().default('zbclient'),
    GST_VERIFY_ZB_ASSET_VERSION: z.string().optional().default(''),

    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

    /** Column-encryption key for PAN, bank account, personal mobile. 32 bytes, base64. */
    PII_ENCRYPTION_KEY: z.string().optional(),

    /**
     * Opt-in for the unauthenticated raw-SQL console (`platform/dev`). Read by
     * `DevSqlModule.register`; declared here so production refuses to boot with
     * it set rather than silently ignoring it.
     */
    DEV_SQL_CONSOLE: z.string().optional(),

    /**
     * Return OTP codes in API responses (`devCode`) for manual testing.
     *
     * Off unless set, and independent of NODE_ENV: deriving it from "not
     * production" is how a server left on NODE_ENV=development gave live codes
     * to anyone who asked. While it is on, anyone who knows an account's email
     * can reset its password and pass its second factor. Allowed in production
     * only because the team is testing against it; the boot log warns loudly.
     */
    OTP_DEV_CODE_IN_RESPONSE: boolish.default(false),
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
      if (env.DEV_SQL_CONSOLE) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_SQL_CONSOLE'],
          message: DEV_SQL_CONSOLE_IN_PRODUCTION,
        });
      }
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
    if (source.DEV_SQL_CONSOLE) {
      issues.push(`  DEV_SQL_CONSOLE: ${DEV_SQL_CONSOLE_IN_PRODUCTION}`);
    }
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

/**
 * Turbo strict mode only forwards keys listed in turbo.json. SMTP / GST
 * credentials live in the repo `.env` and would otherwise never reach Nest,
 * so OTP mail stays on the fake even when the file is filled in.
 */
function applyRootEnvFile(): void {
  const file = [join(process.cwd(), '.env'), join(process.cwd(), '..', '..', '.env')].find(
    (path) => existsSync(path),
  );
  if (!file) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) applyRootEnvFile();
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
