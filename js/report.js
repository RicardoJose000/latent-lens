/* Shared report rendering: claims, failures, structured JSON, gauges */
(function () {
  'use strict';
  const esc = (s) => window.LL.esc(s);
  const LABEL_CLASS = { supported: 'ok', 'low-risk': 'ok', partial: 'warn', contradicted: 'bad', unsupported: 'bad', unverifiable: 'bad' };
  const SEV_COLOR = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--sky)' };

  function claimsHTML(r) {
    const text = r.input.response;
    if (!r.claims.length) return `<p style="color:var(--muted)">${esc(text) || 'No factual claims found.'}</p>`;
    // highlight each claim inside the original response; unmatched text stays plain
    let html = '', cursor = 0;
    r.claims.forEach((c) => {
      const i = text.indexOf(c.text, cursor);
      const tip = `${c.label.toUpperCase()}: ${c.reason}${c.evidence ? '  |  Evidence: "' + c.evidence + '"' : ''}`;
      if (i === -1) { html += ` <mark class="${LABEL_CLASS[c.label]}" title="${esc(tip)}">${esc(c.text)}</mark>`; return; }
      html += esc(text.slice(cursor, i)) + `<mark class="${LABEL_CLASS[c.label]}" title="${esc(tip)}">${esc(c.text)}</mark>`;
      cursor = i + c.text.length;
    });
    html += esc(text.slice(cursor));
    return html.replace(/\n/g, '<br>');
  }

  function findingsHTML(r) {
    if (!r.failures.length) return '<div class="finding"><span class="finding__sev" style="background:var(--green)"></span><div><h4>No failures detected</h4><p>All claims are grounded and every extracted instruction passed.</p></div></div>';
    return r.failures.map((f) => {
      const fix = r.remediation.find((x) => x.type === f.type);
      return `<div class="finding"><span class="finding__sev" style="background:${SEV_COLOR[f.severity]};box-shadow:0 0 10px ${SEV_COLOR[f.severity]}"></span>
        <div><h4>${esc(f.type)}</h4><p>${esc(f.details[0])}${f.count > 1 ? ` <span style="color:var(--dim)">+${f.count - 1} more</span>` : ''}</p>${fix ? `<div class="fix">Fix: ${esc(fix.step)}</div>` : ''}</div>
        <span class="chip ${f.severity === 'high' ? 'chip--bad' : f.severity === 'medium' ? 'chip--warn' : 'chip--info'}">${f.severity}</span></div>`;
    }).join('');
  }

  function jsonHTML(r) {
    const view = { id: r.id, rubric_version: r.rubric_version, engine: r.engine, mode: r.mode, confidence: r.confidence, verdict: r.verdict.label, scores: r.scores, counts: r.counts,
      claims: r.claims.map((c) => ({ text: c.text, label: c.label, evidence: c.evidence || null, failure: c.failure })),
      instructions: r.instructions.map((c) => ({ constraint: c.label, pass: c.pass, detail: c.detail })),
      failures: r.failures.map((f) => ({ type: f.type, severity: f.severity, count: f.count })) };
    return esc(JSON.stringify(view, null, 2))
      .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
      .replace(/:\s(&quot;.*?&quot;)/g, ': <span class="s">$1</span>')
      .replace(/:\s(-?\d+(?:\.\d+)?|true|false|null)/g, ': <span class="n">$1</span>');
  }

  function animateGauge(root, value, tone) {
    const arc = root.querySelector('.gauge__arc');
    const num = root.querySelector('[data-k="overall"]');
    const C = 540.35;
    const stops = { ok: ['#22d3ee', '#34d399'], warn: ['#fbbf24', '#22d3ee'], bad: ['#fb7185', '#fbbf24'] }[tone] || ['#22d3ee', '#2dd4bf'];
    const grad = root.querySelector('linearGradient');
    if (grad) { grad.children[0].setAttribute('stop-color', stops[0]); grad.children[1].setAttribute('stop-color', stops[1]); }
    const o = { v: 0 };
    const set = () => { arc.style.strokeDashoffset = C * (1 - o.v / 100); num.textContent = Math.round(o.v); };
    if (window.gsap && !window.LL.reduced) window.gsap.to(o, { v: value || 0, duration: 1.8, ease: 'expo.out', onUpdate: set });
    else { o.v = value || 0; set(); }
  }

  function fillMetrics(root, r) {
    Object.entries(r.scores).forEach(([k, v]) => {
      const el = root.querySelector(`[data-k="${k}"]`); if (el && k !== 'overall') el.textContent = v === null ? 'n/a' : v;
      const m = root.querySelector(`[data-m="${k}"]`); if (m) requestAnimationFrame(() => m.style.setProperty('--v', (v || 0) + '%'));
    });
    const vEl = root.querySelector('[data-k="verdict"]');
    if (vEl) { vEl.textContent = r.verdict.label; vEl.className = 'chip chip--' + r.verdict.tone; }
    animateGauge(root, r.scores.overall, r.verdict.tone);
  }

  function bindTabs(root) {
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('is-active', x === b));
      root.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === b.dataset.tab));
    }));
  }

  window.LLReport = { claimsHTML, findingsHTML, jsonHTML, fillMetrics, bindTabs, animateGauge };
})();
