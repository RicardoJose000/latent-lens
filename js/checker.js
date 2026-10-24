/* Response Checker page */
(function () {
  'use strict';
  const { esc, runs, toast } = window.LL;
  const E = window.LatentEngine;
  const $ = (id) => document.getElementById(id);
  let current = null;

  function wc() { const n = ($('f-response').value.trim().match(/\S+/g) || []).length; $('f-count').textContent = n + ' word' + (n === 1 ? '' : 's'); }

  function presets() {
    E.PRESETS.forEach((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name;
      b.addEventListener('click', () => { $('f-prompt').value = p.prompt; $('f-response').value = p.response; $('f-context').value = p.context; wc(); run(); });
      $('presets').appendChild(b);
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function scanSteps(fast) {
    const steps = document.querySelectorAll('.scan__step');
    steps.forEach((s) => s.classList.remove('is-run', 'is-done'));
    for (const s of steps) { s.classList.add('is-run'); await wait(fast ? 60 : 260); s.classList.remove('is-run'); s.classList.add('is-done'); }
  }

  async function run(e) {
    if (e) e.preventDefault();
    const prompt = $('f-prompt').value.trim(), response = $('f-response').value.trim(), context = $('f-context').value.trim();
    $('f-prompt').classList.toggle('is-invalid', !prompt); $('f-response').classList.toggle('is-invalid', !response);
    if (!prompt || !response) { toast('Prompt and response are required.'); return; }
    const key = $('f-key').value.trim();
    try { if (key) sessionStorage.setItem('ll_key', key); } catch (err) { /* ignore */ }

    $('runBtn').disabled = true;
    $('emptyState').style.display = 'none'; $('result').classList.remove('is-on'); $('scan').classList.add('is-on');
    if (window.innerWidth < 1000) $('scan').scrollIntoView({ behavior: 'smooth', block: 'start' });

    let r;
    try {
      const [res] = await Promise.all([
        key ? E.judge({ apiKey: key, model: $('f-model').value.trim(), prompt, response, context }) : Promise.resolve(E.evaluate({ prompt, response, context })),
        scanSteps(false)
      ]);
      r = res;
    } catch (err) {
      toast('Judge failed, using deterministic engine: ' + err.message.slice(0, 80));
      r = E.evaluate({ prompt, response, context });
    }
    $('scan').classList.remove('is-on'); $('runBtn').disabled = false;
    render(r);
    runs.add(r);
  }

  function render(r) {
    current = r;
    const root = $('result');
    root.classList.add('is-on');
    $('verdictText').textContent = r.verdict.label === 'Production-ready' ? 'Grounded and compliant.' : r.verdict.label === 'Needs review' ? 'Usable, with issues to review.' : `${r.failures.length} failure type${r.failures.length === 1 ? '' : 's'} found.`;
    $('metaLine').innerHTML = `<span>${r.mode}</span><span>confidence: ${r.confidence}</span><span>${r.counts.claims} claims</span><span>${r.engine}</span><span>${r.latency_ms} ms</span>`;
    $('claims').innerHTML = window.LLReport.claimsHTML(r);
    $('instructions').innerHTML = r.instructions.length ? r.instructions.map((c) => `<div class="check"><span class="ic ${c.pass === true ? 'ok' : c.pass === false ? 'bad' : 'na'}">${c.pass === true ? '&#10003;' : c.pass === false ? '&#10005;' : '&ndash;'}</span><div>${esc(c.label)}<small>${esc(c.detail)}</small></div>${c.pass === false ? `<span class="chip chip--bad">${esc(c.failure)}</span>` : ''}</div>`).join('')
      : '<div class="check"><span class="ic na">&ndash;</span><div>No explicit constraints found in the prompt<small>Add limits like "under 80 words", "3 bullet points", "respond in Portuguese" or "do not mention X".</small></div></div>';
    $('findings').innerHTML = window.LLReport.findingsHTML(r);
    $('json').innerHTML = window.LLReport.jsonHTML(r);
    $('expertPitch').textContent = expertPitch(r);
    $('expertOk').classList.remove('is-on'); $('expertForm').style.display = '';
    window.LLReport.fillMetrics(root, r);
    if (window.gsap && !window.LL.reduced) window.gsap.from(root.children, { y: 40, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.07 });
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  // The free check always ends with a route to paid work, worded for what this run actually found.
  function expertPitch(r) {
    const n = r.failures.length;
    if (r.verdict.tone === 'bad') return `This answer would reach your users with ${n} problem type${n === 1 ? '' : 's'}. An expert can trace them back to your prompts, retrieval or guardrails and tell you which fixes matter first.`;
    if (r.verdict.tone === 'warn') return `Mostly fine, but ${n} issue type${n === 1 ? '' : 's'} slipped through. An expert can check whether this is a one-off or a pattern across your real traffic.`;
    return 'This answer passed. One good answer does not prove the system is reliable: an expert audit tests hundreds of real conversations and finds the cases a single check misses.';
  }

  function requestExpert(e) {
    e.preventDefault();
    const name = $('ex-name'), email = $('ex-email');
    const badName = !name.value.trim(), badEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value);
    name.classList.toggle('is-invalid', badName); email.classList.toggle('is-invalid', badEmail);
    if (badName || badEmail || !current) { toast('Please add your name and a valid email.'); return; }
    const list = window.LL.store.get('inquiries', []);
    const ref = 'INQ-' + String(1000 + list.length + 1);
    const failures = current.failures.map((f) => f.type).join(', ') || 'none';
    list.unshift({ ref, name: name.value.trim(), email: email.value.trim(), company: '-', volume: '-', type: 'Expert review',
      message: `Expert review of run ${current.id}: overall ${current.scores.overall} (${current.verdict.label}). Failures: ${failures}. Prompt: "${current.input.prompt.slice(0, 120)}"`,
      run: { id: current.id, scores: current.scores, verdict: current.verdict.label }, status: 'New', created_at: new Date().toISOString() });
    window.LL.store.set('inquiries', list);
    $('expertForm').style.display = 'none';
    $('expertOk').innerHTML = `Request <b>${ref}</b> is with the team, with this report attached. You will hear back within one business day.`;
    $('expertOk').classList.add('is-on');
  }

  function exportJson() {
    const { input, ...rest } = current; return JSON.stringify({ ...rest, input }, null, 2);
  }

  document.addEventListener('DOMContentLoaded', () => {
    presets(); $('f-response').addEventListener('input', wc);
    try { const k = sessionStorage.getItem('ll_key'); if (k) $('f-key').value = k; } catch (err) { /* ignore */ }
    $('checkForm').addEventListener('submit', run);
    $('expertForm').addEventListener('submit', requestExpert);
    const u = window.LL.auth.user(); if (u) { $('ex-name').value = u.name; $('ex-email').value = u.email; }
    $('clearBtn').addEventListener('click', () => { ['f-prompt', 'f-response', 'f-context'].forEach((id) => { $(id).value = ''; $(id).classList.remove('is-invalid'); }); wc(); $('result').classList.remove('is-on'); $('emptyState').style.display = ''; });
    $('copyJson').addEventListener('click', async () => { try { await navigator.clipboard.writeText(exportJson()); toast('Report JSON copied.'); } catch (err) { toast('Copy failed.'); } });
    $('dlJson').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' })); a.download = `latent-lens-${current.id}.json`; a.click(); });
    // deep link from dashboard: checker.html#run_xxx re-opens a stored run
    const id = location.hash.slice(1);
    if (id) { const r = runs.all().find((x) => x.id === id); if (r) { $('f-prompt').value = r.input.prompt; $('f-response').value = r.input.response; $('f-context').value = r.input.context; wc(); $('emptyState').style.display = 'none'; document.addEventListener('ll:ready', () => render(r)); } }
  });
})();
