// Translator tests: `node --test tests/` from frontend-sieve/.
// sieveToBackend is pure (no DOM/fetch at call time for translation),
// so the sieve→FastAPI mapping is locked without a browser or server.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sieveToBackend } from '../api.js';

const one = (type, params) => [{ type, enabled: true, params }];

describe('sieveToBackend wave-1 mappings', () => {
  it('maps ffill/bfill with limit', () => {
    const { nodes, edges, skipped } = sieveToBackend(
      one('fill-missing', { column: 'Age', method: 'ffill', value: '', limit: '2' }),
    );
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes, [
      { id: 'n1', type: 'fill-na', config: { columns: ['Age'], strategy: 'ffill', limit: 2 } },
    ]);
    assert.deepEqual(edges, []);
  });

  it('maps drop-missing match to how', () => {
    const { nodes, skipped } = sieveToBackend(
      one('drop-missing', { column: '__all__', match: 'all' }),
    );
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes, [{ id: 'n1', type: 'drop-na', config: { how: 'all' } }]);
  });

  it('maps round/reorder/drop-empty/replace', () => {
    const { nodes, edges, skipped } = sieveToBackend([
      { type: 'round-values', enabled: true, params: { columns: ['Age'], decimals: '1' } },
      { type: 'reorder-columns', enabled: true, params: { order: ['Age', 'Name'] } },
      { type: 'drop-empty-columns', enabled: true, params: {} },
      {
        type: 'replace-values',
        enabled: true,
        params: { columns: ['Dept'], find: 'IT', replacement: 'Eng', case: true },
      },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(
      nodes.map((n) => n.type),
      ['round-values', 'reorder-columns', 'drop-empty-columns', 'replace-values'],
    );
    assert.deepEqual(nodes[0], {
      id: 'n1',
      type: 'round-values',
      config: { columns: ['Age'], decimals: 1 },
    });
    assert.deepEqual(nodes[1], {
      id: 'n2',
      type: 'reorder-columns',
      config: { columns: ['Age', 'Name'] },
    });
    assert.deepEqual(nodes[2], { id: 'n3', type: 'drop-empty-columns', config: {} });
    assert.deepEqual(nodes[3], {
      id: 'n4',
      type: 'replace-values',
      config: { columns: ['Dept'], find: 'IT', replacement: 'Eng', case_sensitive: true },
    });
    assert.deepEqual(edges, [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
    ]);
  });

  it('skips unmappable steps with reasons instead of guessing', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'clean-text', enabled: true, params: { column: 'Name' } },
      {
        type: 'replace-values',
        enabled: true,
        params: { columns: ['Dept'], find: '', replacement: 'x', case: true },
      },
    ]);
    assert.equal(nodes.length, 0);
    assert.equal(skipped.length, 2);
  });

  it('skips bypassed steps so remote and local wires agree', () => {
    const { nodes } = sieveToBackend([
      { type: 'drop-duplicates', enabled: false, params: { keep: 'first' } },
      { type: 'sort-rows', enabled: true, params: { column: 'Age', dir: 'asc' } },
    ]);
    assert.deepEqual(
      nodes.map((n) => n.type),
      ['sort'],
    );
  });
});
