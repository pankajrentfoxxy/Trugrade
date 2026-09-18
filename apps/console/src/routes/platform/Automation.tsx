import { useState } from 'react';
import { Button } from '@trugrade/ui';
import { usePrincipal, apiFetch } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { when } from '../fulfilment/api';

/** Archetype B — board, over a rule table. */

interface RuleRow {
  id: string;
  name: string;
  triggerEvent: string;
  conditionNote: string;
  actionNote: string;
  failureNote: string;
  mode: 'AUTO' | 'SUGGEST' | 'MANUAL';
  enabled: boolean;
}

interface AutomationRunRow {
  id: string;
  ruleId: string;
  ruleName: string | null;
  objectRef: string;
  startedAt: string;
  durationMs: number | null;
  status: string;
  error: string | null;
}

const runsConfig: BoardConfig<AutomationRunRow> = {
  kind: 'automation-run',
  title: 'Runs',
  endpoint: '/api/ops/platform/automation/runs',
  rowKey: (r) => r.id,
  searchHint: 'Object reference',
  facets: [{ key: 'rule', label: 'Rule' }],
  empty: {
    head: 'Nothing has run',
    why: 'A rule writes a row here every time it fires, whether it acts or skips.',
  },
  columns: [
    { key: 'rule', header: 'Rule', cell: (r) => <Id>{r.ruleId}</Id> },
    { key: 'name', header: 'Name', cell: (r) => r.ruleName ?? '—' },
    { key: 'object', header: 'Object', cell: (r) => <Id>{r.objectRef}</Id> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'error', header: 'Error', cell: (r) => r.error ?? <Unmeasured label="None" /> },
    { key: 'at', header: 'Started', cell: (r) => when(r.startedAt) },
    {
      key: 'ms',
      header: 'ms',
      numeric: true,
      cell: (r) => (r.durationMs === null ? <Unmeasured /> : r.durationMs),
    },
  ],
};

export default function Automation(): React.JSX.Element {
  const [reloadToken, setReload] = useState(0);
  const { data: rules } = useResource<RuleRow[]>(
    '/api/ops/platform/automation/rules',
    'We could not load the rules.',
    reloadToken,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-h1 text-ink">Automation</h1>
          {rules && <span className="mono tnum text-body-sm text-ink-3">{rules.length}</span>}
        </header>
        <div className="overflow-hidden rounded-lg border border-rule bg-sheet">
          <table className="w-full">
            <thead>
              <tr className="bg-sheet-3">
                {['Rule', 'When', 'Then', 'Mode', 'On', ''].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-3 py-2 text-left text-caption uppercase tracking-wide text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rules ?? []).map((rule) => (
                <RuleLine key={rule.id} rule={rule} onChanged={() => setReload((n) => n + 1)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <BoardScreen config={runsConfig} />
    </div>
  );
}

function RuleLine({
  rule,
  onChanged,
}: {
  rule: RuleRow;
  onChanged: () => void;
}): React.JSX.Element {
  const principal = usePrincipal();
  const [busy, setBusy] = useState(false);
  const canWrite = principal?.permissions.includes('automation.rule.write') ?? false;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiFetch(`/api/ops/platform/automation/rules/${encodeURIComponent(rule.id)}/enabled`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-t border-rule-2">
      <td className="px-3 py-2">
        <Id>{rule.id}</Id> <span className="text-body-sm text-ink-2">{rule.name}</span>
      </td>
      <td className="px-3 py-2 text-body-sm text-ink-2">{rule.conditionNote}</td>
      <td className="px-3 py-2 text-body-sm text-ink-2">{rule.actionNote}</td>
      <td className="px-3 py-2 text-body-sm text-ink-2">{rule.mode}</td>
      <td className="px-3 py-2">
        <StatusDot tone={rule.enabled ? 'ok' : 'idle'} label={rule.enabled ? 'On' : 'Off'} />
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => void toggle()}
          {...(canWrite ? {} : { disabledReason: 'Needs automation.rule.write' })}
        >
          {rule.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </td>
    </tr>
  );
}
