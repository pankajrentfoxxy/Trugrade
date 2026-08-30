'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Button, DataBoard, EmptyState, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import type { ApiFailure } from '../../register/api';
import { inIst } from '../../../lib/deadline';
import { getTeam, updateMember, type Team, type TeamMember, type TeamRole } from '../api';

/**
 * The team board. See `page.tsx` for the archetype and the rules.
 *
 * A client component: authenticated read, and every row action writes.
 */

/** What each role is for, in the words a buyer uses. The server has the codes. */
const ROLE_LABEL: Record<string, string> = {
  CUSTOMER_OWNER: 'Account owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Procurer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};

const ROLE_WHAT: Record<string, string> = {
  CUSTOMER_OWNER: 'Everything, including who else can do what.',
  CUSTOMER_ADMIN: 'Runs the account and its people. Cannot approve spending.',
  CUSTOMER_BUYER: 'Raises orders. Anything over your threshold goes to an approver.',
  CUSTOMER_APPROVER: 'Signs off orders raised by somebody else. Never their own.',
  CUSTOMER_FINANCE: 'Invoices and credit notes.',
  CUSTOMER_VIEWER: 'Reads orders. Changes nothing.',
};

const label = (code: string): string => ROLE_LABEL[code] ?? code;

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'forbidden' }
  | { k: 'error'; message: string }
  | { k: 'ready'; team: Team };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your account just now. That is our problem, not yours — nobody’s access has changed.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function TeamBoard({ role, status }: { role: string; status: string }): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [editing, setEditing] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getTeam();
    if (result.ok) setPhase({ k: 'ready', team: result.data });
    else if (result.status === 401) setPhase({ k: 'signed-out' });
    else if (result.status === 403) setPhase({ k: 'forbidden' });
    else setPhase({ k: 'error', message: problem(result) });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setFilter = (key: string, value: string): void => {
    const next = new URLSearchParams();
    if (key === 'role' ? value : role) next.set('role', key === 'role' ? value : role);
    if (key === 'status' ? value : status) next.set('status', key === 'status' ? value : status);
    const qs = next.toString();
    // `typedRoutes` cannot prove a runtime string is a route. One cast, one line.
    router.push((qs ? `/account/team?${qs}` : '/account/team') as Route, { scroll: false });
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'forbidden') return <NotYours />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const team = phase.k === 'ready' ? phase.team : null;
  const members = (team?.members ?? []).filter(
    (m) => (!role || m.roles.includes(role)) && (!status || m.status === status),
  );
  const filtered = Boolean(role || status);

  return (
    <>
      <div className="wshead obhead">
        <h1>Your team</h1>
        <p>
          Everybody who can sign in on your organisation&rsquo;s account, and what each of them may
          do. A role change takes effect on their next request and they are told about it.
        </p>
      </div>

      <div className="cols">
        <Rail
          team={team}
          role={role}
          status={status}
          onSet={setFilter}
          onClear={() => router.push('/account/team' as Route, { scroll: false })}
        />

        <main>
          <div className="rbar">
            <span className="cnt">
              {team === null ? (
                <span className="ink4">Counting your team…</span>
              ) : (
                <>
                  <b className="mono">{members.length}</b>{' '}
                  {members.length === 1 ? 'person' : 'people'}
                  {filtered && ' match that filter'}
                  {' · '}
                  <b className="mono">{team.owners}</b> account{' '}
                  {team.owners === 1 ? 'owner' : 'owners'}
                </>
              )}
            </span>
          </div>

          {team !== null && members.length === 0 ? (
            <Nothing filtered={filtered} onClear={() => router.push('/account/team' as Route)} />
          ) : (
            <div className="tbl tboard">
              <DataBoard
                caption={
                  team === null
                    ? 'Loading your team.'
                    : `${members.length} ${members.length === 1 ? 'person' : 'people'} on your organisation's account, account owners first.`
                }
                columns={columns(team, (id) => setEditing(id))}
                rows={members}
                rowKey={(m) => m.id}
                loading={team === null}
                skeletonRows={5}
              />
            </div>
          )}

          {team !== null && editing !== null && (
            <RoleEditor
              member={members.find((m) => m.id === editing) ?? team.members.find((m) => m.id === editing)!}
              roles={team.roles}
              onClose={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
            />
          )}

          {team !== null && (
            <p className="fnote off tnote">
              <b>There is no invite button yet.</b> Somebody joins your organisation by registering
              against it, and an account owner then gives them a role here. When invitations exist
              they will live on this screen; until then a control that opened a form leading nowhere
              would be worse than none.
            </p>
          )}
        </main>
      </div>
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

function columns(team: Team | null, onEdit: (id: string) => void): ReadonlyArray<Column<TeamMember>> {
  return [
    {
      key: 'person',
      header: 'Person',
      cell: (m) => (
        <span className="obord">
          <b>
            {m.fullName}
            {m.isYou && <span className="tyou">you</span>}
          </b>
          <span className="obwhen mono">
            {m.email ?? m.mobile ?? <span className="notmeasured">No contact recorded</span>}
          </span>
          {m.jobTitle && <span className="obwhen">{m.jobTitle}</span>}
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'What they may do',
      cell: (m) => (
        <span className="troles">
          {m.roles.length === 0 ? (
            // Not a blank cell: an account with no role can sign in and see
            // nothing, which looks like a bug rather than a decision.
            <span className="notmeasured">No role — they can sign in and see nothing</span>
          ) : (
            m.roles.map((r) => (
              // Neutral. A role is not a verdict, so it carries no PASS/FAIL colour.
              <span className="tchip" key={r} title={ROLE_WHAT[r] ?? r}>
                {label(r)}
              </span>
            ))
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Account',
      cell: (m) => (
        <span className="obord">
          <StatusPill
            tone="neutral"
            label={m.status === 'ACTIVE' ? 'Active' : m.status === 'SUSPENDED' ? 'Switched off' : m.status}
          />
          <span className="obwhen">
            {m.lastLoginAt === null ? (
              // Never signed in. Never drawn as a date, and never as a tick.
              <span className="notmeasured">Never signed in</span>
            ) : (
              <>last in {inIst(m.lastLoginAt)}</>
            )}
          </span>
          <span className="obwhen">
            {m.mfaEnabled ? (
              'Second factor on'
            ) : (
              <span className="notmeasured">No second factor</span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'act',
      header: 'Action',
      cell: (m) => <RowActions member={m} team={team} onEdit={onEdit} />,
    },
  ];
}

function RowActions({
  member,
  team,
  onEdit,
}: {
  member: TeamMember;
  team: Team | null;
  onEdit: (id: string) => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  if (member.lockedReason !== null) {
    // The reason, in words, instead of a greyed-out control with no explanation.
    return <span className="ablocked">{member.lockedReason}</span>;
  }

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await updateMember(member.id, {
      status: member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
    });
    setBusy(false);
    if (result.ok) window.location.reload();
    else setFailure(result.message);
  };

  return (
    <span className="tact">
      <button type="button" className="sel gh" onClick={() => onEdit(member.id)}>
        Change roles
      </button>
      <Button variant="ghost" size="sm" loading={busy} onClick={() => void toggle()}>
        {member.status === 'ACTIVE' ? 'Switch off' : 'Switch on'}
      </Button>
      {team !== null && member.status === 'ACTIVE' && member.roles.includes('CUSTOMER_OWNER') && (
        <span className="obwhen">
          <span className="mono">{team.owners}</span> owners on the account
        </span>
      )}
      {failure !== null && (
        <span className="adrfail" role="alert">
          {failure}
        </span>
      )}
    </span>
  );
}

/* ==========================================================================
 * Changing what somebody may do — the screen's one primary action
 * ======================================================================== */

function RoleEditor({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  roles: readonly TeamRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [picked, setPicked] = React.useState<string[]>(member.roles);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const none = picked.length === 0;

  const save = async (): Promise<void> => {
    if (none) return;
    setBusy(true);
    setFailure(null);
    const result = await updateMember(member.id, { roles: picked });
    setBusy(false);
    if (result.ok) await onSaved();
    else setFailure(result.message);
  };

  return (
    <section className="troleedit" aria-labelledby="editing">
      <div className="sh">
        <div className="shrow">
          <h2 id="editing">What {member.fullName} may do</h2>
          <span className="sub">Takes effect on their next request</span>
        </div>
      </div>

      {failure !== null && (
        <p className="adrfail" role="alert">
          {failure}
        </p>
      )}

      <ul className="trolelist">
        {roles.map((r) => {
          const on = picked.includes(r.code);
          return (
            <li key={r.code} className={r.assignable ? undefined : 'off'}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!r.assignable}
                  onChange={() =>
                    setPicked((p) => (on ? p.filter((c) => c !== r.code) : [...p, r.code]))
                  }
                />
                <span className="l">{label(r.code)}</span>
                <span className="d">{ROLE_WHAT[r.code] ?? r.description ?? r.code}</span>
                {!r.assignable && (
                  // Said, not merely disabled. The reason is specific: you
                  // cannot hand out a power you do not hold yourself.
                  <span className="d off">
                    You cannot give this out, because it grants more than your own account can do.
                    An account owner can.
                  </span>
                )}
                <span className="d mono">
                  {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {none && (
        <p className="adechint">
          Pick at least one role. Somebody with none can sign in and see nothing, which looks like a
          broken account — switch them off instead.
        </p>
      )}

      <div className="tsave">
        <Button
          variant="primary"
          loading={busy}
          {...(none ? { disabledReason: 'Pick at least one role first.' } : {})}
          onClick={() => void save()}
        >
          Save these roles
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/* ==========================================================================
 * The rail
 * ======================================================================== */

function Rail({
  team,
  role,
  status,
  onSet,
  onClear,
}: {
  team: Team | null;
  role: string;
  status: string;
  onSet: (key: string, value: string) => void;
  onClear: () => void;
}): React.JSX.Element {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const applied = (role ? 1 : 0) + (status ? 1 : 0);
  const count = (code: string): number =>
    (team?.members ?? []).filter((m) => m.roles.includes(code)).length;

  return (
    <div className="railzone">
      {/* Under 900px the rail is a full-screen sheet behind this button. It is
          hidden on desktop by CSS, never by a resize listener in JavaScript. */}
      <button
        type="button"
        className="fsheetbtn"
        onClick={() => setSheetOpen(true)}
        aria-expanded={sheetOpen}
        aria-controls="team-filters"
      >
        Filters
      </button>

      <aside
        id="team-filters"
        className={sheetOpen ? 'filters open' : 'filters'}
        aria-label="Team filters"
      >
        <div className="fhead">
          <b>Filters</b>
          <span className="n mono">{applied} applied</span>
          <button type="button" className="clr" onClick={onClear} disabled={applied === 0}>
            Clear all
          </button>
          <button type="button" className="fclose" onClick={() => setSheetOpen(false)}>
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">Close filters</span>
          </button>
        </div>

        <details open>
          <summary>Role</summary>
          <div className="fbody">
            {team === null ? (
              <p className="fnote">Counting…</p>
            ) : (
              team.roles.map((r) => {
                const on = role === r.code;
                const n = count(r.code);
                // Zero-count options are disabled, never hidden.
                const empty = n === 0 && !on;
                return (
                  <label key={r.code} className={empty ? 'fopt off' : 'fopt'}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={empty}
                      onChange={() => onSet('role', on ? '' : r.code)}
                    />
                    {label(r.code)}
                    <span className="c mono">{n}</span>
                  </label>
                );
              })
            )}
          </div>
        </details>

        <details open>
          <summary>Account</summary>
          <div className="fbody">
            {(['ACTIVE', 'SUSPENDED'] as const).map((s) => {
              const on = status === s;
              const n = (team?.members ?? []).filter((m) => m.status === s).length;
              const empty = team !== null && n === 0 && !on;
              return (
                <label key={s} className={empty ? 'fopt off' : 'fopt'}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={empty}
                    onChange={() => onSet('status', on ? '' : s)}
                  />
                  {s === 'ACTIVE' ? 'Active' : 'Switched off'}
                  <span className="c mono">{n}</span>
                </label>
              );
            })}
          </div>
        </details>

        <p className="fnote off">
          Switching an account off never deletes it. The orders that person raised keep naming them,
          and their live sessions end straight away.
        </p>

        <div className="fdone">
          <button type="button" onClick={() => setSheetOpen(false)}>
            Show these people
          </button>
        </div>
      </aside>

      {sheetOpen && (
        <button
          type="button"
          className="fscrim"
          aria-label="Close filters"
          onClick={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function Nothing({ filtered, onClear }: { filtered: boolean; onClear: () => void }): React.JSX.Element {
  if (!filtered) {
    return (
      <div className="empty">
        <h3>Just you, so far</h3>
        <p>
          Nobody else has an account on your organisation yet. Somebody joins by registering against
          your organisation; once they have, they appear here and you give them a role.
        </p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h3>Nobody on your team matches that</h3>
      <p>
        Every option in the rail shows how many people it would return on its own, so the one
        reading <span className="mono">0</span> is the one that emptied this.
      </p>
      <p className="retry">
        <button type="button" className="pill acc" onClick={onClear}>
          Clear the filters
        </button>
      </p>
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your team"
        body="Who can act on an organisation's account is that organisation's business, so we need to know who is asking."
        action={
          <a className="pill acc" href="/sign-in?next=%2Faccount%2Fteam">
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * Signed in, and this is not theirs to see.
 *
 * A distinct state from signed-out on purpose: telling somebody to sign in when
 * they already are is the most confusing refusal a product can give.
 */
function NotYours(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Only an account owner or admin can see who is on the account"
        body="You are signed in, so this is not a sign-in problem. Who may act on your organisation's account, and what they may spend, is managed by your account owner."
        action={
          <a className="pill acc" href="/account">
            Back to your account
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not open your team</h3>
        <p>{message}</p>
        <p>Nobody&rsquo;s access has changed.</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}

export function TeamSkeleton(): React.JSX.Element {
  return (
    <div className="cols">
      <Skeleton className="skrail" />
      <div>
        <Skeleton className="h-12 w-full rounded" />
        <Skeleton className="mt-3 h-96 w-full rounded-lg" />
      </div>
    </div>
  );
}
