-- Stage 9: the inspection outcome, and the two things it could not record.
--
-- The listing → inspection → live chain is otherwise built: the visit is raised
-- inside the submit transaction, the technician is assigned through
-- SchedulingService's six checks, and VisitClosingService moves a passed and
-- sealed unit QC_SEALED → LISTED and republishes its listing ACTIVE /
-- PARTIALLY_ACTIVE / PAUSED. What was missing is the evidence and the escalation.

/*
 * An ops task about a machine.
 *
 * `ordering.ops_task` can point at an order, a purchase order or a shipment,
 * because every task raised so far has been about one of those. A grade
 * mismatch is about a UNIT and the LISTING it sits in, and pushing those into
 * `detail` as loose json would make the one query ops actually runs — "show me
 * the open tasks on this listing" — a jsonb scan rather than an index lookup.
 *
 * FKs, unlike `shipment_id` above them: `ordering.order_line` already references
 * `listing.listing`, so this direction is established and a task about a listing
 * that no longer exists is a task nobody can act on.
 */
ALTER TABLE ordering.ops_task
  ADD COLUMN listing_id uuid NULL REFERENCES listing.listing(id) ON DELETE CASCADE,
  ADD COLUMN unit_id    uuid NULL REFERENCES listing.unit(id) ON DELETE CASCADE;

CREATE INDEX ix_ops_task_listing ON ordering.ops_task (listing_id)
  WHERE listing_id IS NOT NULL AND status = 'OPEN';

COMMENT ON COLUMN ordering.ops_task.listing_id IS
  'The listing a QC task is about. GRADE_MISMATCH and QC_BATCH_FAILED carry it.';

/*
 * One open task per kind per unit.
 *
 * A re-inspection that mismatches a second time must not stack a second
 * GRADE_MISMATCH beside the first: the queue is worked by people, and two rows
 * for one machine is two people picking up the same job. A re-raise finds the
 * open one instead.
 */
CREATE UNIQUE INDEX uq_ops_task_open_unit ON ordering.ops_task (kind, unit_id)
  WHERE unit_id IS NOT NULL AND status = 'OPEN';

/*
 * The report PDF, and why it was never written.
 *
 * `qc_report.report_pdf_key` has existed since the baseline and is read in eight
 * places — the repository maps it, the vendor's documents screen offers it, the
 * buyer's passport links it. **Nothing has ever written it.** On the live
 * database that is 239 reports and zero PDFs: every one of those screens has
 * been offering a document that does not exist.
 *
 * It is written at certification now, in the same transaction as the verdict.
 * The comment is here rather than in the service because the column is the thing
 * that lied, and the next person to read this schema should find out here.
 */
COMMENT ON COLUMN qc.qc_report.report_pdf_key IS
  'Object key of the rendered report. Written by VerdictService at certification, in the verdict transaction. NULL means the report predates Stage 9 or the render failed — never that the report is invalid.';
