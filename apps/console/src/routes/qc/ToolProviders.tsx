import * as React from 'react';
import { Button, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { send } from './api';
import { Datum, Panel, Textarea } from './controls';
import { KNOWN_FIELDS, validateFieldMap } from './fieldMap';
import type { ToolProviderRow } from './types';

/**
 * Tool providers, and the field map that decides what every future certificate
 * parses into.
 *
 * This screen exists because of one instruction in `PHASE_04_QC.md`: *"Change
 * `field_map_json` and the parser, never the tool."* DeviceSure is at v0.1.0 and
 * its payload will move; the mapping layer is what keeps that a configuration
 * change rather than a release. Which makes this the highest-leverage textarea in
 * the console, and the one with no downstream check on it — so `validateFieldMap`
 * runs on every keystroke and the save is refused, not warned.
 *
 * The current map is shown as a table as well as as JSON, because reading a
 * seventeen-line JSON object for the one path that changed is exactly how a typo
 * gets approved.
 */

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: ToolProviderRow;
  onSaved: (row: ToolProviderRow) => void;
}): React.JSX.Element {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(() => JSON.stringify(provider.fieldMapJson, null, 2));
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const check = React.useMemo(() => validateFieldMap(text), [text]);
  const dirty = text !== JSON.stringify(provider.fieldMapJson, null, 2);

  async function onSave(): Promise<void> {
    if (check.errors.length > 0 || !check.map) return;
    setSaving(true);
    setSaveError(null);
    try {
      const row = await send<ToolProviderRow>(
        `/api/qc/tool-providers/${provider.id}/field-map`,
        'PUT',
        { fieldMapJson: check.map },
        'The field map did not save',
      );
      onSaved(row);
      setEditing(false);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const mapped = Object.entries(provider.fieldMapJson);

  return (
    <Panel
      title={`${provider.name} (${provider.code})`}
      aside={
        provider.isActive ? (
          <StatusPill tone="pass" label="Active" />
        ) : (
          <StatusPill tone="neutral" label="Inactive" />
        )
      }
    >
      <div className="grid gap-x-6 md:grid-cols-4">
        <Datum label="Integration">{provider.integrationType}</Datum>
        <Datum label="Report format">{provider.reportFormat}</Datum>
        <Datum label="Licence seats">
          {provider.licenceSeats ?? 'unlimited'}
          <span className="block text-body-sm text-ink-2">
            A hard cap on concurrent technicians, enforced inside the tool.
          </span>
        </Datum>
        <Datum label="Wipe certificates">{provider.supportsWipe ? 'Supported' : 'No'}</Datum>
      </div>

      <h3 className="mt-5 font-mono text-label uppercase tracking-[0.13em] text-ink-2">
        Field map · our field to their path
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">
            The mapping from Gorefurbo field names to paths in this provider&rsquo;s payload.
          </caption>
          <tbody>
            {mapped.map(([field, path]) => (
              <tr key={field} className="border-b border-rule-2">
                <td className="py-2 pr-5 font-mono text-data text-ink">{field}</td>
                <td className="py-2 text-ink-3" aria-hidden="true">
                  &rarr;
                </td>
                <td className="py-2 font-mono text-data text-ink-2">{path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!editing ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit the field map
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <Textarea
            label="field_map_json"
            rows={18}
            spellCheck={false}
            className="font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            hint={`Known fields: ${KNOWN_FIELDS.join(', ')}.`}
          />

          {check.errors.length > 0 && (
            <ul
              role="alert"
              data-testid="field-map-errors"
              className="mt-4 flex list-disc flex-col gap-2 rounded border border-fail bg-sheet-2 p-4 pl-9 text-body-sm text-fail"
            >
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {check.errors.length === 0 && check.warnings.length > 0 && (
            <ul
              data-testid="field-map-warnings"
              className="mt-4 flex list-disc flex-col gap-2 rounded border border-warn p-4 pl-9 text-body-sm text-warn"
            >
              {check.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {saveError && (
            <p className="mt-4 text-body-sm text-fail" role="alert">
              {saveError} Nothing was changed.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-4">
            <Button
              variant="primary"
              loading={saving}
              onClick={() => void onSave()}
              disabledReason={
                check.errors.length > 0
                  ? 'Fix the problems above first. A bad map does not fail — it silently mis-parses every certificate from here on.'
                  : !dirty
                    ? 'Nothing has changed.'
                    : ''
              }
            >
              Save the field map
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setText(JSON.stringify(provider.fieldMapJson, null, 2));
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function ToolProvidersRoute(): React.JSX.Element {
  const { data, error } = useResource<ToolProviderRow[]>(
    '/api/qc/tool-providers',
    'The tool providers are unavailable',
  );
  const [saved, setSaved] = React.useState<Record<string, ToolProviderRow>>({});

  if (error) {
    return (
      <EmptyState
        title="The tool providers did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="No tool providers configured"
        body="Nothing can be ingested until a provider exists with a field map."
      />
    );
  }

  return (
    <div>
      <h1 className="text-h1 text-ink">Tool providers</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        A second diagnostic tool is configuration, not a release. That only holds while the field
        map is right, so it is validated before it can be saved.
      </p>

      {data.map((p) => {
        const current = saved[p.id] ?? p;
        return (
          <ProviderCard
            key={p.id}
            provider={current}
            onSaved={(row) => setSaved((s) => ({ ...s, [row.id]: row }))}
          />
        );
      })}
    </div>
  );
}
