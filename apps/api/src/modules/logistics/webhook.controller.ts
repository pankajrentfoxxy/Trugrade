import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';
import { AppConfig } from '../../shared/config';
import { ClockPort } from '../../shared/clock';
import { UnauthenticatedError } from '../../shared/errors/domain-errors';
import { Inject } from '@nestjs/common';
import { CARRIER_REGISTRY, type CarrierRegistry } from '../../shared/adapters/adapters.module';
import { LogisticsDeliveryService } from './internal/delivery.service';

/**
 * Carrier callbacks: BlueDart and Porter marking their own deliveries.
 *
 * Five properties, in the order they have to happen:
 *
 * 1. **Verify the signature before parsing anything.** An unverified webhook
 *    that can mark an order delivered is a way to make this platform pay a
 *    vendor for goods that never moved. Each provider signs differently; each
 *    gets its own scheme and a 401 on mismatch.
 * 2. **Store the raw payload, always** — including statuses we ignore. This
 *    table is the audit trail and the replay source, and the event we chose not
 *    to act on is exactly the one someone asks about later.
 * 3. **Map the raw code through a per-carrier table, keeping the raw one.**
 *    Delhivery's NDR API keys off raw codes to decide which actions are even
 *    legal, so normalising them away breaks NDR handling downstream.
 * 4. **Be idempotent.** Carriers re-deliver webhooks for days. A second
 *    DELIVERED is a 200 that changes nothing.
 * 5. **Answer fast.** The mapping is inline; nothing here waits on a PDF or a
 *    ledger post.
 */

/** What each carrier's raw status codes mean to us. Raw codes are kept alongside. */
const STATUS_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  BLUEDART: {
    PUD: 'PICKED_UP',
    IT: 'IN_TRANSIT',
    OFD: 'OUT_FOR_DELIVERY',
    DL: 'DELIVERED',
    UD: 'FAILED',
    RT: 'RTO',
  },
  PORTER: {
    accepted: 'SCHEDULED',
    live: 'IN_TRANSIT',
    ended: 'DELIVERED',
    cancelled: 'CANCELLED',
    failed: 'FAILED',
  },
};

interface WebhookBody {
  awb?: string;
  status?: string;
  statusCode?: string;
  occurredAt?: string;
  location?: string;
  reason?: string;
  [key: string]: unknown;
}

