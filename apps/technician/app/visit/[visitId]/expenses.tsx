import { money } from '@trugrade/contracts';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useApp } from '../../../src/app-context';
import { systemClock } from '../../../src/clock';
import { preparePhoto } from '../../../src/photos';
import { queueExpense, queuePhoto } from '../../../src/queue/actions';
import { Banner, Button, Card, Choice, Field, H1, Muted, P, Screen } from '../../../src/ui/kit';
import { PhotoBox } from '../../../src/ui/capture';

/**
 * Visit expenses, with receipts.
 *
 * These roll into `qc.v_visit_economics`, which is the number that says whether
 * QC-at-source pays for itself — cost per inspected unit. That makes a missing
 * toll receipt a distortion of a business metric, not just a technician who is
 * out of pocket, and it is why capture happens on site rather than from memory
 * on Friday.
 *
 * The amount goes through `money()` from `@trugrade/contracts` and travels as a
 * string. `qc_visit_expense.amount` is NUMERIC, and a float that rounds a paisa
 * per receipt makes the economics quietly wrong in the direction nobody checks.
 */
const CATEGORIES = ['TRAVEL', 'FUEL', 'TOLL', 'PARKING', 'FOOD', 'ACCOMMODATION', 'TOOL_LICENCE'] as const;

export default function ExpensesScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { deps, refresh } = useApp();

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('TRAVEL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ uri: string; sha256: string; bytes: number } | null>(null);
  const [shooting, setShooting] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (shooting) {
    return (
      <PhotoBox
        guidance="The whole receipt, flat, with the total and the date readable."
        onCapture={(uri) => {
          void (async () => {
            const p = await preparePhoto(uri, 'RECEIPT', systemClock());
            setReceipt({ uri: p.uri, sha256: p.sha256, bytes: p.bytes });
            setShooting(false);
          })();
        }}
        onCancel={() => setShooting(false)}
      />
    );
  }

  async function add() {
    if (!deps || !visitId) return;
    setBusy(true);
    setError(null);
    try {
      // `money()` rejects anything that is not a clean two-decimal amount, so a
      // fat-fingered "1,20" is caught here rather than by a NUMERIC cast later.
      const parsed = money(amount.trim());
      const localId = Crypto.randomUUID();

      if (receipt) {
        await queuePhoto(
          deps,
          { visitId, visitUnitId: null, unitId: null, expenseLocalId: localId },
          { angle: 'RECEIPT', uri: receipt.uri, sha256: receipt.sha256, bytes: receipt.bytes, capturedAt: systemClock() },
        );
      }

      await queueExpense(deps, visitId, {
        localId,
        category,
        amountInr: parsed.toString(),
        note: note.trim(),
        receiptSha256: receipt?.sha256 ?? null,
      });

      setAdded((a) => [...a, `${category} ${parsed.toString()}`]);
      setAmount('');
      setNote('');
      setReceipt(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Expenses</H1>
      <Muted>Queued on the device like everything else. Add them as you spend, not at the end.</Muted>

      <Choice options={CATEGORIES} value={category} onChange={setCategory} />
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="450.00" />
      <Field label="Note" value={note} onChangeText={setNote} autoCapitalize="sentences" />

      <Button
        title={receipt ? 'Retake the receipt' : 'Photograph the receipt'}
        tone={receipt ? 'plain' : 'brand'}
        onPress={() => setShooting(true)}
      />

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <Button title="Add this expense" onPress={() => void add()} disabled={amount.trim().length === 0} busy={busy} />

      {added.map((a, i) => (
        <Card key={`${a}-${i}`}>
          <P>{a}</P>
        </Card>
      ))}
    </Screen>
  );
}
