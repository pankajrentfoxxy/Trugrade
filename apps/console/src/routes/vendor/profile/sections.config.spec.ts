import { describe, it, expect } from 'vitest';
import {
  PROFILE_SECTIONS,
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
    expect(sectionIsDone(PROFILE_SECTIONS[2]!, onboarding)).toBe(true);
    expect(nextIncompleteSection('bank', onboarding)?.id).toBe('documents');
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
    expect(profileCompletionPct(onboarding)).toBe(25);
  });
});
