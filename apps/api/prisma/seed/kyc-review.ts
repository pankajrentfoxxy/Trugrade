import type { PrismaClient } from '@prisma/client';

/**
 * Applications in the states a reviewer actually meets.
 *
 * Before this ran, every row in the review queue was residue from driving the
 * registration flow by hand: fourteen applications sharing two legal names, all
 * of them past their promise, none of them ever decided. Three consequences,
 * and each is a screen branch that had never once rendered:
 *
 *   - **No application was inside its SLA**, so "8 h left" and "within the
 *     promise" existed only in the source.
 *   - **No verification check had come back MISMATCH or FAIL**, so the one
 *     distinction this screen exists to draw — a provider that did not answer
 *     versus an applicant whose GSTIN does not match their PAN — could be
 *     photographed on one side only.
 *   - **No document had ever been rejected**, so the sentence the applicant
 *     reads had never been read by anybody.
 *
 * T21 and T30 hit the same shape and the fix is theirs: give the seed the
 * spread, rather than move a row to take a screenshot.
 *
 * Four rules govern what is written below.
 *
 * **1. Every instant comes from the caller's clock.** `now` is passed in, the
 * way `seedAfterSale` and `seedQcVisits` take it, and `Date.now()` appears
 * nowhere. A seed stamping wall-clock time while a service measures with
 * `ClockPort` puts a fixed-clock test's window somewhere the seed never
 * intended, and it reads as a logic bug in the service.
 *
 * **2. The SLA is derived, never typed.** `review_sla_due_at` is written as
 * `submitted_for_review_at + the promise for that org type` — 48 hours for a
 * vendor, 24 for a buyer, matching `REVIEW_SLA_HOURS` in `kyc.service.ts`. A
 * seed that types a due date produces a row whose overdue chip disagrees with
 * its own submission time, which is indistinguishable on screen from a clock
 * bug.
 *
 * **3. A provider error is not a failure, in the data as well as on the
 * screen.** The Kestrel application below carries a `PROVIDER_ERROR` on its
 * penny-drop *and* a later `PASS` on the retry, because that is what actually
 * happens: the retry is automatic and consumes no attempt, so `attempt_no`
 * does not advance across it. A seed that advanced it would quietly teach the
 * screen the opposite of the rule it is there to enforce.
 *
 * **4. Nothing here is a verdict on a person that we have not reached.** One
 * application is genuinely rejected, with the reviewer's own sentence on the
 * `kyc_review` row, because that state has to render. The rest are pending, and
 * pending is not amber-because-worrying.
 *
 * Idempotent by legal name: it returns early if the applications are present.
 */

interface Seeded {
  applications: number;
  documents: number;
  checks: number;
}

/** 48 working hours for a vendor, 24 for a buyer. Mirrors `REVIEW_SLA_HOURS`. */
const SLA_HOURS: Record<string, number> = { VENDOR: 48, BUYER: 24 };

const HOUR = 3_600_000;

/**
 * The five applications, and what each one exists to render.
 *
 * `submittedHoursAgo` is measured back from the caller's clock, so the spread
 * holds whenever the seed is run rather than only on the day it was written.
 */
const APPLICATIONS = [
  {
    legalName: 'Vasant Kunj Device Works Pvt. Ltd.',
    tradeName: 'Vasant Kunj Device Works',
    orgType: 'VENDOR',
    constitution: 'PVT_LTD',
    /** Comfortably inside the 48-hour promise: the state nothing could show. */
    submittedHoursAgo: 5,
    status: 'KYC_SUBMITTED',
  },
  {
    legalName: 'Kestrel Endpoint Recovery LLP',
    tradeName: 'Kestrel Endpoint Recovery',
    orgType: 'VENDOR',
    constitution: 'LLP',
    /** Six hours left — the warn band, and still nobody's fault. */
    submittedHoursAgo: 42,
    status: 'KYC_SUBMITTED',
  },
  {
    legalName: 'Ambattur Recommerce Pvt. Ltd.',
    tradeName: 'Ambattur Recommerce',
    orgType: 'VENDOR',
    constitution: 'PVT_LTD',
    /** Thirty hours past OUR promise. A breach we caused, not a verdict on them. */
    submittedHoursAgo: 78,
    status: 'KYC_SUBMITTED',
  },
  {
    legalName: 'Whitefield Procurement Services Pvt. Ltd.',
    tradeName: 'Whitefield Procurement',
    orgType: 'BUYER',
    constitution: 'PVT_LTD',
    /** A buyer: 24 hours, not 48. The board used to state 48 over this row. */
    submittedHoursAgo: 9,
    status: 'INFO_REQUESTED',
  },
  {
    legalName: 'Chembur Trade Links',
    tradeName: 'Chembur Trade Links',
    orgType: 'BUYER',
    constitution: 'PARTNERSHIP',
    /** Decided, and the only application here that is genuinely a refusal. */
    submittedHoursAgo: 60,
    status: 'REJECTED',
  },
] as const;

