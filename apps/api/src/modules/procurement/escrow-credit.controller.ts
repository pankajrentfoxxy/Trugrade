import { Controller, Get } from '@nestjs/common';
import { money } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';

/**
 * Escrow and credit, reported honestly.
 *
 * Neither has a provider. **A screen that renders "₹0 held" without saying so is
 * making a claim we cannot support** — a finance user reads it as "the provider
 * is holding nothing today" when the truth is that nobody is holding anything
 * because nobody has signed. So both endpoints report `connected: false` as a
 * first-class field, and the figures beside it are labelled as what *would* be
 * held, computed from our own rows.
 *
 * The alternative considered and rejected: return 404 until a provider exists.
 * That hides the fact that the capability is built and waiting, and it gives
 * finance no way to see the exposure they are carrying in the meantime.
 */
@Controller('finance')
export class EscrowCreditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('escrow')
  @RequirePermissions('finance.escrow.read')
  async escrow(): Promise<{
    provider: string | null;
    connected: boolean;
    held: string;
    released: string;
    accounts: number;
  }> {
    // What a provider would be holding: everything accrued and not yet paid.
    const [rows] = await this.prisma.$queryRaw<
      Array<{ held: string; released: string; vendors: bigint }>
    >`
      SELECT coalesce(sum(net_payable) FILTER (WHERE status::text <> 'PAID'), 0)::text AS held,
             coalesce(sum(net_payable) FILTER (WHERE status::text = 'PAID'), 0)::text AS released,
             count(DISTINCT vendor_org_id)::bigint AS vendors
        FROM procurement.vendor_payable`;

    return {
      provider: null,
      connected: false,
      held: money(rows?.held ?? '0').toString(),
      released: money(rows?.released ?? '0').toString(),
      accounts: Number(rows?.vendors ?? 0),
    };
  }

  @Get('credit')
  @RequirePermissions('credit.limit.read')
  async credit(): Promise<{
    provider: string | null;
    connected: boolean;
    buyersOnTerms: number;
    exposure: string;
  }> {
    const [rows] = await this.prisma.$queryRaw<Array<{ buyers: bigint; exposure: string }>>`
      SELECT count(DISTINCT buyer_org_id)::bigint AS buyers,
             coalesce(sum(grand_total), 0)::text AS exposure
        FROM ordering."order"
       WHERE status::text NOT IN ('CANCELLED', 'REFUNDED')`;

    return {
      provider: null,
      connected: false,
      buyersOnTerms: Number(rows?.buyers ?? 0),
      exposure: money(rows?.exposure ?? '0').toString(),
    };
  }
}
