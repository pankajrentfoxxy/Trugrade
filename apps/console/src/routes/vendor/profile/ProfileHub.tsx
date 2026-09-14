import * as React from 'react';
import {
  Button,
  HubPageHeader,
  EmptyState,
  HubKpiRow,
  Skeleton,
  StatusPill,
  useToast,
} from '@trugrade/ui';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { getOnboarding } from '../../../../../storefront/src/app/register/api';
import { useAuth } from '../../../lib/auth';
import { useResource } from '../../../lib/useResource';
import { useOnboardingReload } from '../../../lib/vendorOnboarding';
import { SubmitForReview } from './SubmitForReview';
import { API, type OrgProfile } from '../profile-api';
import { BusinessGstSection } from './sections/BusinessGstSection';
import { PickupSection } from './sections/PickupSection';
import { BankSection } from './sections/BankSection';
import { DocumentsSection } from './sections/DocumentsSection';
import { AgreementSection } from './sections/AgreementSection';
import { StockSection } from './sections/StockSection';
import {
  PROFILE_SECTIONS,
  nextIncompleteSection,
  profileCompletionPct,
  sectionIsDone,
  sectionSummary,
  type ProfileSectionId,
} from './sections.config';
import './profile-hub.css';

/**
 * ARCHETYPE C — Record cards that open Archetype F dialogs.
 */
/** The org's status in the supplier's words. "In progress" used to cover all of these. */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  VERIFIED: 'Verified',
  PROFILE_SUBMITTED: 'In review',
  KYC_SUBMITTED: 'In review',
  UNDER_REVIEW: 'In review',
  INFO_REQUESTED: 'Changes requested',
  REJECTED: 'Not approved',
  SUSPENDED: 'Suspended',
};

export function ProfileHub(): React.JSX.Element {
  const { principal } = useAuth();
  const { token, reload } = useOnboardingReload();
  const { data: profile } = useResource<OrgProfile>(`${API}/account/profile`, 'Profile', token);
  const [onboarding, setOnboarding] = React.useState<ResumableOnboarding | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<ProfileSectionId | null>(null);
  const toast = useToast();

  const loadOnboarding = React.useCallback(async (): Promise<void> => {
    const result = await getOnboarding();
    if (!result.ok) {
      setLoadError(result.message);
      setOnboarding(null);
      return;
    }
    setLoadError(null);
    setOnboarding(result.data);
  }, []);

  React.useEffect(() => {
    void loadOnboarding();
  }, [loadOnboarding, token]);

  const pct = profileCompletionPct(onboarding ?? undefined);
  const legalName =
    profile?.legalName ?? String(onboarding?.answers.STATUTORY?.legalName ?? 'Your business');

  const handleSaved = (sectionId: ProfileSectionId): void => {
    void (async () => {
      const result = await getOnboarding();
      if (!result.ok) return;
      const fresh = result.data;
      setOnboarding(fresh);
      setOpen(null);
      // The shell's banner reads the same progress; keep it in step.
      reload();
      const next = nextIncompleteSection(sectionId, fresh);
      if (next) {
        window.setTimeout(() => setOpen(next.id), 700);
        return;
      }
      if (profileCompletionPct(fresh) >= 100) {
        toast({
          tone: 'success',
          title: 'Profile complete',
          body: 'Every required section is saved. Submit it for review from this page.',
        });
      }
    })();
  };

  if (!onboarding && !loadError) {
    return (
      <>
        <HubPageHeader title="Supplier profile" />
        <Skeleton lines={8} />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <HubPageHeader title="Supplier profile" />
        <EmptyState title="Profile progress did not load" body={loadError} />
      </>
    );
  }

  return (
    <>
      <HubPageHeader
        title="Supplier profile"
        actions={
          pct >= 100 ? (
            <StatusPill tone="pass" label="Required sections complete" />
          ) : (
            <StatusPill tone="warn" label={`${pct}% complete`} />
          )
        }
      />

      <HubKpiRow
        cells={[
          { label: 'Progress', value: `${pct}%`, sub: 'required sections' },
          {
            label: 'Status',
            value: (onboarding && STATUS_LABEL[onboarding.status]) ?? 'Not submitted',
            sub: 'listing unlocks after approval',
          },
        ]}
      />

      {onboarding ? (
        <SubmitForReview className="mt-6" onboarding={onboarding} roles={principal?.roles ?? []} />
      ) : null}

      <div className="profile-hub-grid mt-6">
        {PROFILE_SECTIONS.map((section, index) => {
          const done = sectionIsDone(section, onboarding ?? undefined);
          return (
            <article
              key={section.id}
              className="profile-hub-card"
              data-done={done ? 'true' : 'false'}
            >
              <div className="profile-hub-card-head">
                <span className="profile-hub-icon">{done ? '✓' : index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-h3 text-ink">{section.title}</h2>
                  {!section.required ? (
                    <StatusPill className="mt-1" tone="info" label="Recommended" />
                  ) : (
                    <p className="profile-hub-weight mt-1">{section.weight}% of profile</p>
                  )}
                </div>
                {done ? <StatusPill tone="pass" label="Done" /> : null}
                {!done && section.required ? <StatusPill tone="warn" label="Required" /> : null}
              </div>
              <p className="profile-hub-summary">
                {sectionSummary(section, onboarding ?? undefined)}
              </p>
              <Button variant={done ? 'secondary' : 'primary'} onClick={() => setOpen(section.id)}>
                {done ? 'Edit' : 'Fill now'}
              </Button>
            </article>
          );
        })}
      </div>

      <BusinessGstSection
        open={open === 'business'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('business')}
        initial={onboarding?.answers.STATUTORY ?? {}}
        initialConstitution={onboarding?.progress.constitution ?? null}
      />
      <PickupSection
        open={open === 'pickup'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('pickup')}
        initial={onboarding?.answers.FACILITY_CONTACTS ?? {}}
      />
      <BankSection
        open={open === 'bank'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('bank')}
        initial={onboarding?.answers.DOCUMENTS_BANK ?? {}}
        legalName={legalName}
      />
      <DocumentsSection
        open={open === 'documents'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('documents')}
        initial={onboarding?.answers.DOCUMENTS_BANK ?? {}}
      />
      <AgreementSection
        open={open === 'agreement'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('agreement')}
        initial={onboarding?.answers.AGREEMENT ?? {}}
        legalName={legalName}
      />
      <StockSection
        open={open === 'stock'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('stock')}
        initial={onboarding?.answers.CAPABILITY ?? {}}
      />
    </>
  );
}