type ApplicationSpec = (typeof APPLICATIONS)[number];

/**
 * The checks each application carries.
 *
 * Keyed by legal name so the intent of a row is legible beside the org it
 * belongs to. `status` is the durable outcome; `failureReason` is the sentence
 * the reviewer reads and is present on everything that is not a PASS —
 * including the provider errors, where it names our provider rather than
 * anything the applicant did.
 */
const CHECKS: Record<
  string,
  ReadonlyArray<{
    checkType: string;
    status: string;
    masked: string;
    provider: string;
    hoursAgo: number;
    attemptNo: number;
    matchScore?: number;
    failureReason?: string;
  }>
> = {
  'Vasant Kunj Device Works Pvt. Ltd.': [
    { checkType: 'GSTIN', status: 'PASS', masked: '07AA****23C1Z5', provider: 'mock', hoursAgo: 5, attemptNo: 1 },
    { checkType: 'PAN', status: 'PASS', masked: 'AAAC****23C', provider: 'mock', hoursAgo: 5, attemptNo: 1 },
    {
      checkType: 'BANK_PENNY_DROP',
      status: 'PASS',
      masked: '5010****012',
      provider: 'mock',
      hoursAgo: 5,
      attemptNo: 1,
      matchScore: 1,
    },
  ],
  // The whole point of the screen, on one application: the portal did not
  // answer twice, then answered. Two PROVIDER_ERRORs and a PASS, all at
  // attempt 1, because an automatic retry consumes nothing.
  'Kestrel Endpoint Recovery LLP': [
    { checkType: 'GSTIN', status: 'PASS', masked: '29BB****41D1Z9', provider: 'mock', hoursAgo: 42, attemptNo: 1 },
    {
      checkType: 'BANK_PENNY_DROP',
      status: 'PROVIDER_ERROR',
      masked: '9110****778',
      provider: 'mock',
      hoursAgo: 42,
      attemptNo: 1,
      failureReason: 'The bank verification service did not respond within 30 seconds.',
    },
    {
      checkType: 'BANK_PENNY_DROP',
      status: 'PROVIDER_ERROR',
      masked: '9110****778',
      provider: 'mock',
      hoursAgo: 41,
      attemptNo: 1,
      failureReason: 'The bank verification service returned HTTP 503.',
    },
    {
      checkType: 'BANK_PENNY_DROP',
      status: 'PASS',
      masked: '9110****778',
      provider: 'mock',
      hoursAgo: 40,
      attemptNo: 1,
      matchScore: 0.97,
    },
  ],
  // A real mismatch and a real failure, so the screen can be photographed
  // saying so — and so the difference from the row above is visible on one
  // screen rather than described in a comment.
  'Ambattur Recommerce Pvt. Ltd.': [
    {
      checkType: 'GSTIN',
      status: 'MISMATCH',
      masked: '33CC****88E1ZQ',
      provider: 'mock',
      hoursAgo: 78,
      attemptNo: 1,
      matchScore: 0.42,
      failureReason:
        'The GST portal returned "Ambattur Recommerce Private Limited"; the application was submitted as "Ambattur Recommerce Pvt Ltd".',
    },
    {
      checkType: 'BANK_PENNY_DROP',
      status: 'FAIL',
      masked: '6620****431',
      provider: 'mock',
      hoursAgo: 77,
      attemptNo: 2,
      matchScore: 0.11,
      failureReason:
        'The account is held by "A R Enterprises", which does not match the registered business name.',
    },
  ],
  'Whitefield Procurement Services Pvt. Ltd.': [
    { checkType: 'GSTIN', status: 'PASS', masked: '29DD****17F1Z2', provider: 'mock', hoursAgo: 9, attemptNo: 1 },
    {
      checkType: 'PAN',
      status: 'PASS',
      masked: 'DDDE****17F',
      provider: 'mock',
      hoursAgo: 9,
      attemptNo: 1,
    },
  ],
  'Chembur Trade Links': [
    {
      checkType: 'GSTIN',
      status: 'FAIL',
      masked: '27EE****90G1ZJ',
      provider: 'mock',
      hoursAgo: 60,
      attemptNo: 3,
      failureReason: 'The GST portal reports this registration as CANCELLED since 12 Mar 2026.',
    },
  ],
};

