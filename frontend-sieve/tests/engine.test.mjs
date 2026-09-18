// Engine unit tests: `node --test tests/` from frontend-sieve/.
// Zero dependencies (node:test + node:assert only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EngineFactory } from '../engine.js';

const E = EngineFactory();
const DATA = { columns: ['Name', 'Age'], rows: [['a', '1'], ['b', '2']] };
const META = E.metaOf(DATA.columns, DATA.rows, false);

describe('hint calling convention', () => {
  // runFrom() invokes hint(inD, params, inMeta). Single-arg hints once read
  // the DATA object as params and silently returned null, which dropped the
  // _sieve_num/_sieve_str helpers from exported scripts (NameError at runtime).
  it('fill-missing median declares numeric need', () => {
    assert.deepEqual(
      E.OPS['fill-missing'].hint(DATA, { column: 'Age', method: 'median', value: '' }, META),
      { num: true },
    );
  });
  it('fill-missing mode declares no need', () => {
    assert.equal(
      E.OPS['fill-missing'].hint(DATA, { column: 'Age', method: 'mode', value: '' }, META),
      null,
    );
  });
  it('filter-rows numeric value declares numeric need', () => {
    assert.deepEqual(
      E.OPS['filter-rows'].hint(DATA, { column: 'Age', op: '>', value: '4' }, META),
      { num: true },
    );
  });
  it('convert-type number declares numeric need', () => {
    assert.deepEqual(
      E.OPS['convert-type'].hint(DATA, { column: 'Age', to: 'number' }, META),
      { num: true },
    );
  });
  it('convert-type text declares string need', () => {
    assert.deepEqual(
      E.OPS['convert-type'].hint(DATA, { column: 'Name', to: 'text' }, META),
      { str: true },
    );
  });
});

describe('sort direction', () => {
  // Regression: run() once ignored `dir` (always ascending).
  const rows = [['a', '2'], ['b', '1'], ['c', '']];
  it('descending puts max first, missing last', () => {
    const out = E.runFrom({ columns: ['n', 'v'], rows }, [
      { type: 'sort-rows', enabled: true, params: { column: 'v', dir: 'desc' } },
    ]);
    assert.deepEqual(
      out.outputs[1].rows.map((r) => r[1]),
      ['2', '1', ''],
    );
  });
  it('ties keep input order in both directions', () => {
    const tied = [
      ['x', '5'],
      ['y', '5'],
      ['z', '1'],
    ];
    const desc = E.runFrom({ columns: ['n', 'v'], rows: tied }, [
      { type: 'sort-rows', enabled: true, params: { column: 'v', dir: 'desc' } },
    ]);
    assert.deepEqual(
      desc.outputs[1].rows.map((r) => r[0]),
      ['x', 'y', 'z'],
    );
  });
});

describe('one-hot', () => {
  it('flags match first-appearance categories, missing never matches', () => {
    const out = E.runFrom({ columns: ['c'], rows: [['a'], ['b'], ['a'], ['']] }, [
      { type: 'one-hot', enabled: true, params: { column: 'c' } },
    ]);
    assert.deepEqual(out.outputs[1].columns, ['c', 'c_a', 'c_b']);
    assert.deepEqual(out.outputs[1].rows, [
      ['a', 1, 0],
      ['b', 0, 1],
      ['a', 1, 0],
      ['', 0, 0],
    ]);
  });
  it('codegen emits a runnable loop with no stubs', () => {
    const code = E.OPS['one-hot']
      .code({ columns: ['c'], types: {} }, { column: 'c' })
      .join('\n');
    assert.match(code, /for _cat in _cats:/);
    assert.doesNotMatch(code, /PLACEHOLDER|__col|replace the/);
  });
});
