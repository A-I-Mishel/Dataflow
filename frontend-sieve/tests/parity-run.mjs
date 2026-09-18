// Parity runner: parse a CSV with the Sieve engine and run a pipeline,
// printing the final {columns, rows} as JSON for backend/tests/test_sieve_parity.py.
// Usage: node parity-run.mjs <csvPath> '<json array of {type, params}>'
import { readFileSync } from 'node:fs';
import { EngineFactory } from '../engine.js';

const E = EngineFactory();
const csvPath = process.argv[2];
const spec = JSON.parse(process.argv[3]);

const text = readFileSync(csvPath, 'utf8');
const parsed = E.parseCSVText(text);
const nodes = spec.map((s) => ({ type: s.type, enabled: true, params: s.params }));
const res = E.runFrom({ columns: parsed.columns, rows: parsed.rows }, nodes);

const errors = res.results.map((r) => r.err).filter(Boolean);
if (errors.length > 0) {
  console.error(`ENGINE ERRORS: ${errors.join(' | ')}`);
  process.exit(2);
}
const fin = res.outputs[res.outputs.length - 1];
process.stdout.write(JSON.stringify({ columns: fin.columns, rows: fin.rows }));