/**
 * The documents each application carries, and the state each is in.
 *
 * `rejectionReason` is written the way `DocumentService.review` writes it — the
 * controlled sentence, then the reviewer's specific — because the applicant's
 * own screen renders it verbatim and a seed that writes half of it produces a
 * message no reviewer could have sent.
 */
const DOCUMENTS: Record<
  string,
  ReadonlyArray<{
    docType: string;
    status: string;
    filename: string;
    /** How old the document itself is, in days. Drives the age rules. */
    documentAgeDays?: number;
    rejectionReason?: string;
    reviewNote?: string;
    /** Left absent on one document on purpose: "not scanned" has to render. */
    avVerdict?: string;
  }>
> = {
  'Vasant Kunj Device Works Pvt. Ltd.': [
    { docType: 'GST_CERTIFICATE', status: 'UPLOADED', filename: 'gst-certificate.pdf', avVerdict: 'CLEAN' },
    { docType: 'PAN_CARD', status: 'UPLOADED', filename: 'pan.pdf', avVerdict: 'CLEAN' },
    // No `avVerdict`: the scanner has never run on this one, and "not scanned"
    // must not render as a tick.
    { docType: 'ADDRESS_PROOF', status: 'UPLOADED', filename: 'electricity-bill.pdf', documentAgeDays: 20 },
  ],
  'Kestrel Endpoint Recovery LLP': [
    { docType: 'GST_CERTIFICATE', status: 'VERIFIED', filename: 'gst.pdf', avVerdict: 'CLEAN' },
    { docType: 'CANCELLED_CHEQUE', status: 'VERIFIED', filename: 'cheque.jpg', avVerdict: 'CLEAN' },
    { docType: 'SIGNATORY_ID', status: 'UPLOADED', filename: 'partner-aadhaar.pdf', avVerdict: 'CLEAN' },
  ],
  'Ambattur Recommerce Pvt. Ltd.': [
    { docType: 'GST_CERTIFICATE', status: 'UPLOADED', filename: 'gst-scan.pdf', avVerdict: 'CLEAN' },
    {
      docType: 'ADDRESS_PROOF',
      status: 'REJECTED',
      filename: 'electricity-bill-jan.pdf',
      documentAgeDays: 220,
      reviewNote: 'TOO_OLD',
      rejectionReason:
        'This document is older than we can accept. Your electricity bill is dated January 2026; we need one issued in the last three months.',
      avVerdict: 'CLEAN',
    },
    {
      docType: 'INCORPORATION',
      status: 'REJECTED',
      filename: 'coi-page1.jpg',
      reviewNote: 'INCOMPLETE',
      rejectionReason:
        'Part of this document is missing or cut off. Only page 1 of the certificate came through — please send all four pages.',
      avVerdict: 'CLEAN',
    },
  ],
  'Whitefield Procurement Services Pvt. Ltd.': [
    { docType: 'GST_CERTIFICATE', status: 'VERIFIED', filename: 'gst.pdf', avVerdict: 'CLEAN' },
    { docType: 'PO_TEMPLATE', status: 'UPLOADED', filename: 'po-template.pdf', avVerdict: 'CLEAN' },
  ],
  'Chembur Trade Links': [
    { docType: 'PAN_CARD', status: 'UPLOADED', filename: 'firm-pan.pdf', avVerdict: 'CLEAN' },
  ],
};

/** The reviewer's own sentence on the one application that was refused. */
const REJECTION_NOTE =
  'Your GST registration 27EE****90G1ZJ is shown as cancelled on the GST portal since 12 March 2026. ' +
  'We can only onboard a business with an active registration. If this is a portal error, send us the ' +
  'GST REG-21 acknowledgement and we will reopen the application.';

