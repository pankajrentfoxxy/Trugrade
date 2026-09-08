import * as React from 'react';
import { useLocation } from 'react-router';
import {
  applyAuthLightTheme,
  isConsoleAuthPath,
  restoreConsoleThemeFromStorage,
} from '@trugrade/ui';

/**
 * Keeps archetype F routes on the light palette and the signed-in console on
 * dark. The prepaint script in index.html handles the first paint; this handles
 * client navigations between /login and the shell without a reload.
 */
export function ConsoleThemeSync(): null {
  const { pathname } = useLocation();

  React.useLayoutEffect(() => {
    if (isConsoleAuthPath(pathname)) applyAuthLightTheme();
    else restoreConsoleThemeFromStorage();
  }, [pathname]);

  return null;
}
