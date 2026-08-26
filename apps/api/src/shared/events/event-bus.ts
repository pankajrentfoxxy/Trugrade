import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EVENT_PAYLOADS,
  type EventName,
  type EventPayload,
  type DomainEvent,
} from '@trugrade/contracts';
import { PrismaModule, PrismaService } from '../db/prisma.service';
import { RequestContextService } from '../db/org-scope';
import { ClockModule, ClockPort } from '../clock';
import { ContextModule } from '../db/org-scope';

export type EventHandler<N extends EventName = EventName> = (
  event: Extract<DomainEvent, { name: N }>,
) => Promise<void>;

interface Registration {
  /** Stable name, used for dead-letter reporting and to make handlers idempotent. */
  handlerId: string;
  handler: EventHandler;
}

/**
 * The typed in-process event bus, backed by a transactional outbox.
 *
 * The rule that makes this worth having: **publishing inside a transaction must
 * not dispatch until that transaction commits.** Get it wrong and a subscriber
 * acts on an order that was rolled back — and the subscriber that matters is the
 * one that raises a purchase order or accrues a payable.
 *
 * So `publish()` only ever writes a row. Dispatch happens in `OutboxDispatcher`,
 * after commit, reading rows that are only visible because the transaction
 * committed. There is no code path that can publish directly.
 *
 * Event names are the names a real queue would use later (02 §1.1 rule 3). When
 * `qc` becomes its own service, the names do not change — only the transport.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<EventName, Registration[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * Write an event to the outbox. Call this inside the business transaction.
   *
   * Validating the payload here rather than at dispatch means a malformed event
   * fails the transaction that produced it, where the stack trace still points
   * at the code that was wrong.
   */
  async publish<N extends EventName>(name: N, payload: EventPayload<N>): Promise<void> {
    const schema = EVENT_PAYLOADS[name];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Refusing to publish a malformed ${name}: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }

    const ctx = this.ctx.get();
    await this.prisma.db.event_outbox.create({
      data: {
        id: randomUUID(),
        event_name: name,
        payload_json: parsed.data as object,
        trace_id: ctx?.traceId ?? ctx?.requestId ?? null,
        actor_user_id: ctx?.principal?.userId ?? null,
        occurred_at: this.clock.now(),
      },
    });
  }

  /**
   * Subscribe. `handlerId` must be stable across deploys — it is what makes a
   * redelivery attributable and what a dead-letter row names.
   */
  on<N extends EventName>(name: N, handlerId: string, handler: EventHandler<N>): void {
    const list = this.handlers.get(name) ?? [];
    if (list.some((r) => r.handlerId === handlerId)) {
      throw new Error(`Duplicate handler id "${handlerId}" for ${name}`);
    }
    // The union is exhaustive and `on()` is the only writer, so widening a
    // per-event handler to the union type is safe here even though TypeScript
    // cannot see it: `handlersFor(name)` only ever returns handlers registered
    // under that same name.
    list.push({ handlerId, handler: handler as unknown as EventHandler });
    this.handlers.set(name, list);
    this.logger.log(`Subscribed ${handlerId} to ${name}`);
  }

  handlersFor(name: EventName): readonly Registration[] {
    return this.handlers.get(name) ?? [];
  }

  /** For assertions in tests: which events does anything actually listen to? */
  get subscribedEvents(): EventName[] {
    return [...this.handlers.keys()];
  }
}

@Global()
@Module({
  imports: [PrismaModule, ClockModule, ContextModule],
  providers: [EventBus],
  exports: [EventBus],
})
export class EventBusModule {}
