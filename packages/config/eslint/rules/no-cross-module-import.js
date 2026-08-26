'use strict';

const { moduleOfPath, resolveImportedModule } = require('./module-graph');

/**
 * A module may only reach another module through its public barrel
 * (`modules/<name>/index.ts`), which re-exports `I<Name>Service`, the module's
 * event types and its public DTOs — nothing else.
 *
 * 02_ARCHITECTURE.md §1.1 rule 2. This is the rule that makes the modular
 * monolith an architecture instead of a folder layout, and a boundary rule
 * without an error-level lint is a comment.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A module may only import another module via its public barrel (modules/<name> or modules/<name>/index).',
    },
    schema: [],
    messages: {
      deepImport:
        "'{{from}}' reaches into '{{to}}/{{rest}}'. Import the public barrel '{{to}}' instead — {{to}}/{{firstSegment}} is private to that module.",
      notBarrel:
        "'{{from}}' imports '{{to}}/{{rest}}' directly. Cross-module access goes through the public barrel '{{to}}' only.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const ownModule = moduleOfPath(filename);
    if (!ownModule) return {};

    function check(node, rawSpecifier) {
      if (typeof rawSpecifier !== 'string') return;
      const target = resolveImportedModule(rawSpecifier, filename);
      if (!target || target.name === ownModule) return;

      // The public barrel: `modules/x`, `modules/x/index`, `modules/x/index.ts`.
      const rest = target.rest.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
      if (rest === '' || rest === 'index') return;

      const firstSegment = rest.split('/')[0];
      context.report({
        node,
        messageId: 'deepImport',
        data: { from: ownModule, to: target.name, rest, firstSegment },
      });
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => node.source && check(node, node.source.value),
      ImportExpression: (node) =>
        node.source.type === 'Literal' && check(node, node.source.value),
      'CallExpression[callee.name="require"]': (node) => {
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal') check(node, arg.value);
      },
    };
  },
};
