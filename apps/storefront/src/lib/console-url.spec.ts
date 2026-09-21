/**
 * Where "Sell on Trugrade" actually points, in each of the four shapes
 * production can take.
 *
 * The bug this pins down: on the server `consoleBaseUrl()` resolves with NO
 * host at all, so when `CONSOLE_URL` is missing from the running process there
 * is nothing left to derive from and every link falls to `localhost:5173` —
 * on a live domain, in front of buyers.
 */
import { resolveConsoleBaseUrl } from './console-url';

const ENV = process.env;

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.CONSOLE_URL;
  delete process.env.NEXT_PUBLIC_CONSOLE_URL;
});

afterAll(() => {
  process.env = ENV;
});

describe('the env var is set in the running process', () => {
  it('wins, with or without a host', () => {
    process.env.CONSOLE_URL = 'https://seller.rentfoxxy.com';
    expect(resolveConsoleBaseUrl(undefined)).toBe('https://seller.rentfoxxy.com');
    expect(resolveConsoleBaseUrl('rentfoxxy.com', 'https')).toBe('https://seller.rentfoxxy.com');
  });

  it('is read from NEXT_PUBLIC_CONSOLE_URL too', () => {
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://seller.rentfoxxy.com/';
    // Trailing slash trimmed, so `consoleUrl('/')` cannot produce `//`.
    expect(resolveConsoleBaseUrl(undefined)).toBe('https://seller.rentfoxxy.com');
  });
});

describe('the env var is missing from the running process', () => {
  it('derives seller.{domain} WHEN it is given the host', () => {
    expect(resolveConsoleBaseUrl('rentfoxxy.com', 'https')).toBe('https://seller.rentfoxxy.com');
    expect(resolveConsoleBaseUrl('www.rentfoxxy.com', 'https')).toBe(
      'https://seller.rentfoxxy.com',
    );
  });

  /**
   * This is the reported bug. A server component that calls `consoleBaseUrl()`
   * passes no host, so a live deployment with no `CONSOLE_URL` hands buyers a
   * link to a machine that is not theirs.
   */
  it('falls all the way to localhost when it is NOT given the host', () => {
    expect(resolveConsoleBaseUrl(undefined)).toBe('http://localhost:5173');
  });
});

describe('a localhost value left in the environment', () => {
  it('is ignored on a live storefront rather than shipped to buyers', () => {
    process.env.CONSOLE_URL = 'http://localhost:5173';
    expect(resolveConsoleBaseUrl('rentfoxxy.com', 'https')).toBe('https://seller.rentfoxxy.com');
  });

  it('is honoured in local development', () => {
    process.env.CONSOLE_URL = 'http://localhost:5173';
    expect(resolveConsoleBaseUrl('localhost:3000', 'http')).toBe('http://localhost:5173');
  });
});
