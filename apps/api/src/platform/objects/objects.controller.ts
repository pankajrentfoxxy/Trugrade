import {
  Controller,
  Get,
  Header,
  HttpCode,
  Module,
  Param,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../shared/auth/guards';
import { NotFoundError, ValidationError } from '../../shared/errors/domain-errors';
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
/** A bulk drop is a few dozen photographs; nothing legitimate is hundreds a minute. */
const UPLOAD_LIMIT: RateLimitRule = { name: 'object-upload', limit: 120, windowSeconds: 300 };
/** Above every per-route cap the platform sets on a presign. */
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** An upload token names its key under this prefix; a download token never does. */
const PUT_PREFIX = 'put:';

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

    const signed = this.signer.verify(token);
    // An upload token is not a download token, whatever it names.
    const key = signed === null || signed.startsWith(PUT_PREFIX) ? null : signed;
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

  /**
   * Where a presigned upload lands when the store is the local one.
   *
   * The S3 adapter presigns a URL on the bucket and the bytes never touch
   * this process; the development store has no bucket, so its presign points
   * here and this route is the bucket. Same capability model as the GET: the
   * token is an encrypted, expiring key, and a wrong one fails its auth tag.
   * The `put:` prefix is what makes it an upload token; a download token
   * cannot overwrite an object and an upload token cannot read one.
   *
   * The body is read straight off the socket rather than through a parser —
   * nothing registered parses `image/jpeg` — and capped before it is held.
   */
  @Put(':token')
  @Public()
  @HttpCode(200)
  async upload(@Param('token') token: string, @Req() req: Request): Promise<{ stored: true }> {
    const subject = req.ip ?? 'unknown';
    await this.limiter.consume(UPLOAD_LIMIT, subject);
    const signed = this.signer.verify(token);
    if (signed === null || !signed.startsWith(PUT_PREFIX)) {
      await this.limiter.consume(MISS_LIMIT, subject);
      throw new NotFoundError('object', { reason: 'no_object' });
    }
    const key = signed.slice(PUT_PREFIX.length);

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > UPLOAD_MAX_BYTES) {
      throw new ValidationError('That file is larger than we accept.', {
        file: `Keep each photograph under ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`,
      });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > UPLOAD_MAX_BYTES) {
        throw new ValidationError('That file is larger than we accept.', {
          file: `Keep each photograph under ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`,
        });
      }
      chunks.push(buf);
    }
    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      throw new ValidationError('Nothing was uploaded.', { file: 'The file arrived empty.' });
    }
    const contentType = String(req.headers['content-type'] ?? 'application/octet-stream')
      .split(';')[0]!
      .trim();
    await this.store.put(key, body, contentType);
    return { stored: true };
  }
}

@Module({ controllers: [ObjectsController] })
export class ObjectsModule {}
