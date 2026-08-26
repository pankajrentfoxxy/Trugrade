'use strict';
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro in a pnpm workspace.
 *
 * pnpm does not flatten `node_modules`, so Metro's default resolver — which walks
 * up from the file being bundled — never finds `@trugrade/contracts` or the
 * hoisted transitive dependencies. Three settings fix that, and all three are
 * required together:
 *
 *   `watchFolders`            so a change in `packages/contracts` triggers a rebuild
 *   `nodeModulesPaths`        so the workspace root is searched as well as the app
 *   `disableHierarchicalLookup` so Metro uses exactly those two roots and cannot
 *                              silently pick up a second copy of React from a
 *                              nested `node_modules`, which is the failure that
 *                              shows up as "Invalid hook call" and takes a day.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
