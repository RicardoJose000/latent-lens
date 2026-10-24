/* Sample workspace: real engine runs over a set of realistic cases, spread over the last two weeks. */
(function () {
  'use strict';
  const CASES = [
    { prompt: 'Using only the context, tell the customer when their order ships. Keep it under 40 words.', context: 'Orders placed before 2pm ship the same business day. Orders placed after 2pm ship the next business day. We do not ship on weekends.', response: 'Orders placed before 2pm ship the same business day; later orders ship the next business day. We do not ship on weekends.' },
    { prompt: 'Summarise the incident in 2 sentences for the status page. Do not mention the vendor name.', context: 'On 12 March the API returned errors for 18 minutes due to an expired TLS certificate at our CDN provider Fastedge. Traffic was restored after the certificate was renewed.', response: 'On 12 March the API returned errors for 45 minutes because of an expired TLS certificate at Fastedge. Service was restored after renewal and we are adding automated certificate monitoring.' },
    { prompt: 'Respond in Portuguese: what is the warranty period for the X2 headphones?', context: 'The X2 headphones include a 24-month warranty covering manufacturing defects. Accidental damage is not covered.', response: 'The X2 headphones come with a 24-month warranty for manufacturing defects. Accidental damage is not covered.' },
    { prompt: 'Return JSON only with keys "plan" and "price" for the Pro tier.', context: 'Pro tier: 49 EUR per month, billed annually. Team tier: 99 EUR per month.', response: '{"plan": "Pro", "price": "49 EUR per month, billed annually"}' },
    { prompt: 'List 3 bullet points on how to reset a password, based only on the help article.', context: 'To reset your password, open Settings and choose Security. Click Reset password and enter your email. Follow the link sent to your inbox within 15 minutes.', response: '- Open Settings and choose Security\n- Click Reset password and enter your email\n- Follow the link sent to your inbox within 30 minutes' },
    { prompt: 'Explain what our API rate limit is. Must mention the 429 status code.', context: 'The public API allows 600 requests per minute per key. Requests over the limit receive HTTP 429 with a Retry-After header.', response: 'The public API allows 600 requests per minute per key. If you go over the limit you will receive HTTP 429 along with a Retry-After header telling you when to retry.' },
    { prompt: 'In under 60 words, describe the clinical trial result for a patient newsletter.', context: 'The phase 2 trial enrolled 240 patients. 62% of patients on the treatment arm showed improvement versus 41% on placebo. The most common side effect was mild headache.', response: 'The phase 3 trial enrolled 2,400 patients and the treatment cured 90% of them. It is guaranteed safe with no side effects, according to a study by Harvard.' },
    { prompt: 'Give a one paragraph answer: does the Basic plan include SSO?', context: 'SSO (SAML) is available on the Enterprise plan only. Basic and Pro plans support email and Google sign-in.', response: 'No. SSO via SAML is only available on the Enterprise plan. The Basic plan supports email and Google sign-in.' }
  ];

  function seed(email) {
    const all = CASES.concat(window.LatentEngine.PRESETS);
    const now = Date.now();
    const out = all.map((c, i) => {
      const r = window.LatentEngine.evaluate(c);
      r.created_at = new Date(now - (all.length - i) * 36e5 * (14 + (i % 3) * 7)).toISOString();
      r.id = 'run_seed' + i;
      return r;
    }).reverse();
    window.LL.store.set('runs_' + email, out);
    const inq = window.LL.store.get('inquiries', []);
    if (!inq.length) window.LL.store.set('inquiries', [{ ref: 'INQ-1001', name: 'Sample Prospect', email: 'ops@example.com', company: 'Example Health', volume: '10k - 100k', type: 'RAG evaluation', message: 'Patient-facing assistant over 1,200 clinical PDFs. Need a hallucination audit before launch.', status: 'In review', created_at: new Date(now - 864e5 * 2).toISOString() }]);
  }
  window.LLSeed = { seed };
})();
