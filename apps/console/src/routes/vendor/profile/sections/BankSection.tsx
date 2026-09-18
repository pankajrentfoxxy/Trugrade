import * as React from 'react';
import { bankCommitRefusal, persistInOrder } from '../persist';
import { OTP_POLICY } from '@trugrade/contracts';
import { Button, Input, OtpInput, SectionDialog } from '@trugrade/ui';
import {
  commitBankAccount,
  lookupIfsc,
  pennyDrop,
  requestBankChangeCode,
  saveStep,
  type VerificationOutcomeView,
} from '../../../../../../storefront/src/app/register/api';
import {
  ProviderProblem,
  isProviderProblem,
  useRetryLadder,
} from '../../../../../../storefront/src/app/register/verification';
import {
  ACCOUNT_NUMBER_MAX_DIGITS,
  toAccountNumber,
  toIfsc,
  typeAccountNumber,
  typeIfsc,
  validateAccountNumber,
  validateIfsc,
} from '../../../../../../storefront/src/app/register/validation';
import { liveFieldError } from '../live-field';

export interface BankDraft {
  ifsc: string;
  bank: string;
  branch: string;
  account: string;
  confirmAccount: string;
  verified: VerificationOutcomeView | null;
}

export interface BankSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
  legalName: string;
}

export function BankSection({
  open,
  onClose,
  onSaved,
  initial,
  legalName,
}: BankSectionProps): React.JSX.Element {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [draft, setDraft] = React.useState<BankDraft>({
    ifsc: String(initial.ifsc ?? ''),
    bank: String(initial.bankName ?? ''),
    branch: String(initial.branch ?? ''),
    account: '',
    confirmAccount: '',
    verified: null,
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  // The fresh code every payout change needs, whatever the role. See the API's
  // BankChangeService: the factor sits on the operation, not only on the seat.
  const [code, setCode] = React.useState('');
  const [codeSentTo, setCodeSentTo] = React.useState<string | null>(null);
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);
  const [focused, setFocused] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Partial<Record<string, boolean>>>({});

  const dropRef = React.useRef<() => void>(() => undefined);
  const retry = useRetryLadder(() => dropRef.current());

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setCode('');
      setCodeSentTo(null);
      setDevCode(null);
      setDraft({
        ifsc: String(initial.ifsc ?? ''),
        bank: String(initial.bankName ?? ''),
        branch: String(initial.branch ?? ''),
        account: '',
        confirmAccount: '',
        verified: null,
      });
      setError(undefined);
    }
  }, [open, initial]);

  const resolveIfsc = async (code: string): Promise<void> => {
    const msg = validateIfsc(code);
    if (msg) return;
    setBusy(true);
    const result = await lookupIfsc(toIfsc(code));
    setBusy(false);
    if (!result.ok) {
      setError(result.fields.ifsc ?? result.message);
      setDraft((d) => ({ ...d, bank: '', branch: '' }));
      return;
    }
    setDraft((d) => ({
      ...d,
      bank: result.data.bank,
      branch: `${result.data.branch}, ${result.data.city}`,
    }));
    setError(undefined);
  };

  const runPennyDrop = async (): Promise<void> => {
    const ifscErr = validateIfsc(draft.ifsc);
    const acctErr = validateAccountNumber(draft.account);
    if (ifscErr || acctErr) {
      setError(ifscErr ?? acctErr);
      return;
    }
    if (draft.account !== draft.confirmAccount) {
      setError('Account numbers do not match.');
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await pennyDrop({
      ifsc: toIfsc(draft.ifsc),
      accountNumber: toAccountNumber(draft.account),
      expectedName: legalName,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft((d) => ({ ...d, verified: result.data }));
    retry.note('bank', result.data);
    if (result.data.outcome === 'PASS') {
      setStep(2);
    }
  };
  dropRef.current = () => void runPennyDrop();

  const save = async (): Promise<void> => {
    if (step === 1) {
      await runPennyDrop();
      return;
    }
    if (!draft.verified || draft.verified.outcome !== 'PASS') {
      setError('Complete the penny-drop before saving.');
      return;
    }
    if (!codeSentTo) {
      await sendCode();
      return;
    }
    if (code.length !== 6) {
      setError('Enter the six-digit code we sent you to confirm this change.');
      return;
    }
    setBusy(true);
    const beneficiary =
      (draft.verified.resolved?.beneficiaryName as string | undefined) ?? legalName;
    const commit = await commitBankAccount({
      ifsc: toIfsc(draft.ifsc),
      accountNumber: toAccountNumber(draft.account),
      accountHolderName: beneficiary,
      accountType: 'CURRENT',
      otpCode: code,
    });
    if (!commit.ok) {
      setBusy(false);
      setCode('');
      setError(commit.fields.otpCode ?? commit.message);
      return;
    }
    // The code is spent once the server has read it, whatever the bank then says.
    setCode('');
    setCodeSentTo(null);
    setDevCode(null);
    // 200 is not "saved": the server answers 200 with no account when its own
    // penny-drop did not pass. Nothing is marked committed unless one exists.
    const refused = bankCommitRefusal(commit.data);
    if (refused) {
      setBusy(false);
      setError(refused);
      return;
    }
    const failed = await persistInOrder([
      () =>
        saveStep(
          'DOCUMENTS_BANK',
          {
            ...initial,
            ifsc: toIfsc(draft.ifsc),
            bankName: draft.bank,
            branch: draft.branch,
            bankCommitted: true,
          },
          50,
        ),
    ]);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onSaved();
  };

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError(undefined);
    const sent = await requestBankChangeCode();
    setBusy(false);
    if (!sent.ok) {
      setError(sent.message);
      if (sent.retryAfterSeconds) setCooldown(sent.retryAfterSeconds);
      return;
    }
    setCodeSentTo(sent.data.sentTo);
    setDevCode(sent.data.devCode ?? null);
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
  }

  const holder = draft.verified?.resolved as
    | { beneficiaryName?: string; accountNumber?: string; bankName?: string; ifsc?: string }
    | undefined;

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Bank account"
      subtitle={step === 1 ? 'Where we send payouts.' : '₹1 penny-drop confirmation.'}
      stepIndex={step}
      stepCount={2}
      primaryLabel={step === 1 ? 'Continue' : codeSentTo ? 'Save' : 'Send code'}
      primaryLoading={busy}
      onPrimary={() => void save()}
      onBack={step === 2 ? () => setStep(1) : undefined}
    >
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <Input
            label="IFSC"
            mono
            required
            maxLength={11}
            value={draft.ifsc}
            error={liveFieldError('ifsc', draft.ifsc, validateIfsc, focused, active) ?? error}
            onFocus={() => setFocused('ifsc')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              const next = typeIfsc(e.target.value);
              setActive((a) => ({ ...a, ifsc: true }));
              setDraft((d) => ({ ...d, ifsc: next, bank: '', branch: '', verified: null }));
              setError(undefined);
              if (next.length === 11) void resolveIfsc(next);
            }}
          />
          <Input label="Bank" readOnly className="profile-hub-readonly" value={draft.bank || '—'} />
          <Input
            label="Branch"
            readOnly
            className="profile-hub-readonly"
            value={draft.branch || '—'}
          />
          <Input
            label="Account number"
            mono
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={ACCOUNT_NUMBER_MAX_DIGITS}
            value={draft.account}
            error={liveFieldError('account', draft.account, validateAccountNumber, focused, active)}
            onFocus={() => setFocused('account')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, account: true }));
              setDraft((d) => ({ ...d, account: typeAccountNumber(e.target.value), verified: null }));
            }}
          />
          <Input
            label="Re-enter account number"
            mono
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={ACCOUNT_NUMBER_MAX_DIGITS}
            value={draft.confirmAccount}
            error={liveFieldError(
              'confirm',
              draft.confirmAccount,
              (v) =>
                v.length > 0 && v !== draft.account ? 'Account numbers do not match.' : undefined,
              focused,
              active,
            )}
            onFocus={() => setFocused('confirm')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, confirm: true }));
              setDraft((d) => ({ ...d, confirmAccount: typeAccountNumber(e.target.value) }));
            }}
          />
          {draft.verified && isProviderProblem(draft.verified) ? (
            <ProviderProblem
              view={draft.verified}
              provider="the bank"
              retryIn={retry.pending.bank?.secondsLeft}
              retryAttempt={retry.pending.bank?.attempt}
              exhausted={retry.exhausted('bank', draft.verified, busy)}
              onRetryNow={() => void runPennyDrop()}
            />
          ) : null}
        </div>
      ) : (
        <div className="profile-hub-pass-block">
          <p className="text-body-sm text-ink-2">Penny-drop verified</p>
          <p className="mt-1 text-body font-medium text-ink">
            {holder?.beneficiaryName ?? legalName}
          </p>
          <p className="mt-2 font-mono text-body-sm tnum text-ink-2">
            ••••{draft.account.slice(-4)} · {draft.bank} · {toIfsc(draft.ifsc)}
          </p>
          {codeSentTo ? (
            <div className="mt-4 flex flex-col gap-2">
              <OtpInput
                label={`Enter the code we sent to ${codeSentTo}`}
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(undefined);
                }}
                disabled={busy}
              />
              {devCode ? (
                <p className="text-body-sm text-ink-3">
                  Testing mode — your code is <span className="font-mono tnum">{devCode}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void sendCode()}
                >
                  Resend code
                </Button>
                {cooldown > 0 ? (
                  <span className="text-body-sm text-ink-3">
                    You can ask for another in <span className="font-mono tnum">{cooldown}</span>{' '}
                    seconds.
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-body-sm text-ink-2">
              Changing where payouts go needs a code sent to you. Payouts to a new account are
              paused for a while, and the account owner is told on every channel.
            </p>
          )}
          {error ? (
            <p className="mt-3 text-body-sm text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SectionDialog>
  );
}
