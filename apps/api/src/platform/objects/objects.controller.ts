import { Controller, Get, Header, Module, Param, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../shared/auth/guards';
import { NotFoundError } from '../../shared/errors/domain-errors';
import { ObjectStorePort } from '../../shared/adapters/ports';
import { ObjectUrlSigner } from '../../shared/adapters/object-url';
import { RateLimiter, type RateLimitRule } from '../../shared/redis/redis.service';

/**
 * The one place bytes in object storage reach a browser.
 *
 * Every `presignDownload` in the platform resolves here: the condition
 * photographs on a product page, the technician's six frames on a unit
 * passport, the seal photograph on a console record, a KYC document in review.
 * Before this route existed `presignDownload` returned `memory://download/…`,
 * which is not a URL a browser can fetch, and **no image in the product
 * rendered at all**.
 *
 * Three properties it is responsible for:
 *
 *   1. **The key is never published.** `:token` is the key encrypted with an
 *      expiry (`ObjectUrlSigner`), not the key signed. An S3 key path revealing
 *      a vendor slug is a leak PHASE_05 Task 1 names explicitly, and the keys
 *      here genuinely carry org identifiers.
 *   2. **It cannot be walked.** There is no ordering to increment: a token is
 *      AES-GCM ciphertext, and a wrong one fails the auth tag rather than
 *      landing on a neighbouring object. The rate limit below is the second
 *      line, not the first.
 *   3. **It is inert.** `nosniff` plus a `default-src 'none'; sandbox` policy,
 *      so an SVG served from here cannot execute script even if one were ever
 *      stored — and stand-in images are SVG.
 *
 * Deliberately NOT authenticated, and that is the presigned-URL model rather
 * than a hole: the token IS the capability, it is unguessable, and it expires.
 * A page that may show a photograph mints the URL; nothing else can.
 */

/**
 * A product page pulls six condition images and a passport six photographs, so
 * a person reading a few pages is well inside this. A scraper walking tokens is
 * not, and gets nowhere anyway.
 */
const OBJECT_LIMIT: RateLimitRule = { name: 'object-fetch', limit: 240, windowSeconds: 300 };

/** What enumeration produces and a real reader almost never sees. */
const MISS_LIMIT: RateLimitRule = { name: 'object-fetch-miss', limit: 20, windowSeconds: 3_600 };

@Controller('objects')
export class ObjectsController {
  constructor(
    private readonly store: ObjectStorePort,
    private readonly signer: ObjectUrlSigner,
    private readonly limiter: RateLimiter,
  ) {}

  @Get(':token')
  @Public()
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async fetch(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const subject = req.ip ?? 'unknown';
    await this.limiter.consume(OBJECT_LIMIT, subject);

    const key = this.signer.verify(token);
    const bytes = key === null ? null : await this.store.get(key).catch(() => null);
    if (key === null || bytes === null) {
      await this.limiter.consume(MISS_LIMIT, subject);
      // Expired, forged, and deleted are one answer. Distinguishing them tells a
      // prober which of their guesses was structurally valid.
      throw new NotFoundError('object', { reason: 'no_object' });
    }

    // Signed URLs expire, so the response may be cached only for as long as one
    // is likely to be valid, and only by the browser that asked for it.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(bytes, {
      type: await this.store.contentType(key),
      disposition: 'inline',
      length: bytes.length,
    });
  }
}

@Module({ controllers: [ObjectsController] })
export class ObjectsModule {}
