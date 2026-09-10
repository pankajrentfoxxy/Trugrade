import { buyerOrderStatusLabel, deliverySiteLabel, sentenceCaseLabel } from '../src/buyer-order-labels';

describe('sentenceCaseLabel', () => {
  it('capitalises the first letter of each · segment', () => {
    expect(sentenceCaseLabel('Placed · payment pending')).toBe('Placed · Payment pending');
    expect(sentenceCaseLabel('delivered')).toBe('Delivered');
  });
});

describe('buyerOrderStatusLabel', () => {
  it('maps known statuses and sentence-cases fallbacks', () => {
    expect(buyerOrderStatusLabel('PAYMENT_PENDING')).toBe('Placed · Payment pending');
    expect(buyerOrderStatusLabel('DELIVERED')).toBe('Delivered');
    expect(buyerOrderStatusLabel('IN_TRANSIT')).toBe('In transit');
  });
});

describe('deliverySiteLabel', () => {
  it('capitalises a stored label that arrived all lower case', () => {
    expect(deliverySiteLabel('gurugram warehouse')).toBe('Gurugram warehouse');
  });
});
