import {
  type ArgumentsHost,
  Catch,
  type CallHandler,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
  type PipeTransform,
  Module,
  Global,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { ZodError, type ZodTypeAny } from 'zod';
import { DomainError, ValidationError } from '../errors/domain-errors';
import { RequestContextService, type Principal } from '../db/org-scope';
import { translatePrismaError } from '../db/prisma.service';

/**
 * The wire shape of every error. One shape, always, so a client never has to
 * guess — and `detail` is conspicuously absent, because that is the field that
 * would carry the SQL, the stack and the vendor name.
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level messages for a form. */
    fields?: Record<string, string>;
    requestId: string;
  };
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly ctx: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = this.ctx.get()?.requestId ?? 'unknown';

    const domain = this.toDomainError(exception);

    if (domain.httpStatus >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${domain.httpStatus} ${domain.code}: ${domain.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.url} -> ${domain.httpStatus} ${domain.code}: ${domain.message}` +
          (domain.detail ? ` ${JSON.stringify(domain.detail)}` : ''),
      );
    }

    const body: ErrorBody = {
      error: {
        code: domain.code,
        message: domain.message,
        ...(domain.fields ? { fields: domain.fields } : {}),
        requestId,
      },
    };

    if (domain.code === 'RATE_LIMITED') {
      const retry = (domain.detail as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      if (retry) res.setHeader('Retry-After', String(retry));
    }

    res.status(domain.httpStatus).json(body);
  }

  private toDomainError(e: unknown): DomainError {
    if (e instanceof DomainError) return e;

    const translated = translatePrismaError(e);
    if (translated) return translated;

    if (e instanceof ZodError) {
      return new ValidationError(
        'Some of the details need fixing.',
        Object.fromEntries(e.issues.map((i) => [i.path.join('.') || '_', i.message])),
      );
    }

    if (e instanceof HttpException) {
      const status = e.getStatus();
      const response = e.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? e.message);
      return new DomainError(
        status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED',
        status,
        Array.isArray(message) ? message.join('. ') : String(message),
      );
    }

    // Anything unrecognised is a 500 with a deliberately opaque message. The real
    // error is in the log, keyed by requestId; it does not go on the wire.
    return new DomainError(
      'INTERNAL',
      500,
      'Something went wrong at our end. We have been notified.',
      {
        detail: { original: (e as Error)?.message },
      },
    );
  }
}

/** Establishes the per-request context every layer below reads from. */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    // W3C traceparent, so a cross-module flow is one trace end to end.
    const traceId = (req.headers['traceparent'] as string)?.split('-')[1] ?? requestId;
    res.setHeader('x-request-id', requestId);

    return new Observable((subscriber) => {
      this.ctx.run(
        {
          requestId,
          traceId,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          /**
           * Carried over from the request, and this line is load-bearing.
           *
           * Nest runs GUARDS before INTERCEPTORS, so `AuthGuard` resolves the
           * principal and calls `ctx.setPrincipal` before this AsyncLocalStorage
           * context exists — that write goes nowhere, and starting a fresh
           * context here without the principal discarded it. The result was that
           * `ctx.principal` was undefined inside EVERY handler, silently: 21 call
           * sites across the listing, ordering and vendor modules read it for org
           * scoping, and `/auth/session` only looked healthy because it falls back
           * to the refresh cookie when the principal is missing.
           *
           * The guard also stamps `req.principal`, so the request object is the
           * one place the value reliably survives the ordering. Seeding from it
           * is what makes the context agree with the guard.
           */
          principal: (req as Request & { principal?: Principal }).principal,
        },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}

/**
 * Validate with the shared Zod schema rather than a second set of decorators.
 *
 * VR-META-01 requires the client schema and the DTO validator to be the identical
 * constant; the cheapest way to guarantee that is for the server to run the same
 * schema the client ran, out of `@trugrade/contracts`.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        'Some of the details need fixing.',
        Object.fromEntries(result.error.issues.map((i) => [i.path.join('.') || '_', i.message])),
      );
    }
    return result.data;
  }
}

@Global()
@Module({
  providers: [RequestContextInterceptor, DomainExceptionFilter],
  exports: [RequestContextInterceptor, DomainExceptionFilter],
})
export class HttpModule {}
