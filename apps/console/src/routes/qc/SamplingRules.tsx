import * as React from 'react';
import { money } from '@trugrade/contracts';
import { Button, DataBoard, EmptyState, Input, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import { NotMeasured, PageHeader, Section, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { send } from './api';
import type { SamplingRuleRow } from './types';

/**
 * ARCHETYPE B — Board. The active rules, then the form that versions them.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Which fraction of a vendor's stock gets inspected, and what they had to earn
 * to get there.
 *
 * The screen's job is to make the *earned* part visible. A sample percentage on
 * its own reads like a discount; next to `min_units_inspected`, `min_pass_rate`
 * and `min_grade_accuracy` it reads like what it is — a vendor at 25% has proved
 * something across five thousand machines, and drops back the moment they stop.
 *
 * Rules are **versioned, never edited**. `UNIQUE (vendor_tier, effective_from)`
 * plus a partial unique on `is_active` means one active rule per tier, so saving
 * here creates a new row and retires the old one. That is not an implementation
 * detail to hide: an inspection has to be reproducible against the rules that
 * were in force on the day, and an editable row destroys that.
 */

const TIERS = [
  { value: 'WATCHLIST', label: 'Watchlist' },
  { value: 'BRONZE', label: 'Bronze' },
  { value: 'SILVER', label: 'Silver' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'PLATINUM', label: 'Platinum' },
] as const;

interface Draft {
  vendorTier: string;
  minUnitsInspected: string;
  minPassRate: string;
  minGradeAccuracy: string;
  samplePct: string;
  alwaysFullAboveValue: string;
  effectiveFrom: string;
}

const emptyDraft = (): Draft => ({
  vendorTier: 'SILVER',
  minUnitsInspected: '',
  minPassRate: '',
  minGradeAccuracy: '',
  samplePct: '',
  alwaysFullAboveValue: '',
  effectiveFrom: '',
});

/** The reasons a draft will not save, in the words the person typing needs. */
export function checkDraft(d: Draft): string[] {
  const problems: string[] = [];
  const pct = (v: string, label: string): void => {
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      problems.push(`${label} must be a percentage from 0 to 100.`);
    }
  };
  pct(d.samplePct, 'Sample percentage');
  pct(d.minPassRate, 'Minimum pass rate');
  pct(d.minGradeAccuracy, 'Minimum grade accuracy');
  const units = Number(d.minUnitsInspected);
  if (d.minUnitsInspected.trim() === '' || !Number.isInteger(units) || units < 0) {
    problems.push('Minimum units inspected must be a whole number.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveFrom)) {
    problems.push('Give the rule a date it takes effect from.');
  }
  // A sample below 100% on the two lowest tiers is the rule the tier system
  // exists to prevent: those vendors have not earned a sample and a rule saying
  // otherwise would quietly stop inspecting the riskiest stock on the platform.
  if ((d.vendorTier === 'WATCHLIST' || d.vendorTier === 'BRONZE') && Number(d.samplePct) < 100) {
    problems.push(
      'Watchlist and Bronze are inspected in full. A sample there is stock nobody looked at, from the vendors most likely to need looking at.',
    );
  }
  return problems;
}

const ACTIVE_COLUMNS: ReadonlyArray<Column<SamplingRuleRow>> = [
  { key: 'tier', header: 'Tier', cell: (r) => r.vendorTier },
  {
    key: 'sample',
    header: 'Sample',
    cell: (r) => (
      // A sample below 100% is the measured concession this whole screen is
      // about, so it is the value that reads at full ink.
      <span className={Number(r.samplePct) < 100 ? 'font-mono tnum text-ink' : 'font-mono tnum text-ink-2'}>
        {r.samplePct}%
      </span>
    ),
  },
  {
    key: 'requires',
    header: 'Requires',
    cell: (r) => (
      <span className="font-mono tnum text-ink-2">
        {r.minUnitsInspected} units · {r.minPassRate}% pass · {r.minGradeAccuracy}% grade accuracy
      </span>
    ),
  },
  {
    key: 'alwaysFull',
    header: 'Always full above',
    cell: (r) =>
      r.alwaysFullAboveValue ? (
        <span className="font-mono tnum">{money(r.alwaysFullAboveValue).format()}</span>
      ) : (
        <NotMeasured
          why="No consignment value forces a full inspection at this tier"
          label="No threshold"
        />
      ),
  },
  {
    key: 'effectiveFrom',
    header: 'Effective from',
    cell: (r) => <span className="font-mono tnum">{r.effectiveFrom}</span>,
  },
];

export function SamplingRulesRoute(): React.JSX.Element {
  const { data, error } = useResource<SamplingRuleRow[]>(
    '/api/qc/sampling-rules',
    'The sampling rules are unavailable',
  );
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [showProblems, setShowProblems] = React.useState(false);

  const problems = checkDraft(draft);
  const active = (data ?? []).filter((r) => r.isActive);
  const superseded = (data ?? []).filter((r) => !r.isActive);
  const replacing = active.find((r) => r.vendorTier === draft.vendorTier);

  const set = (k: keyof Draft, v: string): void => setDraft((d) => ({ ...d, [k]: v }));

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setShowProblems(true);
    if (problems.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const row = await send<SamplingRuleRow>(
        '/api/qc/sampling-rules',
        'POST',
        {
          vendorTier: draft.vendorTier,
          minUnitsInspected: Number(draft.minUnitsInspected),
          minPassRate: draft.minPassRate,
          minGradeAccuracy: draft.minGradeAccuracy,
          samplePct: draft.samplePct,
          alwaysFullAboveValue: draft.alwaysFullAboveValue.trim() || null,
          effectiveFrom: draft.effectiveFrom,
        },
        'The rule did not save',
      );
      setSaved(`${row.vendorTier} now samples ${row.samplePct}% from ${row.effectiveFrom}.`);
      setDraft(emptyDraft());
      setShowProblems(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <EmptyState
        title="The sampling rules did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;

  return (
    <div className="tg-stack">
      <PageHeader title="Sampling rules">
        One active rule per tier. Saving a new one retires the current one rather than editing it,
        because an inspection has to be reproducible against the rules in force on its own date.
      </PageHeader>

      <Section title="Active" subtitle={`${active.length} of five tiers have an active rule.`}>
        <DataBoard
          caption="The active sampling rule for each vendor tier."
          columns={ACTIVE_COLUMNS}
          rows={active}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="No tier has an active rule"
              body="Nothing is being sampled: every consignment falls through to a full inspection until a rule exists."
            />
          }
        />
      </Section>

      <Section
        title="New rule"
        subtitle={
          replacing
            ? `This will retire the ${replacing.vendorTier} rule that has been in force since ${replacing.effectiveFrom}.`
            : 'No active rule for this tier yet.'
        }
      >
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="grid gap-5 md:grid-cols-3">
            <Select
              label="Vendor tier"
              value={draft.vendorTier}
              onChange={(e) => set('vendorTier', e.target.value)}
              options={TIERS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <Input
              label="Sample percentage"
              type="number"
              min={0}
              max={100}
              value={draft.samplePct}
              onChange={(e) => set('samplePct', e.target.value)}
            />
            <Input
              label="Effective from"
              type="date"
              value={draft.effectiveFrom}
              onChange={(e) => set('effectiveFrom', e.target.value)}
            />
            <Input
              label="Minimum units inspected"
              type="number"
              min={0}
              value={draft.minUnitsInspected}
              onChange={(e) => set('minUnitsInspected', e.target.value)}
              hint="What the vendor must have put through QC before this tier applies."
            />
            <Input
              label="Minimum pass rate (%)"
              type="number"
              min={0}
              max={100}
              value={draft.minPassRate}
              onChange={(e) => set('minPassRate', e.target.value)}
            />
            <Input
              label="Minimum grade accuracy (%)"
              type="number"
              min={0}
              max={100}
              value={draft.minGradeAccuracy}
              onChange={(e) => set('minGradeAccuracy', e.target.value)}
            />
            <Input
              label="Always inspect in full above"
              mono
              placeholder="5000000.00"
              value={draft.alwaysFullAboveValue}
              onChange={(e) => set('alwaysFullAboveValue', e.target.value)}
              hint="Consignment value in rupees. Leave empty for no threshold."
            />
          </div>

          {showProblems && problems.length > 0 && (
            <ul
              role="alert"
              data-testid="draft-problems"
              className="mt-5 flex list-disc flex-col gap-2 rounded border border-fail bg-sheet-2 p-4 pl-9 text-body-sm text-fail"
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {saveError && (
            <p className="mt-4 text-body-sm text-fail" role="alert">
              {saveError} Nothing was changed.
            </p>
          )}
          {saved && <p className="mt-4 text-body-sm text-pass">{saved}</p>}

          <div className="mt-5">
            {/* The one amber control on this screen: it is the only thing here
                that writes anything. */}
            <Button type="submit" variant="primary" loading={saving}>
              Save as a new version
            </Button>
          </div>
        </form>
      </Section>

      {superseded.length > 0 && (
        <Section title="Superseded" subtitle="Kept so an old inspection can be re-derived.">
          <ul className="flex flex-col gap-2 text-body-sm text-ink-2">
            {superseded.map((r) => (
              <li key={r.id}>
                <StatusPill tone="neutral" label={r.vendorTier} />{' '}
                <span className="tnum">
                  {r.samplePct}% from {r.effectiveFrom}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
