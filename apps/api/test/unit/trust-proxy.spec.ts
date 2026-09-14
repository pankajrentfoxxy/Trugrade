import express from 'express';
import request from 'supertest';
import { applyTrustedProxy } from '../../src/shared/http/trust-proxy';

/**
 * A stand-in for one nginx hop in front of the app. nginx appends the address it
 * saw to whatever X-Forwarded-For the client sent, so a request from `client`
 * carrying `forged` reaches the app as `forged, client`.
 */
const viaNginx = (client: string, forged?: string): string =>
  forged ? `${forged}, ${client}` : client;

describe('the API reads the client address from exactly one proxy hop', () => {
  const app = express();
  applyTrustedProxy(app);
  const buckets = new Map<string, number>();
  app.get('/whoami', (req, res) => {
    const subject = req.ip ?? 'unknown';
    buckets.set(subject, (buckets.get(subject) ?? 0) + 1);
    res.json({ ip: subject, count: buckets.get(subject) });
  });

  beforeEach(() => buckets.clear());

  it('two real clients behind nginx get separate rate-limit buckets', async () => {
    const a = await request(app).get('/whoami').set('X-Forwarded-For', viaNginx('203.0.113.10'));
    const b = await request(app).get('/whoami').set('X-Forwarded-For', viaNginx('198.51.100.7'));

    expect(a.body).toEqual({ ip: '203.0.113.10', count: 1 });
    expect(b.body).toEqual({ ip: '198.51.100.7', count: 1 });
  });

  it('ignores an X-Forwarded-For the client forged, so it cannot mint itself a fresh bucket', async () => {
    await request(app).get('/whoami').set('X-Forwarded-For', viaNginx('203.0.113.10', '1.1.1.1'));
    const second = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', viaNginx('203.0.113.10', '8.8.8.8, 9.9.9.9'));

    expect(second.body).toEqual({ ip: '203.0.113.10', count: 2 });
  });
});
