import * as React from 'react';
import { applyAuthLightTheme } from '@trugrade/ui';

/**
 * Console working surfaces stay on the light palette — sign-in, registration,
 * and the signed-in shell. The prepaint script in index.html handles first
 * paint; this keeps client navigations aligned without a reload.
 */
export function ConsoleThemeSync(): null {
  React.useLayoutEffect(() => {
    applyAuthLightTheme();
  }, []);

  return null;
}
