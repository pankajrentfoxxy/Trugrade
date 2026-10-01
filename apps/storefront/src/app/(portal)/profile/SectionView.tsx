'use client';

import * as React from 'react';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { Modal } from '@trugrade/ui';
import {
  getDocumentUrl,
  getDocuments,
  type KycDocument,
  type SessionView,
} from '../../register/api';
import { BUYER_DOCUMENTS, stateName, stateNameForGstin } from '../../register/picklists';
import type { ProfileSectionDef } from './sections.config';

/**
 * A profile card, read.
 *
 * Once a reviewer has verified the organisation the cards are locked, and the
 * hub used to draw them with no control at all: the one-line summary was the
 * whole of what a buyer could see of their own GSTIN, billing address or
 * delivery site. "Locked" and "hidden" are different things. This is the same
 * saved answers the edit dialogs load, laid out as facts rather than fields,
 * with nothing on it that writes.
 *
 * **A missing value is "Not given", in `--ink-4`.** Never a blank row, and
 * never left out — a card that shows six facts when it has six and four when
 * it has four is a card nobody can tell is incomplete.
 *
 * **The Preferences card can open its documents.** Its uploads are the one
 * answer that is not a value but a thing — "Uploaded" says a file exists and
 * nothing about which — so each uploaded document has a View control that
 * opens the file itself, through the same short-lived link the checklist uses
 * while the card is still editable. Still read-only: it opens, it does not
 * replace or remove. The supplier hub's Documents card does the same.
 */

export interface Fact {
  label: string;
  /** Null when nothing was saved. Rendered as "Not given", never as a blank. */
  value: string | null;
  /** Numbers, codes and identifiers set in mono with tabular figures. */
  mono?: boolean;
}

