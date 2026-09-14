/**
 * Refuse to build or start a public app whose cross-app links point at a
 * developer's machine.
 *
 * The storefront's "Become a supplier" link and its `/sell/register` redirect,
 * and the console's wordmark, all fall back to `http://localhost:…` when their
 * variable is unset. Those URLs are baked in at build time, so a production
 * build made without the variable shipped links that send every visitor to
 * their own laptop — and nothing failed to say so.
 *
 * The rule only bites when the app itself is on a public address. A developer
 * on localhost pointing at another localhost port is the normal case.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** True for a URL whose host is this machine. An unparseable URL is not "local". */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Throws, naming every problem at once, when `selfUrl` is a public address and
 * any link target is missing or on localhost. Does nothing when `selfUrl` is
 * unset or local.
 */
export function assertLinkTargetsNotLocal(
  app: string,
  selfUrl: string | undefined,
  targets: Readonly<Record<string, string | undefined>>,
): void {
  if (!selfUrl || isLocalUrl(selfUrl)) return;

  const problems = Object.entries(targets).flatMap(([name, url]) => {
    if (!url) return [`${name} is not set`];
    if (isLocalUrl(url)) return [`${name} is ${url}`];
    return [];
  });
  if (problems.length === 0) return;

  throw new Error(
    `${app} is served at ${selfUrl} but its links would send visitors to a local address: ` +
      `${problems.join('; ')}. Set ${Object.keys(targets).join(' and ')} to the public URL, then rebuild.`,
  );
}
