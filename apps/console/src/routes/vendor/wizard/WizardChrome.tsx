import * as React from 'react';
import { cn } from '@trugrade/ui';
import type { Step, StepStatus } from '@trugrade/ui';

export const WIZARD_STEP_META: Record<
  1 | 2 | 3 | 4,
  { title: string; subtitle: string; icon: 'machine' | 'condition' | 'serials' | 'price' }
> = {
  1: {
    title: 'Pick the machine',
    subtitle:
      'Search the master catalog by model or configuration. Every listing is against a SKU we already carry.',
    icon: 'machine',
  },
  2: {
    title: 'Declare the condition',
    subtitle: "Help us understand the laptop's condition to give it the right value.",
    icon: 'condition',
  },
  3: {
    title: 'Serial numbers',
    subtitle:
      'One serial per machine. We check each one against every live listing on the platform.',
    icon: 'serials',
  },
  4: {
    title: 'What you want to receive',
    subtitle:
      'Enter the amount you want in your account per machine, after everything. That number is what we hold you to.',
    icon: 'price',
  },
};

const STATUS_LABEL: Record<StepStatus, string | null> = {
  complete: 'Complete',
  current: 'In progress',
  upcoming: 'Pending',
  blocked: 'Blocked',
};

function StepIcon({ kind }: { kind: (typeof WIZARD_STEP_META)[1]['icon'] }): React.JSX.Element {
  const common = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true as const };
  if (kind === 'machine') {
    return (
      <svg {...common}>
        <rect x="4" y="7" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M4 19h20" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    );
  }
  if (kind === 'condition') {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" />
        <path d="M10 14l3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'serials') {
    return (
      <svg {...common}>
        <path
          d="M8 8h12M8 14h12M8 20h8"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M14 9v10M10 13h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function WizardStepHeader({ step }: { step: 1 | 2 | 3 | 4 }): React.JSX.Element {
  const meta = WIZARD_STEP_META[step];
  return (
    <div className="wizard-step-header">
      <div className="wizard-step-header-icon text-ink-2">
        <StepIcon kind={meta.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-h2 text-ink">{meta.title}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-ink-2">{meta.subtitle}</p>
      </div>
    </div>
  );
}

function ProgressCircle({ n, status }: { n: number; status: StepStatus }): React.JSX.Element {
  return (
    <span
      className={cn(
        'wizard-progress-circle',
        status === 'complete' && 'wizard-progress-circle-complete',
        status === 'current' && 'wizard-progress-circle-current',
        status === 'upcoming' && 'wizard-progress-circle-upcoming',
        status === 'blocked' && 'wizard-progress-circle-upcoming',
      )}
      aria-hidden="true"
    >
      {status === 'complete' ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2.5 7.2 5.5 10.2 11.5 3.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="font-mono text-data tnum">{n}</span>
      )}
    </span>
  );
}

export function WizardProgress({
  steps,
  onStepClick,
}: {
  steps: readonly Step[];
  onStepClick?: (stepNumber: number) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Listing wizard progress" className="wizard-progress">
      <ol className="wizard-progress-list">
        {steps.map((step, i) => {
          const n = i + 1;
          const statusLabel = STATUS_LABEL[step.status];
          const clickable = step.status === 'complete' && step.href && onStepClick;

          return (
            <li key={step.key} className="wizard-progress-item">
              <div className="wizard-progress-step">
                {clickable ? (
                  <button
                    type="button"
                    className="wizard-progress-hit"
                    onClick={() => onStepClick(n)}
                  >
                    <ProgressCircle n={n} status={step.status} />
                    <span className="wizard-progress-copy">
                      <span className="wizard-progress-title">
                        {n}. {step.label}
                      </span>
                      {statusLabel ? (
                        <span
                          className={cn(
                            'wizard-progress-status',
                            step.status === 'complete' && 'text-pass',
                            step.status === 'current' && 'text-acc-ink',
                            step.status === 'upcoming' && 'text-ink-3',
                            step.status === 'blocked' && 'text-fail',
                          )}
                        >
                          {statusLabel}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <div className="wizard-progress-hit" aria-current={step.status === 'current' ? 'step' : undefined}>
                    <ProgressCircle n={n} status={step.status} />
                    <span className="wizard-progress-copy">
                      <span
                        className={cn(
                          'wizard-progress-title',
                          step.status === 'current' ? 'text-ink' : 'text-ink-2',
                        )}
                      >
                        {n}. {step.label}
                      </span>
                      {statusLabel ? (
                        <span
                          className={cn(
                            'wizard-progress-status',
                            step.status === 'complete' && 'text-pass',
                            step.status === 'current' && 'text-acc-ink',
                            step.status === 'upcoming' && 'text-ink-3',
                            step.status === 'blocked' && 'text-fail',
                          )}
                        >
                          {statusLabel}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )}
              </div>
              {i < steps.length - 1 ? <span className="wizard-progress-line" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