@Controller('webhooks/carriers')
export class CarrierWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly clock: ClockPort,
    private readonly deliveries: LogisticsDeliveryService,
    @Inject(CARRIER_REGISTRY) private readonly carriers: CarrierRegistry,
  ) {}

  @Post('bluedart')
  @Public()
  @HttpCode(200)
  async bluedart(
    @Req() req: Request,
    @Headers('x-bluedart-signature') signature: string | undefined,
    @Body() body: WebhookBody,
  ): Promise<{ accepted: boolean }> {
    this.assertSignature('BLUEDART', req, signature);
    return this.ingest('BLUEDART', body);
  }

  @Post('porter')
  @Public()
  @HttpCode(200)
  async porter(
    @Req() req: Request,
    @Headers('x-porter-signature') signature: string | undefined,
    @Body() body: WebhookBody,
  ): Promise<{ accepted: boolean }> {
    this.assertSignature('PORTER', req, signature);
    return this.ingest('PORTER', body);
  }

  /**
   * HMAC-SHA256 over the raw body, compared in constant time.
   *
   * The raw buffer, not the parsed object: re-serialising JSON reorders keys and
   * changes whitespace, so a signature over the re-serialised form verifies
   * nothing. `main.ts` keeps `rawBody` for this route.
   */
  private assertSignature(carrier: string, req: Request, signature: string | undefined): void {
    const secret = this.config.all[`${carrier}_WEBHOOK_SECRET` as keyof typeof this.config.all] as
      | string
      | undefined;

    // No secret configured means this carrier's callbacks are not live yet.
    // Refusing is the safe answer: accepting unsigned calls "until we get the
    // secret" is how an open delivery endpoint ships.
    if (!secret) {
      throw new UnauthenticatedError();
    }
    if (!signature) throw new UnauthenticatedError();

    const raw: Buffer = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const given = Buffer.from(signature, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new UnauthenticatedError();
    }
  }

  private async ingest(carrier: string, body: WebhookBody): Promise<{ accepted: boolean }> {
    const awb = (body.awb ?? '').trim();
    const rawCode = (body.statusCode ?? body.status ?? '').trim();
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : this.clock.now();

    const [shipment] = await this.prisma.$queryRaw<
      Array<{ id: string; status: string; delivered_at: Date | null }>
    >`
      SELECT id, status::text AS status, delivered_at
        FROM logistics.shipment WHERE awb_number = ${awb}`;

    // An AWB we do not know is still recorded — against nothing, so it cannot be
    // stored on a shipment row, but the 200 is honest: the carrier delivered its
    // message and retrying will not help either of us.
    if (!shipment) return { accepted: true };

    // 2. The raw payload, whatever we decide below.
    await this.prisma.$executeRaw`
      INSERT INTO logistics.shipment_tracking
        (shipment_id, status_code, description, location, raw_payload, occurred_at)
      VALUES (${shipment.id}::uuid, ${rawCode || 'UNKNOWN'},
              ${(body.reason as string | undefined) ?? null},
              ${body.location ?? null}, ${JSON.stringify(body)}::jsonb, ${occurredAt})`;

    const mapped = STATUS_MAP[carrier]?.[rawCode];
    if (!mapped) {
      // 3. An unknown code changes nothing and tells a person. Guessing what a
      // carrier meant is how a consignment gets marked delivered by a typo.
      await this.prisma.$executeRaw`
        INSERT INTO ordering.ops_task
          (kind, severity, shipment_id, subject, detail, assigned_role, status, created_at)
        VALUES ('UNKNOWN_CARRIER_STATUS', 'FYI', ${shipment.id}::uuid,
                ${`${carrier} sent a status we do not recognise: ${rawCode || '(empty)'}`},
                ${JSON.stringify({ carrier, rawCode, awb })}::jsonb,
                'OPS_MANAGER', 'OPEN', ${occurredAt})`;
      return { accepted: true };
    }

    if (mapped === 'DELIVERED') {
      await this.deliveries.markDelivered({
        shipmentId: shipment.id,
        // The carrier's own instant. The return window that decides when a
        // vendor is paid runs from this, so `now()` here would be a guess with
        // money attached.
        deliveredAt: occurredAt,
        source: 'CARRIER_WEBHOOK',
      });
      return { accepted: true };
    }

    if (mapped === 'FAILED') {
      const adapter = this.carriers.get(carrier);
      await this.deliveries.recordFailedAttempt({
        shipmentId: shipment.id,
        outcome: this.ndrOutcome(body),
        reason: (body.reason as string | undefined) ?? `${carrier} reported ${rawCode}`,
        legalActions: adapter?.legalNdrActions(rawCode) ?? [],
        occurredAt,
      });
      return { accepted: true };
    }

    await this.prisma.$executeRaw`
      UPDATE logistics.shipment
         SET status = ${mapped}::public.shipment_status,
             dispatched_at = CASE WHEN ${mapped} = 'PICKED_UP' AND dispatched_at IS NULL
                                  THEN ${occurredAt} ELSE dispatched_at END
       WHERE id = ${shipment.id}::uuid
         AND delivered_at IS NULL`;
    return { accepted: true };
  }

  /** `delivery_attempt.outcome` is a closed list; anything unmapped is unavailable. */
  private ndrOutcome(body: WebhookBody): string {
    const reason = String(body.reason ?? '').toLowerCase();
    if (reason.includes('address')) return 'ADDRESS_NOT_FOUND';
    if (reason.includes('refus')) return 'REFUSED';
    if (reason.includes('closed')) return 'OFFICE_CLOSED';
    if (reason.includes('gate')) return 'GATE_PASS_MISSING';
    return 'CONSIGNEE_UNAVAILABLE';
  }
}
