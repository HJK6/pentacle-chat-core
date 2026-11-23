import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyPentacleSnapshotMessage, applySnapshotWithOptimisticReconciliation, applyPentacleEvent, enqueueOptimisticMessage,
  initialPentacleStreamState, markOptimisticDispatchedByRequestId, selectSessionDetail, type PentacleEvent,
} from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/shared-client-replay.json', import.meta.url), 'utf8'));
test('reconnect and a republication preserve one optimistic input and daemon lane order', () => {
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
  const store = applySnapshotWithOptimisticReconciliation(dispatched,
    { sessions: state.sessions, events: [fixture.initial, ...replay] }, now + 5000);
  const rows = selectSessionDetail(store, fixture.stream, { visibleCount: 'all' })!.transcriptItems;
  assert.deepEqual(rows.map(row => row.text), fixture.expected);
  assert.deepEqual(rows.flatMap(row => row.laneUpdate ? [row.laneUpdate.lane_id] : []), fixture.lane_order);
  assert.equal(rows.find(row => row.optimisticId === 'fixture-opt')?.receiptCaption, 'sent');
  assert.equal(store.optimisticSends?.['fixture-opt'], undefined);
});
