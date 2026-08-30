import * as React from 'react';
import { DataBoard, EmptyState, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import { Board, NotMeasured, PageHeader, Section, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { Num, type PlatformAdmin, type ConfigKey } from './types';

/**
 * ARCHETYPE B — Board. Every runtime setting, and whether anything reads it.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * ## The column that matters is not the value
 *
 * `platform_config` is the live control surface for pricing, QC gates, statutory
 * payment terms and TDS. A table of 74 values implies 74 working settings, and
 * that implication is false: **40 of them are read by no file in the API.** A
 * key nothing reads is not a setting that happens to be at its default. It is a
 * knob that is not connected to anything, and an operator who changes it will
 * watch the number change and the behaviour not.
 *
 * Every config defect this repo has found was of that shape rather than a wrong
 * value — a key under two names, a key missing from one of two build paths, a
 * guardrail set to 3.0 and consumed by nothing. So the board leads with
 * reachability and the value rides alongside it.
 *
 * ## Nothing here can be edited, deliberately
 *
 * See the controller's own header. A text box over this table with no staging,
 * no approval and no rollback is a production incident with a save button.
 *
 * ## Colour
 *
 * A configured value is a SETTING and reads as ink, not amber — amber on this
 * board would be 74 amber numbers, which is the same as none. Nothing here is a
 * PASS or a FAIL, so nothing is green or red: a key nothing reads is a gap in
 * the wiring, not a verdict, and wears the outlined warn chip. A legal-effect
 * key is not a warning either — it is a fact about what changing it costs.
 */

/** The value, rendered as what it is rather than as text. */
function Value({ k }: { k: ConfigKey }): React.JSX.Element {
  const v = k.valueJson;
  if (v === null || v === undefined) {
    return (
      <NotMeasured
        why={`${k.key} holds a JSON null. That is not the same as the key being absent, and it is not zero.`}
        label="Set to null"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-data tnum text-ink">
        {typeof v === 'string' ? v : JSON.stringify(v)}
      </span>
      <span className="text-body-sm text-ink-4">{k.valueType}</span>
    </div>
  );
}

/**
 * Which files name this key.
 *
 * Three states, and the difference between the second and the third is the whole
 * point: an empty list is a finding, `null` is an admission. A key added since
 * the reachability scan has not been looked for, and reporting it as unread
 * would be a claim we have not earned.
 */
function ReadBy({ k }: { k: ConfigKey }): React.JSX.Element {
  if (k.consumers === null) {
    return (
      <NotMeasured
        why={`${k.key} is newer than the committed reachability scan, so no file list exists for it. It has not been shown to be unread.`}
        label="Not scanned"
      />
    );
  }
  if (k.consumers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {/* Not red. A key nothing reads is a hole in the wiring, not a failure
            verdict on a machine — and green/red belong to PASS/FAIL alone. */}
        <StatusPill tone="warn" label="Nothing reads this" />
        <span className="max-w-sm text-body-sm text-ink-3">
          Changing it changes the row and nothing else.
        </span>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {k.consumers.map((f) => (
        <li key={f} className="font-mono text-body-sm text-ink-2">
          {f.replace(/^modules\//, '')}
        </li>
      ))}
    </ul>
  );
}

/**
 * Which of the two writers of `platform_config` creates the key.
 *
 * A key in the migrations and not in the seed — or the reverse — produces a
 * database that boots, serves traffic and is silently missing a setting.
 * `msme.max_payment_days` was exactly that: migration-only, so a seed-built
 * database paid an MSME on 15-day terms instead of the statutory 45. Nothing
 * about the VALUE would have shown it, because the row was not there.
 */
function WrittenBy({ k }: { k: ConfigKey }): React.JSX.Element {
  // `== null` and not `=== null`: an API build that predates this field sends
  // `undefined`, and a screen that crashes on a missing field is worse than one
  // that admits the field is missing.
  if (k.writtenBy == null) {
    return (
      <NotMeasured
        why={`${k.key} is newer than the committed provenance scan, so we have not looked for its writer.`}
        label="Not scanned"
      />
    );
  }
  const { migration, seed } = k.writtenBy;
  if (migration && seed) return <span className="text-body-sm text-ink-3">Migration and seed</span>;
  if (!migration && !seed) {
    return (
      <div className="flex flex-col gap-2">
        <StatusPill tone="warn" label="Written by nothing" />
        <span className="max-w-xs text-body-sm text-ink-3">
          A leftover row, under a name neither writer uses any more.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <StatusPill tone="warn" label={migration ? 'Migration only' : 'Seed only'} />
      <span className="max-w-xs text-body-sm text-ink-3">
        A database built from {migration ? 'the seed' : 'the migrations'} alone does not have this
        key at all.
      </span>
    </div>
  );
}

function Effective({ k }: { k: ConfigKey }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">
        <Num>{k.effectiveFrom.slice(0, 10)}</Num>
      </span>
      {k.history.length > 0 && (
        <span className="text-body-sm text-ink-3">
          <Num>{k.history.length}</Num> earlier{' '}
          {k.history.length === 1 ? 'version' : 'versions'}, last{' '}
          <Num>{String(JSON.stringify(k.history[0]?.valueJson))}</Num> from{' '}
          <Num>{k.history[0]?.effectiveFrom.slice(0, 10)}</Num>
        </span>
      )}
      {k.scheduled.length > 0 && (
        <span className="text-body-sm text-warn">
          <Num>{k.scheduled.length}</Num> future-dated{' '}
          {k.scheduled.length === 1 ? 'row' : 'rows'} — not live yet
        </span>
      )}
      {k.history.length === 0 && k.scheduled.length === 0 && (
        <span className="text-body-sm text-ink-4">Never changed</span>
      )}
    </div>
  );
}

function Meaning({ k }: { k: ConfigKey }): React.JSX.Element {
  return (
    <div className="flex max-w-sm flex-col gap-1">
      {k.description === null ? (
        <NotMeasured
          why={`platform_config.description is null on ${k.key}. Nobody wrote down what it is for.`}
          label="Undocumented"
        />
      ) : (
        <span className="text-body-sm text-ink-2">{k.description}</span>
      )}
      {k.legalEffect !== null && (
        <span className="text-body-sm text-ink">{k.legalEffect}</span>
      )}
    </div>
  );
}

const namespaceOf = (key: string): string => key.split('.')[0] ?? key;

export function ConfigRoute(): React.JSX.Element {
  const [ns, setNs] = useUrlState('ns');
  const [reach, setReach] = useUrlState('reach');
  const [legal, setLegal] = useUrlState('legal');
  const [source, setSource] = useUrlState('source');
  const [q, setQ] = useUrlState('q');

  const { data, error } = useResource<PlatformAdmin>(
    '/api/admin/platform/config',
    'The platform configuration did not load',
  );

  const columns = React.useMemo<ReadonlyArray<Column<ConfigKey>>>(
    () => [
      {
        key: 'key',
        header: 'Key',
        cell: (k) => (
          <div className="flex flex-col gap-1">
            <span className="font-mono text-body-sm text-ink">{k.key}</span>
            {k.legalEffect !== null && <StatusPill tone="neutral" label="Legal effect" />}
          </div>
        ),
      },
      { key: 'value', header: 'Value', cell: (k) => <Value k={k} /> },
      { key: 'read', header: 'Read by', cell: (k) => <ReadBy k={k} /> },
      { key: 'written', header: 'Written by', cell: (k) => <WrittenBy k={k} /> },
      { key: 'effective', header: 'In force since', cell: (k) => <Effective k={k} /> },
      { key: 'meaning', header: 'What it is for', cell: (k) => <Meaning k={k} /> },
    ],
    [],
  );

  if (error) {
    return (
      <EmptyState
        title="The platform configuration did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={12} />;

  const namespaces = [...new Set(data.keys.map((k) => namespaceOf(k.key)))].sort();

  const rows = data.keys.filter((k) => {
    if (ns !== '' && namespaceOf(k.key) !== ns) return false;
    if (legal === '1' && k.legalEffect === null) return false;
    if (q !== '' && !k.key.toLowerCase().includes(q.toLowerCase())) return false;
    if (reach === 'read') return k.consumers !== null && k.consumers.length > 0;
    if (reach === 'unread') return k.consumers !== null && k.consumers.length === 0;
    if (reach === 'unscanned') return k.consumers === null;
    if (source === 'migration') return k.writtenBy?.migration === true && !k.writtenBy.seed;
    if (source === 'seed') return k.writtenBy?.seed === true && !k.writtenBy.migration;
    if (source === 'orphan')
      return k.writtenBy !== null && !k.writtenBy.migration && !k.writtenBy.seed;
    return true;
  });

  const { summary } = data;
  const hidden = data.keys.length - rows.length;

  return (
    <div className="tg-stack">
      <PageHeader title="Platform configuration">
        Every number, flag and string the product reads at runtime.{' '}
        <span className="font-mono tnum text-ink">{summary.keysInForce}</span> keys are in force
        across <span className="font-mono tnum text-ink">{summary.rows}</span> dated rows — and{' '}
        <strong>
          <span className="font-mono tnum">{summary.withoutReader}</span> of them are named by no
          file in the API
        </strong>
        , so changing one would move the row and nothing else.
      </PageHeader>

      {/*
        The second finding, stated at the top because it is not visible anywhere
        else and it is the one that has already cost real money. The two writers
        of this table have diverged: neither the migrations nor the seed produces
        a complete configuration on its own.
      */}
      <p className="max-w-prose text-body-sm text-ink-2">
        This table has two writers — the migrations and{' '}
        <span className="font-mono">prisma/seed/reference.ts</span> — and they have drifted apart.
        Only <span className="font-mono tnum text-ink">{summary.inBothWriters}</span> keys are
        written by both. <span className="font-mono tnum text-ink">{summary.migrationOnly}</span>{' '}
        exist in a migration and in no seed file,{' '}
        <span className="font-mono tnum text-ink">{summary.seedOnly}</span> the other way round, and{' '}
        <span className="font-mono tnum text-ink">{summary.orphaned}</span> in neither.{' '}
        <strong>A database built from either source alone is missing settings the product reads.</strong>{' '}
        That is not hypothetical: <span className="font-mono">msme.max_payment_days</span> was
        migration-only, and a seed-built database paid an MSME on 15-day terms instead of the
        statutory 45.
      </p>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Select
          label="Namespace"
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          options={[
            { value: '', label: `Every namespace (${namespaces.length})` },
            ...namespaces.map((n) => ({
              value: n,
              label: `${n} (${data.keys.filter((k) => namespaceOf(k.key) === n).length})`,
            })),
          ]}
        />
        <Select
          label="Reachability"
          value={reach}
          onChange={(e) => setReach(e.target.value)}
          options={[
            { value: '', label: `Any (${summary.keysInForce})` },
            { value: 'read', label: `Read by code (${summary.withReader})` },
            { value: 'unread', label: `Nothing reads it (${summary.withoutReader})` },
            { value: 'unscanned', label: `Not scanned (${summary.unscanned})` },
          ]}
        />
        <Select
          label="Written by"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          options={[
            { value: '', label: `Either writer (${summary.keysInForce})` },
            { value: 'migration', label: `Migration only (${summary.migrationOnly})` },
            { value: 'seed', label: `Seed only (${summary.seedOnly})` },
            { value: 'orphan', label: `Neither (${summary.orphaned})` },
          ]}
        />
        <Select
          label="Legal effect"
          value={legal}
          onChange={(e) => setLegal(e.target.value)}
          options={[
            { value: '', label: 'Every key' },
            { value: '1', label: 'Statutory keys only' },
          ]}
        />
        <label className="flex flex-col gap-2">
          <span className="text-body-sm font-medium text-ink-2">Key contains</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="tds, warranty, qc.visit…"
            className="h-11 rounded border border-rule bg-sheet px-4 font-mono text-body-sm text-ink placeholder:text-ink-3"
          />
        </label>
      </div>

      {/*
        A filter that hides rows says how many it hid. An operator looking for a
        key that is filtered out otherwise concludes it does not exist, and on a
        configuration screen that conclusion is how a duplicate gets created.
      */}
      <p className="text-body-sm text-ink-3">
        Showing <span className="font-mono tnum text-ink">{rows.length}</span> of{' '}
        <span className="font-mono tnum text-ink">{data.keys.length}</span> keys.
        {hidden > 0 && (
          <>
            {' '}
            <span className="font-mono tnum">{hidden}</span> hidden by the filters above.
          </>
        )}
      </p>

      <Board tableMinWidth={1100}>
        <DataBoard
          caption="Platform configuration keys in force, with the files that read each one."
          columns={columns}
          rows={rows}
          rowKey={(k) => k.key}
          empty={
            <EmptyState
              title="No key matches these filters"
              body="Clear the namespace or the reachability filter. The keys are still there — the filter is hiding them."
            />
          }
        />
      </Board>

      <Section
        title="Nothing on this screen can be changed here"
        subtitle="Read-only, and not as a first cut. §3C.7 asks for an editor; this is a deliberate refusal to ship half of one."
      >
        <p className="max-w-prose text-body-sm text-ink-2">
          A key on this table decides what a vendor is paid, when they are paid, what a buyer is
          charged and what tax is withheld. An editor over it needs staging, a typed validator per
          key, a mandatory reason, a second approver on the statutory keys and a rollback — and an
          editor without those is a production incident with a save button. Values are changed today
          by a migration, which is reviewed, versioned and revertible. Every row here is
          effective-dated, so a change is an INSERT and the old value stays readable; nothing on
          this table is ever overwritten.
        </p>
      </Section>

      <Section
        title="Three things this screen cannot tell you, and why"
        subtitle="Each is a gap in the schema rather than in the screen, and a configuration board that quietly omitted them would be the more misleading version."
      >
        <ul className="flex flex-col gap-5">
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              &ldquo;Read by&rdquo; means the file names the key, not that the value changes
              behaviour
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              The list is a scan of the API source, committed alongside the code and re-derived by
              the test suite on every run, so it cannot silently go stale. What a grep cannot tell
              you is intent: a key whose only reader is a console controller is being{' '}
              <em>reported</em> rather than consumed —{' '}
              <span className="font-mono">price.guardrail_upper_multiple</span> is exactly that, set
              to <Num>3.0</Num> and read only by the screen that says nothing reads it.
            </p>
          </li>
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              There is no type on a key, so the type shown is the value&rsquo;s own
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              §3C.7 asks for typed values — number, bool, string, JSON, duration, money — validated
              against the type. <span className="font-mono">platform_config</span> has{' '}
              <span className="font-mono">value_json</span> and nothing else, so what this board
              shows is what the JSON currently is. A key holding{' '}
              <span className="font-mono">&quot;T_PLUS_2&quot;</span> and a key holding{' '}
              <Num>45</Num> are indistinguishable to the schema, and a validator would have nothing
              to validate against.
            </p>
          </li>
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              Two keys can hold the same number and mean the same thing, and nothing here would
              notice
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              <span className="font-mono">qc.visit_fee_waived_above</span> and{' '}
              <span className="font-mono">qc.visit_fee_waiver_units</span> are one number under two
              names: a database built from the seed alone could not price a listing, and one built
              from the migrations alone could not request an inspection. The Read-by column makes
              that visible — they are read by different files — but no rule on this table prevents
              it, because <span className="font-mono">platform_config.key</span> is unique only in
              combination with <span className="font-mono">effective_from</span> (schema gap #4).
              That is also why the same key can legitimately appear twice with the same version
              number.
            </p>
          </li>
        </ul>
      </Section>
    </div>
  );
}
