/*
 * Latent Lens evaluation engine (client-side build of the MVP pipeline).
 *
 * Pipeline: extract constraints -> decompose claims -> ground each claim -> classify failures -> score -> remediate.
 * Scores are always computed in code from per-item labels, never asked from a model directly. That keeps runs
 * reproducible and lets the optional LLM judge (OpenAI Structured Outputs) swap in as a better labeller
 * without changing the scoring maths.
 */
(function (global) {
  'use strict';

  const RUBRIC_VERSION = 'll-rubric-0.4';
  const ENGINE_VERSION = 'heuristic-1.2';

  const STOP = new Set(('a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those it its ' +
    'into over under about than so such can could would should will shall may might must do does did done have has had having i you he she we they ' +
    'me him her us them my your his our their what which who whom whose when where why how all any both each few more most other some no nor not only ' +
    'own same too very just also there here out up down again further once s t don now please answer write give provide using use based following ' +
    'response question user assistant e g etc via per').split(' '));

  const NEGATION = /\b(not|no|never|none|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|without|neither|nor|no longer|excluded|exempt)\b|\bnon-\w+|\bun\w+able\b/i;
  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1 };
  const LANGS = {
    english: ['the', 'and', 'is', 'of', 'to', 'with', 'that', 'for', 'are', 'this'],
    portuguese: ['de', 'que', 'não', 'para', 'com', 'uma', 'os', 'é', 'por', 'mais', 'você', 'também'],
    spanish: ['que', 'de', 'los', 'las', 'para', 'con', 'una', 'es', 'por', 'más', 'pero', 'también'],
    french: ['le', 'la', 'les', 'des', 'est', 'et', 'pour', 'avec', 'une', 'dans', 'pas', 'vous'],
    german: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'ein', 'eine', 'auch', 'sie'],
    italian: ['il', 'che', 'di', 'della', 'per', 'con', 'una', 'non', 'sono', 'anche', 'gli', 'è']
  };

  const REMEDIATION = {
    'Fabricated entity': 'Constrain generation to retrieved context ("answer only from the sources below") and reject outputs that name entities absent from the context.',
    'Numeric drift': 'Pass numbers through as structured fields, or add a post-generation check that every figure in the answer appears verbatim in the source.',
    'Contradiction': 'Raise retrieval precision (rerank top-k) and add an explicit instruction to quote the source sentence for every factual claim.',
    'Unsupported claim': 'Add a citation requirement per claim and allow the model to answer "not in the provided context" instead of extrapolating.',
    'Ungrounded specifics': 'No ground truth was supplied, so specific figures, names and citations cannot be verified. Add retrieval or supply context before shipping.',
    'Length breach': 'Move the length limit to the end of the system prompt and enforce it with max_tokens plus a truncation guard.',
    'Format breach': 'Use structured outputs / a response schema instead of prose instructions for format, and validate before returning to users.',
    'Language breach': 'State the output language in the system prompt and add a language-ID check that triggers a regenerate on mismatch.',
    'Forbidden content': 'Add a deny-list filter after generation and restate the exclusion as a hard rule in the system prompt.',
    'Missing required content': 'Turn required items into an explicit checklist in the prompt and verify each one in a post-processing step.',
    'Unwarranted refusal': 'Review the safety layer for over-triggering on benign requests; add allowed-use examples to the system prompt.',
    'Overconfident language': 'Instruct the model to calibrate certainty ("likely", "according to the source") and avoid absolutes it cannot verify.',
    'Off-topic': 'Re-anchor the answer on the user question: retrieve with the original query and add a relevance self-check before responding.'
  };

  /* ---------- text utils ---------- */
  const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
  function words(s) { return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'%.-]*/gu) || []).map((w) => w.replace(/[.'-]+$/, '')); }
  function contentTokens(s) { return words(s).filter((w) => !STOP.has(w) && w.length > 1).map(stem); }
  function normNum(n) { return n.replace(/,/g, '').replace(/\.0+$/, '').replace(/\.$/, ''); }
  function numbers(s) {
    const out = (s.match(/\b\d[\d,]*(?:\.\d+)?%?/g) || []).map(normNum);
    words(s).forEach((w) => { if (NUM_WORDS[w] && w !== 'single') out.push(String(NUM_WORDS[w])); });
    return out;
  }
  function entities(s) {
    // Capitalised words that are not sentence-initial, plus acronyms. Good-enough NER for grounding checks.
    const out = new Set();
    const parts = s.split(/(?<=[.!?:])\s+|\n+/);
    parts.forEach((p) => {
      const toks = p.trim().split(/\s+/);
      toks.forEach((t, i) => {
        const w = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!w) return;
        if (/^[A-Z]{2,}[0-9]*$/.test(w) || (i > 0 && /^\p{Lu}[\p{Ll}]{2,}/u.test(w) && !STOP.has(w.toLowerCase()))) out.add(w.toLowerCase());
      });
    });
    return [...out];
  }
  function sentences(text) {
    return text.replace(/\r/g, '').split(/\n+/).flatMap((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').split(/(?<=[.!?])\s+(?=[\p{Lu}\d"'(])/u))
      .map((s) => s.trim()).filter(Boolean);
  }
  function wordCount(s) { return (s.trim().match(/\S+/g) || []).length; }
  function toNum(t) { return /^\d+$/.test(t) ? parseInt(t, 10) : NUM_WORDS[t.toLowerCase()]; }
  function overlap(a, bSet) { if (!a.length) return 0; let hit = 0; a.forEach((t) => { if (bSet.has(t)) hit++; }); return hit / a.length; }
  function detectLang(text) {
    const w = words(text); const scores = {};
    Object.entries(LANGS).forEach(([k, list]) => { const set = new Set(list); scores[k] = w.filter((x) => set.has(x)).length / Math.max(1, w.length); });
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  }

  /* ---------- 1. constraint extraction ---------- */
  function extractConstraints(prompt) {
    const p = prompt;
    const C = [];
    let m;
    const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|single)';
    if ((m = p.match(new RegExp('(?:under|less than|fewer than|no more than|max(?:imum)?(?: of)?|at most|within|up to|not exceed(?:ing)?)\\s+' + NUM + '\\s+words?', 'i')))) C.push({ type: 'max_words', n: toNum(m[1]), text: m[0] });
    else if ((m = p.match(new RegExp('\\bin\\s+' + NUM + '\\s+words', 'i')))) C.push({ type: 'max_words', n: Math.round(toNum(m[1]) * 1.1), text: m[0] });
    if ((m = p.match(new RegExp('at least\\s+' + NUM + '\\s+words', 'i')))) C.push({ type: 'min_words', n: toNum(m[1]), text: m[0] });
    if ((m = p.match(new RegExp('(?:in|exactly|no more than|at most|max(?:imum)?(?: of)?|under)\\s+' + NUM + '\\s+sentences?', 'i')))) C.push({ type: 'max_sentences', n: toNum(m[1]), exact: /exactly/i.test(m[0]), text: m[0] });
    if ((m = p.match(new RegExp(NUM + '\\s+(?:bullet(?:ed)?\\s*(?:points?)?|bullets|key points|items)', 'i')))) C.push({ type: 'bullet_count', n: toNum(m[1]), text: m[0] });
    else if (/bullet(?:ed)?\s*(?:points?|list)?|as a list|in bullets|list format/i.test(p)) C.push({ type: 'bullets', text: (p.match(/bullet(?:ed)?\s*(?:points?|list)?|as a list|in bullets|list format/i) || [''])[0] });
    if (/numbered list|numbered steps|step[- ]by[- ]step list/i.test(p)) C.push({ type: 'numbered', text: 'numbered list' });
    if (/\bjson\b/i.test(p) && /(return|respond|output|format|as)\b[^.]{0,30}\bjson\b|\bjson\b[^.]{0,20}(format|object|only)/i.test(p)) C.push({ type: 'json', text: 'JSON output' });
    if ((m = p.match(/(?:in|respond in|answer in|write in|reply in|translate (?:it )?(?:in)?to)\s+(portuguese|spanish|french|german|italian|english)\b/i))) C.push({ type: 'language', lang: m[1].toLowerCase(), text: m[0] });
    if (/\b(one|a single|single)\s+paragraph\b/i.test(p)) C.push({ type: 'one_paragraph', text: 'single paragraph' });
    if (/\b(no|without|avoid)\s+markdown\b|plain text only|in plain text/i.test(p)) C.push({ type: 'no_markdown', text: 'plain text, no markdown' });
    if (/cite (?:your |the )?sources?|with citations|include (?:references|citations|sources)|reference the source/i.test(p)) C.push({ type: 'citations', text: 'cite sources' });
    if (/end with a question|finish with a question|ask (?:a|one) (?:follow[- ]up )?question at the end/i.test(p)) C.push({ type: 'ends_question', text: 'end with a question' });
    if ((m = p.match(/(?:start|begin)\s+(?:your (?:answer|response|reply) )?with\s+["“']([^"”']{2,60})["”']/i))) C.push({ type: 'starts_with', value: m[1], text: m[0] });
    if (/(?:only|solely|strictly)\s+(?:use|using|rely on|from|on)\s+(?:the\s+)?(?:provided|given|following|above|below)?\s*(?:context|sources?|documents?|information)|based (?:only|solely|strictly) on the (?:context|provided)/i.test(p)) C.push({ type: 'grounded_only', text: 'answer only from provided context' });
    const exRe = /(?:do not|don't|never|avoid|must not|without)\s+(?:mention(?:ing)?|us(?:e|ing)|includ(?:e|ing)|say(?:ing)?|referenc(?:e|ing)|talk(?:ing)? about|discuss(?:ing)?)\s+(?:the\s+(?:word|term|phrase)s?\s+)?(?:any\s+)?["“']?([^"”'.,;:\n]{2,48})["”']?/gi;
    while ((m = exRe.exec(p))) { const term = m[1].trim().replace(/\s+(or|and)\s+.*/i, ''); if (term && !/markdown/i.test(term)) C.push({ type: 'exclude', value: term, text: m[0] }); }
    const inRe = /(?:must|should|make sure (?:to|you)|be sure to|remember to|always)\s+(?:mention|include|reference|state|name)\s+(?:the\s+)?["“']?([^"”'.,;:\n]{2,48})["”']?/gi;
    while ((m = inRe.exec(p))) C.push({ type: 'include', value: m[1].trim(), text: m[0] });
    return C;
  }

  function stripFences(s) { return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim(); }
  const BULLET_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/;

  function checkConstraint(c, response, ctx) {
    const wc = wordCount(response);
    const lines = response.split(/\n/).filter((l) => l.trim());
    const bullets = lines.filter((l) => BULLET_LINE.test(l));
    const sents = sentences(response.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, ''));
    const lc = response.toLowerCase();
    switch (c.type) {
      case 'max_words': return { label: `Length ≤ ${c.n} words`, pass: wc <= c.n, detail: `${wc} words`, failure: 'Length breach' };
      case 'min_words': return { label: `Length ≥ ${c.n} words`, pass: wc >= c.n, detail: `${wc} words`, failure: 'Length breach' };
      case 'max_sentences': { const ok = c.exact ? sents.length === c.n : sents.length <= c.n; return { label: `${c.exact ? 'Exactly' : 'At most'} ${c.n} sentence${c.n > 1 ? 's' : ''}`, pass: ok, detail: `${sents.length} sentence${sents.length === 1 ? '' : 's'} found`, failure: 'Length breach' }; }
      case 'bullet_count': return { label: `${c.n} bullet points`, pass: bullets.length === c.n, detail: `${bullets.length} bullet${bullets.length === 1 ? '' : 's'} found`, failure: 'Format breach' };
      case 'bullets': return { label: 'Bulleted list format', pass: bullets.length >= 2, detail: bullets.length ? `${bullets.length} list items` : 'prose, no list items', failure: 'Format breach' };
      case 'numbered': { const n = lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).length; return { label: 'Numbered list', pass: n >= 2, detail: `${n} numbered items`, failure: 'Format breach' }; }
      case 'json': { let ok = true, d = 'valid JSON'; try { JSON.parse(stripFences(response)); } catch (e) { ok = false; d = 'not parseable: ' + e.message.split('\n')[0].slice(0, 60); } return { label: 'Valid JSON output', pass: ok, detail: d, failure: 'Format breach' }; }
      case 'language': { const got = detectLang(response); return { label: `Written in ${cap(c.lang)}`, pass: got === c.lang, detail: `detected ${cap(got)}`, failure: 'Language breach' }; }
      case 'one_paragraph': { const paras = response.trim().split(/\n\s*\n/).length; return { label: 'Single paragraph', pass: paras === 1 && bullets.length === 0, detail: `${paras} paragraph${paras > 1 ? 's' : ''}`, failure: 'Format breach' }; }
      case 'no_markdown': { const md = /(^|\n)\s*#{1,6}\s|\*\*|__|`|^\s*[-*]\s/m.test(response); return { label: 'Plain text (no markdown)', pass: !md, detail: md ? 'markdown syntax found' : 'clean', failure: 'Format breach' }; }
      case 'citations': { const ok = /\[\d+\]|https?:\/\/|\(source|\bsource:|according to (?:the )?(?:context|document|source)/i.test(response); return { label: 'Cites sources', pass: ok, detail: ok ? 'citation markers found' : 'no citation markers', failure: 'Missing required content' }; }
      case 'ends_question': return { label: 'Ends with a question', pass: /\?\s*$/.test(response.trim()), detail: 'last char: "' + response.trim().slice(-1) + '"', failure: 'Format breach' };
      case 'starts_with': return { label: `Starts with "${c.value}"`, pass: lc.trim().startsWith(c.value.toLowerCase()), detail: '"' + response.trim().slice(0, 28) + '…"', failure: 'Format breach' };
      case 'exclude': { const hit = lc.includes(c.value.toLowerCase()) || contentTokens(c.value).every((t) => contentTokens(response).includes(t)); return { label: `Avoids "${c.value}"`, pass: !hit, detail: hit ? 'term present in response' : 'not present', failure: 'Forbidden content' }; }
      case 'include': { const t = contentTokens(c.value); const ov = overlap(t, new Set(contentTokens(response))); return { label: `Mentions "${c.value}"`, pass: ov >= 0.6, detail: ov >= 0.6 ? 'present' : 'missing', failure: 'Missing required content' }; }
      case 'grounded_only': return { label: 'Uses only provided context', pass: null, detail: ctx ? 'scored by faithfulness' : 'no context supplied', failure: 'Unsupported claim', deferred: true };
      default: return null;
    }
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- 2+3. claim decomposition + grounding ---------- */
  const FILLER = /^(sure|certainly|of course|great question|here(?:'s| is| are)|i hope|let me know|feel free|in summary|in conclusion|overall,? (?:this|that))/i;
  const ABSOLUTE = /\b(always|never|guarantee[sd]?|100%|definitely|certainly|proven|undeniabl[ey]|every single|no doubt)\b/i;
  const CITE_LIKE = /\b(according to|a (?:\d{4} )?study|research (?:shows|found)|published in|et al\.?|journal of|survey by|report by)\b|https?:\/\//i;

  function decompose(response) {
    return sentences(response).flatMap((s) => s.split(/;\s+/)).map((s) => s.trim())
      .filter((s) => contentTokens(s).length >= 3 && !/\?\s*$/.test(s) && !FILLER.test(s));
  }

  function groundClaim(claim, ctxSents, ctxTokSet, ctxNums, ctxEnts) {
    const ct = contentTokens(claim);
    let best = { score: 0, rank: 0, sent: '' };
    ctxSents.forEach((s) => {
      const st = contentTokens(s);
      const sc = overlap(ct, new Set(st));
      const rank = sc + (st[0] && st[0] === ct[0] ? 0.1 : 0); // same grammatical subject breaks ties
      if (rank > best.rank) best = { score: sc, rank, sent: s };
    });
    const cover = overlap(ct, ctxTokSet);
    const support = Math.max(best.score, cover * 0.9);
    const nums = numbers(claim).filter((n) => !ctxNums.has(n));
    const ents = entities(claim).filter((e) => !ctxEnts.has(e) && !ctxTokSet.has(stem(e)));
    const negFlip = best.score >= 0.5 && NEGATION.test(claim) !== NEGATION.test(best.sent);
    let label = 'supported', failure = null, reason = 'Every key term is present in the source.';
    if (nums.length && support >= 0.3) { label = 'contradicted'; failure = 'Numeric drift'; reason = `Figure ${nums.map((n) => '"' + n + '"').join(', ')} does not match the source.`; }
    else if (negFlip) { label = 'contradicted'; failure = 'Contradiction'; reason = 'Polarity is flipped against the closest source sentence.'; }
    else if (ents.length && support < 0.75) { label = support >= 0.3 ? 'contradicted' : 'unsupported'; failure = 'Fabricated entity'; reason = `Entity ${ents.slice(0, 3).map((e) => '"' + e + '"').join(', ')} is not in the source.`; }
    else if (nums.length) { label = 'unsupported'; failure = 'Unsupported claim'; reason = `Figure ${nums.map((n) => '"' + n + '"').join(', ')} has no source.`; }
    else if (support >= 0.6) { label = 'supported'; }
    else if (support >= 0.38) { label = 'partial'; reason = 'Only partly covered by the source; the rest is extrapolation.'; failure = 'Unsupported claim'; }
    else { label = 'unsupported'; failure = 'Unsupported claim'; reason = 'No matching evidence in the provided context.'; }
    return { text: claim, label, support: +support.toFixed(2), evidence: best.score >= 0.25 ? best.sent : '', reason, failure };
  }

  function riskClaim(claim, promptToks) {
    // No ground truth: estimate hallucination risk from how specific / verifiable-looking the claim is.
    const flags = [];
    if (numbers(claim).length) flags.push('specific figure');
    if (entities(claim).some((e) => !promptToks.has(stem(e)))) flags.push('named entity');
    if (CITE_LIKE.test(claim)) flags.push('citation-like reference');
    const label = flags.length >= 2 || CITE_LIKE.test(claim) ? 'unverifiable' : flags.length === 1 ? 'partial' : 'low-risk';
    return { text: claim, label, support: null, evidence: '', reason: flags.length ? `Unverifiable without context: ${flags.join(', ')}.` : 'Generic statement, low hallucination risk.', failure: label === 'unverifiable' ? 'Ungrounded specifics' : null };
  }

  /* ---------- 4+5. orchestrate, classify, score ---------- */
  function evaluate({ prompt = '', response = '', context = '' }) {
    const t0 = performance.now();
    const hasCtx = context.trim().length > 20;
    const constraints = extractConstraints(prompt);
    const claimsText = decompose(response);

    let claims;
    if (hasCtx) {
      const ctxSents = sentences(context);
      const ctxTokSet = new Set(contentTokens(context));
      const ctxNums = new Set(numbers(context));
      const ctxEnts = new Set(entities(context).concat(entities(prompt)));
      claims = claimsText.map((c) => groundClaim(c, ctxSents, ctxTokSet, ctxNums, ctxEnts));
    } else {
      const promptToks = new Set(contentTokens(prompt));
      claims = claimsText.map((c) => riskClaim(c, promptToks));
    }
    return finalize({ prompt, response, context, hasCtx, constraints, claims, t0, engine: ENGINE_VERSION });
  }

  function finalize({ prompt, response, context, hasCtx, constraints, claims, t0, engine, judgeChecks }) {
    const checks = judgeChecks || constraints.map((c) => checkConstraint(c, response, hasCtx)).filter(Boolean);
    const n = claims.length || 1;
    const count = (l) => claims.filter((c) => c.label === l).length;
    const supported = count('supported'), partial = count('partial'), contradicted = count('contradicted'), unsupported = count('unsupported'), unverifiable = count('unverifiable');

    const faithfulness = hasCtx ? (supported + 0.5 * partial) / n : null;
    const hallucination = hasCtx ? (contradicted + unsupported) / n : (unverifiable + 0.4 * partial) / n;

    // grounded_only constraint is decided by faithfulness
    checks.forEach((c) => { if (c.deferred) { if (hasCtx) { c.pass = hallucination === 0; c.detail = hallucination === 0 ? 'all claims grounded' : `${contradicted + unsupported} ungrounded claim(s)`; } else { c.pass = null; } } });
    const scored = checks.filter((c) => c.pass !== null);
    const adherence = scored.length ? scored.filter((c) => c.pass).length / scored.length : null;

    const pTok = contentTokens(prompt.replace(/\b(bullet|words?|sentences?|json|format|paragraph|markdown|portuguese|spanish|english|french|german)\b/gi, ''));
    // Relevance = how much of the question the answer covers, or (with context) how much of the answer stays on the
    // question-relevant part of the context. Taking the max keeps short, correct answers from being punished.
    const rTok = [...new Set(contentTokens(response))];
    const pSet = new Set(pTok);
    let relevance = pTok.length ? Math.min(1, overlap([...pSet], new Set(rTok)) * 1.7) : 1;
    if (hasCtx && pTok.length && rTok.length) {
      const target = new Set(pTok);
      sentences(context).forEach((s) => { const st = contentTokens(s); if (overlap([...pSet], new Set(st)) >= 0.2) st.forEach((t) => target.add(t)); });
      relevance = Math.max(relevance, Math.min(1, overlap(rTok, target) * 1.2));
    }

    const refusal = /\b(as an ai(?: language model)?|i (?:cannot|can't|am unable to|won't) (?:help|assist|provide|answer))\b/i.test(response) && response.length < 600;
    const absolutes = (response.match(new RegExp(ABSOLUTE.source, 'gi')) || []).length;

    // failure taxonomy
    const failures = [];
    const bump = (type, severity, detail) => { const f = failures.find((x) => x.type === type); if (f) { f.count++; f.details.push(detail); if (sev(severity) > sev(f.severity)) f.severity = severity; } else failures.push({ type, severity, count: 1, details: [detail] }); };
    claims.forEach((c) => { if (c.failure) bump(c.failure, c.label === 'contradicted' ? 'high' : c.label === 'unsupported' || c.label === 'unverifiable' ? 'medium' : 'low', c.text); });
    checks.forEach((c) => { if (c.pass === false) bump(c.failure, c.failure === 'Format breach' || c.failure === 'Length breach' ? 'medium' : 'high', `${c.label}: ${c.detail}`); });
    if (refusal) bump('Unwarranted refusal', 'high', 'Response declines a request that appears benign.');
    if (absolutes >= 2) bump('Overconfident language', 'low', `${absolutes} absolute terms (always / guaranteed / 100% ...)`);
    if (relevance < 0.3 && !refusal) bump('Off-topic', 'medium', 'Low lexical overlap between the question and the answer.');
    failures.sort((a, b) => sev(b.severity) - sev(a.severity) || b.count - a.count);

    // weighted overall
    const parts = [];
    if (faithfulness !== null) parts.push([faithfulness, 0.45]); else parts.push([1 - hallucination, 0.3]);
    if (adherence !== null) parts.push([adherence, hasCtx ? 0.3 : 0.45]);
    parts.push([relevance, 0.15]);
    parts.push([refusal ? 0 : Math.max(0, 1 - absolutes * 0.15), 0.1]);
    const wsum = parts.reduce((a, p) => a + p[1], 0);
    let overall = parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum;
    if (failures.some((f) => f.severity === 'high')) overall = Math.min(overall, 0.74);
    if (!claims.length && !response.trim()) overall = 0;

    const pct = (x) => (x === null ? null : Math.round(x * 100));
    const score = pct(overall);
    const verdict = score >= 85 ? { label: 'Production-ready', tone: 'ok' } : score >= 65 ? { label: 'Needs review', tone: 'warn' } : { label: 'High risk', tone: 'bad' };
    const confidence = hasCtx && claims.length >= 3 ? 'high' : hasCtx || claims.length >= 3 ? 'medium' : 'low';

    return {
      id: 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      created_at: new Date().toISOString(),
      rubric_version: RUBRIC_VERSION,
      engine,
      latency_ms: Math.round(performance.now() - t0),
      mode: hasCtx ? 'grounded' : 'reference-free',
      confidence,
      verdict,
      scores: { overall: score, faithfulness: pct(faithfulness), hallucination_rate: pct(hallucination), instruction_adherence: pct(adherence), relevance: pct(relevance) },
      counts: { claims: claims.length, supported, partial, contradicted, unsupported, unverifiable },
      claims,
      instructions: checks,
      failures,
      remediation: failures.map((f) => ({ type: f.type, step: REMEDIATION[f.type] })).filter((r) => r.step),
      input: { prompt, response, context }
    };
  }
  const sev = (s) => ({ low: 1, medium: 2, high: 3 }[s] || 0);

  /* ---------- optional: LLM-as-a-judge via OpenAI Structured Outputs ---------- */
  const JUDGE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['claims', 'instructions'],
    properties: {
      claims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'label', 'evidence', 'reason', 'failure'],
        properties: { text: { type: 'string' }, label: { type: 'string', enum: ['supported', 'partial', 'contradicted', 'unsupported', 'unverifiable', 'low-risk'] }, evidence: { type: 'string' }, reason: { type: 'string' },
          failure: { type: ['string', 'null'], enum: ['Fabricated entity', 'Numeric drift', 'Contradiction', 'Unsupported claim', 'Ungrounded specifics', null] } } } },
      instructions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'pass', 'detail', 'failure'],
        properties: { label: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' }, failure: { type: 'string', enum: ['Length breach', 'Format breach', 'Language breach', 'Forbidden content', 'Missing required content'] } } } }
    }
  };
  const JUDGE_SYSTEM = `You are an evaluation judge, not an assistant. You never answer the user's prompt.
Task: audit an AI response.
1. Split the RESPONSE into atomic factual claims (skip greetings and filler).
2. If CONTEXT is given, label each claim: supported (fully entailed), partial (some parts entailed), contradicted (conflicts with context), unsupported (absent from context). Quote the exact context sentence as evidence or "".
   If CONTEXT is empty, label claims: unverifiable (specific facts that cannot be checked), partial, or low-risk (generic).
3. Extract every explicit instruction from the PROMPT (length, format, language, exclusions, required items) and judge pass/fail with a short detail.
Rules: be strict and literal; when unsure between supported and partial choose partial; never invent evidence.`;

  async function judge({ apiKey, model, prompt, response, context }) {
    const t0 = performance.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini', temperature: 0, seed: 7,
        response_format: { type: 'json_schema', json_schema: { name: 'latent_lens_judgement', strict: true, schema: JUDGE_SCHEMA } },
        messages: [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}\n\nCONTEXT:\n${context || '(none)'}` }]
      })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e.error && e.error.message) || 'Judge request failed (' + res.status + ')'); }
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    const hasCtx = context.trim().length > 20;
    // Heuristic checks still run for deterministic constraints (word counts, JSON validity) and win over the model on those.
    const heur = extractConstraints(prompt).map((c) => checkConstraint(c, response, hasCtx)).filter(Boolean);
    const extra = out.instructions.filter((j) => !heur.some((h) => h.failure === j.failure && similar(h.label, j.label)));
    return finalize({ prompt, response, context, hasCtx, constraints: [], claims: out.claims.map((c) => ({ ...c, support: null })), t0, engine: (model || 'gpt-4o-mini') + ' judge + ' + ENGINE_VERSION, judgeChecks: heur.concat(extra) });
  }
  function similar(a, b) { return overlap(contentTokens(a), new Set(contentTokens(b))) >= 0.5; }

  /* ---------- presets used by the UI and to seed the demo workspace ---------- */
  const PRESETS = [
    {
      id: 'rag', name: 'RAG answer with drift',
      prompt: 'Using only the provided context, summarise our refund policy for a customer in under 80 words. Do not mention store credit.',
      context: 'Customers can request a full refund within 30 days of purchase. Refunds are issued to the original payment method within 5 business days. Digital products are refundable only if they have not been downloaded. Shipping fees are non-refundable.',
      response: 'You can request a full refund within 60 days of purchase. Refunds go back to your original payment method within 5 business days. Digital products are refundable only if not downloaded. Shipping fees are also refunded in full. If you prefer, we can issue store credit instead, approved by our Lisbon support team.'
    },
    {
      id: 'format', name: 'Instruction breach',
      prompt: 'Give exactly 3 bullet points explaining why LLM evaluation matters for product teams. Respond in English and do not mention ChatGPT.',
      context: '',
      response: 'LLM evaluation matters because models can hallucinate facts that look convincing, and product teams need a way to catch those before customers do. Tools like ChatGPT are always confident even when wrong. A 2023 study by Stanford found that 47% of AI answers contained at least one error, so testing is guaranteed to improve quality.'
    },
    {
      id: 'clean', name: 'Grounded & compliant',
      prompt: 'Based only on the context, list the 3 supported export formats as bullet points.',
      context: 'The reporting module supports three export formats: PDF for executive summaries, CSV for raw evaluation rows, and JSON for programmatic access through the API. Exports are generated asynchronously and emailed when ready.',
      response: '- PDF, used for executive summaries\n- CSV, containing the raw evaluation rows\n- JSON, for programmatic access through the API'
    }
  ];

  global.LatentEngine = { evaluate, judge, extractConstraints, PRESETS, RUBRIC_VERSION, ENGINE_VERSION };
})(window);
