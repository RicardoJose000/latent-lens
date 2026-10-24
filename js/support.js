/*
 * Support assistant (demo build).
 * Answers from a curated knowledge base with lexical retrieval, so it works with no API key.
 * When confidence is low it never guesses: it offers a hand-off and files the question in the inquiry inbox.
 * In production the same widget can switch to LLM answers grounded on these entries once a key is added.
 */
(function () {
  'use strict';
  const { store, esc } = window.LL;

  const KB = [
    { q: 'What is Latent Lens', k: 'what is latent lens platform product about do', a: 'Latent Lens is an AI evaluation and quality intelligence platform. It tests LLM apps, RAG pipelines and AI agents for factual accuracy, hallucinations and instruction adherence, then tells your team how to fix what it finds.', link: ['See the platform', 'index.html#platform'] },
    { q: 'How do you detect hallucinations?', k: 'hallucination hallucinate detect detection find catch wrong facts false made up', a: 'The response is split into single claims. Each claim is checked against your ground truth and labeled supported, partial, contradicted or unsupported. Numeric drift, invented names and flipped facts are classified and each comes with a fix.', link: ['Try the checker', 'checker.html'] },
    { q: 'Is the checker free?', k: 'free cost price pricing checker pay paid plan how much', a: 'Yes, the Response Checker is free. Paid work is a fixed-fee Quality Audit on your real traffic, or a scoped Custom Pilot that wires evaluation into your release process.', link: ['See engagements', 'index.html#pilot'] },
    { q: 'Do I need an OpenAI key?', k: 'openai key api need require gpt model llm judge', a: 'No. The core engine runs without any key. An LLM judge (OpenAI, Claude or Gemini) can be switched on later for deeper meaning-level checks, and the scoring stays the same.' },
    { q: 'How are scores calibrated?', k: 'score scores calibrate calibrated calibration accurate accuracy reliable consistent reproducible', a: 'The judge only assigns labels through a strict schema at temperature 0. Scores are computed in code from those labels, and the rubric is tuned against human-labeled examples until they agree.' },
    { q: 'What does an audit include?', k: 'audit quality audit include deliverable report sample traffic rows cost price fee much', a: 'An audit is a fixed fee agreed upfront, based on your traffic volume. It runs your real traffic sample (200 to 2,000 rows) through a custom rubric calibrated on human labels, and you get a failure heatmap by intent and model plus a written remediation plan.', link: ['Request an audit', 'index.html#inquiry'] },
    { q: 'Do you evaluate RAG pipelines?', k: 'rag retrieval pipeline context documents chunks grounding knowledge base', a: 'Yes. Give the retrieved context as ground truth and every claim is grounded against it, so you can see when the answer drifts from your documents.', link: ['Run a grounded check', 'checker.html'] },
    { q: 'Can you test AI agents?', k: 'agent agents tool calls trace traces multi step workflow', a: 'Agent trace evaluation is part of a Custom Pilot: each step and tool call is scored, not just the final answer.', link: ['Discuss a pilot', 'index.html#inquiry'] },
    { q: 'Where is my history?', k: 'history dashboard saved runs previous past account results', a: 'Every check you run is saved to your dashboard with scores, trend and failure breakdown. Sign in to keep it across sessions.', link: ['Open dashboard', 'dashboard.html'] },
    { q: 'Can I export results?', k: 'export download json csv ci pipeline integrate integration api', a: 'Each report can be copied or downloaded as structured JSON, the same format a CI regression gate would read.' },
    { q: 'Which models do you support?', k: 'models support gpt claude gemini llama mistral which provider', a: 'Latent Lens is model-agnostic. It judges the output, so it works with responses from any model or provider.' },
    { q: 'Is my data safe?', k: 'data privacy secure security safe store stored gdpr confidential', a: 'In production, data is stored in Postgres with row-level security so each account only sees its own runs. API keys stay on the server and are never exposed in the browser.' },
    { q: 'How do I contact the team?', k: 'contact team human person talk speak email support help', a: 'I can pass your question to the team right here, or you can use the inquiry form for audits and pilots.', handoff: true }
  ];
  const STARTERS = [0, 1, 3, 5];

  const STOP = new Set('a an the and or of to in on at by for with is are was be do does did i you we my your it this that can how what which where who when me us our please about'.split(' '));
  const toks = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w) && w.length > 1).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  const index = KB.map((e) => new Set(toks(e.q + ' ' + e.k)));

  function retrieve(text) {
    const t = toks(text);
    if (!t.length) return null;
    let best = { i: -1, score: 0 };
    index.forEach((set, i) => { const hit = t.filter((w) => set.has(w)).length; const score = hit / Math.sqrt(t.length * 1.0); if (score > best.score) best = { i, score }; });
    return best.score >= 0.5 ? KB[best.i] : null;
  }

  /* ---------- UI ---------- */
  const el = document.createElement('div');
  el.className = 'sa';
  el.innerHTML = `
    <button class="sa__fab" aria-label="Open support chat" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/></svg>
      <span class="sa__ping"></span>
    </button>
    <section class="sa__panel" role="dialog" aria-label="Latent Lens support">
      <header class="sa__head">
        <div class="sa__avatar"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="#22d3ee" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#22d3ee"/></svg></div>
        <div><b>Lens Assistant</b><span><i class="dot"></i>Answers from Latent Lens docs</span></div>
        <button class="sa__close" aria-label="Close">&times;</button>
      </header>
      <div class="sa__log" aria-live="polite"></div>
      <div class="sa__chips"></div>
      <form class="sa__form"><input class="sa__input" placeholder="Ask about audits, pricing, hallucinations..." autocomplete="off" maxlength="400"><button aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg></button></form>
      <p class="sa__foot">Not sure? It hands you to a person instead of guessing.</p>
    </section>`;
  document.body.appendChild(el);

  const log = el.querySelector('.sa__log');
  const chips = el.querySelector('.sa__chips');
  const input = el.querySelector('.sa__input');
  const fab = el.querySelector('.sa__fab');
  let pendingHandoff = null;
  const transcript = [];

  function say(who, html) {
    const m = document.createElement('div');
    m.className = 'sa__msg sa__msg--' + who;
    m.innerHTML = html;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    transcript.push({ who, text: m.textContent, at: new Date().toISOString() });
  }

  function typing(cb) {
    const t = document.createElement('div'); t.className = 'sa__msg sa__msg--bot sa__typing'; t.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(t); log.scrollTop = log.scrollHeight;
    setTimeout(() => { t.remove(); cb(); }, 650);
  }

  function setChips(list) {
    chips.innerHTML = '';
    list.forEach(([label, fn]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); chips.appendChild(b); });
  }
  const starterChips = () => setChips(STARTERS.map((i) => [KB[i].q, () => ask(KB[i].q)]));

  function answer(entry) {
    say('bot', esc(entry.a) + (entry.link ? `<a class="sa__link" href="${entry.link[1]}">${esc(entry.link[0])} &rarr;</a>` : ''));
    if (entry.handoff) offerHandoff('');
    else setChips([['That helped', () => { say('user', 'That helped'); typing(() => { say('bot', 'Great. Anything else?'); starterChips(); }); }], ['Talk to a person', () => offerHandoff('')]]);
  }

  function offerHandoff(question) {
    pendingHandoff = { question };
    say('bot', 'Leave your email and I will pass this conversation to the team. They reply within one business day.');
    setChips([]);
    input.placeholder = 'your@email.com';
    input.type = 'email';
    input.focus();
  }

  function fileHandoff(email) {
    const list = store.get('inquiries', []);
    const ref = 'INQ-' + String(1000 + list.length + 1);
    const lastQ = pendingHandoff.question || (transcript.filter((t) => t.who === 'user').slice(-1)[0] || {}).text || 'Support chat';
    list.unshift({ ref, name: 'Chat visitor', email, company: '-', volume: '-', type: 'Support chat', message: lastQ, transcript: transcript.slice(-12), status: 'New', created_at: new Date().toISOString() });
    store.set('inquiries', list);
    pendingHandoff = null;
    input.type = 'text'; input.placeholder = 'Ask about audits, pricing, hallucinations...';
    say('bot', `Done. Ticket <b>${ref}</b> is in the team inbox with this chat attached.`);
    starterChips();
  }

  function ask(text) {
    text = text.trim();
    if (!text) return;
    say('user', esc(text));
    setChips([]);
    typing(() => {
      if (pendingHandoff) {
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) fileHandoff(text);
        else say('bot', 'That does not look like an email address. Could you check it?');
        return;
      }
      const hit = retrieve(text);
      if (hit) answer(hit);
      else { say('bot', 'I do not have a confident answer to that, and I would rather not guess.'); offerHandoff(text); }
    });
  }

  function open(on) {
    el.classList.toggle('is-open', on);
    fab.setAttribute('aria-expanded', String(on));
    if (on && !log.children.length) {
      say('bot', 'Hi, I am the Lens Assistant. Ask me about evaluations, audits or pricing.');
      starterChips();
    }
    if (on) setTimeout(() => input.focus(), 250);
  }

  fab.addEventListener('click', () => open(!el.classList.contains('is-open')));
  el.querySelector('.sa__close').addEventListener('click', () => open(false));
  el.querySelector('.sa__form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; ask(v); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('is-open')) open(false); });
})();
