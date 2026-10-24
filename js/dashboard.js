/* Dashboard: KPIs, trend, taxonomy, history, inquiry inbox */
(function () {
  'use strict';
  const { auth, runs, store, esc, toast } = window.LL;
  const $ = (id) => document.getElementById(id);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const STATUS = ['New', 'In review', 'Proposal sent', 'Won', 'Closed'];
  const NDA = ['NDA requested', 'NDA sent', 'NDA signed'];
  const ndaState = (q) => (q.nda === 'yes' ? 'NDA requested' : q.nda);

  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function spark(id, vals, color) {
    const el = $(id); if (!el || vals.length < 2) { if (el) el.innerHTML = ''; return; }
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${38 - ((v - min) / (max - min || 1)) * 32}`);
    el.innerHTML = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="M0,40 L${pts.join(' L')} L100,40Z" fill="url(#${id}g)"/><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
  }

  function trend(list) {
    const el = $('trend');
    const data = list.slice().reverse().slice(-24);
    if (!data.length) { el.innerHTML = '<text x="350" y="190" text-anchor="middle" fill="#5b6b84" font-size="14">Run your first evaluation to see the trend</text>'; return; }
    const W = 700, H = 380, P = 30;
    const x = (i) => P + (data.length === 1 ? (W - 2 * P) / 2 : (i / (data.length - 1)) * (W - 2 * P));
    const y = (v) => H - P - (v / 100) * (H - 2 * P);
    let grid = '';
    [0, 25, 50, 75, 100].forEach((v) => { grid += `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(148,178,214,.08)"/><text x="${P - 8}" y="${y(v) + 4}" fill="#5b6b84" font-size="10" text-anchor="end" font-family="JetBrains Mono">${v}</text>`; });
    const pts = data.map((r, i) => [x(i), y(r.scores.overall)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const fpts = data.filter((r) => r.scores.faithfulness !== null).map((r) => [x(data.indexOf(r)), y(r.scores.faithfulness)]);
    const fline = fpts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    el.innerHTML = `<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#22d3ee" stop-opacity=".3"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>${grid}
      <rect x="${P}" y="${y(100)}" width="${W - 2 * P}" height="${y(85) - y(100)}" fill="rgba(52,211,153,.05)"/>
      <path d="${line} L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P}Z" fill="url(#tg)"/>
      ${fline ? `<path d="${fline}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="4 4" opacity=".8"/>` : ''}
      <path class="trend-line" d="${line}" fill="none" stroke="#22d3ee" stroke-width="2.2"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#050811" stroke="${data[i].verdict.tone === 'ok' ? '#34d399' : data[i].verdict.tone === 'warn' ? '#fbbf24' : '#fb7185'}" stroke-width="2"><title>${esc(data[i].input.prompt.slice(0, 60))} - ${data[i].scores.overall}</title></circle>`).join('')}
      <text x="${W - P}" y="16" fill="#8a9ab3" font-size="11" text-anchor="end" font-family="JetBrains Mono">&#9472; overall   - - faithfulness</text>`;
    const path = el.querySelector('.trend-line');
    if (path && window.gsap && !window.LL.reduced) { const len = path.getTotalLength(); window.gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.8, ease: 'expo.out' }); }
  }

  function taxonomy(list) {
    const counts = {};
    list.forEach((r) => r.failures.forEach((f) => { counts[f.type] = (counts[f.type] || 0) + f.count; }));
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((a, r) => a + r[1], 0);
    $('taxTotal').textContent = total + ' findings';
    const max = rows.length ? rows[0][1] : 1;
    $('taxonomy').innerHTML = rows.length ? rows.slice(0, 8).map(([k, v]) => `<div class="metric"><div class="metric__row"><span>${esc(k)}</span><b>${v}</b></div><div class="meter"><i class="${/Numeric|Contradiction|Fabricated|Forbidden|refusal/.test(k) ? 'bad' : /breach|Missing/.test(k) ? 'warn' : ''}" style="--v:0%" data-v="${(v / max) * 100}"></i></div></div>`).join('')
      : '<p style="color:var(--muted);margin:0">No failures recorded yet.</p>';
    requestAnimationFrame(() => $('taxonomy').querySelectorAll('[data-v]').forEach((m) => m.style.setProperty('--v', m.dataset.v + '%')));
  }

  function table(list) {
    const q = $('search').value.trim().toLowerCase();
    const rows = list.filter((r) => !q || r.input.prompt.toLowerCase().includes(q) || r.input.response.toLowerCase().includes(q));
    $('rows').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td><input type="checkbox" class="pick" data-pick="${r.id}" aria-label="Select run for comparison"${picked.includes(r.id) ? ' checked' : ''}></td>
      <td class="mono" style="font-size:12.5px;color:var(--muted);white-space:nowrap">${ago(r.created_at)}</td>
      <td><div class="clip">${esc(r.input.prompt)}</div></td>
      <td><span class="chip">${r.mode === 'grounded' ? 'grounded' : 'ref-free'}</span></td>
      <td class="mono"><b>${r.scores.overall}</b></td>
      <td class="mono">${r.scores.faithfulness === null ? '<span style="color:var(--dim)">n/a</span>' : r.scores.faithfulness}</td>
      <td class="mono">${r.scores.instruction_adherence === null ? '<span style="color:var(--dim)">n/a</span>' : r.scores.instruction_adherence}</td>
      <td><span class="chip chip--${r.verdict.tone}">${r.verdict.label}</span></td>
      <td style="white-space:nowrap"><a class="btn btn--ghost btn--sm" href="checker.html#${r.id}">Open</a> <button class="btn btn--ghost btn--sm" data-del="${r.id}" aria-label="Delete run">&#10005;</button></td></tr>`).join('')
      : `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:40px">${q ? 'No runs match your search.' : 'No evaluations yet. <a href="checker.html" style="color:var(--cyan)">Run your first check</a> or load the sample runs.'}</td></tr>`;
  }

  /* ---------- compare two runs: score deltas + which failure types appeared or were fixed ---------- */
  let picked = [];
  function compare() {
    const list = runs.all();
    const [a, b] = picked.map((id) => list.find((r) => r.id === id)).filter(Boolean).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
    if (!a || !b) return;
    const rowsHTML = [['Overall', 'overall', 1], ['Faithfulness', 'faithfulness', 1], ['Hallucination rate', 'hallucination_rate', -1], ['Instruction adherence', 'instruction_adherence', 1], ['Relevance', 'relevance', 1]].map(([label, k, dir]) => {
      const va = a.scores[k], vb = b.scores[k];
      const d = va === null || vb === null ? null : vb - va;
      const good = d === null || d === 0 ? 'var(--muted)' : d * dir > 0 ? 'var(--green)' : 'var(--red)';
      return `<tr><td>${label}</td><td class="mono">${va === null ? 'n/a' : va}</td><td class="mono">${vb === null ? 'n/a' : vb}</td><td class="mono" style="color:${good}">${d === null ? '-' : (d > 0 ? '+' : '') + d}</td></tr>`;
    }).join('');
    const ta = new Set(a.failures.map((f) => f.type)), tb = new Set(b.failures.map((f) => f.type));
    const fixed = [...ta].filter((t) => !tb.has(t)), added = [...tb].filter((t) => !ta.has(t));
    $('compare').innerHTML = `<div class="compare__head"><b>Run comparison</b><button class="btn btn--ghost btn--sm" id="closeCompare">Close</button></div>
      <div class="compare__grid"><table class="table"><thead><tr><th>Metric</th><th>Earlier &middot; ${ago(a.created_at)}</th><th>Later &middot; ${ago(b.created_at)}</th><th>Change</th></tr></thead><tbody>${rowsHTML}</tbody></table>
      <div class="compare__fail"><div><span class="chip chip--ok">Fixed</span><p>${fixed.length ? fixed.map(esc).join(', ') : 'None'}</p></div><div><span class="chip chip--bad">New</span><p>${added.length ? added.map(esc).join(', ') : 'None'}</p></div>
      <p class="compare__note">Earlier: "${esc(a.input.prompt.slice(0, 70))}..."<br>Later: "${esc(b.input.prompt.slice(0, 70))}..."</p></div></div>`;
    $('compare').hidden = false;
    $('closeCompare').addEventListener('click', () => { $('compare').hidden = true; });
  }

  function exportCSV() {
    const cols = ['created_at', 'id', 'mode', 'overall', 'faithfulness', 'hallucination_rate', 'instruction_adherence', 'relevance', 'verdict', 'failures', 'prompt'];
    const q = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const lines = [cols.join(',')].concat(runs.all().map((r) => [r.created_at, r.id, r.mode, r.scores.overall, r.scores.faithfulness, r.scores.hallucination_rate, r.scores.instruction_adherence, r.scores.relevance, r.verdict.label, r.failures.map((f) => f.type).join('; '), r.input.prompt].map(q).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'latent-lens-history.csv'; a.click();
    toast('History exported as CSV.');
  }

  function inquiries() {
    const list = store.get('inquiries', []);
    $('inqCount').textContent = list.length;
    $('inqRows').innerHTML = list.length ? list.map((q, i) => `<tr>
      <td class="mono" style="font-size:12.5px">${esc(q.ref)}</td>
      <td>${esc(q.name)}<br><span style="color:var(--dim);font-size:12.5px">${esc(q.email)}</span></td>
      <td>${esc(q.company)}</td>
      <td><span class="chip chip--info">${esc(q.type)}</span>${q.nda ? ` <select class="select nda-sel" data-nda="${i}" aria-label="NDA status">${NDA.map((n) => `<option${n === ndaState(q) ? ' selected' : ''}>${n}</option>`).join('')}</select>` : ''}<div class="clip" style="max-width:280px;font-size:13px;margin-top:6px;color:var(--muted)">${esc(q.message)}</div></td>
      <td class="mono" style="font-size:12.5px">${esc(q.volume)}</td>
      <td><select class="select" data-inq="${i}" style="padding:8px 34px 8px 12px;font-size:13px">${STATUS.map((s) => `<option${s === q.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">No inquiries yet. Requests from the <a href="index.html#inquiry" style="color:var(--cyan)">website form</a> appear here.</td></tr>';
  }

  function render() {
    const list = runs.all();
    const scores = list.map((r) => r.scores.overall);
    const hall = list.map((r) => r.scores.hallucination_rate).filter((v) => v !== null);
    const breaches = list.filter((r) => r.instructions.some((c) => c.pass === false)).length;
    $('k-runs').textContent = list.length;
    $('k-score').textContent = list.length ? Math.round(avg(scores)) : '-';
    $('k-hall').textContent = hall.length ? Math.round(avg(hall)) + '%' : '-';
    $('k-breach').textContent = list.length ? breaches : '-';
    const recent = scores.slice(0, 5), older = scores.slice(5, 10);
    if (recent.length && older.length) { const d = Math.round(avg(recent) - avg(older)); $('k-score-d').innerHTML = `<span style="color:${d >= 0 ? 'var(--green)' : 'var(--red)'}">${d >= 0 ? '+' : ''}${d}</span> <span style="color:var(--muted)">vs previous 5</span>`; }
    $('k-hall-d').innerHTML = '<span style="color:var(--muted)">avg. across runs</span>';
    const chrono = list.slice().reverse();
    spark('s-runs', chrono.map((_, i) => i + 1), '#22d3ee');
    spark('s-score', chrono.map((r) => r.scores.overall), '#2dd4bf');
    spark('s-hall', chrono.map((r) => r.scores.hallucination_rate || 0), '#fb7185');
    spark('s-breach', chrono.map((r) => r.instructions.filter((c) => c.pass === false).length), '#fbbf24');
    trend(list); taxonomy(list); table(list); inquiries();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const u = auth.user(); if (!u) return;
    $('avatar').textContent = u.name.charAt(0).toUpperCase();
    $('hello').innerHTML = `Hello, ${esc(u.name.split(' ')[0])}.`;
    $('signOut').addEventListener('click', auth.signOut);
    $('search').addEventListener('input', () => table(runs.all()));
    $('seedBtn').addEventListener('click', () => { window.LLSeed.seed(u.email); render(); toast('Sample runs evaluated and loaded.'); });
    document.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { runs.remove(d.dataset.del); picked = picked.filter((x) => x !== d.dataset.del); render(); toast('Run deleted.'); } });
    document.addEventListener('change', (e) => {
      const c = e.target.closest('[data-pick]'); if (!c) return;
      if (c.checked) { picked.push(c.dataset.pick); if (picked.length > 2) { const drop = picked.shift(); const old = document.querySelector(`[data-pick="${drop}"]`); if (old) old.checked = false; } }
      else picked = picked.filter((x) => x !== c.dataset.pick);
      $('compareBtn').disabled = picked.length !== 2;
    });
    $('compareBtn').addEventListener('click', compare);
    $('csvBtn').addEventListener('click', exportCSV);
    document.addEventListener('change', (e) => { const n = e.target.closest('[data-nda]'); if (n) { const list = store.get('inquiries', []); list[+n.dataset.nda].nda = n.value; store.set('inquiries', list); toast('NDA status updated.'); } });
    document.addEventListener('change', (e) => { const s = e.target.closest('[data-inq]'); if (s) { const list = store.get('inquiries', []); list[+s.dataset.inq].status = s.value; store.set('inquiries', list); toast('Status updated.'); } });
    render();
  });
})();
