import * as React from 'react';
import { Button, Input, OtpInput, StatusPill } from '@trugrade/ui';
import { Section, Select } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { send } from './api';
import type { TechnicianOption, VisitDetail } from './types';

/**
 * Everything that moves a visit forward, on one panel.
 *
 * The console could read a visit in full and change nothing about it: booking a
 * date, assigning a technician, arriving, taking the vendor's sign-off and
 * closing were all endpoints with no caller anywhere. A vendor-raised visit
 * therefore sat at REQUESTED for ever and the machines on it could never reach
 * the storefront. This is that missing half.
 *
 * Each block is drawn only in the statuses where the server would accept it, so
 * the screen never offers an action that is about to 409.
 */

/** Statuses a date and a technician may still be written on. */
const SCHEDULABLE = ['REQUESTED', 'QUOTED', 'SCHEDULED', 'TECH_ASSIGNED', 'RESCHEDULED'];

export function VisitActions({
  visit,
  onChanged,
}: {
  visit: VisitDetail;
  /** The record reloads after every write; the confirmation lives here. */
  onChanged: () => void;
}): React.JSX.Element | null {
  const principal = usePrincipal();
  const may = (p: string): boolean => principal?.permissions.includes(p) ?? false;
  const canSchedule = may('qc.visit.schedule');
  const canExecute = may('qc.visit.execute');

  if (!canSchedule && !canExecute) return null;

  return (
    <Section title="What happens next" subtitle="Booking, arrival, sign-off and closing.">
      <div className="flex flex-col gap-6">
        {canSchedule && SCHEDULABLE.includes(visit.status) ? (
          <ScheduleBlock visit={visit} onChanged={onChanged} />
        ) : null}
        {canExecute && ['SCHEDULED', 'TECH_ASSIGNED', 'EN_ROUTE'].includes(visit.status) ? (
          <CheckInBlock visit={visit} onChanged={onChanged} />
        ) : null}
        {canExecute && visit.status === 'IN_PROGRESS' ? (
          <SignoffBlock visit={visit} onChanged={onChanged} />
        ) : null}
        {canExecute && visit.status === 'IN_PROGRESS' && visit.vendorSignoffAt ? (
          <CloseBlock visit={visit} onChanged={onChanged} />
        ) : null}
        {['COMPLETED', 'PARTIALLY_COMPLETED'].includes(visit.status) ? (
          <p className="text-body-sm text-ink-2">
            This visit is closed. Passed machines are sealed, listed and on sale; failed ones are
            not, and the vendor sees why on their own screen.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** A refusal is shown in the server's own words, next to the thing that caused it. */
function useAction(onChanged: () => void): {
  busy: boolean;
  error: string | null;
  note: string | null;
  run: (label: string, fn: () => Promise<string | null>) => Promise<void>;
} {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setNote(await fn());
      onChanged();
    } catch (e) {
      setError(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, note, run };
}

function Feedback({
  error,
  note,
}: {
  error: string | null;
  note: string | null;
}): React.JSX.Element | null {
  if (error) {
    return (
      <p role="alert" className="text-body-sm text-fail">
        {error}
      </p>
    );
  }
  if (note) {
    return (
      <p role="status" className="text-body-sm text-ink-2">
        {note}
      </p>
    );
  }
  return null;
}

function ScheduleBlock({
  visit,
  onChanged,
}: {
  visit: VisitDetail;
  onChanged: () => void;
}): React.JSX.Element {
  const { data: technicians } = useResource<TechnicianOption[]>(
    '/api/qc/technicians',
    'Technicians unavailable',
  );
  const { busy, error, note, run } = useAction(onChanged);
  const [date, setDate] = React.useState(visit.scheduledDate ?? '');
  const [from, setFrom] = React.useState('10:00');
  const [to, setTo] = React.useState('13:00');
  const [technicianId, setTechnicianId] = React.useState('');

  const active = (technicians ?? []).filter((t) => t.isActive);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-medium text-ink">
        {visit.scheduledDate ? 'Move this visit' : 'Book this visit'}
      </h3>
      <div className="grid gap-4 md:grid-cols-4">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <Input label="From" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select
          label="Technician"
          value={technicianId}
          onChange={(e) => setTechnicianId(e.target.value)}
          options={[
            { value: '', label: 'Decide later' },
            ...active.map((t) => ({ value: t.id, label: `${t.name} · ${t.employeeCode}` })),
          ]}
        />
      </div>
      {active.length === 0 ? (
        <p className="text-body-sm text-ink-3">
          No active technician is registered, so the visit can be dated but not assigned.
        </p>
      ) : null}
      <div>
        <Button
          variant="primary"
          loading={busy}
          {...(date ? {} : { disabledReason: 'Choose the date of the visit first.' })}
          onClick={() =>
            void run('The visit was not booked', async () => {
              await send(
                `/api/qc/visits/${visit.id}/schedule`,
                'POST',
                {
                  scheduledDate: date,
                  slotFrom: from,
                  slotTo: to,
                  ...(technicianId ? { technicianId } : {}),
                },
                'The visit could not be booked',
              );
              return technicianId
                ? 'Booked, and the technician is assigned.'
                : 'Booked. Assign a technician before the day.';
            })
          }
        >
          {visit.scheduledDate ? 'Move the visit' : 'Book the visit'}
        </Button>
      </div>
      <Feedback error={error} note={note} />
    </div>
  );
}

/**
 * Arrival. The coordinates come from the device that is actually at the site —
 * `geo_variance_metres` is only worth recording if it was measured, so a browser
 * that will not give a position cannot check in.
 */
function CheckInBlock({
  visit,
  onChanged,
}: {
  visit: VisitDetail;
  onChanged: () => void;
}): React.JSX.Element {
  const { busy, error, note, run } = useAction(onChanged);
  const [denied, setDenied] = React.useState<string | null>(null);

  const position = async (): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser cannot report a location.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message)), {
        enableHighAccuracy: true,
        timeout: 15_000,
      });
    });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-medium text-ink">Arrive and start the inspection</h3>
      <p className="text-body-sm text-ink-2">
        Press this at the warehouse. We record where you were, so an inspection done somewhere else
        is visible rather than invisible.
      </p>
      {visit.status === 'SCHEDULED' ? (
        <p className="text-body-sm text-ink-3">
          No technician is assigned yet. Assign one above first.
        </p>
      ) : null}
      <div>
        <Button
          variant="primary"
          loading={busy}
          {...(visit.status === 'SCHEDULED'
            ? { disabledReason: 'Assign a technician before arriving.' }
            : {})}
          onClick={() =>
            void run('The visit was not started', async () => {
              setDenied(null);
              let at: GeolocationPosition;
              try {
                at = await position();
              } catch (e) {
                setDenied(
                  `We could not read this device's location (${(e as Error).message}). Allow location for this site, then press again.`,
                );
                throw new Error('location unavailable');
              }
              const result = await send<{ geoVarianceMetres: number | null; alerted: boolean }>(
                `/api/qc/visits/${visit.id}/check-in`,
                'POST',
                { latitude: at.coords.latitude, longitude: at.coords.longitude },
                'Check-in failed',
              );
              return result.geoVarianceMetres === null
                ? 'Checked in. The inspection can start.'
                : `Checked in ${Math.round(result.geoVarianceMetres)} m from the registered address.`;
            })
          }
        >
          Check in
        </Button>
      </div>
      {denied ? (
        <p role="alert" className="text-body-sm text-fail">
          {denied}
        </p>
      ) : (
        <Feedback error={error} note={note} />
      )}
    </div>
  );
}

