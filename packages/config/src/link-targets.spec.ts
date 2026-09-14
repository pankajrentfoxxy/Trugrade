import { assertLinkTargetsNotLocal, isLocalUrl } from './link-targets';

describe('a public app refuses links that point at localhost', () => {
  it('throws when the storefront is public and the console URL is localhost', () => {
    expect(() =>
      assertLinkTargetsNotLocal('storefront', 'https://truegrade.rentfoxxy.com', {
        CONSOLE_URL: 'http://localhost:5173',
      }),
    ).toThrow(/CONSOLE_URL is http:\/\/localhost:5173/);
  });

  it('throws when a target is missing, naming it', () => {
    expect(() =>
      assertLinkTargetsNotLocal('console', 'https://seller.rentfoxxy.com', {
        VITE_STOREFRONT_URL: undefined,
      }),
    ).toThrow(/VITE_STOREFRONT_URL is not set/);
  });

  it('passes when every target is public', () => {
    expect(() =>
      assertLinkTargetsNotLocal('storefront', 'https://truegrade.rentfoxxy.com', {
        CONSOLE_URL: 'https://seller.rentfoxxy.com',
      }),
    ).not.toThrow();
  });

  it('leaves local development alone', () => {
    expect(() =>
      assertLinkTargetsNotLocal('storefront', 'http://localhost:3000', {
        CONSOLE_URL: 'http://localhost:5173',
      }),
    ).not.toThrow();
    expect(() => assertLinkTargetsNotLocal('console', undefined, { X: undefined })).not.toThrow();
  });

  it('recognises every loopback spelling', () => {
    for (const url of [
      'http://localhost:1',
      'http://127.0.0.1',
      'http://[::1]:8080',
      'http://0.0.0.0',
    ]) {
      expect(isLocalUrl(url)).toBe(true);
    }
    expect(isLocalUrl('https://seller.rentfoxxy.com')).toBe(false);
  });
});
