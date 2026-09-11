import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppConfig, ConfigModule } from '../config';
import { ConflictError, ValidationError, type DomainError } from '../errors/domain-errors';

/**
 * The transaction-scoped client. Everything inside `runInTransaction` sees the
 * transactional client automatically, so a repository never has to be handed a
 * `tx` parameter and no code path can accidentally write outside the transaction
 * its caller opened. That matters most in the three flows that must be atomic
 * (02_ARCHITECTURE.md §4).
 */
type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const txStorage = new AsyncLocalStorage<TxClient>();

/**
 * Composition, not inheritance, and for a concrete reason.
 *
 * Prisma 6 returns a Proxy from `new PrismaClient()`, and its `get` trap forwards
 * to the raw target without preserving the proxy as the receiver. So inside a
 * getter defined on a *subclass prototype*, `this` is the bare target and every
 * model accessor (`this.event_outbox`, `this.unit`, ...) is undefined — while the
 * same access from outside works fine. That is a genuinely nasty failure: it
 * looks like a dependency-injection problem and it only bites on the non-
 * transactional path.
 *
 * Holding the client in a field sidesteps the whole thing.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(config: AppConfig) {
    this.client = new PrismaClient({
      datasources: { db: { url: config.get('DATABASE_URL') } },
      log: config.get('NODE_ENV') === 'development' ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** The client to use right now: the ambient transaction if there is one. */
  get db(): TxClient {
    return txStorage.getStore() ?? this.client;
  }

  // --- delegated escape hatches -------------------------------------------
  // Raw SQL is how the hot paths in 02_ARCHITECTURE.md §4 are written; these
  // route through `db`, so raw statements join the ambient transaction too.

  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    return (this.db as PrismaClient).$queryRaw(query, ...values) as Promise<T>;
  }
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
    return (this.db as PrismaClient).$queryRawUnsafe(query, ...values) as Promise<T>;
  }
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    return (this.db as PrismaClient).$executeRaw(query, ...values);
  }
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    return (this.db as PrismaClient).$executeRawUnsafe(query, ...values);
  }
  $connect(): Promise<void> {
    return this.client.$connect();
  }
  $disconnect(): Promise<void> {
    return this.client.$disconnect();
  }

  /**
   * Run `fn` inside one transaction. Nested calls join the outer transaction
   * rather than opening a second one — a nested BEGIN that silently committed
   * early is exactly how a "rolled back" order leaves a purchase order behind.
   */
  async runInTransaction<T>(
    fn: () => Promise<T>,
    opts: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {},
  ): Promise<T> {
    const existing = txStorage.getStore();
    if (existing) return fn();

    return this.client.$transaction(async (tx) => txStorage.run(tx as TxClient, fn), {
      // Serializable would be safer still, but the order-confirmation flow takes
      // explicit row locks (FOR UPDATE / SKIP LOCKED) and the quantity CHECK is
      // the real guarantee, so ReadCommitted plus explicit locking is both
      // correct and far less prone to spurious retries under load.
      isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: opts.timeoutMs ?? 15_000,
      maxWait: 5_000,
    });
  }

  /** True when called inside `runInTransaction`. Used by the outbox to assert placement. */
  get isInTransaction(): boolean {
    return txStorage.getStore() !== undefined;
  }

  /**
   * Advisory lock, held for the life of the current transaction.
   *
   * Used for gapless invoice-number allocation (VR-146) and anywhere a sequence
   * must not skip. Postgres releases it on commit or rollback, so there is no
   * leak path — unlike a Redis lock, which can expire mid-transaction. That is
   * why the money paths use this and the stock paths use Redis plus a DB CHECK.
   */
  async advisoryLock(key: string): Promise<void> {
    if (!this.isInTransaction) {
      throw new Error(`advisoryLock('${key}') must be called inside runInTransaction`);
    }
    // hashtextextended gives a stable bigint from an arbitrary key.
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

/**
 * Turn a Prisma constraint violation into a domain error that names the rule the
 * database enforced, rather than leaking the constraint name to a user.
 *
 * The mapping is deliberately explicit: a generic "duplicate key" message is how
 * "Serial number 5CD1234ABC is already registered" becomes "Something went wrong".
 */
export function translatePrismaError(e: unknown): DomainError | undefined {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return undefined;

  const meta = e.meta as
    | { target?: string | string[]; constraint?: string; code?: string; message?: string }
    | undefined;
  const target = String(meta?.constraint ?? meta?.target ?? '');
  const pgCode = String(meta?.code ?? '');
  const pgMessage = String(meta?.message ?? e.message ?? '');
  const constraint = target || pgMessage;

  if (e.code === 'P2002') {
    if (target.includes('uq_unit_active_serial')) {
      return new ConflictError(
        'That serial number is already registered on the platform. A laptop can be listed in exactly one place at a time.',
        { constraint: target },
      );
    }
    if (target.includes('uq_qcrep_current')) {
      return new ConflictError('This unit already has a current inspection report.', {
        constraint: target,
      });
    }
    if (target.includes('seal_code')) {
      return new ConflictError('That seal code has already been used.', { constraint: target });
    }
    if (target.includes('unit_id')) {
      return new ConflictError('That unit is already allocated to another order.', {
        constraint: target,
      });
    }
    return new ConflictError('That value is already in use.', { constraint: target });
  }

  if (e.code === 'P2003') {
    return new ConflictError('That reference points at something that no longer exists.', {
      constraint: target,
    });
  }

  // `$queryRaw` failures arrive as P2010 with the Postgres code in `meta.code`,
  // not as P2002/P2003. Leaving them unmapped is how a missing SKU on listing
  // create became an opaque 500 instead of a field the vendor can fix.
  if (e.code === 'P2010') {
    if (pgCode === '23503' || pgMessage.includes('foreign key')) {
      if (pgMessage.includes('listing_sku_id_fkey')) {
        return new ValidationError('That machine is not in the catalog we carry.', {
          skuId: 'Search again and pick the configuration we hold.',
        });
      }
      if (pgMessage.includes('listing_pickup_location_id_fkey')) {
        return new ConflictError('Choose a pickup address that belongs to your organisation.', {
          constraint,
        });
      }
      return new ConflictError('That reference points at something that no longer exists.', {
        constraint,
      });
    }
    if (pgCode === '23505' || pgMessage.includes('duplicate key')) {
      return new ConflictError('That value is already in use.', { constraint });
    }
    if (pgCode === '23514' || pgCode === '23502' || pgCode === '22P02') {
      return new ValidationError('Some of the details need fixing.', {
        _: 'A value was not in the form we store.',
      });
    }
    return undefined;
  }

  // A CHECK or EXCLUDE violation that the caller already interprets.
  if (e.code === 'P2034') {
    return undefined;
  }

  return undefined;
}

@Global()
@Module({ imports: [ConfigModule], providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
