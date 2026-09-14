import { Logger } from '@nestjs/common';
import { FakeNotification, NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';

describe('FakeNotification never writes an OTP to the log', () => {
  it('redacts the code but keeps it in the outbox for tests', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const outbox = new NotificationOutbox();
    const fake = new FakeNotification(outbox);

    await fake.send({
      channel: 'EMAIL',
      to: 'owner@example.com',
      templateCode: 'AUTH_LOGIN_OTP',
      locale: 'en',
      variables: { code: '482913', minutes: '5' },
      isTransactional: true,
    });

    const logged = debug.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('482913');
    expect(logged).toContain('[redacted]');
    expect(outbox.last('AUTH_LOGIN_OTP')?.variables.code).toBe('482913');
    debug.mockRestore();
  });
});
