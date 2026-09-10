import { mergeBillingGstPrefill, prefillBillingFromVerifiedGst } from './gst-billing-prefill';
import type { BillingAddress } from './StepContacts';

const statutory = {
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
};

describe('prefillBillingFromVerifiedGst', () => {
  it('maps each verified GSTIN to its registered office address', () => {
    const prefill = prefillBillingFromVerifiedGst(statutory);
    expect(prefill.get('06AAHCT0310N1ZG')).toMatchObject({
      line1: 'Fourth Floor, 429, JMD Megapolis IT Park',
      city: 'Gurugram',
      state: '06',
      pincode: '122018',
    });
  });
});

describe('mergeBillingGstPrefill', () => {
  it('fills empty billing rows and leaves typed rows alone', () => {
    const prefill = prefillBillingFromVerifiedGst(statutory);
    const empty: BillingAddress = {
      gstin: '06AAHCT0310N1ZG',
      line1: '',
      line2: '',
      city: '',
      state: '06',
      pincode: '',
    };
    const typed: BillingAddress = {
      gstin: '06AAHCT0310N1ZG',
      line1: 'Manual entry',
      line2: '',
      city: 'Gurugram',
      state: '06',
      pincode: '122001',
    };

    expect(mergeBillingGstPrefill([empty], prefill)[0]).toMatchObject({
      line1: 'Fourth Floor, 429, JMD Megapolis IT Park',
      city: 'Gurugram',
      pincode: '122018',
    });
    expect(mergeBillingGstPrefill([typed], prefill)[0]).toEqual(typed);
  });

  it('replaces a state that does not match the GSTIN', () => {
    const prefill = prefillBillingFromVerifiedGst(statutory);
    const mismatched: BillingAddress = {
      gstin: '06AAHCT0310N1ZG',
      line1: 'raama hy',
      line2: '',
      city: 'Delhi Cantt',
      state: '07',
      pincode: '110028',
    };
    expect(mergeBillingGstPrefill([mismatched], prefill)[0]).toMatchObject({
      line1: 'Fourth Floor, 429, JMD Megapolis IT Park',
      city: 'Gurugram',
      state: '06',
      pincode: '122018',
    });
  });
});
