import {
  AUDIENCE_HEADER,
  CONSOLE_ACCESS_COOKIE,
  STOREFRONT_ACCESS_COOKIE,
  cookieNamesFor,
  extractSessionAccessToken,
  resolveSessionAudience,
} from './session-cookies';

const STOREFRONT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:5173';

describe('resolveSessionAudience', () => {
  it('reads the explicit audience header first', () => {
    expect(
      resolveSessionAudience({ headers: { [AUDIENCE_HEADER]: 'console' } }, STOREFRONT, CONSOLE),
    ).toBe('console');
  });

  it('matches Origin to the console URL', () => {
    expect(
      resolveSessionAudience({ headers: { origin: CONSOLE } }, STOREFRONT, CONSOLE),
    ).toBe('console');
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(
      resolveSessionAudience(
        { headers: { referer: `${CONSOLE}/login` } },
        STOREFRONT,
        CONSOLE,
      ),
    ).toBe('console');
  });

  it('defaults to storefront when nothing matches', () => {
    expect(resolveSessionAudience({ headers: {} }, STOREFRONT, CONSOLE)).toBe('storefront');
  });
});

describe('extractSessionAccessToken', () => {
  it('reads the console cookie for console requests', () => {
    const token = extractSessionAccessToken(
      {
        headers: { origin: CONSOLE },
        cookies: {
          [CONSOLE_ACCESS_COOKIE]: 'console-token',
          [STOREFRONT_ACCESS_COOKIE]: 'storefront-token',
        },
      },
      STOREFRONT,
      CONSOLE,
    );
    expect(token).toBe('console-token');
  });

  it('reads the storefront cookie for buyer requests', () => {
    const token = extractSessionAccessToken(
      {
        headers: { origin: STOREFRONT },
        cookies: {
          [CONSOLE_ACCESS_COOKIE]: 'console-token',
          [STOREFRONT_ACCESS_COOKIE]: 'storefront-token',
        },
      },
      STOREFRONT,
      CONSOLE,
    );
    expect(token).toBe('storefront-token');
  });

  it('prefers Authorization over cookies', () => {
    const token = extractSessionAccessToken(
      {
        headers: { authorization: 'Bearer header-token', origin: CONSOLE },
        cookies: { [cookieNamesFor('console').access]: 'cookie-token' },
      },
      STOREFRONT,
      CONSOLE,
    );
    expect(token).toBe('header-token');
  });
});
