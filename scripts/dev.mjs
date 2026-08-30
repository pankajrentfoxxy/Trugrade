#!/usr/bin/env node
/**
 * One command: `pnpm dev`.
 *
 * Brings up the compose stack, waits for it, applies migrations, seeds, and
 * starts every app. If a developer needs a README paragraph to get running, this
 * script has failed — so it does the waiting and the ordering, not the reader.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

const step = (msg) => console.log(`\n[34m>[0m ${msg}`);

// 1. .env files, created from the examples on first run.
if (!existsSync('.env') && existsSync('.env.example')) {
  step('Creating .env from .env.example');
  copyFileSync('.env.example', '.env');
}

// 2. Infrastructure, in two calls rather than one.
//
//    `up -d --wait` across the WHOLE file fails on this stack, and the message
//    it printed — "Is Docker running?" — sends you to look at Docker, which is
//    fine. The real cause is `minio-init`: a one-shot `mc` container that
//    creates the bucket and exits 0. `--wait` waits for every service to become
//    healthy, and a container that has already exited has no health to report,
//    so compose returns non-zero even though every long-running service came up
//    correctly.
//
//    So: start everything, which runs the one-shot, then wait only on the four
//    services that are meant to still be running. The wait is what stops the
//    migration below racing a Postgres that is still starting, and it still
//    does that.
const COMPOSE = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const LONG_RUNNING = ['postgres', 'redis', 'minio', 'mailpit'];

step('Starting Postgres, Redis, MinIO and Mailpit');
if (
  sh('docker', [...COMPOSE, 'up', '-d']).status !== 0 ||
  sh('docker', [...COMPOSE, 'up', '-d', '--wait', ...LONG_RUNNING]).status !== 0
) {
  console.error();
  console.error('Could not start the local stack. Is Docker running?');
  process.exit(1);
}

// 3. Schema.
step('Applying migrations');
if (sh('pnpm', ['--filter', '@trugrade/api', 'db:migrate']).status !== 0) process.exit(1);

step('Generating the Prisma client');
sh('pnpm', ['--filter', '@trugrade/api', 'db:generate']);

// 4. Reference and persona data.
step('Seeding');
sh('pnpm', ['--filter', '@trugrade/api', 'db:seed']);

// 5. Everything else, in parallel, until Ctrl-C.
step('Starting apps  (storefront :3000 - console :5173 - API :4000 - Mailpit :8026 - MinIO :9011)');
const child = spawn('pnpm', ['turbo', 'run', 'dev', '--parallel'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
