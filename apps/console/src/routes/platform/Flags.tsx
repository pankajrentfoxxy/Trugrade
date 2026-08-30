import * as React from 'react';
import { DataBoard, EmptyState, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import { Board, PageHeader, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { Num, type PlatformAdmin } from './types';

/**
 * ARCHETYPE B — Board. Two tables the spec builds screens on, and neither is wired.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * ## Why one screen and not two
 *
 * §3C.7 asks for `/admin/feature-flags` and `/admin/notifications/templates`
 * separately, and they would be two boards saying the same sentence. Both tables
 * exist in the schema, both are empty, and — the part that matters — **no file
 * in the API names either of them.** They are not two empty features; they are
 * one unbuilt capability with two tables, and splitting the finding across two
 * routes makes it read as smaller than it is. When either gains a writer it
 * earns its own route.
 *
 * ## An empty flag list is not "everything is off"
 *
 * This is the whole reason the screen exists rather than being skipped. A flag
 * board showing nothing invites the reading "no experiments are running, so
 * behaviour is the default" — which is exactly the reassurance a missing value
 * must never give. The truth is stronger and worse: if a row were inserted
 * tomorrow, nothing would consult it. So the screen states the reader count,
 * which is zero, beside the row count, which is also zero.
 *
 * ## Colour
 *
 * A disabled flag is not a FAIL and an inactive template is not one either, so
 * neither is red. The one measured value on the screen is the rollout
 * percentage, which is the only amber a flag row could legitimately carry.
 */

interface FlagRow {
  key: string;
  enabled: boolean;
  rolloutPct: number;
  orgScopeCount: number;
}

interface TemplateRow {
  code: string;
  channel: string;
  locale: string;
  version: number;
  isActive: boolean;
  subject: string | null;
  providerTemplateId: string | null;
}

const FLAG_COLUMNS: ReadonlyArray<Column<FlagRow>> = [
  { key: 'key', header: 'Flag', cell: (f) => <span className="font-mono text-body-sm text-ink">{f.key}</span> },
  {
    key: 'enabled',
    header: 'State',
    // Neutral, not green. "On" is a state, not a pass — and this console fixed
    // eight misuses of PASS colour for exactly this reading.
    cell: (f) => <StatusPill tone="neutral" label={f.enabled ? 'On' : 'Off'} />,
  },
  {
    key: 'rollout',
    header: 'Rollout',
    cell: (f) => (
      <span className="font-mono text-data tnum text-acc-ink">
        {f.rolloutPct}% <span className="text-body-sm text-ink-4">of accounts</span>
      </span>
    ),
  },
  {
    key: 'scope',
    header: 'Scoped to',
    cell: (f) =>
      f.orgScopeCount === 0 ? (
        <span className="text-body-sm text-ink-3">Every organisation</span>
      ) : (
        <span className="text-body-sm text-ink">
          <Num>{f.orgScopeCount}</Num> organisations
        </span>
      ),
  },
];

const TEMPLATE_COLUMNS: ReadonlyArray<Column<TemplateRow>> = [
  { key: 'code', header: 'Code', cell: (t) => <span className="font-mono text-body-sm text-ink">{t.code}</span> },
  { key: 'channel', header: 'Channel', cell: (t) => <span className="text-body-sm text-ink-2">{t.channel}</span> },
  {
    key: 'locale',
    header: 'Locale',
    cell: (t) => (
      <span className="text-body-sm text-ink-2">
        {t.locale} · v<Num>{t.version}</Num>
      </span>
    ),
  },
  {
    key: 'state',
    header: 'State',
    cell: (t) => <StatusPill tone="neutral" label={t.isActive ? 'Active' : 'Archived'} />,
  },
  {
    key: 'subject',
    header: 'Subject',
    cell: (t) => <span className="text-body-sm text-ink-2">{t.subject ?? 'No subject line'}</span>,
  },
  {
    key: 'meta',
    header: 'Provider template',
    cell: (t) => (
      <span className="font-mono text-body-sm text-ink-3">
        {t.providerTemplateId ?? 'Not registered'}
      </span>
    ),
  },
];

export function FlagsRoute(): React.JSX.Element {
  const { data, error } = useResource<PlatformAdmin>(
    '/api/admin/platform/config',
    'The flags and templates did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="The flags and templates did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;

  const { flags, templates } = data;

  return (
    <div className="tg-stack">
      <PageHeader title="Feature flags and notification templates">
        Two tables <span className="font-mono">03_UX_SPEC.md</span> §3C.7 builds screens on. Both
        exist in the schema. <strong>Neither is read by any file in the API</strong>, so a row in
        either would change nothing — which is a different fact from either being empty, and the
        more important of the two.
      </PageHeader>

      <Section
        title="Feature flags"
        subtitle="platform.feature_flag — key, enabled, rollout percentage, and a list of organisation ids to scope it to."
        aside={
          <span className="text-body-sm text-ink-3">
            <Num>{flags.rows.length}</Num> rows · <Num>{flags.readerCount}</Num> files read them
          </span>
        }
      >
        <Board tableMinWidth={720}>
          <DataBoard
            caption="Feature flags declared on the platform."
            columns={FLAG_COLUMNS}
            rows={flags.rows}
            rowKey={(f) => f.key}
            empty={
              <EmptyState
                title="No flag has ever been declared"
                body={
                  <>
                    <span className="block">
                      This is not &ldquo;every experiment is switched off&rdquo;. The table has no
                      rows AND no reader:{' '}
                      <span className="font-mono">platform.feature_flag</span> is named by no file
                      in the API, so inserting a row would not change what any request does.
                    </span>
                    <span className="mt-3 block text-ink-3">
                      §3C.7 also requires that a flag change affecting buyer-facing pricing or claims
                      needs a second-person approval, and that every toggle is audit-logged with
                      actor and reason. Neither exists, because there is nothing to toggle.
                    </span>
                  </>
                }
              />
            }
          />
        </Board>
      </Section>

      <Section
        title="Notification templates"
        subtitle="platform.notification_template — the versioned email, SMS and WhatsApp bodies every outbound message is supposed to be rendered from."
        aside={
          <span className="text-body-sm text-ink-3">
            <Num>{templates.rows.length}</Num> rows · <Num>{templates.readerCount}</Num> files read
            them
          </span>
        }
      >
        <Board tableMinWidth={900}>
          <DataBoard
            caption="Notification templates declared on the platform."
            columns={TEMPLATE_COLUMNS}
            rows={templates.rows}
            rowKey={(t) => `${t.code}:${t.channel}:${t.locale}:${t.version}`}
            empty={
              <EmptyState
                title="No template has ever been written"
                body={
                  <>
                    <span className="block">
                      And messages are going out anyway.{' '}
                      <span className="font-mono tnum text-ink">{templates.messagesSent}</span> rows
                      sit in <span className="font-mono">platform.notification_log</span>, composed
                      in code rather than rendered from a template — so there is no version history
                      behind what a vendor was actually told, and no place to change the wording
                      without a deploy.
                    </span>
                    <span className="mt-3 block text-ink-3">
                      The variable typing, the unknown-variable check that blocks activation, the
                      Meta approval status on a WhatsApp template and the marketing/transactional
                      split that DPDP and TRAI require are all §3C.7 requirements with no column to
                      hold them: the table has code, channel, locale, subject, body, version and an
                      active flag, and nothing else.
                    </span>
                  </>
                }
              />
            }
          />
        </Board>
      </Section>

      <Section
        title="What a flag would have to reach before this screen is worth a toggle"
        subtitle="Named so that building the toggle first is visibly the wrong order."
      >
        <p className="max-w-prose text-body-sm text-ink-2">
          A flag is only a flag if a request path consults it. The switches the product does
          consult are booleans in <span className="font-mono">platform_config</span> — the eight{' '}
          <span className="font-mono">qc.auto_approve_*</span> gates are read by the verdict service
          on every inspection, and they are what actually decides whether a machine goes on sale. A
          rollout percentage and an organisation scope solve a different problem, and the platform
          does not have that problem yet. Three keys that look like flags —{' '}
          <span className="font-mono">ordering.credit_enabled</span>,{' '}
          <span className="font-mono">tax.einvoice_enabled</span> and{' '}
          <span className="font-mono">dispatch.direct_allowed</span> — are read by nothing either,
          and the configuration board says so.
        </p>
      </Section>
    </div>
  );
}
