import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDesignPath,
  parseDashboardLinkEvent,
  type DashboardLink,
  type DesignPresentation,
  type DesignTarget,
} from '../src/index.ts';

const presentations: readonly DesignPresentation[] = ['workspace', 'embed'];
const fixture: {
  version: number;
  event_cases: {
    name: string;
    event: unknown;
    link: DashboardLink | null;
    paths: Record<DesignPresentation, string | null>;
  }[];
  rejected_paths: ({ name: string } & Record<DesignPresentation, string>)[];
} = JSON.parse(readFileSync(new URL('./fixtures/dashboard_links_v1.json', import.meta.url), 'utf8'));

function designEvent(target: unknown, display: Record<string, unknown> = {}) {
  return { raw: { dashboard_link: { dashboard: 'design', target, ...display } } };
}

test('the shared event matrix parses and produces literal paths in both presentations', () => {
  assert.equal(fixture.version, 1);
  for (const { name, event, link, paths } of fixture.event_cases) {
    const original = structuredClone(event);
    const parsed = parseDashboardLinkEvent(event);
    assert.deepEqual(parsed, link, name);
    assert.deepEqual(event, original, `${name}: retains the original event`);
    for (const presentation of presentations) {
      assert.equal(parsed && buildDesignPath(parsed.target, presentation), paths[presentation], `${name}: ${presentation}`);
    }
  }
});

test('the builder refuses raw URL spellings and only accepts the trusted presentation literal', () => {
  for (const entry of fixture.rejected_paths) {
    for (const presentation of presentations) {
      const spelling = entry[presentation];
      assert.equal(buildDesignPath(spelling as unknown as DesignTarget, presentation), null, entry.name);
      assert.equal(buildDesignPath({ project_id: 'demo', design_id: spelling }, presentation), null, entry.name);
    }
  }
  assert.equal(buildDesignPath(undefined, 'standalone' as DesignPresentation), null);
});

test('every target ID must match the canonical ASCII grammar and length', () => {
  const target = { project_id: '0', design_id: 'd'.repeat(80), view_id: 'v-' };
  assert.deepEqual(parseDashboardLinkEvent(designEvent(target))?.target, target);
  assert.equal(buildDesignPath(target, 'workspace'), `/next/design/0/${'d'.repeat(80)}/v-`);
  for (const key of Object.keys(target)) {
    for (const value of ['', '-demo', 'demo_board', 'démø', 'a'.repeat(81), 'a\n', ' a', 'a ', '..', 'a/b', 'a\\b', 'a?', 'a#', 12, null, undefined]) {
      const invalid = { ...target, [key]: value };
      assert.equal(parseDashboardLinkEvent(designEvent(invalid)), null, `${key}: ${String(value)}`);
      for (const presentation of presentations) {
        assert.equal(buildDesignPath(invalid, presentation), null, `${presentation}: ${key}: ${String(value)}`);
      }
    }
  }
});

test('missing and malformed envelopes remain ordinary, including inherited lookalikes', () => {
  const link = { dashboard: 'design' };
  for (const value of [null, false, [], {}, { raw: null }, { raw: [] }, { raw: { dashboard_link: [] } },
    { raw: { dashboard_link: 'design' } }, { raw: { dashboard_link: Object.create(link) } },
    { raw: Object.create({ dashboard_link: link }) }, Object.create({ raw: { dashboard_link: link } })]) {
    assert.equal(parseDashboardLinkEvent(value), null);
  }
  for (const target of [null, '', [], false, undefined, {}, Object.create({ project_id: 'demo', design_id: 'board' })]) {
    assert.equal(parseDashboardLinkEvent(designEvent(target)), null);
    if (target !== undefined) {
      for (const presentation of presentations) {
        assert.equal(buildDesignPath(target as DesignTarget, presentation), null);
      }
    }
  }
});

test('only a lowercase hex revision of exactly 64 characters survives as preview metadata', () => {
  const target = { project_id: 'demo', design_id: 'board' };
  for (const revision_id of [null, 123, '0'.repeat(63), '0'.repeat(65), `${'a'.repeat(64)}\n`, 'g'.repeat(64)]) {
    const link = parseDashboardLinkEvent(designEvent(target, { revision_id }));
    assert.deepEqual(link, { dashboard: 'design', target });
    assert.equal(buildDesignPath(link?.target, 'embed'), '/next/embed/design/demo/board');
  }
});
