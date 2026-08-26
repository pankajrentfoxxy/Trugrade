-- DeviceSure as a QC tool provider (Phase 4 Task 2, 07_DEVICESURE_INTEGRATION.md §5.4).
--
-- Seeded here rather than in the seed script because that is where the other
-- three providers live, and because the point of field_map_json is that ops
-- edits it in place when DeviceSure's payload moves: "Change field_map_json and
-- the parser, never the tool." The migration supplies the starting value; every
-- change after that is a data operation, not a release.

-- 07 §5.4 asks for integration_type = 'API' + 'WEBHOOK', which this column cannot
-- hold: it is a single TEXT with a CHECK over four values. Rather than widen it
-- for one row, the value records how the *report arrives*, which is what the
-- column means for the other three providers too -- and DeviceSure's report
-- arrives by webhook (qc.session.certified -> POST /qc/tool-runs). The outbound
-- POST /api/v1/qc/sessions call is us pushing a declaration to them, which is a
-- different direction and not what this column describes.
INSERT INTO qc.qc_tool_provider
  (code, name, vendor_company, integration_type, report_format, field_map_json,
   supports_wipe, wipe_standard, cost_per_scan_paise, is_active) VALUES
  ('DEVICESURE','DeviceSure Certified Inspection','DeviceSure','WEBHOOK','JSON',
   -- Our field first, their path second: the convention PHONECHECK, BLANCCO and
   -- TT_AGENT already use. Written the other way round it parses to garbage the
   -- first time the generic parser is reused across providers.
   '{"tool_run_id":"certificate.id",
     "raw_report_hash":"certificate.sha256",
     "signature":"certificate.signature",
     "nonce":"session.nonce",
     "valid_until":"certificate.validUntil",
     "rules_version":"session.rulesVersion",
     "serial":"device.serial",
     "device_fingerprint":"device.fingerprint",
     "qc_score":"score",
     "grade_proposed":"grade",
     "area_results":"testResults",
     "hardware":"hardware",
     "battery_health_pct":"battery.healthPct",
     "cycle_count":"battery.cycleCount",
     "seal_code":"seal.code",
     "photos":"photos",
     "wipe":"wipe"}',
   TRUE,'NIST_800_88_PURGE', 0, TRUE)
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN qc.qc_tool_provider.integration_type IS
  'How a report REACHES us: API (we poll), WEBHOOK (they push), FILE_IMPORT, MANUAL_ENTRY. Not a description of every call in the integration -- DeviceSure is WEBHOOK inbound while we also call its outbound session API to push declared_spec.';

COMMENT ON COLUMN qc.qc_tool_provider.field_map_json IS
  'Our field name -> the provider payload path. This direction is load-bearing and matches all seeded providers. Edited in place when a provider payload changes; that is a data operation, never a code release.';

-- licence_seats is a hard cap on concurrent technicians (Phase 4 Task 5), and
-- for DeviceSure it is also the vendor's maxAgents under the licence we issue.
-- Left NULL because the real number comes with the commercial agreement; the
-- scheduler must treat NULL as "no cap recorded" and not as zero.
COMMENT ON COLUMN qc.qc_tool_provider.licence_seats IS
  'Hard cap on concurrent technicians for this tool. NULL means no cap has been recorded -- the scheduler must not read that as zero and refuse to schedule anyone.';
