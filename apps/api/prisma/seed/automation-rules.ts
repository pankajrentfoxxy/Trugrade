import type { PrismaClient } from '@prisma/client';

/**
 * The twelve automation rules.
 *
 * Also inserted by `20260916030000_automation_engine`, which is where a real
 * database gets them. This copy exists for the test harness: `automation_rule`
 * has a foreign key into `identity.user_account` (`updated_by`), so TRUNCATE
 * ... CASCADE on the user table takes the rules with it however carefully the
 * exclusion list names them — the same trap `test/support/db.ts` documents for
 * `platform_config`.
 */
export async function seedAutomationRules(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO platform.automation_rule
      (id, name, trigger_event, condition_note, action_note, failure_note, mode) VALUES
    ('R1', 'Raise purchase orders on a confirmed order', 'order.confirmed',
       'Payment captured, or credit reserved',
       'One purchase order per supply point, sent to the vendor hub',
       'Ops task raised and the order is held at Placed', 'AUTO'),
      ('R2', 'Book a carrier when a PO is packed', 'po.dispatch_ready',
       'Lane is serviceable and a rate card matches',
       'Shipment, AWB, pickup task and delivery task',
       'Ops task BOOKING_FAILED, blocker; the PO stays on the dispatch board', 'AUTO'),
      ('R3', 'Assign an in-house rider to a pickup', 'pickup.created',
       'Carrier is in-house and a rider is on shift in the zone',
       'Rider assigned and the manifest pushed to their app',
       'The pickup stays unassigned on the board for a human', 'AUTO'),
      ('R4', 'Close a delivery on the carrier webhook', 'carrier.webhook',
       'Signature verified and the raw status maps to DELIVERED',
       'Shipment, order and delivery task all marked delivered',
       'The raw event is stored and no status changes', 'AUTO'),
      ('R5', 'Open the return window at delivery', 'shipment.delivered',
       'Always',
       'vendor_payable.eligible_at is set to delivery plus 168 hours',
       'Nothing to fail: the timestamp is derived from the delivery', 'AUTO'),
      ('R6', 'Sweep eligible payables into a payout run', 'clock.hourly',
       'eligible_at has passed, not on hold, and the PO is received',
       'The payable joins the next payout run',
       'The payable waits for the next sweep and says why on the board', 'AUTO'),
      ('R7', 'Raise an NDR task on a failed delivery', 'carrier.webhook',
       'The raw status maps to FAILED',
       'Ops task carrying only the actions this carrier will accept',
       'The attempt is recorded even when the action list cannot be read', 'AUTO'),
      ('R8', 'Quarantine a consignment with a broken seal', 'pickup.completed',
       'Any expected seal was scanned broken',
       'Units quarantined, payable put ON_HOLD, blocker raised',
       'The pickup cannot complete, so nothing moves', 'AUTO'),
      ('R9', 'Schedule a QC visit for a submitted listing', 'listing.submitted',
       'A licensed technician has capacity in the zone',
       'The visit is scheduled at the next free slot',
       'The visit stays unscheduled for a human to place', 'SUGGEST'),
      ('R10', 'Instruct escrow on an approved payout', 'payout.approved',
       'The maker and the checker are different people',
       'Escrow instructed and the ledger batch posted',
       'Refused at the database constraint before anything moves', 'AUTO'),
      ('R11', 'Retry a failed e-invoice', 'einvoice.failed',
       'The failure is transient rather than a dead GSTIN',
       'Retried with backoff, five attempts',
       'A tax task is raised after the fifth attempt', 'AUTO'),
      ('R12', 'Route a high-exposure order to approval', 'order.placed',
       'The reservation takes credit utilisation past 90%',
       'The order goes to approval and finance is notified',
       'Nothing to fail: the order is held rather than confirmed', 'AUTO')
    ON CONFLICT (id) DO NOTHING`);
}
