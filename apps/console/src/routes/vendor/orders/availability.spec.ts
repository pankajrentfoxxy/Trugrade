import { describe, expect, it } from 'vitest';
import type { PoLineGroup } from '../api';
import {
  draftsComplete,
  emptyDrafts,
  lineError,
  lineKey,
  lineValue,
  owedFor,
  submitLabel,
  tally,
  tdsOn,
  toPayload,
} from './availability';

/**
 * The rules both purchase-order screens share, checked once.
 *
 * The one that matters most: an empty box is "not answered", not 0 — the form
 * is incomplete until every line has a number, and the button says so.
 */

const line = (over: Partial<PoLineGroup>): PoLineGroup => ({
  lineIds: ['l1'],
  skuId: 'sku-1',
  skuCode: 'X',
  title: 'Dell Latitude 3420',
  specSummary: null,
  gradeAtPo: 'A',
  qty: 3,
  unitPrice: '5000.00',
  lineTotal: '15000.00',
  lineStatus: 'PENDING',
  rejectionReason: null,
  qtyAvailable: null,
  attachedCount: 0,
  serials: [],
  ...over,
});

const GROUPS = [line({}), line({ skuId: 'sku-2', gradeAtPo: 'B', qty: 1, unitPrice: '4000.00' })];

describe('one box', () => {
  it('accepts 0 through the quantity asked for, and nothing else', () => {
    expect(lineError('0', 3)).toBeNull();
    expect(lineError('3', 3)).toBeNull();
    expect(lineError('4', 3)).toBe(
      'This line asks for 3 machines. Enter a quantity between 0 and 3.',
    );
    expect(lineError('2', 1)).toBe(
      'This line asks for 1 machine. Enter a quantity between 0 and 1.',
    );
    expect(lineError('1.5', 3)).toBe('Enter a whole number of machines.');
    expect(lineError('-1', 3)).toBe('Enter a whole number of machines.');
  });

  it('treats an empty box as unanswered rather than as an error or a zero', () => {
    expect(lineError('', 3)).toBeNull();
    expect(lineValue('', 3)).toBeNull();
    expect(lineValue('0', 3)).toBe(0);
  });
});

describe('the whole form', () => {
  it('is complete only when every line has a valid number', () => {
    const drafts = emptyDrafts(GROUPS);
    expect(draftsComplete(GROUPS, drafts)).toBe(false);

    drafts.set(lineKey(GROUPS[0]!), '2');
    expect(draftsComplete(GROUPS, drafts)).toBe(false);

    drafts.set(lineKey(GROUPS[1]!), '0');
    expect(draftsComplete(GROUPS, drafts)).toBe(true);

    drafts.set(lineKey(GROUPS[1]!), '9');
    expect(draftsComplete(GROUPS, drafts)).toBe(false);
  });

  it('owes the vendor for the quantities typed, after TDS at the PO rate', () => {
    const drafts = new Map([
      [lineKey(GROUPS[0]!), '2'],
      [lineKey(GROUPS[1]!), '1'],
    ]);
    const owed = owedFor(GROUPS, drafts);
    expect(owed.toString()).toBe('14000.00');
    expect(tdsOn(owed, 0.1).toString()).toBe('14.00');
    expect(tally(GROUPS, drafts)).toEqual({ confirmed: 3, asked: 4 });
  });

  it('labels the button with what is about to be confirmed', () => {
    const drafts = emptyDrafts(GROUPS);
    expect(submitLabel(GROUPS, drafts)).toBe('Update availability');

    drafts.set(lineKey(GROUPS[0]!), '3').set(lineKey(GROUPS[1]!), '1');
    expect(submitLabel(GROUPS, drafts)).toBe('Confirm all 4 available');

    drafts.set(lineKey(GROUPS[0]!), '1');
    expect(submitLabel(GROUPS, drafts)).toBe('Confirm 2 of 4 available');

    drafts.set(lineKey(GROUPS[0]!), '0').set(lineKey(GROUPS[1]!), '0');
    expect(submitLabel(GROUPS, drafts)).toBe('Confirm nothing is available');
  });

  it('posts one quantity per SKU and grade, in the order the lines are shown', () => {
    const drafts = new Map([
      [lineKey(GROUPS[0]!), '2'],
      [lineKey(GROUPS[1]!), '0'],
    ]);
    expect(toPayload(GROUPS, drafts)).toEqual([
      { skuId: 'sku-1', grade: 'A', qtyAvailable: 2 },
      { skuId: 'sku-2', grade: 'B', qtyAvailable: 0 },
    ]);
  });
});