export async function seedKycReview(
  prisma: PrismaClient,
  now: Date,
  log: (msg: string) => void = () => undefined,
): Promise<Seeded> {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE legal_name = ${APPLICATIONS[0].legalName}`;
  if (existing.length > 0) {
    log('  KYC review spread already present — skipping.');
    return { applications: 0, documents: 0, checks: 0 };
  }

  // The reviewer whose name goes on the one decision below. `kyc_review`
  // requires a real user, and the demo seed's KYC_REVIEWER is the person who
  // would actually have made it.
  const [reviewer] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.user_account WHERE email = 'kyc@trugrade.in' LIMIT 1`;

  let documents = 0;
  let checks = 0;

  for (const app of APPLICATIONS as readonly ApplicationSpec[]) {
    const submittedAt = new Date(now.getTime() - app.submittedHoursAgo * HOUR);
    const slaHours = SLA_HOURS[app.orgType] ?? 24;
    const slaDueAt = new Date(submittedAt.getTime() + slaHours * HOUR);

    const [org] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO identity.organization
        (org_type, legal_name, trade_name, constitution, status,
         submitted_for_review_at, review_sla_due_at, created_at)
      VALUES
        (${app.orgType}::org_type, ${app.legalName}, ${app.tradeName},
         ${app.constitution}::constitution_type, ${app.status}::org_status,
         ${submittedAt}, ${slaDueAt}, ${submittedAt})
      RETURNING id`;
    if (!org) continue;

    for (const c of CHECKS[app.legalName] ?? []) {
      await prisma.$executeRaw`
        INSERT INTO kyc.verification_check
          (org_id, check_type, input_value_masked, input_hash, provider, status,
           match_score, failure_reason, attempt_no, checked_at, cost_paise, latency_ms)
        VALUES
          (${org.id}::uuid, ${c.checkType}, ${c.masked},
           encode(sha256((${c.masked} || ${c.checkType})::bytea), 'hex'),
           ${c.provider}, ${c.status}, ${c.matchScore ?? null}, ${c.failureReason ?? null},
           ${c.attemptNo}, ${new Date(now.getTime() - c.hoursAgo * HOUR)}, 200,
           ${c.status === 'PROVIDER_ERROR' ? 30_000 : 420})`;
      checks += 1;
    }

    for (const d of DOCUMENTS[app.legalName] ?? []) {
      const documentDate =
        d.documentAgeDays === undefined
          ? null
          : new Date(now.getTime() - d.documentAgeDays * 24 * HOUR).toISOString().slice(0, 10);
      await prisma.$executeRaw`
        INSERT INTO kyc.kyc_document
          (org_id, doc_type, file_key, file_hash_sha256, mime, size_bytes, status,
           original_filename, document_date, av_verdict, av_scanned_at,
           exif_stripped_at, rejection_reason, review_note, reviewed_by, created_at)
        VALUES
          (${org.id}::uuid, ${d.docType},
           ${`kyc/${org.id}/${d.docType.toLowerCase()}`},
           encode(sha256((${org.id} || ${d.docType})::bytea), 'hex'),
           ${d.filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'},
           ${240_000 + d.filename.length * 1000}, ${d.status}::doc_status,
           ${d.filename}, ${documentDate}::date, ${d.avVerdict ?? null},
           ${d.avVerdict === undefined ? null : submittedAt},
           ${d.filename.endsWith('.pdf') ? null : submittedAt},
           ${d.rejectionReason ?? null}, ${d.reviewNote ?? null},
           ${d.status === 'REJECTED' ? (reviewer?.id ?? null) : null}::uuid,
           ${submittedAt})`;
      documents += 1;
    }

    if (app.status === 'REJECTED' && reviewer) {
      await prisma.$executeRaw`
        INSERT INTO kyc.kyc_review (org_id, reviewer_id, decision, reason_codes, notes, decided_at)
        VALUES (${org.id}::uuid, ${reviewer.id}::uuid, 'REJECT', ARRAY['GSTIN_CANCELLED'],
                ${REJECTION_NOTE}, ${new Date(now.getTime() - 4 * HOUR)})`;
    }
  }

  log(
    `  ${APPLICATIONS.length} applications, ${documents} documents, ${checks} verification checks.`,
  );
  return { applications: APPLICATIONS.length, documents, checks };
}
