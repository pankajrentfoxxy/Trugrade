import { ConflictError } from '../../shared/errors/domain-errors';
import { KycService } from './kyc.service';

/** A service with only the one read `assertProfileEditable` makes. */
const serviceFor = (status: string): KycService => {
  const svc = Object.create(KycService.prototype) as KycService;
  Object.assign(svc, {
    prisma: { db: { organization: { findUnique: () => Promise.resolve({ status }) } } },
  });
  return svc;
};

describe('a submitted profile cannot be changed by the applicant', () => {
  it.each(['REGISTERED', 'INFO_REQUESTED'])('%s is still editable', async (status) => {
    await expect(serviceFor(status).assertProfileEditable('o1')).resolves.toBeUndefined();
  });

  it.each(['KYC_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'])(
    '%s refuses the change with a sentence, not a bare 409',
    async (status) => {
      const refusal = serviceFor(status).assertProfileEditable('o1');
      await expect(refusal).rejects.toBeInstanceOf(ConflictError);
      await expect(refusal).rejects.toThrow(/cannot be changed|locked/);
    },
  );
});
