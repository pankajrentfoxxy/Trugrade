import { cookieOptionsForAudience } from '../../src/shared/auth/session-cookies';

const STOREFRONT = 'https://truegrade.rentfoxxy.com';
const CONSOLE = 'https://seller.rentfoxxy.com';

describe('session cookie attributes come from the configured URL, never from NODE_ENV', () => {
  it('marks cookies Secure when the portal is served over https', () => {
    expect(cookieOptionsForAudience('console', STOREFRONT, CONSOLE).secure).toBe(true);
    expect(cookieOptionsForAudience('storefront', STOREFRONT, CONSOLE).secure).toBe(true);
  });

  it('does not mark them Secure on plain-http localhost, where the browser would drop them', () => {
    expect(
      cookieOptionsForAudience('console', 'http://localhost:3000', 'http://localhost:5173').secure,
    ).toBe(false);
  });

  it('never sets a Domain, so existing host-only cookies are replaced rather than shadowed', () => {
    expect(cookieOptionsForAudience('console', STOREFRONT, CONSOLE).domain).toBeUndefined();
    expect(cookieOptionsForAudience('storefront', STOREFRONT, CONSOLE).domain).toBeUndefined();
  });

  it('keeps httpOnly and SameSite=Lax', () => {
    expect(cookieOptionsForAudience('console', STOREFRONT, CONSOLE)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
