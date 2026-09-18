// Translator tests: `node --test tests/` from frontend-sieve/.
// sieveToBackend is pure (no DOM/fetch at call time for translation),
// so the sieve→FastAPI mapping is locked without a browser or server.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sieveToBackend } from '../api.js';
import { EngineFactory } from '../engine.js';

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

describe('sieveToBackend wave-2 mappings', () => {
  it('maps split/merge/extract/group/label/normalize', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'split-column', enabled: true, params: { column: 'Email', delimiter: '@', max_splits: '', keep: true } },
      { type: 'merge-columns', enabled: true, params: { columns: ['City', 'Active'], separator: ' ', output: 'Locale', keep: true } },
      { type: 'extract-text', enabled: true, params: { column: 'Email', mode: 'after', delim: '@', output: 'Domain' } },
      { type: 'group-rare', enabled: true, params: { column: 'Dept', min_count: '10', replacement: 'Other' } },
      { type: 'label-encode', enabled: true, params: { column: 'City' } },
      { type: 'normalize', enabled: true, params: { column: 'Age', method: 'z' } },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(
      nodes.map((n) => n.type),
      ['split-column', 'merge-columns', 'extract-text', 'group-rare', 'encode-categorical', 'normalize'],
    );
    assert.deepEqual(nodes[0].config, {
      columns: ['Email'], delimiter: '@', keep_original: true,
    });
    assert.deepEqual(nodes[4], {
      id: 'n5', type: 'encode-categorical', config: { method: 'label', columns: ['City'] },
    });
    assert.deepEqual(nodes[5], {
      id: 'n6', type: 'normalize', config: { columns: ['Age'], method: 'z-score' },
    });
  });

  it('maps convert-to-date and the date ops', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'convert-type', enabled: true, params: { column: 'HireDate', to: 'date' } },
      { type: 'extract-date-part', enabled: true, params: { column: 'HireDate', part: 'year', output: 'HireYear' } },
      { type: 'date-difference', enabled: true, params: { start: 'HireDate', end: 'EndDate', unit: 'days', output: 'Gap' } },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes[0], {
      id: 'n1', type: 'parse-date', config: { columns: ['HireDate'], format: 'auto' },
    });
    assert.deepEqual(nodes[1], {
      id: 'n2', type: 'extract-date-part', config: { columns: ['HireDate'], part: 'year', output: 'HireYear' },
    });
    assert.deepEqual(nodes[2], {
      id: 'n3', type: 'date-difference', config: { columns: ['HireDate', 'EndDate'], unit: 'days', output: 'Gap' },
    });
  });

  it('keeps convert-to-number/text local-only', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'convert-type', enabled: true, params: { column: 'Age', to: 'number' } },
    ]);
    assert.equal(nodes.length, 0);
    assert.equal(skipped.length, 1);
  });
});

