// P0 regression locks: `node --test tests/` from frontend-sieve/.
// Zero deps. Covers the Phase-1 crash/hang fixes without a browser.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EngineFactory, py } from '../engine.js';
import { linearEdges, setApiBase, getSessionId, setSessionId, clearSessionId } from '../api.js';

const E = EngineFactory();

describe('P0: corrupt / unknown ops never crash restore', () => {
  it('filter tolerates null entries (boot guard)', () => {
    const saved = [null, { type: 'sort-rows' }, { type: 'nope-op' }, undefined];
    const kept = saved.filter((x) => x && E.OPS[x.type]);
    assert.deepEqual(kept, [{ type: 'sort-rows' }]);
  });

  it('unknown op isolates error in runFrom', () => {
    const out = E.runFrom({ columns: ['v'], rows: [['1']] }, [
      { type: 'nope-op', enabled: true, params: {} },
    ]);
    assert.ok(out.results[0].err);
    assert.equal(out.outputs.length, 2);
  });

  it('unknown op label falls back to ?', () => {
    const nodes = [{ type: 'nope-op' }];
    const op = nodes[0] ? E.OPS[nodes[0].type] : null;
    const label = `Step 1 · ${((op && op.name) || '?')}`;
    assert.equal(label, 'Step 1 · ?');
  });

  it('bypassed unknown op label falls back to its type', () => {
    const off = [{ type: 'nope-op', enabled: false }];
    const label = off.map((n) => ((E.OPS[n.type] && E.OPS[n.type].name) || n.type)).join(', ');
    assert.equal(label, 'nope-op');
  });
});

describe('P0: runFrom shape (self-test lock)', () => {
  it('returns [base, ...steps]', () => {
    const rr = E.runFrom({ columns: ['v'], rows: [['1'], ['2']] }, [
      { type: 'sort-rows', enabled: true, params: { column: 'v', dir: 'desc' } },
    ]);
    assert.equal(rr.outputs.length, 2);
    assert.deepEqual(rr.outputs[1].rows, [['2'], ['1']]);
  });
});

describe('P0: template edges without ids', () => {
  it('synthesizes n1.. ids instead of [{}]', () => {
    const edges = linearEdges([{ type: 'a' }, { type: 'b' }]);
    assert.deepEqual(edges, [{ source: 'n1', target: 'n2' }]);
  });

  it('keeps real ids when present', () => {
    const edges = linearEdges([{ id: 'x' }, { id: 'y' }]);
    assert.deepEqual(edges, [{ source: 'x', target: 'y' }]);
  });

  it('tolerates empty / null input', () => {
    assert.deepEqual(linearEdges([]), []);
    assert.deepEqual(linearEdges(null), []);
  });
});

describe('P0: worker blob includes py', () => {
  it('EngineFactory source needs py at runtime', () => {
    const factorySrc = EngineFactory.toString();
    assert.ok(factorySrc.includes('py('));
    assert.equal(typeof py, 'function');
    const combined = factorySrc + '\n' + py.toString();
    assert.ok(combined.includes('function py'));
  });
});

describe('P0: restored view validation', () => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function saneView(saved) {
    const view = { z: 0.85, px: 60, py: 40 };
    if (saved && typeof saved === 'object') {
      const vz = Number(saved.z), vpx = Number(saved.px), vpy = Number(saved.py);
      if (Number.isFinite(vz)) view.z = clamp(vz, 0.35, 1.8);
      if (Number.isFinite(vpx)) view.px = vpx;
      if (Number.isFinite(vpy)) view.py = vpy;
    }
    return view;
  }

  it('rejects NaN / string coords', () => {
    assert.deepEqual(saneView({ z: NaN, px: 'x', py: undefined }), { z: 0.85, px: 60, py: 40 });
  });

  it('clamps zoom into range', () => {
    assert.equal(saneView({ z: 9, px: 0, py: 0 }).z, 1.8);
    assert.equal(saneView({ z: 0.01, px: 0, py: 0 }).z, 0.35);
  });

  it('accepts finite values', () => {
    assert.deepEqual(saneView({ z: 1, px: 10, py: 20 }), { z: 1, px: 10, py: 20 });
  });
});

describe('Phase B: backend base + sessions', () => {
  it('setApiBase rejects typos instead of blanking', () => {
    assert.throws(() => setApiBase('localhost:8000'), /http/);
    assert.throws(() => setApiBase('ftp://x'), /http/);
  });

  it('setApiBase accepts empty (local-only) and https', () => {
    assert.equal(setApiBase(''), '');
    assert.equal(setApiBase('https://api.example.com/'), 'https://api.example.com');
  });

  it('sessions are scoped per base', () => {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    try {
      setSessionId('https://a.example', 'sid-a');
      setSessionId('https://b.example', 'sid-b');
      assert.equal(getSessionId('https://a.example'), 'sid-a');
      assert.equal(getSessionId('https://b.example'), 'sid-b');
      assert.equal(getSessionId('https://c.example'), '');
      clearSessionId('https://a.example');
      assert.equal(getSessionId('https://a.example'), '');
      assert.equal(getSessionId('https://b.example'), 'sid-b');
    } finally {
      delete globalThis.localStorage;
    }
  });

  it('getSessionId never leaks across bases without storage', () => {
    // No browser globals: must return '' without throwing.
    assert.equal(getSessionId('https://x.example'), '');
  });
});
