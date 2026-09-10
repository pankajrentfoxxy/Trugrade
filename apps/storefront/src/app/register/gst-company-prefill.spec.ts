import { prefillCompanyFromVerifiedGst } from './gst-company-prefill';

describe('prefillCompanyFromVerifiedGst', () => {
  it('maps the primary verified GSTIN into locked company fields', () => {
    const prefill = prefillCompanyFromVerifiedGst({
      gstins: [
        {
          gstin: '06AAHCT0310N1ZG',
          isPrimary: true,
          confirmed: true,
          outcome: {
            id: '1',
            checkType: 'GSTIN',
            outcome: 'PASS',
            message: 'ok',
            attemptNo: 1,
            attemptsRemaining: 4,
            willRetryAutomatically: false,
            resolved: {
              legalName: 'NIMBUS SOLUTIONS PRIVATE LIMITED',
              tradeName: 'Nimbus Solutions',
              constitutionType: 'PVT_LTD',
              registrationDate: '2019-01-16',
            },
          },
        },
      ],
    });

    expect(prefill?.values.legalName).toBe('NIMBUS SOLUTIONS PRIVATE LIMITED');
    expect(prefill?.values.tradeName).toBe('Nimbus Solutions');
    expect(prefill?.values.constitution).toBe('PVT_LTD');
    expect(prefill?.values.yearEstablished).toBe('2019');
    expect(prefill?.locked.has('constitution')).toBe(true);
  });
});