describe('sieveToBackend wave-3 mappings', () => {
  it('maps create/conditional with column extraction', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'create-column', enabled: true, params: { formula: '[Age] + 1', output: 'AgePlus' } },
      {
        type: 'conditional-column',
        enabled: true,
        params: {
          rules: [
            { column: 'Age', op: '<', value: '18', result: 'Minor' },
            { column: 'Age', op: '<', value: '60', result: 'Adult' },
          ],
          default: 'Senior',
          output: 'AgeGroup',
        },
      },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes[0], {
      id: 'n1',
      type: 'create-column',
      config: { formula: '[Age] + 1', output: 'AgePlus', columns: ['Age'] },
    });
    assert.deepEqual(nodes[1], {
      id: 'n2',
      type: 'conditional-column',
      config: {
        columns: ['Age'],
        rules: [
          { column: 'Age', operator: '<', value: 18, result: 'Minor' },
          { column: 'Age', operator: '<', value: 60, result: 'Adult' },
        ],
        default: 'Senior',
      },
    });
  });

  it('assembles validate checks from flat params', () => {
    const { nodes, skipped } = sieveToBackend([
      {
        type: 'validate-column',
        enabled: true,
        params: {
          column: 'Age', vtype: 'any', required: true, min: '0', max: '',
          allowed: [], unique: false, pattern: '',
        },
      },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes[0], {
      id: 'n1',
      type: 'validate-column',
      config: {
        columns: ['Age'],
        checks: [{ rule: 'required' }, { rule: 'min', value: '0' }],
      },
    });
  });

  it('skips empty validate/find-invalid configs with reasons', () => {
    const { nodes, skipped } = sieveToBackend([
      {
        type: 'validate-column',
        enabled: true,
        params: {
          column: 'Age', vtype: 'any', required: false, min: '', max: '',
          allowed: [], unique: false, pattern: '',
        },
      },
      {
        type: 'find-invalid',
        enabled: true,
        params: { column: 'Age', expect: 'number', min: 'x', max: '' },
      },
    ]);
    // find-invalid with garbage bounds still maps (the backend refuses it,
    // exactly like the local engine) — only the check-less validate skips.
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, 'find-invalid');
    assert.equal(skipped.length, 1);
  });
});

describe('sieveToBackend wave-4 mappings', () => {
  it('maps clip/find-replace/remove-special/standardize/log', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'clip-values', enabled: true, params: { columns: ['Score'], min: '1', max: '5' } },
      { type: 'find-replace-pattern', enabled: true, params: { columns: ['Email'], pattern: '\\d+', replacement: '#', regex: true, case: true } },
      { type: 'remove-special-chars', enabled: true, params: { columns: ['City'], letters: true, numbers: true, spaces: true, custom: '' } },
      { type: 'standardize-categories', enabled: true, params: { columns: ['Dept'], method: 'lower', map: {} } },
      { type: 'log-transform', enabled: true, params: { columns: ['Score'], base: 'ln', invalid: 'null' } },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(nodes[0], {
      id: 'n1', type: 'clip-values', config: { columns: ['Score'], min_value: '1', max_value: '5' },
    });
    assert.deepEqual(nodes[1].config.use_regex, true);
    assert.deepEqual(nodes[1].type, 'find-replace-pattern');
    assert.deepEqual(nodes[2], {
      id: 'n3', type: 'remove-special-chars',
      config: { columns: ['City'], letters: true, numbers: true, spaces: true, custom_chars: '' },
    });
    assert.deepEqual(nodes[3].config, { columns: ['Dept'], method: 'lower', mapping: {} });
    assert.deepEqual(nodes[4], {
      id: 'n5', type: 'log-transform', config: { columns: ['Score'], method: 'ln', on_invalid: 'null' },
    });
  });

  it('skips invalid wave-4 configs with reasons', () => {
    const { nodes, skipped } = sieveToBackend([
      { type: 'clip-values', enabled: true, params: { columns: ['Score'], min: '', max: '' } },
      { type: 'log-transform', enabled: true, params: { columns: ['Score'], base: 'log7', invalid: 'null' } },
    ]);
    assert.equal(nodes.length, 0);
    assert.equal(skipped.length, 2);
  });
});

describe('translator coverage', () => {
  it('accounts for every registered op: mapped or explicitly local-only', () => {
    const E = EngineFactory();
    const types = Object.keys(E.OPS);
    assert.ok(types.length >= 28, `expected the full library, found ${types.length}`);
    for (const type of types) {
      const r = sieveToBackend([{ type, enabled: true, params: E.OPS[type].defaults() }]);
      const accounted = r.nodes.length === 1 || r.skipped.length > 0;
      assert.ok(accounted, `${type}: silently dropped by the translator`);
      if (r.skipped.length) {
        assert.ok(
          r.skipped[0].reason && r.skipped[0].reason.length > 3,
          `${type}: skip reason must explain why`,
        );
      }
    }
  });
});
