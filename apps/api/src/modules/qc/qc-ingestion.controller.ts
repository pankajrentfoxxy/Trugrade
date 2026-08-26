import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  IngestionService,
  ingestToolRunSchema,
  type IngestToolRunDto,
  type IngestionResult,
} from './internal/ingestion.service';

/**
 * `POST /qc/tool-runs` — the one door a certificate comes through.
 *
 * Two callers, one endpoint: DeviceSure's `qc.session.certified` webhook
 * (07 §5.3) and the technician app replaying its offline queue. They are the
 * same request, and giving them separate routes would mean two idempotency
 * stories where the whole design has exactly one.
 *
 * **Why 200 and never 201.** The same run submitted twice must be one row and a
 * 200 (QC-001). A 201-then-200 split would make the status code carry the
 * idempotency answer, so every client would have to branch on it — and a webhook
 * sender that retries on anything but 2xx would then treat our correct answer as
 * a failure. The body says what happened: `alreadyIngested` is the flag, and it
 * is honest on the first call too.
 *
 * **Authentication is `qc.report.ingest`, and the signature is the real
 * control.** The permission decides who may knock; the Ed25519 signature over
 * `signablePayload()` decides whether we believe what they said. That ordering
 * matters because the sender is, by design, a party with a financial interest in
 * the grade — a vendor running the agent under our licence. A bearer token
 * proves DeviceSure's service account called us; only the signature proves
 * DeviceSure's server produced the certificate.
 *
 * Nothing is refused with a 4xx that we could instead record. A rejected
 * certificate, a serial mismatch and a parse failure all come back 200 with the
 * raw payload already stored, because each of them is a finding somebody has to
 * act on rather than a malformed request to bounce. The 4xx cases are the ones
 * where we genuinely cannot file the thing: an unaddressable unit (422), a
 * replayed nonce (409), a tool provider we do not have configured (412).
 */
@Controller('qc')
export class QcIngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('tool-runs')
  @HttpCode(200)
  @RequirePermissions('qc.report.ingest')
  ingest(
    @Body(new ZodValidationPipe(ingestToolRunSchema)) body: IngestToolRunDto,
  ): Promise<IngestionResult> {
    return this.ingestion.ingest(body);
  }
}
