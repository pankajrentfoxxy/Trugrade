/**
 * Which delivery site's pincode a signed-in buyer's product page opens on.
 */
import type { OrgAddress } from '../../(portal)/api';
import { defaultDeliveryPincode } from './DefaultPincode';

const site = (over: Partial<OrgAddress>): OrgAddress => ({
  id: 'a',
  type: 'SHIPPING',
  label: null,
  line1: '1 Road',
  line2: null,
  city: 'New Delhi',
  state: 'Delhi',
  stateCode: '07',
  pincode: '110001',
  contactName: 'Priya',
  contactMobile: '+919876543210',
  landmark: null,
  gateInstructions: null,
  receivingHours: null,
  isDefault: false,
  isBillingEnabled: false,
  isActive: true,
  verifiedAt: null,
  editable: true,
  lockedReason: null,
  ...over,
});

describe('defaultDeliveryPincode', () => {
  it('takes the default site over the others, whatever the order', () => {
    const book = [
      site({ id: 'b', pincode: '122001' }),
      site({ id: 'c', pincode: '400001', isDefault: true }),
    ];
    expect(defaultDeliveryPincode(book)).toBe('400001');
  });

  it('never opens on a retired site, even the one that used to be the default', () => {
    const book = [
      site({ id: 'b', pincode: '122001', isDefault: true, isActive: false }),
      site({ id: 'c', pincode: '400001' }),
    ];
    expect(defaultDeliveryPincode(book)).toBe('400001');
  });

  it('gives nothing for a buyer with no open site, so the box asks as for a guest', () => {
    expect(defaultDeliveryPincode([])).toBeNull();
    expect(defaultDeliveryPincode([site({ isActive: false })])).toBeNull();
  });
});
