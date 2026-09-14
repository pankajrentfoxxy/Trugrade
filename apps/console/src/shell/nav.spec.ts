import { describe, expect, it } from 'vitest';
import type { Principal } from '../lib/auth';
import { activeEntry, monogram, visibleGroups, NAV } from './nav';

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
    expect(groups).toEqual(['Today', 'Sell', 'Inspect', 'Account']);
  });
});

/**
 * The supplier hub rail is ten places, and the four routes it leaves out are
 * still routes.
 *
 * Both halves matter. A rail that grows an item per route stops being a map and
 * becomes an index; a route dropped from the rail with no link on the screen
 * that owns it is simply unreachable. The second test is the one that catches
 * the second failure, so it asserts against the actual screens rather than
 * against a list of intentions.
 */
describe('the supplier hub rail', () => {
  const owner = principal({
    orgType: 'VENDOR',
    roles: ['VENDOR_OWNER'],
    permissions: [
      'listing.own.read',
      'listing.own.write',
      'procurement.po.read_own',
      'procurement.payable.read_own',
    ],
  });

  it('shows the ten places, in order, and nothing else', () => {
    const railed = visibleGroups(owner)
      .flatMap(([, entries]) => entries)
      .filter((e) => e.surface === 'VENDOR' && e.rail !== false)
      .map((e) => e.label);

    expect(railed).toEqual([
      'Home',
      'Listings',
      'Inspect',
      'Grades',
      'Orders',
      'Payouts',
      'Team',
      'Facilities',
      'Documents',
      'Profile',
    ]);
  });

  it('keeps the off-rail routes in NAV so a sub-route still lights its section', () => {
    const all = NAV.filter((e) => e.surface === 'VENDOR');
    const off = all.filter((e) => e.rail === false).map((e) => e.to);

    expect(off).toEqual([
      '/vendor/listings/new',
      '/vendor/sku-request',
      '/vendor/dispatch',
      '/vendor/payouts',
    ]);
    // Still in NAV, so `activeEntry` resolves them rather than lighting nothing.
    for (const to of off) expect(activeEntry(to, all)).toBeDefined();
  });
});
