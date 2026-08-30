-- A unit whose current QC report is not a clean pass must carry no pass stamp.
--
-- `listing.unit_is_sellable(status, qc_passed_at, qc_valid_until, seal_status)`
-- never sees the verdict. That is deliberate and fine, because the pass stamp is
-- supposed to BE the verdict's shadow on the unit: `verdict.service.ts` nulls
-- `qc_passed_at` and `qc_valid_until` on anything short of a clean pass, which is
-- what makes a machine that was live yesterday and failed today leave the
-- storefront in that same statement.
--
-- The invariant held in the application and was broken by a seed, which set a
-- report to FAIL without clearing the unit. Evaluating the function over those
-- rows with status LISTED returned TRUE for both the FAIL and the MISMATCH — a
-- failed laptop the view calls sellable. It stayed off the storefront only
-- because those verdicts happened to land on allocated units.
--
-- So this names the contradiction rather than trusting every future writer to
-- remember it. A view and not a trigger: the check spans listing and qc, the
-- correct writer is `verdict.service`, and a cross-schema trigger on the hot
-- path of every unit update buys less than it costs. `qc_expiry.spec` and the
-- seed assert this is empty, which is where a violation surfaces.
CREATE OR REPLACE VIEW listing.v_unit_contradicting_its_qc AS
  SELECT u.id            AS unit_id,
         u.serial_number,
         u.status,
         r.verdict,
         u.qc_passed_at,
         u.qc_valid_until,
         listing.unit_is_sellable(u.status, u.qc_passed_at, u.qc_valid_until, s.status)
           AS sellable_now,
         listing.unit_is_sellable('LISTED'::public.unit_status, u.qc_passed_at,
                                  u.qc_valid_until, s.status)
           AS sellable_if_listed
    FROM listing.unit u
    JOIN qc.qc_report r ON r.unit_id = u.id AND r.is_current
    LEFT JOIN qc.qc_seal s ON s.unit_id = u.id
   WHERE r.verdict NOT IN ('PASS'::public.qc_verdict, 'PASS_WITH_NOTE'::public.qc_verdict)
     AND u.qc_passed_at IS NOT NULL;

COMMENT ON VIEW listing.v_unit_contradicting_its_qc IS
  'Units carrying a QC pass stamp their current report contradicts. Must always be empty: unit_is_sellable cannot see the verdict, so a row here is a failed machine one status change away from the storefront.';
