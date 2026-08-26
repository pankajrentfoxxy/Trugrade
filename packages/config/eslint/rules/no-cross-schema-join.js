'use strict';

const { MODULES } = require('./module-graph');

const SCHEMA_RE = new RegExp(
  String.raw`\b(?:from|join)\s+"?(` +
    MODULES.join('|') +
    String.raw`)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?`,
  'gi',
);

/**
 * Raw SQL that joins across two module schemas breaks the seam just as surely as
 * an import does, and neither TypeScript nor the import rule can see it.
 *
 * Escape hatch, reported by CI so it stays visible:
 *   // eslint-disable-next-line @trugrade/no-cross-schema-join -- <written justification>
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Raw SQL must not join across two module schemas.' },
    schema: [],
    messages: {
      crossSchema:
        "This SQL touches two module schemas ({{schemas}}). Cross-module reads go through the owning module's service interface, not a JOIN.",
    },
  },
  create(context) {
    function scan(node, sql) {
      if (typeof sql !== 'string' || sql.length < 10) return;
      const found = new Set();
      let m;
      SCHEMA_RE.lastIndex = 0;
      while ((m = SCHEMA_RE.exec(sql)) !== null) found.add(m[1].toLowerCase());
      if (found.size > 1) {
        context.report({
          node,
          messageId: 'crossSchema',
          data: { schemas: [...found].sort().join(', ') },
        });
      }
    }

    return {
      Literal: (node) => scan(node, node.value),
      TemplateLiteral: (node) => {
        // Static parts only. An interpolated table name is a separate problem
        // (no-unsafe-raw-sql) and is not this rule's business.
        scan(node, node.quasis.map((q) => q.value.cooked ?? '').join(' ? '));
      },
    };
  },
};