const str = (row: Record<string, unknown> | undefined, key: string): string | null => {
  const v = row?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const first = (rows: unknown): Record<string, unknown> | undefined =>
  Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;

/** The receiving window's days, in the words the Delivery card uses. */
const DAYS: Readonly<Record<string, string>> = {
  MON_FRI: 'Mon–Fri',
  MON_SAT: 'Mon–Sat',
  ALL: 'All days',
};

const CHANNEL: Readonly<Record<string, string>> = {
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
};

const LANGUAGE: Readonly<Record<string, string>> = { en: 'English', hi: 'Hindi' };

const address = (row: Record<string, unknown> | undefined): string | null => {
  const line1 = str(row, 'line1');
  if (!line1) return null;
  const line2 = str(row, 'line2');
  return line2 ? `${line1}, ${line2}` : line1;
};

/**
 * What each card holds, in the order the card asks for it.
 *
 * Read from the same places the edit bodies read — `session` for the account,
 * `onboarding.answers` for the rest — so the view cannot disagree with the
 * form that wrote it.
 */
export function sectionFacts(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding,
  session: SessionView,
): Fact[] {
  const answers = onboarding.answers;
  switch (section.id) {
    case 'account':
      return [
        { label: 'Name', value: session.fullName?.trim() || null },
        { label: 'Work email', value: session.email || null },
        { label: 'Mobile', value: session.mobile || null, mono: true },
      ];
    case 'tax': {
      const gst = first(answers.STATUTORY?.gstins);
      const company = answers.BUSINESS_PROFILE;
      const billing = first(answers.CONTACTS_ADDRESSES?.billing);
      const gstin = str(gst, 'gstin');
      const legal = str(company, 'legalName');
      const trade = str(company, 'tradeName');
      return [
        { label: 'GSTIN', value: gstin, mono: true },
        { label: 'Legal name', value: legal },
        // Only when it is a different name; "trading as" the legal name is noise.
        ...(trade && trade !== legal ? [{ label: 'Trading as', value: trade }] : []),
        { label: 'Constitution', value: str(company, 'constitution')?.replace(/_/g, ' ') ?? null },
        { label: 'Registered in', value: str(company, 'yearEstablished'), mono: true },
        {
          label: 'State of registration',
          value: gstin ? (stateNameForGstin(gstin) ?? null) : null,
        },
        { label: 'Billing address', value: address(billing) },
        { label: 'Billing city', value: str(billing, 'city') },
        { label: 'Billing state', value: stateName(str(billing, 'state') ?? '') ?? null },
        { label: 'Billing PIN code', value: str(billing, 'pincode'), mono: true },
      ];
    }
    case 'delivery': {
      const site = first(answers.CONTACTS_ADDRESSES?.delivery);
      const days = str(site, 'days');
      const opens = str(site, 'opensAt');
      const closes = str(site, 'closesAt');
      return [
        { label: 'Site', value: str(site, 'label') },
        { label: 'Address', value: address(site) },
        { label: 'City', value: str(site, 'city') },
        { label: 'State', value: stateName(str(site, 'state') ?? '') ?? null },
        { label: 'PIN code', value: str(site, 'pincode'), mono: true },
        { label: 'Signs for deliveries', value: str(site, 'contactName') },
        { label: 'Their mobile', value: str(site, 'contactMobile'), mono: true },
        {
          label: 'Receiving hours',
          value: days && opens && closes ? `${DAYS[days] ?? days} ${opens}–${closes}` : null,
        },
        { label: 'Gate instructions', value: str(site, 'gateInstructions') },
      ];
    }
    case 'preferences': {
      const prefs = answers.DOCUMENTS;
      const channels = Array.isArray(prefs?.channels)
        ? prefs.channels.filter((c): c is string => typeof c === 'string')
        : [];
      const language = str(prefs, 'language');
      return [
        {
          label: 'Purchase order number on orders',
          value: prefs?.poRequired === true ? 'Required' : prefs ? 'Not required' : null,
        },
        {
          label: 'How we reach you',
          value: channels.length > 0 ? channels.map((c) => CHANNEL[c] ?? c).join(', ') : null,
        },
        { label: 'Language', value: language ? (LANGUAGE[language] ?? language) : null },
      ];
    }
  }
}

export function SectionViewDialog({
  section,
  onboarding,
  session,
  onClose,
}: {
  section: ProfileSectionDef | null;
  onboarding: ResumableOnboarding;
  session: SessionView;
  onClose: () => void;
}): React.JSX.Element {
  const facts = section ? sectionFacts(section, onboarding, session) : [];
  const withDocuments = section?.id === 'preferences';
  return (
    <Modal
      open={section !== null}
      onClose={onClose}
      title={section?.title ?? ''}
      description="These details are approved and locked. To change anything, contact support."
      // It asks for nothing, so a click beside it may close it.
      dismissOnBackdrop
    >
      {withDocuments ? <DocumentFacts /> : null}
      <dl className="facts" data-testid="section-facts">
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            {f.value === null ? (
              <dd className="ink4">Not given</dd>
            ) : (
              <dd className={f.mono ? 'font-mono tnum' : undefined}>{f.value}</dd>
            )}
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** What each document type is called — the same words the checklist uses. */
const DOCUMENT_LABEL: Readonly<Record<string, string>> = {
  GST_CERTIFICATE: 'GST certificate',
  PAN_CARD: 'PAN card',
  SIGNATORY_ID: 'Signatory ID',
  PO_TEMPLATE: 'Purchase order template',
};

const labelOf = (docType: string, file: KycDocument | undefined): string =>
  DOCUMENT_LABEL[docType] ?? file?.label ?? docType.toLowerCase().replace(/_/g, ' ');

/**
 * The documents the Preferences card holds, read, with a way to open each.
 *
 * Mounted only while its dialog is showing, so the file list is read when the
 * buyer asks for it and not on every visit to the hub. The buyer's step saves
 * no record of which documents were sent — the checklist reads the list each
 * time — so the list is the only source here: a row is "Uploaded" when a file
 * of that type exists that a reviewer has not rejected, and a View control
 * appears only beside a file that is actually in the list.
 *
 * EVERY STATE
 * -----------
 *   - **Reading the list**: the rows say so, rather than "Not uploaded" about
 *     a file that is merely slow to list.
 *   - **The list would not load**: the rows say they could not be checked,
 *     the note says it is on our side, and offers to try again.
 *   - **Opening a file**: that row's control says "Opening…" and is disabled.
 *   - **A file would not open**: a message under that row, in the server's
 *     words, and the control is there to try again.
 */
function DocumentFacts(): React.JSX.Element {
  const [docs, setDocs] = React.useState<KycDocument[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<Readonly<Record<string, string>>>({});

  const load = React.useCallback((): void => {
    setListError(null);
    void getDocuments().then((result) => {
      if (result.ok) setDocs(result.data);
      else setListError(result.message);
    });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const view = async (type: string, id: string): Promise<void> => {
    setOpening(type);
    setRowError(({ [type]: _cleared, ...rest }) => rest);
    const result = await getDocumentUrl(id);
    setOpening(null);
    if (!result.ok) {
      setRowError((e) => ({ ...e, [type]: result.message }));
      return;
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <dl className="facts" data-testid="document-facts">
        {BUYER_DOCUMENTS.map(({ docType }) => {
          const file = docs?.find((d) => d.docType === docType && d.status !== 'REJECTED');
          const label = labelOf(docType, file);
          const problem = rowError[docType];
          return (
            <div key={docType} data-has-note={problem ? 'true' : undefined}>
              <dt>{label}</dt>
              {file ? (
                <dd>
                  <span>Uploaded</span>
                  <button
                    type="button"
                    className="facts-action"
                    disabled={opening === docType}
                    aria-label={`View ${label}`}
                    onClick={() => void view(docType, file.id)}
                  >
                    {opening === docType ? 'Opening…' : 'View'}
                  </button>
                </dd>
              ) : (
                <dd className="ink4">
                  {docs ? 'Not uploaded' : listError ? 'Could not check' : 'Checking…'}
                </dd>
              )}
              {problem ? (
                <p className="facts-note" role="alert">
                  We could not open this file. {problem}
                </p>
              ) : null}
            </div>
          );
        })}
      </dl>
      {listError ? (
        <p className="facts-note" role="alert" data-testid="documents-unavailable">
          We could not load your documents. That is on our side, not yours. {listError}{' '}
          <button type="button" className="facts-action" onClick={load}>
            Try again
          </button>
        </p>
      ) : null}
    </>
  );
}
