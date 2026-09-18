/* ==================================================================
   ENGINE — pure and self-contained. Stringified into a Web Worker,
   so it must not reference anything outside this function.
   ================================================================== */
function EngineFactory(){
  const MISS = v => v == null || v === '';
  const rnd  = v => Math.round(v * 10000) / 10000;
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function numify(v){
    if (v == null) return NaN;
    let s = String(v).trim().replace(/[$\s\u00A0\u202F']/g, '');
    if (s === '') return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1){
      if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');   // EU: 1.234,56
      else s = s.replace(/,/g, '');                              // US: 1,234.56
    } else if (lc > -1){
      s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    return Number(s);
  }
  const isNumV = v => !MISS(v) && !Number.isNaN(numify(v));

  const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  function mkDate(y,mo,d){
    y=+y; mo=+mo; d=+d;
    if (!y || mo<1 || mo>12 || d<1 || d>31) return null;
    const dt = new Date(Date.UTC(y, mo-1, d));
    if (dt.getUTCMonth() !== mo-1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function parseDate(v){
    if (MISS(v)) return null;
    const s = String(v).trim(); let m;
    if (m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)) return mkDate(m[1], m[2], m[3]);
    if (m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)){
      let a = +m[1], b = +m[2]; if (a > 12){ const t = a; a = b; b = t; } // day-first fallback
      return mkDate(m[3], a, b);
    }
    if (m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)){
      const mo = MONTHS[m[1].slice(0,3).toLowerCase()]; return mo ? mkDate(m[3], mo, m[2]) : null;
    }
    if (m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/)){
      const mo = MONTHS[m[2].slice(0,3).toLowerCase()]; return mo ? mkDate(m[3], mo, m[1]) : null;
    }
    return null;
  }
  function quantile(sorted, qt){
    const pos = (sorted.length - 1) * qt, base = Math.floor(pos), rest = pos - base;
    return sorted[base+1] !== undefined ? sorted[base] + rest * (sorted[base+1] - sorted[base]) : sorted[base];
  }
  // Canonical scalar→string shared by string-building ops (merge, extract):
  // whole floats take int form so both engines agree without pandas dtype
  // knowledge. Missing (null/NaN) stays null and is skipped by callers,
  // never stringified. Known edge: JS booleans stringify lowercase
  // ('true') vs pandas ('True') — unreachable via CSV parsing, where
  // booleans arrive as strings.
  function sieveStr(v){
    if (v == null || (typeof v === 'number' && Number.isNaN(v))) return null;
    if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    return String(v);
  }
  // Regex character-class body for the remove-special-chars keep set.
  // Mirrors backend build_allowed() exactly: same groups in the same order,
  // same escaping (regex + class metacharacters).
  function specialClassBody(letters, numbers, spaces, custom){
    let body = '';
    if (letters !== false) body += 'A-Za-z';
    if (numbers !== false) body += '0-9';
    if (spaces !== false) body += '\\s';
    if (custom) body += String(custom).replace(/[\\\]^$.*+?()[\]{}|-]/g, '\\$&');
    return body;
  }
  // ISO-8601 week number from Y/M/D components (no timezone involved).
  function isoWeekNum(y, mo, d){
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const day = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const fday = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - fday + 3);
    return 1 + Math.round((dt - first) / 6048e5);
  }
  // Strict scalar→number for arithmetic/validation: blank stays missing,
  // anything else must parse cleanly or it throws naming the column. This
  // deliberately rejects what numify() accepts (currency, thousands) so the
  // local engine refuses exactly the inputs pandas to_numeric() refuses.
  const STRICT_NUM_RE = /^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;
  function strictNum(v, col){
    if (MISS(v)) return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    if (typeof v !== 'string') throw new Error(`"${col}" has non-numeric values`);
    const t = v.trim();
    if (/^[-+]?inf(inity)?$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    if (!STRICT_NUM_RE.test(t)) throw new Error(`"${col}" has non-numeric values`);
    return Number(t);
  }
  // Row matcher with filter-rows semantics (numeric coercion, then string
  // fallback, missing never matches). Copied shape, not shared code, so the
  // locked filter behavior cannot regress from conditional edits.
  function matchCond(v, op, t){
    if (MISS(v)) return false;
    const numeric = isNumV(t);
    if (numeric){
      if (!isNumV(v)) return false;
      const a = numify(v), b = numify(t);
      switch (op){
        case '=': return a === b;  case '≠': return a !== b;
        case '>': return a > b;    case '<': return a < b;
        case '≥': return a >= b;   case '≤': return a <= b;
        default: return false;
      }
    }
    const s = String(v), u = String(t);
    switch (op){
      case '=': return s === u;   case '≠': return s !== u;
      case '>': return s > u;     case '<': return s < u;
      case '≥': return s >= u;    case '≤': return s <= u;
      case 'contains': return s.toLowerCase().includes(u.toLowerCase());
      default: return false;
    }
  }
  // Safe arithmetic formulas, e.g. "[price] * [quantity]". Mirrors the
  // backend grammar exactly (see transforms/create_column.py): numbers,
  // [column] refs, four operators, parens, unary minus — nothing else can
  // even be represented, so formulas are interpreted, never executed.
  function parseFormula(src){
    const toks = [];
    let i = 0;
    while (i < src.length){
      const ch = src[i];
      if (/\s/.test(ch)){ i++; continue; }
      if ('+-*/()'.includes(ch)){ toks.push(ch); i++; continue; }
      if (ch === '['){
        const j = src.indexOf(']', i + 1);
        if (j < 0) throw new Error('unclosed [column] reference');
        const name = src.slice(i + 1, j).trim();
        if (!name) throw new Error('empty [] reference');
        toks.push({ t:'col', name }); i = j + 1; continue;
      }
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (m){ toks.push({ t:'num', v:parseFloat(m[0]) }); i += m[0].length; continue; }
      throw new Error(`unexpected character "${ch}" (columns go in [brackets])`);
    }
    let pos = 0, depth = 0;
    const peek = () => (pos < toks.length ? toks[pos] : null);
    const next = () => { const t = peek(); if (t === null) throw new Error('formula ends mid-expression'); pos++; return t; };
    // Depth cap mirrors the backend twin: uncapped nesting overflows the
    // call stack instead of producing a readable node error.
    const deeper = () => { if (++depth > 50) throw new Error('formula nests too deeply (max 50)'); };
    function expr(){ let n = term(); while (peek() === '+' || peek() === '-'){ const op = next(); n = { t:'bin', op, l:n, r:term() }; } return n; }
    function term(){ let n = factor(); while (peek() === '*' || peek() === '/'){ const op = next(); n = { t:'bin', op, l:n, r:factor() }; } return n; }
    function factor(){
      const t = next();
      if (t && typeof t === 'object') return t;
      if (t === '('){ deeper(); try { const n = expr(); if (next() !== ')') throw new Error('unbalanced parenthesis'); return n; } finally { depth--; } }
      if (t === '-'){ deeper(); try { return { t:'neg', x:factor() }; } finally { depth--; } }
      throw new Error(`expected a number, [column] or '('`);
    }
    const tree = expr();
    if (peek() !== null) throw new Error('trailing input after formula');
    return tree;
  }
  function formulaRefs(tree, acc){
    acc = acc || [];
    if (tree.t === 'col'){ if (!acc.includes(tree.name)) acc.push(tree.name); }
    else if (tree.t === 'bin'){ formulaRefs(tree.l, acc); formulaRefs(tree.r, acc); }
    else if (tree.t === 'neg'){ formulaRefs(tree.x, acc); }
    return acc;
  }
  function evalFormula(tree, get){
    if (tree.t === 'num') return tree.v;
    if (tree.t === 'col') return get(tree.name);
    if (tree.t === 'neg'){ const v = evalFormula(tree.x, get); return v === null ? null : -v; }
    const l = evalFormula(tree.l, get), r = evalFormula(tree.r, get);
    if (l === null || r === null) return null;
    switch (tree.op){
      case '+': return l + r;
      case '-': return l - r;
      case '*': return l * r;
      default: return r === 0 ? null : l / r;
    }
  }
  function formulaToPandas(tree){
    if (tree.t === 'num') return String(tree.v);
    if (tree.t === 'col') return `df[${py(tree.name)}]`;
    if (tree.t === 'neg') return `(-${formulaToPandas(tree.x)})`;
    return `(${formulaToPandas(tree.l)} ${tree.op} ${formulaToPandas(tree.r)})`;
  }
  function decodeBytes(buf){
    try { return { text: new TextDecoder('utf-8', {fatal:true}).decode(buf), encoding: 'UTF-8' }; }
    catch(e){ return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'Windows-1252' }; }
  }

  function parseCSVText(raw){
    const warnings = [];
    const text = raw.replace(/^\uFEFF/, '');
    const nl = text.indexOf('\n');
    const head = nl >= 0 ? text.slice(0, nl) : text;
    let delim = ',';
    const cand = [',',';','\t','|'].map(d => [d, head.split(d).length - 1]).sort((a,b) => b[1] - a[1]);
    if (cand[0][1] > 0 && cand[0][0] !== ','){ delim = cand[0][0]; warnings.push({level:'info', msg:`Detected “${delim === '\t' ? 'tab' : delim}” as the delimiter.`}); }
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++){
      const ch = text[i];
      if (inQ){
        if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      }
      else if (ch === '"') inQ = true;
      else if (ch === delim){ row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r'){
        if (ch === '\r' && text[i+1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      }
      else cur += ch;
    }
    if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
    if (inQ) warnings.push({level:'warn', msg:'File ended inside an unclosed quoted field — the last cell may be truncated.'});
    let emptySkipped = 0;
    const dataRows = rows.filter(r => (r.length === 1 && r[0].trim() === '') ? (emptySkipped++, false) : true);
    if (!dataRows.length) throw new Error('no data rows found in file');
    const seen = {};
    const columns = dataRows[0].map((c, i) => {
      let n = String(c).trim() || `column_${i+1}`;
      if (seen[n]){
        // Reserve the new name too: ['a','a','a_2'] must not collapse the
        // third column onto the generated 'a_2'.
        let k = seen[n], m;
        do { k++; m = `${n}_${k}`; } while (seen[m]);
        seen[n] = k;
        warnings.push({level:'warn', msg:`Duplicate header “${String(c).trim()}” renamed to “${m}”.`});
        n = m;
      }
      seen[n] = 1;
      return n;
    });
    let shortR = 0, longR = 0;
    const out = dataRows.slice(1).map(r => {
      if (r.length > columns.length){ longR++; return r.slice(0, columns.length); }
      if (r.length < columns.length){ shortR++; return r.concat(new Array(columns.length - r.length).fill('')); }
      return r;
    });
    if (longR)  warnings.push({level:'warn', msg:`${fmtInt(longR)} row(s) had more values than the ${columns.length} headers — extras were dropped.`});
    if (shortR) warnings.push({level:'warn', msg:`${fmtInt(shortR)} row(s) had fewer values than headers — gaps were filled as empty.`});
    if (emptySkipped) warnings.push({level:'info', msg:`${fmtInt(emptySkipped)} blank line(s) skipped.`});
    return { columns, rows: out, warnings, delim };
  }

  /* ---- per-dataset column statistics ---- */
  function metaOf(columns, rows, deep){
    const nc = columns.length;
    const missC = new Array(nc).fill(0), numC = new Array(nc).fill(0), dateC = new Array(nc).fill(0), seenC = new Array(nc).fill(0);
    const sampleA = new Array(nc).fill(null);
    let totalMissing = 0;
    const uniq = deep ? columns.map(() => new Set()) : null;
    const dupSeen = deep ? new Set() : null;
    let dupCount = 0;
    for (let ri = 0; ri < rows.length; ri++){
      const r = rows[ri];
      if (deep){ const k = JSON.stringify(r); if (dupSeen.has(k)) dupCount++; else dupSeen.add(k); }
      for (let i = 0; i < nc; i++){
        const v = r[i];
        if (MISS(v)){ missC[i]++; totalMissing++; continue; }
        if (sampleA[i] === null) sampleA[i] = v;
        seenC[i]++;
        if (isNumV(v)) numC[i]++;
        else if (parseDate(v)) dateC[i]++;
        if (deep && uniq[i].size <= 1000) uniq[i].add(v);
      }
    }
    const types = {}, missingByCol = {}, samples = {};
    const uniqByCol = deep ? {} : null;
    for (let i = 0; i < nc; i++){
      const c = columns[i], nn = seenC[i];
      types[c] = nn && numC[i]/nn >= .85 ? 'num' : (nn && dateC[i]/nn >= .85 ? 'date' : 'text');
      missingByCol[c] = missC[i];
      samples[c] = sampleA[i];
      if (deep) uniqByCol[c] = uniq[i].size > 1000 ? '1000+' : uniq[i].size;
    }
    const meta = { types, missingByCol, missingTotal: totalMissing, samples, uniqByCol };
    if (deep) meta.dupCount = dupCount || 0;
    return meta;
  }

  const colIdx = (d, c) => {
    if (c === '' || c == null) throw new Error('pick a column in the inspector first');
    const i = d.columns.indexOf(c);
    if (i < 0) throw new Error(`column "${c}" no longer exists upstream`);
    return i;
  };
  const replaceCell = (r, ci, v) => { const n = r.slice(); n[ci] = v; return n; };
  function mostlyNum(rows, ci){
    let n = 0, num = 0;
    for (let i = 0; i < rows.length && n < 200; i++){ const v = rows[i][ci]; if (MISS(v)) continue; n++; if (isNumV(v)) num++; }
    return n > 0 && num / n >= .85;
  }
  function isNumCol(rows, ci){
    for (let i = 0; i < rows.length; i++){ const v = rows[i][ci]; if (MISS(v)) continue; if (!isNumV(v)) return false; }
    return true;
  }
  const sanitizeCol = s => String(s).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'col';

  /* ---- operation library: pure (data, params) → new data ---- */
  const OPS = {

    'fill-missing': {
      name:'Fill Missing', icon:'droplet', group:'Missing Data', rowStable:true,
      blurb:'Replace gaps with mean, median, mode…',
      defaults: () => ({ column:'', method:'median', value:'', limit:'' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'method', t:'seg', label:'Strategy', opts:[['mean','Mean'],['median','Median'],['mode','Mode'],['ffill','Fill down'],['bfill','Fill up'],['custom','Value']] },
        { k:'value', t:'text', label:'Fill value', ph:'e.g. Unknown', show:p=>p.method==='custom' },
        { k:'limit', t:'text', label:'Consecutive-fill limit', ph:'blank = unlimited', show:p=>p.method==='ffill'||p.method==='bfill' }
      ],
      summary: p => {
        const label = {mean:'mean',median:'median',mode:'mode',ffill:'fill down',bfill:'fill up',custom:`“${p.value}”`}[p.method];
        const lim = (p.method === 'ffill' || p.method === 'bfill') && p.limit !== '' && p.limit != null ? ` · max ${p.limit} in a row` : '';
        return `${p.column || '—'} · ${label}${lim}`;
      },
      hint: (d, p) => (p.method === 'mean' || p.method === 'median') ? { num:true } : null,
      run(d, p){
        const ci = colIdx(d, p.column), rows = d.rows;
        if (p.method === 'ffill' || p.method === 'bfill'){
          const lim = p.limit === '' || p.limit == null ? null
            : (/^\d+$/.test(String(p.limit).trim()) ? parseInt(p.limit, 10) : null);
          if ((p.limit !== '' && p.limit != null) && lim === null) throw new Error('fill limit must be a whole number or blank');
          const order = rows.map((_, i) => i);
          if (p.method === 'bfill') order.reverse();
          // pandas .ffill(limit=n)/.bfill(limit=n) semantics: at most n
          // consecutive gaps filled, streak resets on every real value.
          const out = rows.slice();
          let last = null, streak = 0;
          for (const i of order){
            const v = rows[i][ci];
            if (MISS(v)){
              if (last !== null && (lim === null || streak < lim)){ out[i] = replaceCell(rows[i], ci, last); streak++; }
            } else { last = v; streak = 0; }
          }
          return { columns: d.columns, rows: out };
        }
        let fill;
        if (p.method === 'mean' || p.method === 'median'){
          const nums = [];
          for (const r of rows){ const v = r[ci]; if (!MISS(v) && isNumV(v)) nums.push(numify(v)); }
          if (!nums.length) throw new Error(`"${p.column}" has no parseable numeric values to average`);
          nums.sort((a,b) => a - b);
          fill = rnd(p.method === 'mean' ? nums.reduce((a,b) => a+b, 0) / nums.length : quantile(nums, .5));
        } else if (p.method === 'mode'){
          const freq = new Map(); let best = null, bn = 0;
          for (const r of rows){ const v = r[ci]; if (MISS(v)) continue; const c1 = (freq.get(v)||0)+1; freq.set(v, c1); if (c1 > bn){ bn = c1; best = v; } }
          if (best === null) throw new Error('no values to learn a mode from');
          fill = best;
        } else {
          if (p.value === '') throw new Error('type a fill value below');
          fill = (mostlyNum(rows, ci) && isNumV(p.value)) ? numify(p.value) : p.value;
        }
        return { columns: d.columns, rows: rows.map(r => MISS(r[ci]) ? replaceCell(r, ci, fill) : r) };
      },
      code: (ctx, p) => {
        const c = py(p.column);
        if (p.method === 'ffill' || p.method === 'bfill'){
          const m = p.method === 'ffill' ? 'ffill' : 'bfill';
          const arg = /^\d+$/.test(String(p.limit ?? '').trim()) ? `limit=${parseInt(p.limit, 10)}` : '';
          return [`df[${c}] = df[${c}].${m}(${arg})`];
        }
        if (p.method === 'mode')  return [`df[${c}] = df[${c}].fillna(df[${c}].mode().iloc[0])`];
        if (p.method === 'mean' || p.method === 'median'){
          const agg = p.method === 'mean' ? 'mean' : 'median';
          if (ctx.types && ctx.types[p.column] === 'num')
            return [`_m = df[${c}].${agg}().round(4)`, `df[${c}] = df[${c}].fillna(_m)`];
          return [`_k = _sieve_num(df[${c}])`, `_m = _k.${agg}().round(4)`, `df[${c}] = df[${c}].fillna(_m)`];
        }
        const val = (ctx.types && ctx.types[p.column] === 'num' && isNumV(p.value)) ? String(numify(p.value)) : py(p.value);
        return [`df[${c}] = df[${c}].fillna(${val})`];
      }
    },

    'drop-missing': {
      name:'Drop Missing Rows', icon:'ban', group:'Missing Data', rowStable:false,
      blurb:'Remove rows that contain empty cells',
      defaults: () => ({ column:'__all__', match:'any' }),
      schema: [
        { k:'column', t:'select', label:'Drop rows empty in', opts: ctx => [['__all__','any column'], ...ctx.columns.map(c => [c, c])] },
        { k:'match', t:'seg', label:'Drop when', opts:[['any','any checked cell is empty'],['all','every checked cell is empty']] }
      ],
      summary: p => {
        const scope = p.column === '__all__' ? 'rows' : `rows where “${p.column}”`;
        return (p.match || 'any') === 'any'
          ? (p.column === '__all__' ? 'rows with any empty cell' : `${scope} is empty`)
          : (p.column === '__all__' ? 'rows that are completely empty' : `${scope} is empty`);
      },
      run(d, p){
        const any = (p.match || 'any') === 'any';
        const idx = p.column === '__all__' ? d.columns.map((_, i) => i) : [colIdx(d, p.column)];
        const rows = d.rows.filter(r => any ? !idx.some(i => MISS(r[i])) : !idx.every(i => MISS(r[i])));
        return { columns: d.columns, rows };
      },
      code: (ctx, p) => {
        const how = (p.match || 'any') === 'any' ? 'any' : 'all';
        if (p.column === '__all__') return [`df = df.dropna(how="${how}")`];
        return [`df = df.dropna(subset=[${py(p.column)}], how="${how}")`];
      }
    },

    'drop-duplicates': {
      name:'Drop Duplicates', icon:'copy', group:'Rows', rowStable:false,
      blurb:'Remove repeated rows, keep first or last',
      defaults: () => ({ keep:'first' }),
      schema: [{ k:'keep', t:'seg', label:'Keep', opts:[['first','First'],['last','Last']] }],
      summary: p => `keep ${p.keep} occurrence`,
      run(d, p){
        const seen = new Set();
        const src = p.keep === 'first' ? d.rows : d.rows.slice().reverse();
        const out = src.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
        return { columns: d.columns, rows: p.keep === 'first' ? out : out.reverse() };
      },
      code: (ctx, p) => [`df = df.drop_duplicates(${p.keep === 'last' ? 'keep="last" ' : ''}).reset_index(drop=True)`]
    },

    'filter-rows': {
      name:'Filter Rows', icon:'filter', group:'Rows', rowStable:false,
      blurb:'Keep only rows matching a condition',
      defaults: () => ({ column:'', op:'=', value:'' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'op', t:'seg', label:'Operator', opts:[['=','='],['≠','≠'],['>','>'],['<','<'],['≥','≥'],['≤','≤'],['contains','contains']] },
        { k:'value', t:'text', label:'Value', ph:'value to compare' }
      ],
      summary: p => `${p.column || '—'} ${p.op} ${p.value === '' ? '…' : p.value}`,
      hint: (d, p) => isNumV(p.value) ? { num:true } : null,
      run(d, p){
        const ci = colIdx(d, p.column);
        if (p.value === '') throw new Error('type a comparison value');
        const numeric = isNumV(p.value);
        const target = numeric ? numify(p.value) : String(p.value);
        const rows = d.rows.filter(r => {
          const v = r[ci];
          if (MISS(v)) return false;
          if (numeric){
            if (!isNumV(v)) return false;
            const a = numify(v);
            switch (p.op){
              case '=': return a === target;  case '≠': return a !== target;
              case '>': return a > target;    case '<': return a < target;
              case '≥': return a >= target;   case '≤': return a <= target;
            }
          }
          const s = String(v), t = String(p.value);
          switch (p.op){
            case '=': return s === t;   case '≠': return s !== t;
            case '>': return s > t;     case '<': return s < t;
            case '≥': return s >= t;    case '≤': return s <= t;
            case 'contains': return s.toLowerCase().includes(t.toLowerCase());
          }
        });
        return { columns: d.columns, rows };
      },
      code: (ctx, p) => {
        const c = py(p.column);
        if (p.op === 'contains')
          return [`df = df[df[${c}].notna() & df[${c}].astype(str).str.contains(${py(p.value)}, case=False, regex=False)]`];
        const OP = {'=':'==','≠':'!=','>':'>','<':'<','≥':'>=','≤':'<='}[p.op];
        if (isNumV(p.value))
          return [`_k = _sieve_num(df[${c}])`, `df = df[_k.notna() & (_k ${OP} ${numify(p.value)})]`];
        return [`df = df[df[${c}].notna() & (df[${c}].astype(str) ${OP} ${py(p.value)})]`];
      }
    },

    'sort-rows': {
      name:'Sort Rows', icon:'sort', group:'Rows', rowStable:false,
      blurb:'Order rows by any column',
      defaults: () => ({ column:'', dir:'asc' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'dir', t:'seg', label:'Direction', opts:[['asc','A → Z'],['desc','Z → A']] }
      ],
      summary: p => `${p.column || '—'} · ${p.dir === 'asc' ? 'ascending' : 'descending'}`,
      hint: (d, p) => ({ num: d.columns.includes(p.column) && isNumCol(d.rows, d.columns.indexOf(p.column)) }),
      run(d, p){
        const ci = colIdx(d, p.column);
        const numeric = isNumCol(d.rows, ci);
        const dir = p.dir === 'asc' ? 1 : -1;
        // Direction lives in the comparator (not a post-hoc reverse) so tied
        // rows keep input order in BOTH directions — matching pandas
        // kind="stable" — while missing values stay last either way
        // (na_position="last" in the exported code).
        const rows = d.rows.slice().sort((a, b) => {
          const va = a[ci], vb = b[ci], ma = MISS(va), mb = MISS(vb);
          if (ma && mb) return 0;
          if (ma) return 1;
          if (mb) return -1;
          if (numeric){ const x = numify(va), y = numify(vb); return x === y ? 0 : (x < y ? -1 : 1) * dir; }
          return (va < vb ? -1 : va > vb ? 1 : 0) * dir;   // code-point order, mirrors Python str comparison
        });
        return { columns: d.columns, rows };
      },
      code: (ctx, p, hint) => {
        const c = py(p.column);
        if (hint && hint.num)
          return [
            `_k = _sieve_num(df[${c}])`,
            `df = df.assign(_sieve_key=_k).sort_values("_sieve_key", ascending=${p.dir === 'asc'}, na_position="last", kind="stable").drop(columns="_sieve_key").reset_index(drop=True)`
          ];
        return [`df = df.sort_values(${c}, ascending=${p.dir === 'asc'}, na_position="last", kind="stable").reset_index(drop=True)  # text order, stable ties`];
      }
    },

    'remove-outliers': {
      name:'Remove Outliers', icon:'scissors', group:'Rows',
      blurb:'Trim extreme values with the IQR rule',
      rowStable:false,
      defaults: () => ({ column:'', action:'remove' }),
      schema: [
        { k:'column', t:'column', label:'Numeric column' },
        { k:'action', t:'seg', label:'Action', opts:[['remove','Drop rows'],['clip','Clip values']] }
      ],
      summary: p => `${p.column || '—'} · IQR ×1.5 · ${p.action === 'remove' ? 'drop rows' : 'clip'}`,
      hint: () => ({ num:true }),
      run(d, p){
        const ci = colIdx(d, p.column);
        const nums = [];
        for (const r of d.rows){ const v = r[ci]; if (!MISS(v) && isNumV(v)) nums.push(numify(v)); }
        if (nums.length < 4) throw new Error('need at least 4 numeric values');
        nums.sort((a,b) => a-b);
        const q1 = quantile(nums, .25), q3 = quantile(nums, .75), iqr = q3 - q1;
        const lo = q1 - 1.5*iqr, hi = q3 + 1.5*iqr;
        if (p.action === 'remove'){
          const rows = d.rows.filter(r => { const v = r[ci]; if (MISS(v) || !isNumV(v)) return true; const x = numify(v); return x >= lo && x <= hi; });
          return { columns: d.columns, rows };
        }
        return { columns: d.columns, rows: d.rows.map(r => {
          const v = r[ci]; if (MISS(v) || !isNumV(v)) return r;
          const x = numify(v);
          return (x < lo || x > hi) ? replaceCell(r, ci, rnd(clamp(x, lo, hi))) : r;
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column);
        if (p.action === 'remove') return [
          `_k = _sieve_num(df[${c}])`,
          '_q1, _q3 = _k.quantile([0.25, 0.75])',
          '_iqr = _q3 - _q1',
          'df = df[_k.isna() | _k.between(_q1 - 1.5*_iqr, _q3 + 1.5*_iqr)]'
        ];
        return [
          `_k = _sieve_num(df[${c}])`,
          '_q1, _q3 = _k.quantile([0.25, 0.75])',
          '_iqr = _q3 - _q1',
          '_mask = _k.notna() & ((_k < _q1 - 1.5*_iqr) | (_k > _q3 + 1.5*_iqr))',
          'df.loc[_mask, ' + c + '] = _k[_mask].clip(_q1 - 1.5*_iqr, _q3 + 1.5*_iqr).round(4)'
        ];
      }
    },

    'clean-text': {
      name:'Clean Text', icon:'sparkle', group:'Text & Types', rowStable:true,
      blurb:'Trim spaces, fix casing, tidy whitespace',
      defaults: () => ({ column:'', trim:true, collapse:true, case:'lower', punct:false }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'case', t:'seg', label:'Letter case', opts:[['keep','Keep'],['lower','lower'],['upper','UPPER'],['title','Title']] },
        { k:'trim', t:'check', label:'Trim outer spaces' },
        { k:'collapse', t:'check', label:'Collapse inner whitespace' },
        { k:'punct', t:'check', label:'Strip punctuation' }
      ],
      summary: p => {
        const bits = [];
        if (p.trim) bits.push('trim'); if (p.collapse) bits.push('single-space'); if (p.punct) bits.push('no punctuation');
        bits.push({keep:'keep case',lower:'lowercase',upper:'UPPERCASE',title:'Title Case'}[p.case]);
        return `${p.column || '—'} · ${bits.join(' · ')}`;
      },
      hint: (d, p, inMeta) => (inMeta.types[p.column] && inMeta.types[p.column] !== 'text') ? { str:true } : null,
      run(d, p){
        const ci = colIdx(d, p.column);
        const f = v => {
          if (MISS(v)) return v;
          let s = String(v);
          if (p.trim) s = s.trim();
          if (p.collapse) s = s.replace(/\s+/g, ' ');
          if (p.case === 'lower') s = s.toLowerCase();
          else if (p.case === 'upper') s = s.toUpperCase();
          else if (p.case === 'title') s = s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
          if (p.punct) s = s.replace(/[^\w\s]|_/g, '');
          return s;
        };
        return { columns: d.columns, rows: d.rows.map(r => {
          const v = r[ci]; if (MISS(v)) return r;
          const nv = f(v);
          return nv === v ? r : replaceCell(r, ci, nv);
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column), parts = [];
        if (p.trim) parts.push('str.strip()');
        if (p.collapse) parts.push('str.replace(r"\\s+", " ", regex=True)');
        if (p.case === 'lower') parts.push('str.lower()');
        else if (p.case === 'upper') parts.push('str.upper()');
        else if (p.case === 'title') parts.push('str.replace(r"\\S+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), regex=True)');
        if (p.punct) parts.push('str.replace(r"[^\\w\\s]|_", "", regex=True)');
        if (!parts.length) parts.push('str.strip()');
        const base = (ctx.types && ctx.types[p.column] && ctx.types[p.column] !== 'text')
          ? `_sieve_str(df[${c}])` : `df[${c}]`;
        return [`_s = ${base}.${parts.join('.')}`, `df[${c}] = df[${c}].where(df[${c}].isna(), _s)`];
      }
    },

    'convert-type': {
      name:'Convert Type', icon:'type', group:'Text & Types', rowStable:true,
      blurb:'Cast a column to number, text or ISO date',
      defaults: () => ({ column:'', to:'number' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'to', t:'seg', label:'Convert to', opts:[['number','number'],['text','text'],['date','ISO date']] }
      ],
      summary: p => `${p.column || '—'} → ${{number:'number',text:'text',date:'date (YYYY-MM-DD)'}[p.to]}`,
      hint: (d, p) => p.to === 'number' ? { num:true } : (p.to === 'text' ? { str:true } : null),
      run(d, p){
        const ci = colIdx(d, p.column);
        return { columns: d.columns, rows: d.rows.map(r => {
          const v = r[ci];
          if (p.to === 'number') return replaceCell(r, ci, (!MISS(v) && isNumV(v)) ? numify(v) : null);
          if (p.to === 'date')   return replaceCell(r, ci, MISS(v) ? null : parseDate(v));
          if (MISS(v)) return r;
          const s = String(v);
          return s === v ? r : replaceCell(r, ci, s);
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column);
        if (p.to === 'number') return [`df[${c}] = _sieve_num(df[${c}])`];
        if (p.to === 'date') return [
          `try:  # pandas >= 2.0 handles mixed formats`,
          `    df[${c}] = pd.to_datetime(df[${c}], format="mixed", errors="coerce")`,
          `except (TypeError, ValueError):`,
          `    df[${c}] = pd.to_datetime(df[${c}], errors="coerce")`,
          `df[${c}] = df[${c}].dt.strftime("%Y-%m-%d")`
        ];
        return [`df[${c}] = df[${c}].map(_sieve_str)`];
      }
    },

    'drop-columns': {
      name:'Drop Columns', icon:'columns', group:'Structure', rowStable:true,
      blurb:'Remove columns you don’t need',
      defaults: () => ({ columns:[] }),
      schema: [{ k:'columns', t:'multi', label:'Columns to drop' }],
      summary: p => (p.columns && p.columns.length) ? p.columns.join(', ') : 'nothing selected yet',
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        const drop = p.columns.map(c => colIdx(d, c));
        if (drop.length >= d.columns.length) throw new Error('cannot drop every column');
        const keep = d.columns.map((_, i) => i).filter(i => !drop.includes(i));
        return { columns: keep.map(i => d.columns[i]), rows: d.rows.map(r => keep.map(i => r[i])) };
      },
      code: (ctx, p) => [`df = df.drop(columns=[${p.columns.map(py).join(', ')}])`]
    },

    'rename-columns': {
      name:'Rename Columns', icon:'type', group:'Structure', rowStable:true,
      blurb:'Give columns clearer names',
      defaults: () => ({ map:{} }),
      schema: [{ k:'map', t:'rename', label:'New names — blank keeps the old one' }],
      summary: p => {
        const e = Object.entries(p.map || {}).filter(([,v]) => v !== '' && v != null);
        if (!e.length) return 'no renames yet';
        const shown = e.slice(0,2).map(([a,b]) => `${a} → ${b}`).join(' · ');
        return e.length > 2 ? `${shown} · +${e.length-2} more` : shown;
      },
      run(d, p){
        const m = p.map || {};
        const entries = Object.entries(m).filter(([o, v]) => v !== '' && v != null && d.columns.includes(o));
        if (!entries.length) throw new Error('type at least one new name');
        const news = d.columns.map(c => { const e = entries.find(([o]) => o === c); return e ? String(e[1]).trim() : c; });
        if (news.some(c => c === '')) throw new Error('names cannot be empty');
        const dup = news.find((c, i) => news.indexOf(c) !== i);
        if (dup) throw new Error(`duplicate column name “${dup}”`);
        return { columns: news, rows: d.rows };   // rename is metadata-only; rows shared immutably
      },
      code: (ctx, p) => {
        const e = Object.entries(p.map || {}).filter(([o, v]) => v !== '' && v != null && ctx.columns.includes(o));
        if (!e.length) return ['# nothing to rename'];
        return [`df = df.rename(columns={${e.map(([o, n]) => `${py(o)}: ${py(String(n).trim())}`).join(', ')}})`];
      }
    },

    'one-hot': {
      name:'One-hot Encode', icon:'layers', group:'Categories', rowStable:true,
      blurb:'Turn a category into 0/1 flag columns',
      defaults: () => ({ column:'' }),
      schema: [{ k:'column', t:'column', label:'Category column' }],
      summary: p => `${p.column || '—'} → 0/1 flags`,
      run(d, p){
        const ci = colIdx(d, p.column);
        const cats = [];
        for (const r of d.rows){ const v = r[ci]; if (MISS(v)) continue; if (!cats.includes(v)) cats.push(v); }
        if (cats.length < 2) throw new Error('needs at least 2 distinct non-empty values');
        if (cats.length > 15) throw new Error(`"${p.column}" has ${cats.length} distinct values — too many to encode`);
        const newCols = cats.map(cat => `${sanitizeCol(p.column)}_${sanitizeCol(String(cat))}`);
        const dup = newCols.find((c, i) => newCols.indexOf(c) !== i || d.columns.includes(c));
        if (dup) throw new Error(`encoding would create a duplicate column “${dup}”`);
        return {
          columns: [...d.columns, ...newCols],
          rows: d.rows.map(r => r.concat(cats.map(cat => String(r[ci]) === String(cat) ? 1 : 0)))
        };
      },
      code: (ctx, p) => oneHotCode(p)
    },

    'standardize': {
      name:'Standardize', icon:'sigma', group:'Numbers', rowStable:true,
      blurb:'Z-scores or 0→1 scaling, into a new column',
      defaults: () => ({ column:'', method:'z' }),
      schema: [
        { k:'column', t:'column', label:'Numeric column' },
        { k:'method', t:'seg', label:'Method', opts:[['z','z-score'],['minmax','0 → 1']] }
      ],
      summary: p => `${p.column || '—'} → ${{z:'z-score',minmax:'0–1 scale'}[p.method]}`,
      hint: () => ({ num:true }),
      run(d, p){
        const ci = colIdx(d, p.column);
        const nums = [];
        for (const r of d.rows){ const v = r[ci]; if (!MISS(v) && isNumV(v)) nums.push(numify(v)); }
        if (nums.length < 2) throw new Error('need at least 2 numeric values');
        const nc = p.column + (p.method === 'z' ? '_z' : '_scaled');
        if (d.columns.includes(nc)) throw new Error(`column "${nc}" already exists`);
        let f;
        if (p.method === 'z'){
          const mean = nums.reduce((a,b) => a+b, 0) / nums.length;
          const sd = Math.sqrt(nums.reduce((a,b) => a + (b-mean)**2, 0) / (nums.length - 1));
          if (sd === 0) throw new Error('values have zero variance');
          f = v => rnd((numify(v) - mean) / sd);
        } else {
          const lo = Math.min(...nums), hi = Math.max(...nums);
          if (hi === lo) throw new Error('values have zero range');
          f = v => rnd((numify(v) - lo) / (hi - lo));
        }
        return {
          columns: [...d.columns, nc],
          rows: d.rows.map(r => {
            const v = r[ci];
            return (MISS(v) || !isNumV(v)) ? replaceCell(r, d.columns.length, null) : replaceCell(r, d.columns.length, f(v));
          })
        };
      },
      code: (ctx, p) => {
        const c = py(p.column), nc = py(p.column + (p.method === 'z' ? '_z' : '_scaled'));
        if (p.method === 'z')
          return [`_k = _sieve_num(df[${c}])`, `df[${nc}] = ((_k - _k.mean()) / _k.std()).round(4)`];
        return [`_k = _sieve_num(df[${c}])`, `df[${nc}] = ((_k - _k.min()) / (_k.max() - _k.min())).round(4)`];
      }
    },

    'round-values': {
      name:'Round Values', icon:'sigma', group:'Numbers', rowStable:true,
      blurb:'Round numbers to N decimal places',
      defaults: () => ({ columns:[], decimals:'2' }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'decimals', t:'text', label:'Decimal places', ph:'e.g. 2' }
      ],
      summary: p => `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} → ${p.decimals === '' ? '…' : p.decimals + ' dp'}`,
      hint: () => ({ num:true }),
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        if (!/^\d+$/.test(String(p.decimals ?? '').trim())) throw new Error('decimals must be a whole number ≥ 0');
        const dec = parseInt(p.decimals, 10);
        const idx = p.columns.map(c => colIdx(d, c));
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (const ci of idx){
            const v = row[ci];
            if (!MISS(v) && isNumV(v)){
              const nv = Number(numify(v).toFixed(dec));
              if (nv !== v) row = replaceCell(row, ci, nv);
            }
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const dec = /^\d+$/.test(String(p.decimals ?? '').trim()) ? String(parseInt(p.decimals, 10)) : '2';
        const cs = (p.columns || []).map(py).join(', ');
        return [`df[[${cs}]] = df[[${cs}]].round(${dec})`];
      }
    },

    'reorder-columns': {
      name:'Reorder Columns', icon:'columns', group:'Structure', rowStable:true,
      blurb:'Arrange columns in a new order',
      defaults: () => ({ order:[] }),
      schema: [{ k:'order', t:'lines', label:'New order — one column per line' }],
      summary: p => {
        const o = (p.order || []).filter(x => x !== '');
        if (!o.length) return 'list every column, one per line';
        return o.slice(0, 2).join(', ') + (o.length > 2 ? ` (+${o.length - 2} more)` : '');
      },
      run(d, p){
        // Exact set match: a missing or extra entry would silently drop data.
        const o = (p.order || []).filter(x => x !== '');
        if (!o.length) throw new Error('list every column name, one per line');
        const unknown = o.filter(c => !d.columns.includes(c));
        if (unknown.length) throw new Error(`unknown column${unknown.length > 1 ? 's' : ''} “${unknown.join('”, “')}”`);
        const missing = d.columns.filter(c => !o.includes(c));
        if (missing.length) throw new Error(`still missing “${missing.join('”, “')}”`);
        if (new Set(o).size !== o.length) throw new Error('list each column exactly once');
        return { columns: o.slice(), rows: d.rows.map(r => o.map(c => r[d.columns.indexOf(c)])) };
      },
      code: (ctx, p) => [`df = df[[${(p.order || []).filter(x => x !== '').map(py).join(', ')}]]`]
    },

    'drop-empty-columns': {
      name:'Drop Empty Columns', icon:'ban', group:'Structure', rowStable:true,
      blurb:'Remove columns where every cell is empty',
      defaults: () => ({}),
      schema: [],
      summary: () => 'columns with no data at all',
      run(d, p){
        // Mirrors the backend twin: empty means null/NaN or exactly ''.
        // Whitespace-only strings are NOT empty (trimming is clean-text's
        // job) — treating them as empty here would diverge from pandas.
        // Zero rows would vacuously drop everything, so bail out instead.
        if (!d.rows.length) return { columns: d.columns, rows: d.rows };
        const drop = d.columns.map((_, i) => i).filter(i => d.rows.every(r => MISS(r[i])));
        if (!drop.length) return { columns: d.columns, rows: d.rows };
        const keep = d.columns.map((_, i) => i).filter(i => !drop.includes(i));
        return { columns: keep.map(i => d.columns[i]), rows: d.rows.map(r => keep.map(i => r[i])) };
      },
      code: () => [
        `# drop columns where every value is missing or ''`,
        `empty = [c for c in df.columns if df[c].isna().all() or (str(df[c].dtype) in ('object', 'string', 'str') and bool((df[c] == '').all()))]`,
        `df = df.drop(columns=empty)`
      ]
    },

    'replace-values': {
      name:'Replace Values', icon:'arrowr', group:'Values', rowStable:true,
      blurb:'Swap one value for another',
      defaults: () => ({ columns:[], find:'', replacement:'', case:true }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'find', t:'text', label:'Find value', ph:'exact value to find' },
        { k:'replacement', t:'text', label:'Replacement', ph:'blank writes empty' },
        { k:'case', t:'check', label:'Match case' }
      ],
      summary: p => `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · “${p.find}” → “${p.replacement}”${p.case === false ? ' · any case' : ''}`,
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        if (p.find === '' || p.find == null) throw new Error('type the value to find');
        const idx = p.columns.map(c => colIdx(d, c));
        const f = p.find, sensitive = p.case !== false;
        // Match rule (mirrors pandas replace + the backend twin): strict
        // equality first, then numeric equivalence across the string/number
        // boundary Sieve's CSV parsing creates; case-insensitive mode only
        // ever matches strings. Missing cells are never matched.
        const match = v => {
          if (sensitive){
            if (v === f) return true;
            return isNumV(v) && isNumV(f) && numify(v) === numify(f);
          }
          return typeof v === 'string' && v.toLowerCase() === String(f).toLowerCase();
        };
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (const ci of idx){
            const v = row[ci];
            if (MISS(v) || !match(v)) continue;
            const nv = p.replacement == null ? null : p.replacement;
            if (nv !== v) row = replaceCell(row, ci, nv);
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const cs = p.columns.map(py).join(', ');
        const allNum = (p.columns || []).every(c => ctx.types && ctx.types[c] === 'num');
        // py(null) would emit the *string* "null" — None must be literal.
        const lit = v => v == null ? 'None'
          : (v !== '' && allNum && isNumV(v) ? String(numify(v)) : py(v));
        if (p.case === false){
          return [
            `for _c in [${cs}]:`,
            `    df[_c] = df[_c].where(df[_c].isna(), df[_c].apply(lambda v: ${lit(p.replacement)} if isinstance(v, str) and v.lower() == ${py(String(p.find).toLowerCase())} else v))`
          ];
        }
        return [`df[[${cs}]] = df[[${cs}]].replace(${lit(p.find)}, ${lit(p.replacement)})`];
      }
    },

    'split-column': {
      name:'Split Column', icon:'table', group:'Text & Types', rowStable:true,
      blurb:'Split one column into several on a delimiter',
      defaults: () => ({ column:'', delimiter:',', max_splits:'', keep:true }),
      schema: [
        { k:'column', t:'column', label:'Source column' },
        { k:'delimiter', t:'text', label:'Delimiter', ph:'e.g. ,' },
        { k:'max_splits', t:'text', label:'Max splits', ph:'blank = split all' },
        { k:'keep', t:'check', label:'Keep original column' }
      ],
      summary: p => `${p.column || '—'} split on “${p.delimiter}”`,
      run(d, p){
        const ci = colIdx(d, p.column);
        if (p.delimiter === '' || p.delimiter == null) throw new Error('type a delimiter');
        const maxS = (p.max_splits === '' || p.max_splits == null) ? null
          : (/^\d+$/.test(String(p.max_splits).trim()) ? parseInt(p.max_splits, 10) : null);
        if (p.max_splits !== '' && p.max_splits != null && maxS === null) throw new Error('max splits must be a whole number or blank');
        // pandas n=maxS keeps the remainder glued to the last piece.
        const splitN = s => {
          const parts = s.split(p.delimiter);
          if (maxS === null || parts.length <= maxS + 1) return parts;
          return [...parts.slice(0, maxS), parts.slice(maxS).join(p.delimiter)];
        };
        const cooked = d.rows.map(r => {
          const v = r[ci];
          if (MISS(v)) return null;
          return splitN(String(v));
        });
        let width = 0;
        for (const parts of cooked) if (parts && parts.length > width) width = parts.length;
        if (!d.rows.length) return { columns: d.columns, rows: d.rows };
        // An all-missing column still yields one null part, like pandas
        // str.split(expand=True) does — otherwise the twins diverge.
        if (width === 0) width = 1;
        if (width > 15) throw new Error(`splits into ${width} pieces (max 15) — use a more specific delimiter`);
        const names = [];
        for (let i = 0; i < width; i++) names.push(`${p.column}_${i + 1}`);
        const dup = names.find(c => d.columns.includes(c));
        if (dup) throw new Error(`output would overwrite column “${dup}”`);
        const cols = p.keep !== false ? [...d.columns, ...names] : [...d.columns.filter(c => c !== p.column), ...names];
        return { columns: cols, rows: d.rows.map((r, i) => {
          const parts = cooked[i];
          const cells = names.map((_, k) => (parts && k < parts.length ? parts[k] : null));
          const base = p.keep !== false ? r : r.filter((_, j) => d.columns[j] !== p.column);
          return base.concat(cells);
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column);
        const n = /^\d+$/.test(String(p.max_splits ?? '').trim()) ? `, n=${parseInt(p.max_splits, 10)}` : '';
        const names = `_parts.columns = [f"${p.column}_{i + 1}" for i in range(_parts.shape[1])]`;
        const lines = [
          `_s = df[${c}].mask(df[${c}].isna() | (df[${c}] == ''))`,
          `_parts = _s.str.split(${py(p.delimiter)}${n}, expand=True)`,
          names,
          `df = pd.concat([df, _parts], axis=1)`
        ];
        if (p.keep === false) lines.push(`df = df.drop(columns=[${c}])`);
        return lines;
      }
    },

    'merge-columns': {
      name:'Merge Columns', icon:'plus', group:'Structure', rowStable:true,
      blurb:'Combine columns into one, joined by text',
      defaults: () => ({ columns:[], separator:' ', output:'', keep:true }),
      schema: [
        { k:'columns', t:'multi', label:'Source columns (tick 2+)' },
        { k:'separator', t:'text', label:'Separator', ph:'e.g. a space' },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Full Name' },
        { k:'keep', t:'check', label:'Keep source columns' }
      ],
      summary: p => `${(p.columns && p.columns.length) ? p.columns.join(' + ') : '—'} → ${p.output || '…'}`,
      run(d, p){
        if (!p.columns || p.columns.length < 2) throw new Error('tick at least two columns');
        const idx = p.columns.map(c => colIdx(d, c));
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        const sep = p.separator == null ? ' ' : String(p.separator);
        return {
          columns: [...d.columns, out],
          rows: d.rows.map(r => {
            const bits = [];
            for (const ci of idx){
              const t = sieveStr(r[ci]);
              if (t === null || t === '') continue;
              bits.push(t);
            }
            return r.concat([bits.length ? bits.join(sep) : null]);
          })
        };
      },
      code: (ctx, p) => {
        const cs = p.columns.map(py).join(', ');
        const out = py(String(p.output).trim());
        const sep = py(p.separator == null ? ' ' : String(p.separator));
        const lines = [
          `def _sieve_j(x):`,
          `    if x is None or (isinstance(x, float) and pd.isna(x)): return None`,
          `    if isinstance(x, bool): return str(x)`,
          `    if isinstance(x, float) and x.is_integer(): return str(int(x))`,
          `    return str(x)`,
          `df[${out}] = df[[${cs}]].apply(lambda r: ${sep}.join([t for t in (_sieve_j(x) for x in r) if t]) or None, axis=1)`
        ];
        if (p.keep === false) lines.push(`df = df.drop(columns=[${cs}])`);
        return lines;
      }
    },

    'extract-text': {
      name:'Extract Text', icon:'eye', group:'Text & Types', rowStable:true,
      blurb:'Pull part of a text value into a new column',
      defaults: () => ({ column:'', mode:'after', length:'', start:'', end:'', delim:'', delim2:'', pattern:'', output:'' }),
      schema: [
        { k:'column', t:'column', label:'Source column' },
        { k:'mode', t:'seg', label:'Extract', opts:[['after','After delimiter'],['before','Before delimiter'],['between','Between delimiters'],['prefix','First N chars'],['suffix','Last N chars'],['substring','Substring'],['regex','Regex match']] },
        { k:'delim', t:'text', label:'Delimiter', ph:'e.g. @', show:p=>['after','before','between'].includes(p.mode) },
        { k:'delim2', t:'text', label:'End delimiter', ph:'e.g. .', show:p=>p.mode==='between' },
        { k:'length', t:'text', label:'Length', ph:'e.g. 3', show:p=>p.mode==='prefix'||p.mode==='suffix' },
        { k:'start', t:'text', label:'Start (0-based)', ph:'e.g. 0', show:p=>p.mode==='substring' },
        { k:'end', t:'text', label:'End (blank = rest)', ph:'e.g. 5', show:p=>p.mode==='substring' },
        { k:'pattern', t:'text', label:'Pattern', ph:'e.g. \\d+', show:p=>p.mode==='regex' },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Domain' }
      ],
      summary: p => {
        const what = {after:`after “${p.delim}”`,before:`before “${p.delim}”`,between:`between delimiters`,prefix:`first ${p.length}`,suffix:`last ${p.length}`,substring:`substring`,regex:`regex`}[p.mode];
        return `${p.column || '—'} · ${what} → ${p.output || '…'}`;
      },
      run(d, p){
        const ci = colIdx(d, p.column);
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        // '' input flows through to '' output (present-but-empty); only
        // null/NaN stay missing — exactly the backend mask rule.
        const ext = s => {
          switch (p.mode){
            case 'before': {
              if (!p.delim) throw new Error('type a delimiter');
              return s.split(p.delim)[0];
            }
            case 'after': {
              if (!p.delim) throw new Error('type a delimiter');
              const i = s.indexOf(p.delim);
              return i < 0 ? null : s.slice(i + String(p.delim).length);
            }
            case 'between': {
              if (!p.delim || !p.delim2) throw new Error('type both delimiters');
              const i1 = s.indexOf(p.delim);
              if (i1 < 0) return null;
              const i2 = s.indexOf(p.delim2, i1 + String(p.delim).length);
              return i2 < 0 ? null : s.slice(i1 + String(p.delim).length, i2);
            }
            case 'prefix':
            case 'suffix': {
              if (!/^\d+$/.test(String(p.length ?? '').trim()) || parseInt(p.length, 10) < 1) throw new Error('length must be ≥ 1');
              const n = parseInt(p.length, 10);
              return p.mode === 'prefix' ? s.slice(0, n) : s.slice(-n);
            }
            case 'substring': {
              if (!/^\d+$/.test(String(p.start ?? '').trim())) throw new Error('start must be ≥ 0');
              const st = parseInt(p.start, 10);
              const en = (p.end === '' || p.end == null) ? s.length
                : (/^\d+$/.test(String(p.end).trim()) ? parseInt(p.end, 10) : null);
              if (en === null || en < st) throw new Error('end must be ≥ start');
              return s.slice(st, en);
            }
            case 'regex': {
              if (!p.pattern) throw new Error('type a pattern');
              let m;
              try { m = s.match(new RegExp(p.pattern)); } catch(e){ throw new Error('invalid pattern'); }
              return m ? m[0] : null;
            }
            default: throw new Error(`unknown extract mode "${p.mode}"`);
          }
        };
        return {
          columns: [...d.columns, out],
          rows: d.rows.map(r => {
            const v = r[ci];
            if (v == null || (typeof v === 'number' && Number.isNaN(v))) return r.concat([null]);
            if (v === '') return r.concat(['']);
            return r.concat([ext(sieveStr(v))]);
          })
        };
      },
      code: (ctx, p) => {
        const c = py(p.column), out = py(String(p.output).trim());
        const head = [
          `def _sieve_t(x):`,
          `    if x is None or (isinstance(x, float) and pd.isna(x)): return None`,
          `    if isinstance(x, bool): return str(x)`,
          `    if isinstance(x, float) and x.is_integer(): return str(int(x))`,
          `    return str(x)`,
          `df[${out}] = df[${c}].map(_sieve_t)`
        ];
        const blank = `df[${out}] = df[${out}].mask(df[${c}] == '', '')`;
        const tail = (() => {
          switch (p.mode){
            case 'before': return [`df[${out}] = df[${out}].str.split(${py(p.delim)}, n=1).str[0]`];
            case 'after': return [`df[${out}] = df[${out}].str.split(${py(p.delim)}, n=1).str[1]`];
            case 'between': return [
              `def _between_${p.output.replace(/\W+/g, '_')}(s, d1=${py(p.delim)}, d2=${py(p.delim2)}):`,
              `    if not isinstance(s, str): return None`,
              `    i1 = s.find(d1)`,
              `    if i1 < 0: return None`,
              `    i2 = s.find(d2, i1 + len(d1))`,
              `    if i2 < 0: return None`,
              `    return s[i1 + len(d1):i2]`,
              `df[${out}] = df[${out}].apply(_between_${p.output.replace(/\W+/g, '_')})`
            ];
            case 'prefix': return [`df[${out}] = df[${out}].str[:${parseInt(p.length, 10)}]`];
            case 'suffix': return [`df[${out}] = df[${out}].str[-${parseInt(p.length, 10)}:]`];
            case 'substring': {
              const en = (p.end === '' || p.end == null) ? '' : String(parseInt(p.end, 10));
              return [`df[${out}] = df[${out}].str[${parseInt(p.start, 10)}:${en}]`];
            }
            default: return [`df[${out}] = df[${out}].str.extract(${py('(' + p.pattern + ')')}, expand=True)[0]`];
          }
        })();
        return [...head, ...tail, blank];
      }
    },

    'group-rare': {
      name:'Group Rare Values', icon:'layers', group:'Categories', rowStable:true,
      blurb:'Fold infrequent categories into “Other”',
      defaults: () => ({ column:'', min_count:'10', replacement:'Other' }),
      schema: [
        { k:'column', t:'column', label:'Category column' },
        { k:'min_count', t:'text', label:'Keep categories with at least', ph:'e.g. 10 or 5%' },
        { k:'replacement', t:'text', label:'Replacement label', ph:'e.g. Other' }
      ],
      summary: p => `${p.column || '—'} · rarer than ${p.min_count || '…'} → “${p.replacement}”`,
      run(d, p){
        const ci = colIdx(d, p.column);
        if (!p.replacement || !String(p.replacement).trim()) throw new Error('type a replacement label');
        const raw = String(p.min_count ?? '').trim();
        let thr;
        if (/%$/.test(raw)){
          const frac = Number(raw.slice(0, -1)) / 100;
          if (!Number.isFinite(frac) || frac < 0) throw new Error(`threshold must be a count or a percentage like '5%'`);
          thr = Math.ceil(frac * d.rows.length);
        } else if (/^-?\d+$/.test(raw)){
          thr = parseInt(raw, 10);
          if (thr < 0) throw new Error(`threshold must be a count or a percentage like '5%'`);
        } else throw new Error(`threshold must be a count or a percentage like '5%'`);
        const rep = String(p.replacement).trim();
        const freq = new Map();
        for (const r of d.rows){ const v = r[ci]; if (MISS(v)) continue; freq.set(v, (freq.get(v) || 0) + 1); }
        return { columns: d.columns, rows: d.rows.map(r => {
          const v = r[ci];
          if (MISS(v) || (freq.get(v) || 0) >= thr) return r;
          return replaceCell(r, ci, rep);
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column), rep = py(String(p.replacement).trim());
        const raw = String(p.min_count ?? '').trim();
        const thr = /%$/.test(raw) ? `import math\n_thr = math.ceil(len(df) * ${Number(raw.slice(0, -1)) / 100})` : `_thr = ${parseInt(raw, 10)}`;
        return [
          `_vc = df[${c}].replace('', pd.NA).value_counts()`,
          thr,
          `_keep = _vc[_vc >= _thr].index`,
          `_miss = df[${c}].isna() | (df[${c}] == '')`,
          `df[${c}] = df[${c}].where(_miss | df[${c}].isin(_keep), ${rep})`
        ];
      }
    },

    'label-encode': {
      name:'Label Encode', icon:'grid', group:'Categories', rowStable:true,
      blurb:'Integer labels in sklearn order (missing sorts last)',
      defaults: () => ({ column:'' }),
      schema: [{ k:'column', t:'column', label:'Category column' }],
      summary: p => `${p.column || '—'} → 0, 1, 2…`,
      run(d, p){
        const ci = colIdx(d, p.column);
        // Mirrors pandas astype(str) + sklearn LabelEncoder exactly: missing
        // sorts last, '' sorts first, the rest lexicographically. Known
        // edges vs raw astype: whole floats ('2.0' there, '2' here — Sieve
        // cannot see pandas dtypes) and booleans ('True' vs 'true',
        // unreachable via CSV parsing where booleans arrive as strings).
        const pkey = v => {
          if (v == null || (typeof v === 'number' && Number.isNaN(v))) return null;
          return String(v);
        };
        const keys = new Set(d.rows.map(r => pkey(r[ci])));
        const ordered = [...keys].filter(k => k !== null).sort();
        if (keys.has(null)) ordered.push(null);
        const idx = new Map(ordered.map((k, i) => [k, i]));
        return { columns: d.columns, rows: d.rows.map(r => replaceCell(r, ci, idx.get(pkey(r[ci])))) };
      },
      code: (ctx, p) => [
        `from sklearn.preprocessing import LabelEncoder`,
        `df[${py(p.column)}] = LabelEncoder().fit_transform(df[${py(p.column)}].astype(str))`
      ]
    },

    'normalize': {
      name:'Normalize', icon:'sigma', group:'Numbers', rowStable:true,
      blurb:'Scale numbers in place: 0→1 or z-scores',
      defaults: () => ({ column:'', method:'minmax' }),
      schema: [
        { k:'column', t:'column', label:'Numeric column' },
        { k:'method', t:'seg', label:'Method', opts:[['minmax','0 → 1'],['z','z-score']] }
      ],
      summary: p => `${p.column || '—'} → ${{minmax:'0–1 scale',z:'z-score'}[p.method]}`,
      hint: () => ({ num:true }),
      run(d, p){
        const ci = colIdx(d, p.column);
        const nums = [];
        for (const r of d.rows){
          const v = r[ci];
          if (MISS(v)) continue;
          if (!isNumV(v)) throw new Error(`"${p.column}" has non-numeric values`);
          nums.push(numify(v));
        }
        if (!nums.length) throw new Error('no numeric values to scale');
        let f;
        if (p.method === 'z'){
          // Sample std (ddof=1) with the backend's zero/NaN guard: sd 0 or
          // undefined becomes 1, so constant columns scale to zeros.
          const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
          let sd = nums.length > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)) : NaN;
          if (!(sd > 0)) sd = 1;
          f = v => (numify(v) - mean) / sd;
        } else {
          const lo = Math.min(...nums), hi = Math.max(...nums);
          let den = hi - lo;
          if (den === 0) den = 1;
          f = v => (numify(v) - lo) / den;
        }
        return { columns: d.columns, rows: d.rows.map(r => {
          const v = r[ci];
          return (MISS(v)) ? r : replaceCell(r, ci, f(v));
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column);
        if (p.method === 'z') return [`df[${c}] = (df[${c}] - df[${c}].mean()) / df[${c}].std().replace(0, 1).fillna(1)`];
        return [`df[${c}] = (df[${c}] - df[${c}].min()) / (df[${c}].max() - df[${c}].min()).replace(0, 1)`];
      }
    },

    'extract-date-part': {
      name:'Extract Date Part', icon:'file', group:'Dates', rowStable:true,
      blurb:'Year, month, weekday… into a new column',
      defaults: () => ({ column:'', part:'year', output:'' }),
      schema: [
        { k:'column', t:'column', label:'Date column' },
        { k:'part', t:'seg', label:'Part', opts:[['year','Year'],['month','Month'],['day','Day'],['weekday','Weekday'],['quarter','Quarter'],['week','Week #']] },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Year' }
      ],
      summary: p => `${p.column || '—'} · ${p.part} → ${p.output || '…'}`,
      run(d, p){
        const ci = colIdx(d, p.column);
        if (!['year','month','day','weekday','quarter','week'].includes(p.part)) throw new Error(`unknown date part "${p.part}"`);
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        return { columns: [...d.columns, out], rows: d.rows.map(r => {
          const v = r[ci];
          if (MISS(v)) return r.concat([null]);
          const iso = parseDate(v);
          if (!iso) return r.concat([null]);
          const [Y, M, D] = iso.split('-').map(Number);
          let val;
          if (p.part === 'year') val = Y;
          else if (p.part === 'month') val = M;
          else if (p.part === 'day') val = D;
          else if (p.part === 'weekday') val = WD[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()];
          else if (p.part === 'quarter') val = 'Q' + Math.floor((M + 2) / 3);
          else val = isoWeekNum(Y, M, D);
          return r.concat([val]);
        })};
      },
      code: (ctx, p) => {
        const c = py(p.column), out = py(String(p.output).trim());
        const acc = {year:`_k.dt.year`,month:`_k.dt.month`,day:`_k.dt.day`,weekday:`_k.dt.strftime('%A')`,
          quarter:`_k.dt.quarter.map(lambda q: f'Q{int(q)}' if pd.notna(q) else None)`,
          week:`_k.dt.isocalendar().week.astype('Int64')`}[p.part];
        return [
          `try:`,
          `    _k = pd.to_datetime(df[${c}], format="mixed", errors="coerce")`,
          `except (TypeError, ValueError):`,
          `    _k = pd.to_datetime(df[${c}], errors="coerce")`,
          `df[${out}] = ${acc}`
        ];
      }
    },

    'date-difference': {
      name:'Date Difference', icon:'arrowr', group:'Dates', rowStable:true,
      blurb:'Time between two dates, in days / hours…',
      defaults: () => ({ start:'', end:'', unit:'days', output:'' }),
      schema: [
        { k:'start', t:'column', label:'Start date column' },
        { k:'end', t:'column', label:'End date column' },
        { k:'unit', t:'seg', label:'Unit', opts:[['days','Days'],['hours','Hours'],['minutes','Minutes'],['seconds','Seconds']] },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Days Open' }
      ],
      summary: p => `${p.start || '—'} → ${p.end || '—'} in ${p.unit} → ${p.output || '…'}`,
      run(d, p){
        const si = colIdx(d, p.start), ei = colIdx(d, p.end);
        const div = {days:86400000,hours:3600000,minutes:60000,seconds:1000}[p.unit];
        if (!div) throw new Error(`unknown unit "${p.unit}"`);
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        const ms = v => {
          if (MISS(v)) return null;
          const iso = parseDate(v);
          if (!iso) return null;
          const [Y, M, D] = iso.split('-').map(Number);
          return Date.UTC(Y, M - 1, D);
        };
        return { columns: [...d.columns, out], rows: d.rows.map(r => {
          const a = ms(r[si]), b = ms(r[ei]);
          return r.concat([(a === null || b === null) ? null : (b - a) / div]);
        })};
      },
      code: (ctx, p) => {
        const div = {days:86400,hours:3600,minutes:60,seconds:1}[p.unit];
        const s = py(p.start), e = py(p.end), out = py(String(p.output).trim());
        return [
          `def _parse(s):`,
          `    try:`,
          `        return pd.to_datetime(s, format="mixed", errors="coerce")`,
          `    except (TypeError, ValueError):`,
          `        return pd.to_datetime(s, errors="coerce")`,
          `_s = _parse(df[${s}])`,
          `_e = _parse(df[${e}])`,
          `df[${out}] = (_e - _s).dt.total_seconds() / ${div}`
        ];
      }
    },

    'create-column': {
      name:'Create Column', icon:'code', group:'Structure', rowStable:true,
      blurb:'New column from a safe formula',
      defaults: () => ({ formula:'', output:'' }),
      schema: [
        { k:'formula', t:'text', label:'Formula', ph:'[price] * [quantity]' },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Total' }
      ],
      summary: p => `${p.formula || '…'} → ${p.output || '…'}`,
      hint: () => ({ num:true }),
      run(d, p){
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        if (!p.formula || !String(p.formula).trim()) throw new Error('type a formula');
        const tree = parseFormula(String(p.formula));
        const refs = formulaRefs(tree);
        if (!refs.length) throw new Error('reference at least one [column]');
        const unknown = refs.filter(c => !d.columns.includes(c));
        if (unknown.length) throw new Error(`unknown column${unknown.length > 1 ? 's' : ''} “${unknown.join('”, “')}”`);
        const at = {};
        for (const c of refs) at[c] = d.columns.indexOf(c);
        return { columns: [...d.columns, out], rows: d.rows.map(r => {
          const get = c => strictNum(r[at[c]], c);
          let v = evalFormula(tree, get);
          if (v !== null && !Number.isFinite(v)) v = null;
          return r.concat([v]);
        })};
      },
      code: (ctx, p) => {
        const out = py(String(p.output).trim());
        let expr;
        try { expr = formulaToPandas(parseFormula(String(p.formula))); }
        catch (e){ return [`# invalid formula — see the node error`]; }
        return [`df[${out}] = ${expr}`, `df[${out}] = df[${out}].replace([np.inf, -np.inf], np.nan)`];
      }
    },

    'conditional-column': {
      name:'Conditional Column', icon:'filter', group:'Structure', rowStable:true,
      blurb:'New column from IF / ELSE rules',
      defaults: () => ({ rules:[{ column:'', op:'=', value:'', result:'' }], default:'', output:'' }),
      schema: [
        { k:'rules', t:'rules', label:'Rules — first match wins' },
        { k:'default', t:'text', label:'Else value (blank = empty)', ph:'e.g. Senior' },
        { k:'output', t:'text', label:'Output column name', ph:'e.g. Group' }
      ],
      summary: p => `${(p.rules || []).length} rule${(p.rules || []).length === 1 ? '' : 's'} → ${p.output || '…'}`,
      run(d, p){
        if (!p.output || !String(p.output).trim()) throw new Error('name the output column');
        const out = String(p.output).trim();
        if (d.columns.includes(out)) throw new Error(`column “${out}” already exists`);
        if (!p.rules || !p.rules.length) throw new Error('add at least one rule');
        const ops = ['=', '≠', '>', '<', '≥', '≤', 'contains'];
        const rules = p.rules.map((r, i) => {
          const ci = colIdx(d, r.column);
          if (!ops.includes(r.op)) throw new Error(`rule ${i + 1}: unknown operator "${r.op}"`);
          return { ci, op: r.op, value: r.value, result: r.result };
        });
        const els = (p.default === '' || p.default == null) ? null : p.default;
        return { columns: [...d.columns, out], rows: d.rows.map(r => {
          for (const q of rules) if (matchCond(r[q.ci], q.op, q.value)) return r.concat([q.result]);
          return r.concat([els]);
        })};
      },
      code: (ctx, p) => {
        const out = py(String(p.output).trim());
        const condCode = (col, op, val) => {
          const c = py(col);
          const lit = isNumV(val) ? String(numify(val)) : py(val);
          if (op === '=') return `(df[${c}] == ${lit})`;
          if (op === '≠') return `(df[${c}] != ${lit})`;
          if (op === 'contains') return `(df[${c}].fillna("").astype(str).str.contains(${py(String(val))}, na=False, regex=False))`;
          const o = op === '≥' ? '>=' : op === '≤' ? '<=' : op;
          return `(df[${c}] ${o} ${lit})`;
        };
        const lines = (p.rules || []).map((r, i) => `_m${i + 1} = ${condCode(r.column, r.op, r.value)}`);
        const lits = (p.rules || []).map(r => r.result == null ? 'None' : py(r.result));
        const els = (p.default === '' || p.default == null) ? 'None' : py(p.default);
        lines.push(`df[${out}] = np.select([${(p.rules || []).map((_, i) => `_m${i + 1}`).join(', ')}], [${lits.join(', ')}], default=${els})`);
        return lines;
      }
    },

    'validate-column': {
      name:'Validate Column', icon:'check', group:'Data Quality', rowStable:true,
      blurb:'Check rules; data passes through unchanged',
      defaults: () => ({ column:'', vtype:'any', required:false, min:'', max:'', allowed:[], unique:false, pattern:'' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'vtype', t:'seg', label:'Expected type', opts:[['any','Any'],['integer','Integer'],['number','Number'],['text','Text'],['date','Date']] },
        { k:'required', t:'check', label:'Required (no gaps)' },
        { k:'min', t:'text', label:'Minimum', ph:'blank = skip' },
        { k:'max', t:'text', label:'Maximum', ph:'blank = skip' },
        { k:'allowed', t:'lines', label:'Allowed values (one per line, blank = skip)' },
        { k:'unique', t:'check', label:'Must be unique' },
        { k:'pattern', t:'text', label:'Must match regex', ph:'blank = skip' }
      ],
      summary: p => {
        let n = 0;
        if (p.vtype && p.vtype !== 'any') n++;
        if (p.required) n++;
        if (p.min !== '' && p.min != null) n++;
        if (p.max !== '' && p.max != null) n++;
        if (p.allowed && p.allowed.length) n++;
        if (p.unique) n++;
        if (p.pattern) n++;
        return `${p.column || '—'} · ${n} check${n === 1 ? '' : 's'}`;
      },
      run(d, p){
        const ci = colIdx(d, p.column);
        // Same check shape the backend consumes: [{rule, ...}].
        const checks = [];
        if (p.vtype && p.vtype !== 'any') checks.push({ rule:'type', expected:p.vtype });
        if (p.required) checks.push({ rule:'required' });
        if (p.min !== '' && p.min != null) checks.push({ rule:'min', value:p.min });
        if (p.max !== '' && p.max != null) checks.push({ rule:'max', value:p.max });
        if (p.allowed && p.allowed.length) checks.push({ rule:'allowed', values:p.allowed.slice() });
        if (p.unique) checks.push({ rule:'unique' });
        if (p.pattern) checks.push({ rule:'pattern', pattern:p.pattern });
        const numOf = v => {
          try {
            const n = strictNum(v, p.column);
            return n === null ? NaN : n;
          } catch (e){ return NaN; }
        };
        const evalCheck = c => {
          const bad = new Array(d.rows.length).fill(false);
          const hit = i => { bad[i] = true; };
          if (c.rule === 'required'){
            d.rows.forEach((r, i) => { if (MISS(r[ci])) hit(i); });
          } else if (c.rule === 'type'){
            d.rows.forEach((r, i) => {
              const v = r[ci];
              if (MISS(v)) return;
              if (c.expected === 'text') return;
              if (c.expected === 'date'){ if (!parseDate(v)) hit(i); return; }
              const n = numOf(v);
              if (Number.isNaN(n)) hit(i);
              else if (c.expected === 'integer' && !Number.isInteger(n)) hit(i);
            });
          } else if (c.rule === 'min' || c.rule === 'max'){
            const b = Number(c.value);
            if (!Number.isFinite(b)) throw new Error(`${c.rule}imum must be numeric`);
            d.rows.forEach((r, i) => {
              const v = r[ci];
              if (MISS(v)) return;
              const n = numOf(v);
              if (Number.isNaN(n)) hit(i);
              else if (c.rule === 'min' ? n < b : n > b) hit(i);
            });
          } else if (c.rule === 'allowed'){
            d.rows.forEach((r, i) => {
              const v = r[ci];
              if (MISS(v)) return;
              if (!c.values.includes(v)) hit(i);
            });
          } else if (c.rule === 'unique'){
            const freq = new Map();
            d.rows.forEach(r => { const v = r[ci]; if (!MISS(v)) freq.set(v, (freq.get(v) || 0) + 1); });
            d.rows.forEach((r, i) => { if (!MISS(r[ci]) && freq.get(r[ci]) > 1) hit(i); });
          } else if (c.rule === 'pattern'){
            let re;
            try { re = new RegExp(c.pattern); } catch (e){ throw new Error('invalid pattern'); }
            d.rows.forEach((r, i) => {
              const v = r[ci];
              if (MISS(v)) return;
              if (!re.test(String(v))) hit(i);
            });
          } else throw new Error(`unknown rule "${c.rule}"`);
          const rows = [];
          bad.forEach((f, i) => { if (f) rows.push(i); });
          const seen = new Set(), samples = [];
          for (const i of rows){
            const v = d.rows[i][ci];
            const k = v === null ? '∅' : String(v);
            if (!seen.has(k)){ seen.add(k); samples.push(v); }
            if (samples.length >= 5) break;
          }
          return { rule:c.rule, invalid:rows.length, samples, rows };
        };
        const evaluated = checks.map(evalCheck);
        const anyFail = new Array(d.rows.length).fill(false);
        for (const e of evaluated) for (const i of e.rows) anyFail[i] = true;
        return {
          columns: d.columns, rows: d.rows,
          report: {
            column:p.column, total:d.rows.length,
            invalid: anyFail.filter(Boolean).length,
            checks: evaluated.map(({ rule, invalid, samples }) => ({ rule, invalid, samples }))
          }
        };
      },
      code: (ctx, p) => {
        const c = py(p.column);
        const present = `(df[${c}].notna() & (df[${c}].astype(object) != ''))`;
        const lines = [`# validate ${p.column} (pass-through: data unchanged)`];
        if (p.required) lines.push(`assert df[${c}].notna().all() and (df[${c}] != '').all(), '${p.column}: required'`);
        if (p.vtype && p.vtype !== 'any'){
          if (p.vtype === 'text') lines.push(`# ${p.column}: text accepts anything present`);
          else if (p.vtype === 'date') lines.push(`assert (pd.to_datetime(df[${c}], format="mixed", errors="coerce").notna() | ~${present}).all(), '${p.column}: must be dates'`);
          else if (p.vtype === 'integer') lines.push(`_k = pd.to_numeric(df[${c}], errors="coerce")`, `assert ((_k.notna() & (_k % 1 == 0)) | ~${present}).all(), '${p.column}: must be integers'`);
          else lines.push(`assert (pd.to_numeric(df[${c}], errors="coerce").notna() | ~${present}).all(), '${p.column}: must be numeric'`);
        }
        for (const which of ['min', 'max']){
          if (p[which] !== '' && p[which] != null){
            const b = Number(p[which]);
            const op = which === 'min' ? '>=' : '<=';
            lines.push(`_k = pd.to_numeric(df[${c}], errors="coerce")`, `assert ((_k ${op} ${Number.isFinite(b) ? b : p[which]}) | ~${present}).all(), '${p.column}: ${which} ${p[which]}'`);
          }
        }
        if (p.allowed && p.allowed.length) lines.push(`assert (df[${c}].isin(${JSON.stringify(p.allowed)}) | ~${present}).all(), '${p.column}: unexpected value'`);
        if (p.unique) lines.push(`_p = df[${c}][${present}]`, `assert not _p.duplicated().any(), '${p.column}: must be unique'`);
        if (p.pattern) lines.push(`assert (df[${c}].astype(str).str.contains(${py(p.pattern)}, na=False, regex=True) | ~${present}).all(), '${p.column}: pattern mismatch'`);
        return lines;
      }
    },

    'find-invalid': {
      name:'Find Invalid Values', icon:'alert', group:'Data Quality', rowStable:true,
      blurb:'List values that look wrong (data unchanged)',
      defaults: () => ({ column:'', expect:'number', min:'', max:'' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'expect', t:'seg', label:'Expected', opts:[['number','Number'],['text','Text'],['date','Date']] },
        { k:'min', t:'text', label:'Minimum', ph:'numbers only', show:p=>p.expect==='number' },
        { k:'max', t:'text', label:'Maximum', ph:'numbers only', show:p=>p.expect==='number' }
      ],
      summary: p => `${p.column || '—'} · expect ${p.expect}`,
      run(d, p){
        const ci = colIdx(d, p.column);
        if (!['number','text','date'].includes(p.expect)) throw new Error(`unknown expectation "${p.expect}"`);
        let lo = null, hi = null;
        if (p.expect === 'number'){
          if (p.min !== '' && p.min != null){ lo = Number(p.min); if (!Number.isFinite(lo)) throw new Error('minimum must be numeric'); }
          if (p.max !== '' && p.max != null){ hi = Number(p.max); if (!Number.isFinite(hi)) throw new Error('maximum must be numeric'); }
        } else if ((p.min !== '' && p.min != null) || (p.max !== '' && p.max != null)){
          throw new Error('bounds need numeric expectation');
        }
        const numOf = v => {
          try {
            const n = strictNum(v, p.column);
            return n === null ? NaN : n;
          } catch (e){ return NaN; }
        };
        const samples = [];
        let invalid = 0;
        d.rows.forEach(r => {
          const v = r[ci];
          if (MISS(v)) return;
          let reason = null;
          if (p.expect === 'number'){
            const n = numOf(v);
            if (Number.isNaN(n)) reason = 'not a number';
            else if (lo !== null && n < lo) reason = `below minimum (${p.min})`;
            else if (hi !== null && n > hi) reason = `above maximum (${p.max})`;
          } else if (p.expect === 'date'){
            if (!parseDate(v)) reason = 'not a date';
          }
          if (reason){
            invalid++;
            if (samples.length < 12 && !samples.some(s => s.value === v)) samples.push({ value:v, reason });
          }
        });
        return { columns: d.columns, rows: d.rows, report:{ column:p.column, total:d.rows.length, invalid, samples } };
      },
      code: (ctx, p) => {
        const c = py(p.column);
        const head = [`# find-invalid ${p.column}: lists values that look wrong (data unchanged)`];
        if (p.expect === 'number'){
          const lines = [...head,
            `_num = pd.to_numeric(df[${c}], errors="coerce")`,
            `_present = df[${c}].notna() & (df[${c}].astype(object) != '')`,
            `_bad = _present & _num.isna()`];
          if (p.min !== '' && p.min != null) lines.push(`_bad = _bad | (_present & _num.notna() & (_num < ${Number(p.min)}))`);
          if (p.max !== '' && p.max != null) lines.push(`_bad = _bad | (_present & _num.notna() & (_num > ${Number(p.max)}))`);
          return lines;
        }
        if (p.expect === 'date') return [...head,
          `_ok = pd.to_datetime(df[${c}], format="mixed", errors="coerce").notna()`,
          `_bad = df[${c}].notna() & (df[${c}].astype(object) != '') & ~_ok`];
        return [...head, `_bad = pd.Series(False, index=df.index)`];
      }
    },

    'clip-values': {
      name:'Clip Values', icon:'scissors', group:'Numbers', rowStable:true,
      blurb:'Clamp numbers into a range',
      defaults: () => ({ columns:[], min:'', max:'' }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'min', t:'text', label:'Minimum (blank = none)', ph:'e.g. 0' },
        { k:'max', t:'text', label:'Maximum (blank = none)', ph:'e.g. 100' }
      ],
      summary: p => {
        const lo = (p.min === '' || p.min == null) ? '−∞' : p.min;
        const hi = (p.max === '' || p.max == null) ? '+∞' : p.max;
        return `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · ${lo} to ${hi}`;
      },
      hint: () => ({ num:true }),
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        const idx = p.columns.map(c => colIdx(d, c));
        const bound = (raw, which) => {
          if (raw === '' || raw == null) return null;
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new Error(`${which} bound must be numeric`);
          return n;
        };
        const lo = bound(p.min, 'minimum'), hi = bound(p.max, 'maximum');
        if (lo === null && hi === null) throw new Error('set a minimum, a maximum, or both');
        if (lo !== null && hi !== null && lo > hi) throw new Error('minimum exceeds maximum');
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (let k = 0; k < idx.length; k++){
            const ci = idx[k], v = row[ci];
            if (MISS(v)) continue;
            const n = strictNum(v, p.columns[k]);
            let nv = n;
            if (lo !== null && nv < lo) nv = lo;
            if (hi !== null && nv > hi) nv = hi;
            if (nv !== v) row = replaceCell(row, ci, nv);
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const cs = p.columns.map(py).join(', ');
        const args = [];
        if (p.min !== '' && p.min != null) args.push(`lower=${Number(p.min)}`);
        if (p.max !== '' && p.max != null) args.push(`upper=${Number(p.max)}`);
        return [`df[[${cs}]] = df[[${cs}]].clip(${args.join(', ')})`];
      }
    },

    'find-replace-pattern': {
      name:'Find & Replace Pattern', icon:'eye', group:'Values', rowStable:true,
      blurb:'Rewrite text matching a pattern',
      defaults: () => ({ columns:[], pattern:'', replacement:'', regex:true, case:true }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'pattern', t:'text', label:'Pattern', ph:'e.g. [^0-9]' },
        { k:'replacement', t:'text', label:'Replacement', ph:'blank deletes matches' },
        { k:'regex', t:'check', label:'Regular expression' },
        { k:'case', t:'check', label:'Match case' }
      ],
      summary: p => `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · “${p.pattern}” → “${p.replacement}”`,
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        if (!p.pattern) throw new Error('type a pattern');
        if (p.pattern.length > 200) throw new Error('pattern accepts at most 200 characters');
        const idx = p.columns.map(c => colIdx(d, c));
        const rep = p.replacement == null ? '' : String(p.replacement);
        // Literal replacements are plain split/join (no $ semantics);
        // every RegExp path pins $ to literal so JS agrees with Python.
        const repLit = rep.split('$').join('$$');
        let re = null;
        if (p.regex !== false || p.case === false){
          const src = p.regex === false
            ? p.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : p.pattern;
          try { re = new RegExp(src, 'g' + (p.case === false ? 'i' : '')); }
          catch (e){ throw new Error('invalid pattern'); }
        }
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (const ci of idx){
            const v = row[ci];
            if (MISS(v)) continue;
            const s = sieveStr(v);
            const nv = re ? s.replace(re, repLit) : s.split(p.pattern).join(rep);
            if (nv !== v) row = replaceCell(row, ci, nv);
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const css = p.columns.map(py).join(', ');
        const rep = py(p.replacement == null ? '' : String(p.replacement));
        const head = [
          `def _sieve_t(x):`,
          `    if x is None or (isinstance(x, float) and pd.isna(x)): return None`,
          `    if isinstance(x, bool): return str(x)`,
          `    if isinstance(x, float) and x.is_integer(): return str(int(x))`,
          `    return str(x)`
        ];
        const tail = (p.regex === false)
          ? (p.case === false
            ? [`import re`, `df[[${css}]] = df[[${css}]].map(_sieve_t).str.replace(re.escape(${py(p.pattern)}), ${rep}, regex=True, flags=re.IGNORECASE)`]
            : [`df[[${css}]] = df[[${css}]].map(_sieve_t).str.split(${py(p.pattern)}).str.join(${rep})`])
          : [`df[[${css}]] = df[[${css}]].map(_sieve_t).str.replace(${py(p.pattern)}, ${rep}, regex=True${p.case === false ? ', flags=re.IGNORECASE' : ''})`];
        return [...head, ...tail];
      }
    },

    'remove-special-chars': {
      name:'Remove Special Characters', icon:'sparkle', group:'Text & Types', rowStable:true,
      blurb:'Keep only chosen character groups',
      defaults: () => ({ columns:[], letters:true, numbers:true, spaces:true, custom:'' }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'letters', t:'check', label:'Keep letters (A–Z)' },
        { k:'numbers', t:'check', label:'Keep numbers (0–9)' },
        { k:'spaces', t:'check', label:'Keep spaces' },
        { k:'custom', t:'text', label:'Also keep these characters', ph:'e.g. -_.' }
      ],
      summary: p => {
        const keep = [];
        if (p.letters !== false) keep.push('letters');
        if (p.numbers !== false) keep.push('numbers');
        if (p.spaces !== false) keep.push('spaces');
        if (p.custom) keep.push(`“${p.custom}”`);
        return `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · keep ${keep.join(' + ') || 'nothing'}`;
      },
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        const body = specialClassBody(p.letters, p.numbers, p.spaces, p.custom);
        if (!body) throw new Error('keep at least one character group');
        const re = new RegExp(`[^${body}]`, 'g');
        const idx = p.columns.map(c => colIdx(d, c));
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (const ci of idx){
            const v = row[ci];
            if (MISS(v)) continue;
            const nv = sieveStr(v).replace(re, '');
            if (nv !== v) row = replaceCell(row, ci, nv);
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const pats = specialClassBody(p.letters, p.numbers, p.spaces, p.custom);
        const head = [
          `def _sieve_t(x):`,
          `    if x is None or (isinstance(x, float) and pd.isna(x)): return None`,
          `    if isinstance(x, bool): return str(x)`,
          `    if isinstance(x, float) and x.is_integer(): return str(int(x))`,
          `    return str(x)`
        ];
        return [...head, ...p.columns.map(c =>
          `df[${py(c)}] = df[${py(c)}].map(_sieve_t).str.replace(${py(`[^${pats}]`)}, '', regex=True)`)];
      }
    },

    'standardize-categories': {
      name:'Standardize Categories', icon:'check', group:'Categories', rowStable:true,
      blurb:'Unify spellings, then apply mappings',
      defaults: () => ({ columns:[], method:'lower', map:{} }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'method', t:'seg', label:'Letter case', opts:[['keep','Keep'],['lower','lower'],['upper','UPPER'],['title','Title']] },
        { k:'map', t:'rename', label:'Custom mappings — blank keeps the value' }
      ],
      summary: p => {
        const e = Object.entries(p.map || {}).filter(([, v]) => v !== '' && v != null).length;
        return `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · ${p.method}${e ? ` + ${e} mapping${e === 1 ? '' : 's'}` : ''}`;
      },
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        if (!['keep','lower','upper','title'].includes(p.method)) throw new Error(`unknown case "${p.method}"`);
        const idx = p.columns.map(c => colIdx(d, c));
        const entries = Object.entries(p.map || {}).filter(([, v]) => v !== '' && v != null);
        // Trim → case → mapping: the same order as the backend twin.
        const applyCase = s => {
          if (p.method === 'lower') return s.toLowerCase();
          if (p.method === 'upper') return s.toUpperCase();
          if (p.method === 'title') return s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
          return s;
        };
        const lookup = new Map(entries);
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (const ci of idx){
            const v = row[ci];
            if (MISS(v) || typeof v !== 'string') continue;
            let nv = applyCase(v.trim());
            if (lookup.has(nv)) nv = lookup.get(nv);
            if (nv !== v) row = replaceCell(row, ci, nv);
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const cs = p.columns.map(py).join(', ');
        // A cols list (never df["a", "b"] tuple indexing, which breaks past
        // one column) — mirrors the backend twin line for line.
        const caseLine = {
          keep:`# unchanged case`,
          lower:`df[cols] = df[cols].str.lower()`,
          upper:`df[cols] = df[cols].str.upper()`,
          title:`df[cols] = df[cols].str.replace(r"\\S+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), regex=True)`
        }[p.method];
        const lines = [
          `cols = [${cs}]`,
          `# trim + case first, custom mappings second (missing untouched)`,
          `df[cols] = df[cols].apply(lambda s: s.str.strip() if s.dtype == object else s)`,
          caseLine
        ];
        const entries = Object.entries(p.map || {}).filter(([, v]) => v !== '' && v != null);
        if (entries.length) lines.push(`df[cols] = df[cols].replace({${entries.map(([o, n]) => `${py(o)}: ${py(String(n).trim())}`).join(', ')}})`);
        return lines;
      }
    },

    'log-transform': {
      name:'Log Transform', icon:'sigma', group:'Numbers', rowStable:true,
      blurb:'Compress skewed numbers with logs',
      defaults: () => ({ columns:[], base:'ln', invalid:'null' }),
      schema: [
        { k:'columns', t:'multi', label:'Columns (tick at least one)' },
        { k:'base', t:'seg', label:'Base', opts:[['ln','Natural (e)'],['log10','Base 10'],['log2','Base 2']] },
        { k:'invalid', t:'seg', label:'Zero / negative', opts:[['null','Write empty'],['error','Fail step']] }
      ],
      summary: p => `${(p.columns && p.columns.length) ? p.columns.join(', ') : '—'} · ${p.base}`,
      hint: () => ({ num:true }),
      run(d, p){
        if (!p.columns || !p.columns.length) throw new Error('tick at least one column');
        if (!['ln','log10','log2'].includes(p.base)) throw new Error(`unknown base "${p.base}"`);
        if (!['null','error'].includes(p.invalid)) throw new Error(`unknown handling "${p.invalid}"`);
        const idx = p.columns.map(c => colIdx(d, c));
        const fn = p.base === 'ln' ? Math.log : p.base === 'log10' ? Math.log10 : Math.log2;
        return { columns: d.columns, rows: d.rows.map(r => {
          let row = r;
          for (let k = 0; k < idx.length; k++){
            const ci = idx[k], v = row[ci];
            if (MISS(v)) continue;
            const n = strictNum(v, p.columns[k]);
            if (!(n > 0)){
              if (p.invalid === 'error') throw new Error(`log of non-positive value (${String(v)})`);
              // Always write: the cell holds a real value, null always differs.
              row = replaceCell(row, ci, null);
              continue;
            }
            row = replaceCell(row, ci, fn(n));
          }
          return row;
        })};
      },
      code: (ctx, p) => {
        const cs = p.columns.map(py).join(', ');
        const fn = { ln:'np.log', log10:'np.log10', log2:'np.log2' }[p.base];
        const lines = [];
        if (p.invalid === 'error'){
          lines.push(`_bad = [c for c in [${cs}] if ((pd.to_numeric(df[c], errors="coerce").notna()) & (pd.to_numeric(df[c], errors="coerce") <= 0)).any()]`);
          lines.push(`assert not _bad, f"log-transform: non-positive values in {_bad}"`);
        }
        lines.push(`_v = df[[${cs}]].apply(pd.to_numeric, errors="coerce")`);
        lines.push(`with np.errstate(divide="ignore", invalid="ignore"):`);
        lines.push(`    _v = ${fn}(_v)`);
        lines.push(`df[[${cs}]] = _v.mask(~np.isfinite(_v), np.nan)`);
        return lines;
      }
    }
  };
  // One-hot codegen: categories are recomputed in pandas at runtime in the
  // same first-appearance order run() uses, with the same name sanitizing
  // (non-word runs to "_", trimmed) and the same missing semantics (null
  // and "" never become categories, never match a flag). Whole floats
  // stringify without ".0" on both sides, mirroring run()'s String().
  // App-side guards (<2 cats, >15 cats, duplicate flag names) run before
  // export, so the script only handles the valid case.
  function oneHotCode(p){
    const c = py(p.column);
    const pre = py(sanitizeCol(p.column));
    return [
      `def _sieve_cat(x):`,
      `    if pd.isna(x) or (isinstance(x, str) and x == ""):`,
      `        return None`,
      `    if isinstance(x, float) and x.is_integer():`,
      `        return str(int(x))`,
      `    return str(x)`,
      `_cats = df[${c}].map(_sieve_cat).dropna().drop_duplicates().tolist()  # first-appearance order`,
      `for _cat in _cats:`,
      `    _safe = re.sub(r"\\W+", "_", _cat).strip("_") or "col"`,
      `    df[${pre} + "_" + _safe] = (df[${c}].map(_sieve_cat) == _cat).astype(int)`
    ];
  }

  /* ---- pipeline runner ---- */
  function deltaOf(inMeta, outMeta, inD, out, stable){
    let changed = -1;
    if (stable){
      changed = 0;
      const shared = [];
      for (let i = 0; i < out.columns.length; i++){
        const j = inD.columns.indexOf(out.columns[i]);
        if (j >= 0) shared.push([j, i]);
      }
      const rc = Math.min(inD.rows.length, out.rows.length);
      for (let r = 0; r < rc; r++){
        const a = inD.rows[r], b = out.rows[r];
        for (const [j, i] of shared) if (a[j] !== b[i]) changed++;
      }
    }
    return { rb: inD.rows.length, ra: out.rows.length, cb: inD.columns.length, ca: out.columns.length,
             mb: inMeta.missingTotal, ma: outMeta.missingTotal, changed };
  }

  function runFrom(base, nodes){
    const srcMeta = metaOf(base.columns, base.rows, false);
    const outputs = [{ columns: base.columns, rows: base.rows, rowStable: true, meta: srcMeta }];
    const results = [];
    for (let k = 0; k < nodes.length; k++){
      const n = nodes[k];
      const op = OPS[n.type];
      const inD = { columns: outputs[outputs.length-1].columns, rows: outputs[outputs.length-1].rows };
      const inMeta = outputs[outputs.length-1].meta;
      const res = { err:null, delta:null, hint:null, report:null, inColumns: inD.columns, inTypes: inMeta.types };
      let outRec;
      if (!op){ res.err = 'unknown operation'; outRec = { columns: inD.columns, rows: inD.rows, rowStable: true, meta: inMeta, error: res.err }; }
      else if (!n.enabled){
        outRec = { columns: inD.columns, rows: inD.rows, muted: true, rowStable: true, meta: inMeta };
      } else {
        try {
          const o = op.run(inD, n.params);
          const stable = op.rowStable !== false;
          const meta = metaOf(o.columns, o.rows, false);
          res.delta = deltaOf(inMeta, meta, inD, o, stable);
          res.hint = op.hint ? (op.hint(inD, n.params, inMeta) || null) : null;
          // Quality nodes attach {column, invalid, checks/samples} here;
          // rows still flow through unchanged.
          res.report = o.report || null;
          outRec = { columns: o.columns, rows: o.rows, rowStable: stable, meta };
        } catch(e){
          res.err = String((e && e.message) || e);
          outRec = { columns: inD.columns, rows: inD.rows, rowStable: true, meta: inMeta, error: res.err };
        }
      }
      outputs.push(outRec); results.push(res);
    }
    return { base: { columns: base.columns, rows: base.rows, meta: srcMeta }, outputs, results };
  }

  // SVG wire path between two node ports. Coerces every coordinate:
  // restored workspaces may carry string/missing positions, and "40"+236
  // concatenates (wire flies off-canvas and vanishes) while nodes still
  // render — the classic missing-wire symptom. Never returns NaN.
  function wirePath(ax, ay, bx, by, w, portY){
    const X = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const x1 = X(ax) + X(w), y1 = X(ay) + X(portY);
    const x2 = X(bx), y2 = X(by) + X(portY);
    const dx = Math.max(36, Math.min(170, (x2 - x1) * .5));
    return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
  }

  return { MISS, numify, isNumV, parseDate, quantile, decodeBytes, parseCSVText, metaOf, runFrom, OPS, sanitizeCol, wirePath, parseFormula, formulaRefs, evalFormula, formulaToPandas, strictNum, matchCond };
}

/* python string literal helper (used by op codegen) */
function py(v){ return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

export { EngineFactory, py };
