import { consoleSellRegisterUrl, resolveConsoleBaseUrl } from './console-url';

describe('resolveConsoleBaseUrl', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.CONSOLE_URL;
    delete process.env.NEXT_PUBLIC_CONSOLE_URL;
  });

  afterAll(() => {
    process.env = env;
  });

  it('uses CONSOLE_URL when set for a live storefront host', () => {
    process.env.CONSOLE_URL = 'https://seller.rentfoxxy.com';
    expect(resolveConsoleBaseUrl('trugrade.rentfoxxy.com', 'https')).toBe(
      'https://seller.rentfoxxy.com',
    );
  });

  it('ignores a localhost env default on a live storefront host', () => {
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'http://localhost:5173';
    expect(resolveConsoleBaseUrl('trugrade.rentfoxxy.com', 'https')).toBe(
      'https://seller.rentfoxxy.com',
    );
  });

  it('keeps localhost for local dev', () => {
    process.env.CONSOLE_URL = 'http://localhost:5173';
    expect(resolveConsoleBaseUrl('localhost:3000', 'http')).toBe('http://localhost:5173');
  });

  it('builds vendor registration links from the resolved base', () => {
    process.env.CONSOLE_URL = 'https://seller.example.com/';
    expect(consoleSellRegisterUrl()).toBe('https://seller.example.com/sell/register');
  });
});