function SignoffBlock({
  visit,
  onChanged,
}: {
  visit: VisitDetail;
  onChanged: () => void;
}): React.JSX.Element {
  const { busy, error, note, run } = useAction(onChanged);
  const [sent, setSent] = React.useState<{ sentTo: string; devCode: string | null } | null>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');

  if (visit.vendorSignoffAt) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-body font-medium text-ink">Vendor sign-off</h3>
        <StatusPill
          className="self-start"
          tone="pass"
          label={`Signed by ${visit.vendorSignoffName ?? 'the site contact'}`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-medium text-ink">Vendor sign-off</h3>
      <p className="text-body-sm text-ink-2">
        The site contact gets a code by SMS with what was found. They read it back to you, and that
        is what stops &ldquo;you never told me it failed&rdquo;.
      </p>
      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-ink-2">
            Code sent to <span className="font-mono tnum">{sent.sentTo}</span>.
          </p>
          <Input
            label="Who signed"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <OtpInput label="Their code" value={code} onChange={setCode} disabled={busy} />
          {sent.devCode ? (
            <p className="text-body-sm text-ink-3">
              Testing mode — the code is <span className="font-mono tnum">{sent.devCode}</span>.
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              loading={busy}
              {...(name.trim().length >= 2 && code.length >= 4
                ? {}
                : { disabledReason: 'Enter who signed and the code they read out.' })}
              onClick={() =>
                void run('The sign-off was not accepted', async () => {
                  await send(
                    `/api/qc/visits/${visit.id}/signoff`,
                    'POST',
                    { otp: code, contactName: name.trim() },
                    'The code was refused',
                  );
                  setCode('');
                  return 'Signed off. The visit can be closed.';
                })
              }
            >
              Record the sign-off
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run('The code was not sent', async () => {
                const issued = await send<{ sentTo: string; devCode?: string }>(
                  `/api/qc/visits/${visit.id}/signoff/otp`,
                  'POST',
                  {},
                  'The code could not be sent',
                );
                setSent({ sentTo: issued.sentTo, devCode: issued.devCode ?? null });
                return null;
              })
            }
          >
            Send the sign-off code
          </Button>
        </div>
      )}
      <Feedback error={error} note={note} />
    </div>
  );
}

function CloseBlock({
  visit,
  onChanged,
}: {
  visit: VisitDetail;
  onChanged: () => void;
}): React.JSX.Element {
  const { busy, error, note, run } = useAction(onChanged);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-medium text-ink">Close the visit</h3>
      <p className="text-body-sm text-ink-2">
        Closing lists every passed and sealed machine for sale and marks the rest failed. Every
        machine on the manifest needs an outcome first.
      </p>
      <div>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            void run('The visit was not closed', async () => {
              const result = await send<{ unitsListed: number; unitsFailed: number }>(
                `/api/qc/visits/${visit.id}/close`,
                'POST',
                {},
                'The visit could not be closed',
              );
              return `Closed. ${result.unitsListed} on sale, ${result.unitsFailed} failed.`;
            })
          }
        >
          Close the visit
        </Button>
      </div>
      <Feedback error={error} note={note} />
    </div>
  );
}
