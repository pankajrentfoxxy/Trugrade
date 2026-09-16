import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Money } from '@trugrade/contracts';
import {
  CreditLinePort,
  EscrowPort,
  type BeneficiaryRef,
  type CreditApplication,
  type CreditDecision,
  type CreditLimit,
  type CreditReservation,
  type EscrowAccountRef,
  type EscrowEntry,
  type EscrowHoldRef,
  type EscrowTxnRef,
  type FundEscrow,
  type HoldEscrow,
  type OpenEscrowAccount,
} from '../ports';

/**
 * Escrow and credit, before either provider is signed.
 *
 * These are not placeholders to delete. They are the executable description of
 * the contract the real thing must satisfy, and they keep the platform's **own**
 * record of what would be held and what has been reserved — so the screens are
 * honest rather than absent: "No escrow provider is connected. These are the
 * platform's own records of what would be held."
 *
 * The one thing they must never do is imply money moved. Every reference these
 * return is prefixed so it cannot be mistaken for a provider's, and the escrow
 * balance is arithmetic over rows this process wrote.
 */

@Injectable()
export class FakeEscrow extends EscrowPort {
  private readonly accounts = new Map<string, EscrowEntry[]>();
  private readonly holds = new Map<string, { accountRef: string; amount: Money }>();

  async openAccount(input: OpenEscrowAccount): Promise<EscrowAccountRef> {
    const accountRef = `NOPROVIDER-ESC-${input.orgId.slice(0, 8)}`;
    if (!this.accounts.has(accountRef)) this.accounts.set(accountRef, []);
    return { accountRef, provider: 'none' };
  }

  async fund(input: FundEscrow): Promise<EscrowTxnRef> {
    return this.record(input.accountRef, 'FUND', input.amount, input.reference);
  }

  async hold(input: HoldEscrow): Promise<EscrowHoldRef> {
    const holdRef = `NOPROVIDER-HOLD-${randomUUID().slice(0, 8)}`;
    this.holds.set(holdRef, { accountRef: input.accountRef, amount: input.amount });
    await this.record(input.accountRef, 'HOLD', input.amount, input.reference);
    return { holdRef, provider: 'none' };
  }

  async release(holdRef: string, to: BeneficiaryRef, amount: Money): Promise<EscrowTxnRef> {
    const hold = this.holds.get(holdRef);
    return this.record(
      hold?.accountRef ?? 'NOPROVIDER-ESC-unknown',
      'RELEASE',
      amount,
      `to ••••${to.accountNumberLast4}`,
    );
  }

  async refund(holdRef: string, amount: Money, reason: string): Promise<EscrowTxnRef> {
    const hold = this.holds.get(holdRef);
    return this.record(hold?.accountRef ?? 'NOPROVIDER-ESC-unknown', 'REFUND', amount, reason);
  }

  async balance(accountRef: string): Promise<Money> {
    const entries = this.accounts.get(accountRef) ?? [];
    return entries.reduce(
      (sum, e) => (e.kind === 'FUND' ? sum.add(e.amount) : sum.sub(e.amount)),
      Money.ZERO,
    );
  }

  async statement(accountRef: string, from: Date, to: Date): Promise<EscrowEntry[]> {
    return (this.accounts.get(accountRef) ?? []).filter((e) => {
      const at = new Date(e.at).getTime();
      return at >= from.getTime() && at <= to.getTime();
    });
  }

  private async record(
    accountRef: string,
    kind: EscrowEntry['kind'],
    amount: Money,
    narration: string,
  ): Promise<EscrowTxnRef> {
    const entry: EscrowEntry = {
      txnRef: `NOPROVIDER-TXN-${randomUUID().slice(0, 8)}`,
      kind,
      amount,
      at: new Date().toISOString(),
      narration,
    };
    const entries = this.accounts.get(accountRef) ?? [];
    entries.push(entry);
    this.accounts.set(accountRef, entries);
    return { txnRef: entry.txnRef, provider: 'none', at: entry.at };
  }
}

/**
 * Customer credit with no NBFC behind it.
 *
 * `reserve` is the one piece of real behaviour, because it is what stops an
 * order the lender will not fund: it holds against a limit and refuses when the
 * headroom is not there. Everything else answers honestly that nobody has
 * underwritten anything.
 */
@Injectable()
export class FakeCreditLine extends CreditLinePort {
  private readonly limits = new Map<string, Money>();
  private readonly reservations = new Map<string, { orgId: string; amount: Money }>();

  async requestLimit(input: CreditApplication): Promise<CreditDecision> {
    return {
      outcome: 'REFERRED',
      limit: Money.ZERO,
      // The provider's own words, and there is no provider. Saying "approved"
      // here would be the platform underwriting, which is exactly what the port
      // exists to prevent.
      reason: 'No credit provider is connected, so no limit has been underwritten.',
      decisionRef: `NOPROVIDER-APP-${input.orgId.slice(0, 8)}`,
    };
  }

  async currentLimit(orgId: string): Promise<CreditLimit> {
    const limit = this.limits.get(orgId) ?? Money.ZERO;
    const used = [...this.reservations.values()]
      .filter((r) => r.orgId === orgId)
      .reduce((sum, r) => sum.add(r.amount), Money.ZERO);
    return { orgId, limit, available: limit.sub(used), provider: null };
  }

  async reserve(orgId: string, orderId: string, amount: Money): Promise<CreditReservation> {
    const { available } = await this.currentLimit(orgId);
    if (amount.gt(available)) {
      throw new Error(
        `This order needs ${amount.format()} of credit and ${available.format()} is available.`,
      );
    }
    const reservationRef = `NOPROVIDER-RES-${orderId.slice(0, 8)}`;
    this.reservations.set(reservationRef, { orgId, amount });
    return {
      reservationRef,
      amount,
      // A day, from the fake's own clock. The real provider states its own.
      expiresAt: new Date(this.nowMs() + 86_400_000).toISOString(),
    };
  }

  async settle(reservationRef: string): Promise<void> {
    this.reservations.delete(reservationRef);
  }

  async release(reservationRef: string): Promise<void> {
    this.reservations.delete(reservationRef);
  }

  /**
   * The fake's clock. A provider would timestamp this itself; until one does,
   * the wall clock is the honest answer and it is named rather than inlined so
   * the lint rule's point — that time-dependent rules stay testable — is met by
   * a seam rather than by an exemption.
   */
  protected nowMs(): number {
    return new Date().getTime();
  }

  /** Test seam: give an org headroom without an NBFC. */
  grantLimit(orgId: string, limit: Money): void {
    this.limits.set(orgId, limit);
  }
}
