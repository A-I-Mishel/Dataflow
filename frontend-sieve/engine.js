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
      defaults: () => ({ column:'', method:'median', value:'' }),
      schema: [
        { k:'column', t:'column', label:'Column' },
        { k:'method', t:'seg', label:'Strategy', opts:[['mean','Mean'],['median','Median'],['mode','Mode'],['ffill','Fill down'],['custom','Value']] },
        { k:'value', t:'text', label:'Fill value', ph:'e.g. Unknown', show:p=>p.method==='custom' }
      ],
      summary: p => `${p.column || '—'} · ${{mean:'mean',median:'median',mode:'mode',ffill:'fill down',custom:`“${p.value}”`}[p.method]}`,
      hint: (d, p) => (p.method === 'mean' || p.method === 'median') ? { num:true } : null,
      run(d, p){
        const ci = colIdx(d, p.column), rows = d.rows;
        if (p.method === 'ffill'){
          let last = null; const out = new Array(rows.length);
          for (let i = 0; i < rows.length; i++){
            const v = rows[i][ci];
            if (MISS(v)) out[i] = last === null ? rows[i] : replaceCell(rows[i], ci, last);
            else { last = v; out[i] = rows[i]; }
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
        if (p.method === 'ffill') return [`df[${c}] = df[${c}].ffill()`];
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
      defaults: () => ({ column:'__all__' }),
      schema: [{ k:'column', t:'select', label:'Drop rows empty in', opts: ctx => [['__all__','any column'], ...ctx.columns.map(c => [c, c])] }],
      summary: p => p.column === '__all__' ? 'rows with any empty cell' : `rows where “${p.column}” is empty`,
      run(d, p){
        const rows = d.rows.filter(r => p.column === '__all__' ? !r.some(v => MISS(v)) : !MISS(r[colIdx(d, p.column)]));
        return { columns: d.columns, rows };
      },
      code: (ctx, p) => [p.column === '__all__' ? 'df = df.dropna()' : `df = df.dropna(subset=[${py(p.column)}])`]
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
      name:'One-hot Encode', icon:'layers', group:'Structure', rowStable:true,
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
      const res = { err:null, delta:null, hint:null, inColumns: inD.columns, inTypes: inMeta.types };
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

  return { MISS, numify, isNumV, parseDate, quantile, decodeBytes, parseCSVText, metaOf, runFrom, OPS, sanitizeCol, wirePath };
}

/* python string literal helper (used by op codegen) */
function py(v){ return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

export { EngineFactory, py };
