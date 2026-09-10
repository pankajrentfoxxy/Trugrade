import { pickCityFromAreas } from './PincodeLocalityFields';

describe('pickCityFromAreas', () => {
  const areas = [
    { value: 'Gurugram', label: 'Gurugram' },
    { value: 'South West Delhi', label: 'South West Delhi' },
  ];

  it('matches by value or label case-insensitively', () => {
    expect(pickCityFromAreas('Gurugram', areas)).toBe('Gurugram');
    expect(pickCityFromAreas('gurugram', areas)).toBe('Gurugram');
  });

  it('returns empty when nothing matches', () => {
    expect(pickCityFromAreas('Delhi Cantt', areas)).toBe('');
  });

  it('matches Gurugram to a Gurgaon post-office name from India Post', () => {
    const gurgaonAreas = [{ value: 'Gurgaon South City II', label: 'Gurgaon South City II' }];
    expect(pickCityFromAreas('Gurugram', gurgaonAreas)).toBe('Gurgaon South City II');
  });
});
