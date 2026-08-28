import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Money } from '@trugrade/contracts';
import { AppConfig } from '../../config';
import { ObjectUrlSigner } from '../object-url';
import {
  EInvoicePort,
  EwayBillPort,
  NotificationPort,
  ObjectStorePort,
  PaymentGatewayPort,
  QcPlatformPort,
  VirtualAccountPort,
  type EwayBillRequest,
  type EwayBillResult,
  type NotificationReceipt,
  type NotificationRequest,
  type PaymentCapture,
  type PaymentIntent,
  type QcSessionRequest,
  type VirtualAccount,
} from '../ports';
import { ProviderError } from '../../errors/domain-errors';

/**
 * An assertable outbox. Tests read `outbox.last('OTP')` rather than reaching
 * into a mock's call list, which keeps the assertion about the message a person
 * would have received rather than about how it was sent.
 */
@Injectable()
export class NotificationOutbox {
  private readonly sent: Array<NotificationRequest & { at: string; id: string }> = [];

  record(req: NotificationRequest, id: string): void {
    this.sent.push({ ...req, id, at: new Date(0).toISOString() });
  }
  all(): ReadonlyArray<NotificationRequest & { id: string }> {
    return this.sent;
  }
  last(templateCode?: string): (NotificationRequest & { id: string }) | undefined {
    const matching = templateCode
      ? this.sent.filter((s) => s.templateCode === templateCode)
      : this.sent;
    return matching[matching.length - 1];
  }
  forRecipient(to: string): ReadonlyArray<NotificationRequest & { id: string }> {
    return this.sent.filter((s) => s.to === to);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

@Injectable()
export class FakeNotification extends NotificationPort {
  private readonly logger = new Logger('FakeNotification');
  constructor(private readonly outbox: NotificationOutbox) {
    super();
  }

  async send(req: NotificationRequest): Promise<NotificationReceipt> {
    // Deterministic triggers: mobile ending 99 fails permanently, 98 is delayed.
    if (req.to.endsWith('99')) {
      return {
        providerMessageId: randomUUID(),
        accepted: false,
        reason: 'Permanent delivery failure (fake trigger)',
      };
    }
    const id = randomUUID();
    this.outbox.record(req, id);
    this.logger.debug(
      `[${req.channel}] ${req.templateCode} -> ${req.to} ${JSON.stringify(req.variables)}`,
    );
    return { providerMessageId: id, accepted: true };
  }
}

@Injectable()
export class FakePaymentGateway extends PaymentGatewayPort {
  private readonly payments = new Map<string, PaymentCapture>();
  private readonly secret = 'fake_webhook_secret';

  async createIntent(input: {
    amount: Money;
    orderId: string;
    buyerOrgId: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent> {
    // Amount-based triggers, per the test plan.
    const rupees = input.amount.toString();
    if (rupees === '1.11') throw new ProviderError('razorpay', { trigger: 'forced failure' });

    const gatewayOrderId = `order_${createHash('sha1').update(input.idempotencyKey).digest('hex').slice(0, 14)}`;
    return {
      gatewayOrderId,
      amount: input.amount,
      currency: 'INR',
      checkoutToken: `tok_${gatewayOrderId}`,
    };
  }

  async fetchPayment(gatewayPaymentId: string): Promise<PaymentCapture> {
    const existing = this.payments.get(gatewayPaymentId);
    if (existing) return existing;
    const capture: PaymentCapture = {
      gatewayPaymentId,
      gatewayOrderId: `order_${gatewayPaymentId.slice(-14)}`,
      amount: Money.rupees(0),
      method: 'UPI',
      status: 'CAPTURED',
    };
    this.payments.set(gatewayPaymentId, capture);
    return capture;
  }

  async refund(input: {
    gatewayPaymentId: string;
    amount: Money;
    idempotencyKey: string;
  }): Promise<{ gatewayRefundId: string; status: 'PROCESSED' | 'PENDING' | 'FAILED' }> {
    return {
      gatewayRefundId: `rfnd_${createHash('sha1').update(input.idempotencyKey).digest('hex').slice(0, 14)}`,
      status: 'PROCESSED',
    };
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    // Length-safe compare; a timing-safe compare is what the real adapter uses.
    return expected === signature;
  }

  /** Test helper: produce a correctly signed webhook body. */
  signForTest(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }
}

@Injectable()
export class FakeVirtualAccount extends VirtualAccountPort {
  private readonly accounts = new Map<string, VirtualAccount>();

  async create(input: {
    buyerOrgId: string;
    legalName: string;
    allowedPayerAccount: { accountNumber: string; ifsc: string };
  }): Promise<VirtualAccount> {
    const id = `va_${input.buyerOrgId.slice(0, 8)}`;
    const va: VirtualAccount = {
      virtualAccountId: id,
      // TPV-bound: a transfer from any other account is returned, and the
      // checkout screen has to say so.
      accountNumber: `TRUGRADE${createHash('sha1').update(input.buyerOrgId).digest('hex').slice(0, 10).toUpperCase()}`,
      ifsc: 'RATN0VAAPIS',
      allowedPayerAccounts: [input.allowedPayerAccount.accountNumber],
    };
    this.accounts.set(id, va);
    return va;
  }

  async close(virtualAccountId: string): Promise<void> {
    this.accounts.delete(virtualAccountId);
  }
}

@Injectable()
export class FakeEwayBill extends EwayBillPort {
  private readonly bills = new Map<string, EwayBillResult & { cancelled?: boolean }>();

  async generate(req: EwayBillRequest): Promise<EwayBillResult> {
    if (req.shipToAddress.pincode === '000000') {
      throw new ProviderError('nic-ewb', { code: '325', message: 'Invalid pincode pair' });
    }
    // Validity: one day per 200 km, minimum one day — the real slab rule.
    const days = Math.max(1, Math.ceil(req.transportDistanceKm / 200));
    const generatedAt = new Date('2026-08-26T00:00:00Z');
    const result: EwayBillResult = {
      ewbNumber: String(1e11 + (Math.abs(hash(req.documentNumber)) % 1e11)).slice(0, 12),
      validUntil: new Date(generatedAt.getTime() + days * 86_400_000).toISOString(),
      generatedAt: generatedAt.toISOString(),
    };
    this.bills.set(result.ewbNumber, result);
    return result;
  }

  async updatePartB(ewbNumber: string, _vehicleNumber: string): Promise<void> {
    if (!this.bills.has(ewbNumber)) throw new ProviderError('nic-ewb', { code: '306' });
  }

  async cancel(ewbNumber: string, _reason: string): Promise<void> {
    const bill = this.bills.get(ewbNumber);
    if (!bill) throw new ProviderError('nic-ewb', { code: '306' });
    // The real API refuses a cancellation more than 24 h after generation.
    const age = Date.parse('2026-08-26T00:00:00Z') - Date.parse(bill.generatedAt);
    if (age > 86_400_000)
      throw new ProviderError('nic-ewb', { code: '312', message: 'Cannot cancel after 24 hours' });
    bill.cancelled = true;
  }
}

@Injectable()
export class FakeEInvoice extends EInvoicePort {
  async generateIrn(payload: Record<string, unknown>): Promise<{
    irn: string;
    ackNo: string;
    ackDate: string;
    signedQr: string;
  }> {
    const irn = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return {
      irn,
      ackNo: String(Math.abs(hash(irn)) % 1e12),
      ackDate: '2026-08-26T00:00:00Z',
      signedQr: Buffer.from(irn).toString('base64'),
    };
  }
  async cancelIrn(_irn: string, _reason: string): Promise<void> {}
}

/**
 * S3 on the local disk. `poison/*` returns a file whose magic bytes contradict
 * its MIME.
 *
 * WHY DISK AND NOT A MAP. `pnpm db:seed` and the API are two processes. An
 * image the seed writes has to still be there when the API serves it minutes
 * later, and a Map dies with the process that made it — which is why 608
 * catalogued condition images stood against zero objects and no photograph in
 * the product could render.
 *
 * The layout is deliberately not the key path: a key is hashed to a filename so
 * a key containing `..`, a drive letter or a 300-character prefix cannot decide
 * where a byte lands. The content type rides in a sidecar because it is the
 * store's answer, not the file extension's guess.
 */
@Injectable()
export class FakeObjectStore extends ObjectStorePort {
  private readonly root: string;

  /**
   * Required, not optional. It was optional for one call site's convenience and
   * that turned a missing constructor argument into a `ProviderError` thrown
   * from inside a passport request — a dependency that is optional to construct
   * and mandatory to use is the worst of both.
   */
  constructor(
    private readonly signer: ObjectUrlSigner,
    config: AppConfig,
  ) {
    super();
    this.root = config.get('OBJECT_STORE_DIR');
  }

  private path(key: string): string {
    return join(this.root, createHash('sha256').update(key).digest('hex'));
  }

  async presignUpload(
    key: string,
    contentType: string,
    maxBytes: number,
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    return {
      url: `memory://upload/${key}`,
      fields: { 'content-type': contentType, 'max-bytes': String(maxBytes) },
    };
  }
  async presignDownload(key: string, ttlSeconds: number): Promise<string> {
    return this.signer.sign(key, ttlSeconds);
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    mkdirSync(this.root, { recursive: true });
    const path = this.path(key);
    writeFileSync(path, body);
    writeFileSync(`${path}.type`, contentType, 'utf8');
  }
  async get(key: string): Promise<Buffer> {
    if (key.startsWith('poison/')) {
      // Declared PDF, actually a PNG. The magic-byte check must catch it (VR-063).
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    const path = this.path(key);
    if (!existsSync(path)) throw new ProviderError('s3', { key, reason: 'NoSuchKey' });
    return readFileSync(path);
  }
  /** The type `put` was given. Not inferred from the key — a key is not a promise. */
  async contentType(key: string): Promise<string> {
    const sidecar = `${this.path(key)}.type`;
    return existsSync(sidecar) ? readFileSync(sidecar, 'utf8') : 'application/octet-stream';
  }
  async delete(key: string): Promise<void> {
    const path = this.path(key);
    rmSync(path, { force: true });
    rmSync(`${path}.type`, { force: true });
  }
  async exists(key: string): Promise<boolean> {
    return existsSync(this.path(key));
  }
}

@Injectable()
export class FakeQcPlatform extends QcPlatformPort {
  private readonly licences = new Map<string, { key: string; revoked: boolean }>();
  readonly sessions: QcSessionRequest[] = [];

  async createSession(req: QcSessionRequest): Promise<{ sessionId: string }> {
    const licence = this.licences.get(req.organizationId);
    if (licence?.revoked) {
      throw new ProviderError('devicesure', {
        reason: 'LICENCE_REVOKED',
        organizationId: req.organizationId,
      });
    }
    this.sessions.push(req);
    return { sessionId: randomUUID() };
  }

  async issueVendorLicence(input: {
    organizationId: string;
    maxAgents: number;
    features: string[];
  }): Promise<{ licenceKey: string }> {
    const key = `DS-${createHash('sha1').update(input.organizationId).digest('hex').slice(0, 16).toUpperCase()}`;
    this.licences.set(input.organizationId, { key, revoked: false });
    return { licenceKey: key };
  }

  /**
   * The enforcement mechanism the whole quality model rests on: suspend a vendor
   * on the platform and their agents stop certifying (07 §5.1).
   */
  async revokeVendorLicence(organizationId: string, _reason: string): Promise<void> {
    const licence = this.licences.get(organizationId);
    if (licence) licence.revoked = true;
    else this.licences.set(organizationId, { key: 'unknown', revoked: true });
  }

  async fetchPublicKey(_keyId: string): Promise<string> {
    return 'MCowBQYDK2VwAyEA_fake_ed25519_public_key_for_tests_only_00000=';
  }

  isRevoked(organizationId: string): boolean {
    return this.licences.get(organizationId)?.revoked ?? false;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
