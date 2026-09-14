/**
 * How a profile section decides it saved.
 *
 * Every section used to `await saveStep(...)` and `await completeStep(...)`
 * without reading either result, then call `onSaved()` — so a 409, a 422 or a
 * dropped connection closed the dialog, ticked the card and moved the supplier
 * on as if the server had agreed. A section's state now comes from the responses,
 * never from the fact that its submit handler ran.
 */

/** The part of the storefront client's `ApiResult` a save cares about. */
export type SaveResult =
  | { ok: true }
  | { ok: false; message: string; fields: Record<string, string> };

/**
 * Run a section's writes in order and stop at the first refusal. Resolves to that
 * refusal's message — a field message first, because it names what to fix — or
 * to null when every write landed.
 */
export async function persistInOrder(
  writes: ReadonlyArray<() => Promise<SaveResult>>,
): Promise<string | null> {
  for (const write of writes) {
    const result = await write();
    if (!result.ok) return Object.values(result.fields)[0] ?? result.message;
  }
  return null;
}

/**
 * A committed payout account, as the server reports it.
 *
 * `POST /onboarding/bank-account` answers 200 even when its own penny-drop did not
 * pass — with `accountId: null`, because nothing was written. `ok` alone therefore
 * says nothing about whether there is an account.
 */
export interface BankCommit {
  verification: { outcome: string; message: string };
  accountId: string | null;
}

/** Verified means a stored account AND a penny-drop that matched the name. */
export function bankCommitRefusal(commit: BankCommit): string | null {
  if (commit.accountId && commit.verification.outcome === 'PASS') return null;
  return (
    commit.verification.message ||
    'The bank did not confirm this account, so it was not saved. Check the details and try again.'
  );
}
