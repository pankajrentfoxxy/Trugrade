import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useApp } from '../src/app-context';
import { systemClock } from '../src/clock';
import { outstanding, retryBlocked, type OutboxItem } from '../src/queue/outbox';
import { Banner, Button, Card, Chip, H1, H2, Muted, P, Row, Screen } from '../src/ui/kit';

/**
 * What has not reached the server, item by item.
 *
 * The badge in the header answers "is anything outstanding". This screen answers
 * the two questions that follow — *what*, and *why is it stuck* — and it does it
 * with the server's own message rather than a generic failure state, because a
 * blocked item is nearly always something the technician can fix while they are
 * still at the site.
 *
 * Blocked items are shown first and can be retried by hand. Retrying is safe:
 * every row carries the nonce it was created with, so a retry of something that
 * did in fact land is one row and a 200, not a duplicate inspection.
 */
export default function SyncScreen() {
  const { db, counts, offline, syncing, syncNow, refresh } = useApp();
  const [items, setItems] = useState<OutboxItem[]>([]);

  const load = useCallback(async () => {
    if (!db) return;
    setItems(await outstanding(db));
    await refresh();
  }, [db, refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const blocked = items.filter((i) => i.status === 'BLOCKED');
  const pending = items.filter((i) => i.status === 'PENDING');

  const oldest = counts.oldestPendingAt;
  const ageHours = oldest ? Math.floor((systemClock() - oldest) / 3_600_000) : 0;

  return (
    <Screen>
      <H1>
        {counts.outstanding === 0 ? 'Everything is on the server' : `${counts.outstanding} to send`}
      </H1>

      {offline ? <Banner tone="warn">No usable connection. Nothing is lost — it goes up when there is one.</Banner> : null}

      {counts.pendingPhotos > 0 ? (
        <Muted>
          {counts.pendingPhotos} of those are photographs, which are most of the bytes. They will be
          slower than the rest.
        </Muted>
      ) : null}

      {oldest && ageHours >= 4 ? (
        <Banner tone="bad">
          The oldest item has been waiting {ageHours} hours. Find signal before you finish for the
          day — do not leave the site with this on the device.
        </Banner>
      ) : null}

      <Button title="Try now" onPress={() => void syncNow().then(load)} busy={syncing} />

      {blocked.length > 0 ? (
        <>
          <H2>Refused by the server — these need you</H2>
          <Banner tone="bad">
            These will not clear on their own. Read what the server said, fix it, then retry.
          </Banner>
          {blocked.map((i) => (
            <Card key={i.id}>
              <Row>
                <Chip label={i.kind.replace('_', ' ')} tone="bad" />
                <Muted>attempt {i.attempts}</Muted>
              </Row>
              <P tone="bad">{i.lastError ?? 'No message.'}</P>
              <Muted>{i.dedupeKey}</Muted>
            </Card>
          ))}
          <Button
            title="Retry everything refused"
            tone="plain"
            onPress={() =>
              void (async () => {
                if (!db) return;
                await retryBlocked(db);
                await syncNow();
                await load();
              })()
            }
          />
        </>
      ) : null}

      {pending.length > 0 ? (
        <>
          <H2>Waiting to go up</H2>
          {pending.map((i) => (
            <Card key={i.id}>
              <Row>
                <Chip label={i.kind.replace('_', ' ')} tone={i.attempts > 0 ? 'warn' : 'brand'} />
                {i.attempts > 0 ? <Muted>tried {i.attempts}×</Muted> : null}
              </Row>
              <Muted>{i.dedupeKey}</Muted>
              {i.lastError ? <Muted>{i.lastError}</Muted> : null}
            </Card>
          ))}
        </>
      ) : null}

      <Muted>
        Items go up in the order they were recorded, so a photograph always reaches the server before
        the result that cites it. That is why one stuck item pauses the ones behind it.
      </Muted>
    </Screen>
  );
}
