import { prefillFromVerifiedGst } from './gst-business-prefill';

describe('prefillFromVerifiedGst', () => {
  it('maps the primary verified GSTIN into locked business fields', () => {
    const prefill = prefillFromVerifiedGst({
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
              legalName: 'TRUETECH SERVICES PRIVATE LIMITED',
              tradeName: 'TRUETECH SERVICES PRIVATE LIMITED',
              constitutionType: 'PVT_LTD',
              registrationDate: '2019-01-16',
              vendorCategory: 'TRADER',
              registeredAddress: {
                line1: 'Fourth Floor, 429, JMD Megapolis IT Park',
                line2: 'SOHNA ROAD, Sector 48',
                city: 'Gurugram',
                state: '06',
                pincode: '122018',
              },
            },
          },
        },
      ],
    });

    expect(prefill?.values.legalName).toBe('TRUETECH SERVICES PRIVATE LIMITED');
    expect(prefill?.values.constitution).toBe('PVT_LTD');
    expect(prefill?.values.category).toBe('TRADER');
    expect(prefill?.locked.has('registered')).toBe(true);
  });
});
