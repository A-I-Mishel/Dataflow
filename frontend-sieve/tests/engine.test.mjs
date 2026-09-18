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

describe('wirePath', () => {
  it('builds a valid cubic between ports', () => {
    assert.equal(E.wirePath(0, 100, 300, 100, 236, 18), 'M 236 118 C 272 118, 264 118, 300 118');
  });
  it('clamps control offset on long-distance wires', () => {
    // Regression: wires spanning thousands of units must keep the same
    // port anchoring with dx pinned at 170 — the path itself was always
    // correct; visibility is the SVG viewport's job (see #wires CSS).
    assert.equal(
      E.wirePath(40, 120, 5000, 2000, 236, 18),
      'M 276 138 C 446 138, 4830 2018, 5000 2018',
    );
  });
  it('anchors correctly with negative coordinates', () => {
    // Nodes dragged into negative space: endpoints must stay exact and
    // finite so the wire reaches its ports once the viewport allows it.
    assert.equal(
      E.wirePath(-800, -400, 300, 100, 236, 18),
      'M -564 -382 C -394 -382, 130 118, 300 118',
    );
  });
  it('loops back with minimum offset when target is left of source', () => {
    assert.equal(
      E.wirePath(900, 200, 100, 200, 236, 18),
      'M 1136 218 C 1172 218, 64 218, 100 218',
    );
  });
  it('stays finite for extreme coordinates', () => {
    for (const [ax, ay, bx, by] of [
      [0, 0, 1e6, 1e6],
      [-1e6, -1e6, 1e6, 1e6],
      [40, 120, 41, 121],
    ]) {
      const d = E.wirePath(ax, ay, bx, by, 236, 18);
      assert.match(d, /^M -?[\d.]+ -?[\d.]+ C /);
      assert.doesNotMatch(d, /NaN|undefined|Infinity/);
    }
  });
  it('never emits NaN for hostile coordinates', () => {
    for (const bad of [undefined, null, NaN, 'abc', {}, []]) {
      const d = E.wirePath(bad, bad, 300, 100, 236, 18);
      assert.doesNotMatch(d, /NaN|undefined/);
    }
    // Numeric strings (legacy storage) still resolve correctly
    assert.equal(E.wirePath('40', '120', 300, 100, 236, 18).slice(0, 11), 'M 276 138 C');
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

describe('deep stats', () => {
  // Regression: `let dupCount;` + `dupCount++` produced NaN, so the
  // duplicate-rows tile always showed 0.
  it('counts duplicate rows', () => {
    const meta = E.metaOf(
      ['a'],
      [['x'], ['y'], ['x'], ['x']],
      true,
    );
    assert.equal(meta.dupCount, 2);
  });
});

describe('remove-outliers clip', () => {
  // Regression: `clamp` was only defined in app.js scope, so clip threw
  // ReferenceError both on the main thread and in the stringified worker.
  it('clips values at the IQR fences', () => {
    const out = E.OPS['remove-outliers'].run(
      { columns: ['v'], rows: [[10], [20], [30], [40], [1000]] },
      { column: 'v', action: 'clip' },
    );
    assert.equal(out.rows[4][0], 70);
  });
});

describe('duplicate headers', () => {
  // Regression: the generated rename was never reserved, so
  // ['a','a','a_2'] collapsed into two 'a_2' columns.
  it('never emits duplicate column names', () => {
    const parsed = E.parseCSVText('a,a,a_2\n1,2,3\n');
    assert.deepEqual(parsed.columns, ['a', 'a_2', 'a_2_2']);
  });
});

describe('directional fill', () => {
  const rows = [['1'], [''], [''], ['4']];
  it('ffill carries the last value forward', () => {
    const out = E.OPS['fill-missing'].run(
      { columns: ['v'], rows: rows.map((r) => [...r]) },
      { column: 'v', method: 'ffill', value: '', limit: '' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['1', '1', '1', '4'],
    );
  });
  it('bfill carries the next value backward', () => {
    const out = E.OPS['fill-missing'].run(
      { columns: ['v'], rows: rows.map((r) => [...r]) },
      { column: 'v', method: 'bfill', value: '', limit: '' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['1', '4', '4', '4'],
    );
  });
  it('limit caps consecutive fills like pandas', () => {
    const out = E.OPS['fill-missing'].run(
      { columns: ['v'], rows: rows.map((r) => [...r]) },
      { column: 'v', method: 'ffill', value: '', limit: '1' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['1', '1', '', '4'],
    );
  });
  it('rejects a non-numeric limit', () => {
    assert.throws(() =>
      E.OPS['fill-missing'].run(
        { columns: ['v'], rows: [['']] },
        { column: 'v', method: 'ffill', value: '', limit: 'many' },
      ),
    );
  });
});

describe('drop-missing match', () => {
  const data = { columns: ['a', 'b'], rows: [['1', 'x'], ['', 'y'], ['', '']] };
  it('any drops rows with any empty cell', () => {
    const out = E.OPS['drop-missing'].run(data, { column: '__all__', match: 'any' });
    assert.deepEqual(out.rows, [['1', 'x']]);
  });
  it('all keeps rows that still hold something', () => {
    const out = E.OPS['drop-missing'].run(data, { column: '__all__', match: 'all' });
    assert.deepEqual(out.rows, [['1', 'x'], ['', 'y']]);
  });
});

describe('round-values', () => {
  it('rounds ticked columns to N places', () => {
    const out = E.OPS['round-values'].run(
      { columns: ['v', 't'], rows: [['1.234', 'a'], ['2.345', 'b']] },
      { columns: ['v'], decimals: '1' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      [1.2, 2.3],
    );
    assert.deepEqual(
      out.rows.map((r) => r[1]),
      ['a', 'b'],
    );
  });
  it('requires columns and valid decimals', () => {
    assert.throws(() =>
      E.OPS['round-values'].run({ columns: ['v'], rows: [] }, { columns: [], decimals: '2' }),
    );
    assert.throws(() =>
      E.OPS['round-values'].run({ columns: ['v'], rows: [] }, { columns: ['v'], decimals: 'many' }),
    );
  });
});

describe('reorder-columns', () => {
  it('reorders exactly', () => {
    const out = E.OPS['reorder-columns'].run(
      { columns: ['a', 'b'], rows: [[1, 2]] },
      { order: ['b', 'a'] },
    );
    assert.deepEqual(out.columns, ['b', 'a']);
    assert.deepEqual(out.rows, [[2, 1]]);
  });
  it('rejects inexact orders instead of dropping data', () => {
    const data = { columns: ['a', 'b'], rows: [] };
    assert.throws(() => E.OPS['reorder-columns'].run(data, { order: ['b'] }));
    assert.throws(() => E.OPS['reorder-columns'].run(data, { order: ['b', 'a', 'zzz'] }));
    assert.throws(() => E.OPS['reorder-columns'].run(data, { order: ['a', 'a', 'b'] }));
  });
});

describe('drop-empty-columns', () => {
  it('drops only fully-empty columns', () => {
    const out = E.OPS['drop-empty-columns'].run(
      { columns: ['a', 'b', 'c'], rows: [[1, '', 'x'], [2, '', '']] },
      {},
    );
    assert.deepEqual(out.columns, ['a', 'c']);
  });
  it('never drops from an empty frame', () => {
    const out = E.OPS['drop-empty-columns'].run({ columns: ['a'], rows: [] }, {});
    assert.deepEqual(out.columns, ['a']);
  });
});

describe('replace-values', () => {
  const data = { columns: ['c'], rows: [['a'], ['B'], ['c']] };
  it('swaps exact matches', () => {
    const out = E.OPS['replace-values'].run(data, {
      columns: ['c'], find: 'a', replacement: 'z', case: true,
    });
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['z', 'B', 'c'],
    );
  });
  it('matches case-insensitively for strings only', () => {
    const out = E.OPS['replace-values'].run(data, {
      columns: ['c'], find: 'b', replacement: 'W', case: false,
    });
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['a', 'W', 'c'],
    );
  });
  it('requires columns and a find value', () => {
    assert.throws(() =>
      E.OPS['replace-values'].run(data, { columns: [], find: 'a', replacement: 'z', case: true }),
    );
    assert.throws(() =>
      E.OPS['replace-values'].run(data, { columns: ['c'], find: '', replacement: 'z', case: true }),
    );
  });
});

describe('split-column', () => {
  it('splits on a delimiter with auto names', () => {
    const out = E.OPS['split-column'].run(
      { columns: ['e'], rows: [['a@x'], ['b'], ['']] },
      { column: 'e', delimiter: '@', max_splits: '', keep: true },
    );
    assert.deepEqual(out.columns, ['e', 'e_1', 'e_2']);
    assert.deepEqual(out.rows[0].slice(1), ['a', 'x']);
    assert.deepEqual(out.rows[1].slice(1), ['b', null]);
    assert.deepEqual(out.rows[2].slice(1), [null, null]);
  });
  it('glues the remainder to the last piece', () => {
    const out = E.OPS['split-column'].run(
      { columns: ['e'], rows: [['a@x@y']] },
      { column: 'e', delimiter: '@', max_splits: '1', keep: true },
    );
    assert.deepEqual(out.rows[0].slice(1), ['a', 'x@y']);
  });
  it('rejects empty delimiters and explosions', () => {
    const data = { columns: ['e'], rows: [['a b c d e f g h i j k l m n o p q']] };
    assert.throws(() =>
      E.OPS['split-column'].run(data, { column: 'e', delimiter: '', max_splits: '', keep: true }),
    );
    assert.throws(() =>
      E.OPS['split-column'].run(data, { column: 'e', delimiter: ' ', max_splits: '', keep: true }),
    );
  });
});

describe('merge-columns', () => {
  it('joins with canonical numbers, skipping missing', () => {
    const out = E.OPS['merge-columns'].run(
      { columns: ['a', 'b'], rows: [['x', 25], [null, 'y'], ['', 'z']] },
      { columns: ['a', 'b'], separator: ' ', output: 'ab', keep: true },
    );
    assert.deepEqual(
      out.rows.map((r) => r[2]),
      ['x 25', 'y', 'z'],
    );
  });
  it('all-missing rows merge to null', () => {
    const out = E.OPS['merge-columns'].run(
      { columns: ['a', 'b'], rows: [[null, '']] },
      { columns: ['a', 'b'], separator: ' ', output: 'ab', keep: true },
    );
    assert.deepEqual(out.rows[0][2], null);
  });
  it('requires two columns and a fresh output name', () => {
    const data = { columns: ['a', 'b'], rows: [] };
    assert.throws(() =>
      E.OPS['merge-columns'].run(data, { columns: ['a'], separator: ' ', output: 'ab', keep: true }),
    );
    assert.throws(() =>
      E.OPS['merge-columns'].run(data, { columns: ['a', 'b'], separator: ' ', output: 'a', keep: true }),
    );
  });
});

describe('extract-text', () => {
  const data = { columns: ['e'], rows: [['john@x.com'], ['nope'], ['']] };
  const run = (params) => E.OPS['extract-text'].run(data, { column: 'e', output: 'o', ...params });
  it('after/before delimiters', () => {
    assert.equal(run({ mode: 'after', delim: '@' }).rows[0][1], 'x.com');
    assert.equal(run({ mode: 'before', delim: '@' }).rows[0][1], 'john');
    assert.equal(run({ mode: 'after', delim: '@' }).rows[1][1], null);
    assert.equal(run({ mode: 'after', delim: '@' }).rows[2][1], '');
  });
  it('between/prefix/regex', () => {
    assert.equal(run({ mode: 'between', delim: '<', delim2: '>' }).rows[0][1], null);
    const tagged = E.OPS['extract-text'].run(
      { columns: ['e'], rows: [['a<b>c']] },
      { column: 'e', mode: 'between', delim: '<', delim2: '>', output: 'o' },
    );
    assert.equal(tagged.rows[0][1], 'b');
    assert.equal(run({ mode: 'prefix', length: '4' }).rows[0][1], 'john');
    assert.equal(run({ mode: 'regex', pattern: '\\w+@\\w+' }).rows[0][1], 'john@x');
    assert.equal(run({ mode: 'regex', pattern: '\\d+' }).rows[0][1], null);
  });
  it('rejects bad config', () => {
    assert.throws(() => run({ mode: 'after', delim: '' }));
    assert.throws(() => run({ mode: 'prefix', length: '0' }));
    assert.throws(() => run({ mode: 'regex', pattern: '([' }));
    assert.throws(() =>
      E.OPS['extract-text'].run(data, { column: 'e', mode: 'after', delim: '@', output: 'e' }),
    );
  });
});

describe('group-rare', () => {
  const data = { columns: ['c'], rows: [['a'], ['a'], ['b'], ['c'], ['']] };
  it('folds rare values by count', () => {
    const out = E.OPS['group-rare'].run(data, { column: 'c', min_count: '2', replacement: 'Other' });
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['a', 'a', 'Other', 'Other', ''],
    );
  });
  it('accepts percentages', () => {
    const out = E.OPS['group-rare'].run(data, { column: 'c', min_count: '40%', replacement: 'Other' });
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      ['a', 'a', 'Other', 'Other', ''],
    );
  });
});

describe('label-encode', () => {
  it('labels in sklearn order with missing last', () => {
    const out = E.OPS['label-encode'].run(
      { columns: ['c'], rows: [['b'], ['a'], [''], ['a']] },
      { column: 'c' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      [2, 1, 0, 1],
    );
  });
});

describe('normalize', () => {
  it('scales 0 to 1 in place', () => {
    const out = E.OPS['normalize'].run(
      { columns: ['v'], rows: [['10'], ['20'], ['30']] },
      { column: 'v', method: 'minmax' },
    );
    assert.deepEqual(out.columns, ['v']);
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      [0, 0.5, 1],
    );
  });
  it('z-scores with the backend zero-variance guard', () => {
    const out = E.OPS['normalize'].run(
      { columns: ['v'], rows: [['5'], ['5']] },
      { column: 'v', method: 'z' },
    );
    assert.deepEqual(
      out.rows.map((r) => r[0]),
      [0, 0],
    );
  });
  it('refuses non-numeric columns like the backend', () => {
    assert.throws(() =>
      E.OPS['normalize'].run({ columns: ['v'], rows: [['abc']] }, { column: 'v', method: 'z' }),
    );
  });
});

describe('date ops', () => {
  it('extracts parts without timezones', () => {
    const data = { columns: ['d'], rows: [['2026-09-18'], ['bad'], ['']] };
    const run = (part) => E.OPS['extract-date-part'].run(data, { column: 'd', part, output: 'o' });
    assert.equal(run('year').rows[0][1], 2026);
    assert.equal(run('month').rows[0][1], 9);
    assert.equal(run('weekday').rows[0][1], 'Friday');
    assert.equal(run('quarter').rows[0][1], 'Q3');
    assert.equal(run('week').rows[0][1], 38);
    assert.equal(run('year').rows[1][1], null);
    assert.equal(run('year').rows[2][1], null);
  });
  it('differences dates in the requested unit', () => {
    const out = E.OPS['date-difference'].run(
      { columns: ['s', 'e'], rows: [['2026-01-01', '2026-01-10'], ['2026-01-01', '']] },
      { start: 's', end: 'e', unit: 'days', output: 'gap' },
    );
    assert.equal(out.rows[0][2], 9);
    assert.equal(out.rows[1][2], null);
  });
});

describe('parseFormula', () => {
  it('parses precedence, parens and unary minus', () => {
    assert.deepEqual(E.parseFormula('[a] + [b] * 2'), {
      t: 'bin', op: '+', l: { t: 'col', name: 'a' }, r: { t: 'bin', op: '*', l: { t: 'col', name: 'b' }, r: { t: 'num', v: 2 } },
    });
    assert.deepEqual(E.parseFormula('-([a] + 1)'), {
      t: 'neg', x: { t: 'bin', op: '+', l: { t: 'col', name: 'a' }, r: { t: 'num', v: 1 } },
    });
  });
  it('rejects bad syntax with messages', () => {
    for (const bad of ['', '[a', '[a] +', '[a] * * 2', 'price *', '([a]', '@']) {
      assert.throws(() => E.parseFormula(bad));
    }
  });
});

describe('create-column', () => {
  const data = { columns: ['price', 'qty'], rows: [[100, 2], [250, 4], [null, 1]] };
  it('evaluates with missing propagation', () => {
    const out = E.OPS['create-column'].run(data, { formula: '[price] * [qty]', output: 'total' });
    assert.deepEqual(out.columns, ['price', 'qty', 'total']);
    assert.deepEqual(
      out.rows.map((r) => r[2]),
      [200, 1000, null],
    );
  });
  it('maps division by zero to null', () => {
    const out = E.OPS['create-column'].run(
      { columns: ['a', 'b'], rows: [[1, 0]] },
      { formula: '[a] / [b]', output: 'c' },
    );
    assert.equal(out.rows[0][2], null);
  });
  it('refuses unknown columns and non-numerics', () => {
    assert.throws(() =>
      E.OPS['create-column'].run(data, { formula: '[nope] + 1', output: 'c' }),
    );
    assert.throws(() =>
      E.OPS['create-column'].run(
        { columns: ['a'], rows: [['xx']] },
        { formula: '[a] + 1', output: 'c' },
      ),
    );
    assert.throws(() =>
      E.OPS['create-column'].run(data, { formula: '[price] + 1', output: 'price' }),
    );
  });
});

describe('conditional-column', () => {
  const data = { columns: ['age'], rows: [[17], [25], [65], [null]] };
  const params = {
    rules: [
      { column: 'age', op: '<', value: '18', result: 'Minor' },
      { column: 'age', op: '<', value: '60', result: 'Adult' },
    ],
    default: 'Senior',
    output: 'grp',
  };
  it('applies first match wins with else default', () => {
    const out = E.OPS['conditional-column'].run(data, params);
    assert.deepEqual(
      out.rows.map((r) => r[1]),
      ['Minor', 'Adult', 'Senior', 'Senior'],
    );
  });
  it('blank default yields null', () => {
    const out = E.OPS['conditional-column'].run(data, { ...params, default: '' });
    assert.equal(out.rows[3][1], null);
  });
  it('requires rules and a fresh output', () => {
    assert.throws(() => E.OPS['conditional-column'].run(data, { ...params, rules: [] }));
    assert.throws(() => E.OPS['conditional-column'].run(data, { ...params, output: 'age' }));
  });
});

describe('validate-column', () => {
  const data = { columns: ['age'], rows: [[25], [-5], ['abc'], [null]] };
  it('reports per-rule findings and passes data through', () => {
    const out = E.OPS['validate-column'].run(data, {
      column: 'age', vtype: 'any', required: false, min: '0', max: '', allowed: [], unique: false, pattern: '',
    });
    assert.deepEqual(out.columns, ['age']);
    assert.equal(out.rows.length, 4);
    assert.equal(out.report.invalid, 2);
    assert.equal(out.report.checks[0].rule, 'min');
    assert.equal(out.report.checks[0].invalid, 2);
  });
  it('required flags gaps and unique flags repeats', () => {
    const req = E.OPS['validate-column'].run(
      { columns: ['a'], rows: [[1], [null]] },
      { column: 'a', vtype: 'any', required: true, min: '', max: '', allowed: [], unique: false, pattern: '' },
    );
    assert.equal(req.report.invalid, 1);
    const dup = E.OPS['validate-column'].run(
      { columns: ['a'], rows: [[1], [1], [2]] },
      { column: 'a', vtype: 'any', required: false, min: '', max: '', allowed: [], unique: true, pattern: '' },
    );
    assert.equal(dup.report.invalid, 2);
  });
});

describe('find-invalid', () => {
  it('lists reasons and passes data through', () => {
    const out = E.OPS['find-invalid'].run(
      { columns: ['age'], rows: [[25], [-5], ['abc'], [null]] },
      { column: 'age', expect: 'number', min: '0', max: '' },
    );
    assert.equal(out.rows.length, 4);
    assert.equal(out.report.invalid, 2);
    assert.deepEqual(
      out.report.samples.map((s) => s.reason),
      ['below minimum (0)', 'not a number'],
    );
  });
});

describe('operation registry', () => {
  // Mirror of the GROUPS list in app.js: an op whose group is missing here
  // silently vanishes from the palette.
  const GROUPS = ['Missing Data', 'Rows', 'Values', 'Text & Types', 'Structure', 'Categories', 'Numbers', 'Dates', 'Data Quality'];
  it('every op is complete, grouped, and constructible', () => {
    const types = Object.keys(E.OPS);
    assert.ok(types.length >= 28, `expected the full library, found ${types.length}`);
    for (const [type, op] of Object.entries(E.OPS)) {
      for (const k of ['name', 'icon', 'group', 'blurb', 'defaults', 'schema', 'summary', 'run', 'code']) {
        assert.ok(op[k] !== undefined, `${type}: missing ${k}`);
      }
      assert.ok(GROUPS.includes(op.group), `${type}: unknown group "${op.group}"`);
      assert.ok(Array.isArray(op.schema), `${type}: schema must be an array`);
      const params = op.defaults();
      assert.equal(typeof op.summary(params), 'string', `${type}: summary must return a string`);
    }
  });
});
