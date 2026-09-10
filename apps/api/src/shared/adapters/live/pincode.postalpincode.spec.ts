import { areaLabel, dedupeAreas } from './pincode.postalpincode';

describe('postalpincode.in response parsing', () => {
  it('maps 122018 to the post-office name in Haryana', () => {
    const offices = [
      {
        Name: 'Gurgaon South City II',
        Block: 'NA',
        District: 'Gurgaon',
        State: 'Haryana',
        Pincode: '122018',
      },
    ];

    expect(areaLabel(offices[0]!)).toBe('Gurgaon South City II');
    expect(dedupeAreas(offices)).toEqual([
      { value: 'Gurgaon South City II', label: 'Gurgaon South City II' },
    ]);
  });

  it('falls back to district when name is missing', () => {
    const offices = [{ Block: 'NA', District: 'Gurgaon', State: 'Haryana' }];
    expect(areaLabel(offices[0]!)).toBe('Gurgaon');
  });
});
