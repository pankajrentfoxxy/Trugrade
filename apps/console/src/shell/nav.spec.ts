import { describe, expect, it } from 'vitest';
import type { Principal } from '../lib/auth';
import { activeEntry, monogram, visibleGroups } from './nav';

const principal = (p: Partial<Principal>): Principal => ({
  userId: 'u',
  orgId: 'o',
  orgType: 'PLATFORM',
  roles: [],
  permissions: [],
  mfaRequired: false,
  ...p,
});

describe('the section rail decides where you are', () => {
  const platform = principal({
    permissions: ['catalog.sku.read', 'catalog.condition_image.write', 'kyc.application.read'],
  });
  const entries = visibleGroups(platform).flatMap(([, e]) => e);

  it('lights the deepest matching entry, not the first prefix', () => {
    // Both '/catalog' and '/catalog/condition-images' are prefixes of this URL.
    // Lighting 'Catalog' while you are on 'Image coverage' is the bug.
    expect(activeEntry('/catalog/condition-images', entries)?.label).toBe('Image coverage');
  });

  it('keeps the section lit on a detail screen that has no entry of its own', () => {
    expect(activeEntry('/kyc/org-42', entries)?.label).toBe('KYC queue');
  });

  it('lights nothing on a path outside every section', () => {
    expect(activeEntry('/login', entries)).toBeUndefined();
  });

  it('does not match a sibling that merely shares a prefix string', () => {
    expect(activeEntry('/catalogue', entries)).toBeUndefined();
  });
});

describe('the collapsed rail', () => {
  it('disambiguates two screens whose names start with the same letter', () => {
    expect(monogram('Scheduling')).not.toBe(monogram('Sampling rules'));
  });

  it('uses word initials, and the first two letters of a single word', () => {
    expect(monogram('Grade corrections')).toBe('GC');
    expect(monogram('Catalog')).toBe('CA');
  });
});

describe('the org-type gate', () => {
  it('hides the QC section from a vendor who holds the QC permission for their own visits', () => {
    const vendor = principal({
      orgType: 'VENDOR',
      permissions: ['qc.visit.read', 'listing.own.read'],
    });
    const groups = visibleGroups(vendor).map(([group]) => group);
    expect(groups).toEqual(['Vendor']);
  });
});
