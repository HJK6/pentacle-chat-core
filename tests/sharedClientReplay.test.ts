import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyPentacleSnapshotMessage, applySnapshotWithOptimisticReconciliation, applyPentacleEvent, enqueueOptimisticMessage,
  initialPentacleStreamState, markOptimisticDispatchedByRequestId, selectSessionDetail, type PentacleEvent,
} from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/shared-client-replay.json', import.meta.url), 'utf8'));
function replayReconnect() {
  const state = applyPentacleSnapshotMessage(initialPentacleStreamState, { sessions: [{
    stream_id: fixture.stream, host: 'fixture', provider: 'codex', session_name: 'shared-replay',
    last_text: '', last_kind: 'ASSIST', last_event_at: fixture.initial.timestamp, online: true,
    draft: '', pending: false, working: false,
  }] });
  const seeded = applyPentacleEvent(state, fixture.initial);
  const optimistic = enqueueOptimisticMessage(seeded, {
    streamId: fixture.stream, optimisticId: 'fixture-opt', requestId: 'fixture-request',
    text: fixture.send, createdAt: Date.parse(fixture.initial.timestamp), queuedAt: Date.parse(fixture.initial.timestamp),
  });
  const replay = fixture.disconnected_replay.map((event: PentacleEvent) =>
    event.kind === 'USER' ? { ...event, optimistic_id: 'fixture-opt' } : event);
  const now = Date.parse(fixture.initial.timestamp);
  const dispatched = markOptimisticDispatchedByRequestId(optimistic, 'fixture-request', now, 1);
  return applySnapshotWithOptimisticReconciliation(dispatched,
    { sessions: state.sessions, events: [fixture.initial, ...replay] }, now + 5000);
}

test('reconnect and a republication preserve one optimistic input and daemon lane order', () => {
  const store = replayReconnect();
  const rows = selectSessionDetail(store, fixture.stream, { visibleCount: 'all' })!.transcriptItems;
  assert.deepEqual(rows.map(row => row.text), fixture.expected);
  assert.deepEqual(rows.flatMap(row => row.laneUpdate ? [row.laneUpdate.lane_id] : []), fixture.lane_order);
  assert.equal(rows.find(row => row.optimisticId === 'fixture-opt')?.receiptCaption, 'sent');
  assert.equal(store.optimisticSends?.['fixture-opt'], undefined);
});

test('bounded reconnect history counts distinct lane cards before taking the tail', () => {
  const store = replayReconnect();
  const all = selectSessionDetail(store, fixture.stream, { visibleCount: 'all' })!;
  const rowKey = (row: (typeof all.transcriptItems)[number]) => [row.id, row.text];
  const bounded = selectSessionDetail(store, fixture.stream, { visibleCount: 3 })!;
  assert.deepEqual(bounded.transcriptItems.map(rowKey), all.transcriptItems.slice(-3).map(rowKey));
  assert.ok(bounded.transcriptItems.some(row => row.optimisticId === 'fixture-opt'));
  assert.equal(bounded.remainingCount, 1);
  assert.equal(bounded.hiddenCount, all.hiddenCount);
  for (const count of [1, 2, 4]) {
    const view = selectSessionDetail(store, fixture.stream, { visibleCount: count })!;
    assert.deepEqual(view.transcriptItems.map(rowKey), all.transcriptItems.slice(-count).map(rowKey));
    assert.equal(view.remainingCount, all.transcriptItems.length - count);
  }
});
