'use strict';

/**
 * Shared knowledge about the module/schema map (02_ARCHITECTURE.md §1.1, §2.1).
 * One database, twelve schemas, twelve NestJS modules, one-to-one.
 */
const MODULES = [
  'identity',
  'kyc',
  'customer',
  'vendor',
  'catalog',
  'listing',
  'qc',
  'ordering',
  'procurement',
  'payment',
  'logistics',
  'platform',
];

/** Sub-folders of a module that are private to it. Everything else is private too. */
const PRIVATE_SEGMENTS = ['internal', 'entities', 'dto', 'events', 'jobs'];

/** Normalise Windows separators so the rule behaves identically on both platforms. */
const posix = (p) => String(p).split('\\').join('/');

/**
 * Which module does this absolute-ish path belong to? Returns null when the path
 * is not inside `src/modules/<name>/`.
 */
function moduleOfPath(filePath) {
  const m = posix(filePath).match(/(?:^|\/)modules\/([^/]+)(?:\/|$)/);
  if (!m) return null;
  return MODULES.includes(m[1]) ? m[1] : null;
}

/**
 * Resolve an import specifier to a `modules/<name>/<rest>` shape, or null.
 * Handles both the path alias (`src/modules/x`, `@/modules/x`, `modules/x`) and
 * relative hops (`../qc/internal/foo`, `../../modules/qc`).
 */
function resolveImportedModule(specifier, fromFile) {
  const spec = posix(specifier);
  let combined;
  if (spec.startsWith('.')) {
    const dir = posix(fromFile).split('/').slice(0, -1).join('/');
    const parts = (dir + '/' + spec).split('/');
    const stack = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    combined = stack.join('/');
  } else {
    combined = spec;
  }
  const m = combined.match(/(?:^|\/)modules\/([^/]+)((?:\/[^/]*)*)$/);
  if (!m || !MODULES.includes(m[1])) return null;
  return { name: m[1], rest: (m[2] || '').replace(/^\//, '') };
}

module.exports = { MODULES, PRIVATE_SEGMENTS, moduleOfPath, resolveImportedModule, posix };
