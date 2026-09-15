import { RazorpayIfscBankVerification } from './ifsc.razorpay';

const reply = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;

describe('ifsc.razorpay.com lookup', () => {
  const adapter = new RazorpayIfscBankVerification();
  afterEach(() => jest.restoreAllMocks());

  it('maps a known IFSC to bank, branch and city', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        reply(200, {
          BANK: 'HDFC Bank',
          BRANCH: 'TULSIANI CHMBRS - NARIMAN PT',
          CITY: 'GREATER MUMBAI',
        }),
      );
    const result = await adapter.lookupIfsc('HDFC0000001');
    expect(result.outcome).toBe('PASS');
    expect(result.data).toEqual({
      bank: 'HDFC Bank',
      branch: 'TULSIANI CHMBRS - NARIMAN PT',
      city: 'GREATER MUMBAI',
    });
  });

  it('says FAIL, naming the code, for an IFSC the directory does not have', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply(404, 'Not Found'));
    const result = await adapter.lookupIfsc('ABCD0123456');
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toContain('ABCD0123456');
  });

  it('says PROVIDER_ERROR, not FAIL, when the directory cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const result = await adapter.lookupIfsc('HDFC0000001');
    expect(result.outcome).toBe('PROVIDER_ERROR');
  });
});
