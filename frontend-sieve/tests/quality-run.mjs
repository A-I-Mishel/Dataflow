// Quality parity runner: score a frame with the Sieve engine, printing the
// quality report as JSON for backend/tests/test_quality.py.
// Usage: node quality-run.mjs <csvPath>            (parses like the app)
//     or node quality-run.mjs '<json {columns, rows}>'  (exact frame)
import { readFileSync, existsSync } from 'node:fs';
import { EngineFactory } from '../engine.js';

const E = EngineFactory();
const arg = process.argv[2];
let frame;
try {
  frame = JSON.parse(arg);
  if (!Array.isArray(frame.columns) || !Array.isArray(frame.rows)) throw new Error('not a frame');
} catch (e) {
  if (e.message === 'not a frame') throw e;
  if (!existsSync(arg)) throw new Error(`no such file and not a JSON frame: ${arg}`);
  const parsed = E.parseCSVText(readFileSync(arg, 'utf8'));
  frame = { columns: parsed.columns, rows: parsed.rows };
}
process.stdout.write(JSON.stringify(E.qualityScore(frame.columns, frame.rows)));
