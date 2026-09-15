import { describe, it, expect } from 'vitest';
import {
  PROFILE_SECTIONS,
  bankSummary,
  nextIncompleteSection,
  profileCompletionPct,
  sectionIsDone,
} from './sections.config';

describe('profile sections config', () => {
  it('weights required sections to 100%', () => {
    const required = PROFILE_SECTIONS.filter((s) => s.required);
    expect(required.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });

  it('returns the next incomplete required section in order', () => {
    const onboarding = {
      answers: { DOCUMENTS_BANK: { bankCommitted: true } },
      payoutAccount: {
        last4: '7455',
        bankName: 'HDFC Bank',
        ifsc: 'HDFC0000489',
        pennyDropStatus: 'SUCCESS',
        frozenUntil: null,
      },
      progress: {
        steps: [
          { stepCode: 'BUSINESS_PROFILE', status: 'COMPLETE' },
          { stepCode: 'STATUTORY', status: 'COMPLETE' },
          { stepCode: 'FACILITY_CONTACTS', status: 'COMPLETE' },
          { stepCode: 'DOCUMENTS_BANK', status: 'NOT_STARTED' },
          { stepCode: 'AGREEMENT', status: 'NOT_STARTED' },
        ],
      },
    } as never;
    const bank = PROFILE_SECTIONS.find((s) => s.id === 'bank')!;
    expect(sectionIsDone(bank, onboarding)).toBe(true);
    expect(nextIncompleteSection('bank', onboarding)?.id).toBe('documents');
  });

  it('never calls the bank card done or verified without a verified account on file', () => {
    const bank = PROFILE_SECTIONS.find((s) => s.id === 'bank')!;
    // A stale draft flag and a COMPLETE step, but no account: exactly the state
    // saving the documents card used to leave behind.
    const noAccount = {
      answers: { DOCUMENTS_BANK: { bankCommitted: true } },
      payoutAccount: null,
      progress: { steps: [{ stepCode: 'DOCUMENTS_BANK', status: 'COMPLETE' }] },
    } as never;
    expect(sectionIsDone(bank, noAccount)).toBe(false);
    expect(bankSummary(null)).toBe('Account number not added yet');
    expect(
      bankSummary({
        last4: '7455',
        bankName: null,
        ifsc: 'HDFC0000489',
        pennyDropStatus: 'PENDING',
        frozenUntil: null,
      }),
    ).toBe('••••7455 — verification pending');
  });

  it('computes completion from section weights', () => {
    const onboarding = {
      answers: {},
      progress: {
        steps: [
          { stepCode: 'BUSINESS_PROFILE', status: 'COMPLETE' },
          { stepCode: 'STATUTORY', status: 'COMPLETE' },
        ],
      },
    } as never;
    expect(profileCompletionPct(onboarding)).toBe(20);
  });

  it('has a card for every step the server requires of a vendor, and no optional card', () => {
    // The server's onboarding_step_definition rows for VENDOR. A required step
    // with no card here is how a supplier reached "100%" and could not submit.
    const serverRequired = [
      'ACCOUNT',
      'STATUTORY',
      'BUSINESS_PROFILE',
      'CAPABILITY',
      'FACILITY_CONTACTS',
      'DOCUMENTS_BANK',
      'AGREEMENT',
    ];
    const covered = new Set(PROFILE_SECTIONS.filter((s) => s.required).flatMap((s) => s.stepCodes));
    for (const code of serverRequired) expect(covered.has(code)).toBe(true);
    expect(PROFILE_SECTIONS.every((s) => s.required)).toBe(true);
  });
});
