/* Landing page: scroll-scrubbed statement, pinned film strip, cinematic reveal, sample report, inquiry form */
(function () {
  'use strict';
  const { esc, store, toast, reduced } = window.LL;

  /* sample report from the real engine */
  function sampleReport() {
    const root = document.getElementById('sampleReport');
    if (!root) return;
    const r = window.LatentEngine.evaluate(window.LatentEngine.PRESETS[0]);
    document.getElementById('sampleClaims').innerHTML = window.LLReport.claimsHTML(r);
    document.getElementById('sampleFindings').innerHTML = window.LLReport.findingsHTML(r);
    document.getElementById('sampleJson').innerHTML = window.LLReport.jsonHTML(r);
    document.getElementById('sampleMeta').innerHTML = `<span>${r.counts.claims} claims</span><span>${r.instructions.length} instructions</span><span>rubric ${r.rubric_version}</span><span>engine ${r.engine}</span><span>${r.latency_ms} ms</span>`;
    window.LLReport.bindTabs(root);
    let done = false;
    const fire = () => { if (!done) { done = true; window.LLReport.fillMetrics(root, r); } };
    if (window.ScrollTrigger) window.ScrollTrigger.create({ trigger: root, start: 'top 75%', onEnter: fire }); else fire();
  }

  /* inquiry form: validated, stored (demo) and visible in the dashboard inbox */
  function inquiry() {
    const f = document.getElementById('inquiryForm');
    if (!f) return;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      let ok = true;
      f.querySelectorAll('[required]').forEach((el) => {
        const bad = !el.value.trim() || (el.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value));
        el.classList.toggle('is-invalid', bad); if (bad) ok = false;
      });
      if (!ok) { toast('Please complete the highlighted fields.'); return; }
      const data = Object.fromEntries(new FormData(f).entries());
      const list = store.get('inquiries', []);
      const ref = 'INQ-' + String(1000 + list.length + 1);
      list.unshift({ ...data, ref, status: 'New', created_at: new Date().toISOString() });
      store.set('inquiries', list);
      const ok2 = document.getElementById('inquiryOk');
      ok2.innerHTML = `Thanks ${esc(data.name.split(' ')[0])}, request <b>${ref}</b> is in the pipeline (${esc(data.type)}). You can see it in the <a href="dashboard.html#inquiries" style="color:var(--cyan)">dashboard inbox</a>.`;
      ok2.classList.add('is-on');
      f.reset();
    });
  }

  function motion() {
    const gsap = window.gsap, ST = window.ScrollTrigger;
    if (!gsap || reduced) return;

    // statement: words light up as you scroll
    document.querySelectorAll('[data-scrub]').forEach((el) => {
      el.innerHTML = el.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span> `).join('');
      gsap.to(el.querySelectorAll('.w'), { opacity: 1, stagger: 0.05, ease: 'none', scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: true } });
    });

    // pinned horizontal film strip
    const pin = document.querySelector('.pipeline__pin');
    const track = document.querySelector('.pipeline__track');
    if (pin && track) {
      const dist = () => track.scrollWidth - window.innerWidth;
      const tween = gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: pin, start: 'center center', end: () => '+=' + dist(), pin: true, scrub: 0.8, invalidateOnRefresh: true } });
      gsap.to('.pipeline__progress i', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: pin, start: 'center center', end: () => '+=' + dist(), scrub: true } });
      track.querySelectorAll('.frame').forEach((fr) => {
        const v = fr.querySelector('video');
        gsap.fromTo(v, { xPercent: -8 }, { xPercent: 8, ease: 'none', scrollTrigger: { trigger: fr, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
        gsap.from(fr.querySelector('.frame__inner > div:last-child'), { y: 60, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: fr, containerAnimation: tween, start: 'left 70%' } });
      });
    }

    // cinematic iris reveal
    const media = document.querySelector('.cinema__media');
    if (media) {
      const tl = gsap.timeline({ scrollTrigger: { trigger: '.cinema', start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
      tl.fromTo(media, { clipPath: 'circle(12% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)', ease: 'none' })
        .fromTo('.cinema__media video', { scale: 1.35 }, { scale: 1, ease: 'none' }, 0)
        .fromTo('.cinema__text', { scale: 0.85, opacity: 0.3 }, { scale: 1, opacity: 1, ease: 'none' }, 0);
      const tc = document.getElementById('tc'); const t0 = performance.now();
      (function tick() { const ms = performance.now() - t0; const s = Math.floor(ms / 1000); tc.textContent = ['00', String(Math.floor(s / 60) % 60).padStart(2, '0'), String(s % 60).padStart(2, '0'), String(Math.floor((ms % 1000) / 41.6)).padStart(2, '0')].join(':'); requestAnimationFrame(tick); })();
    }

    // hero panel floats out on scroll
    gsap.to('.hero__copy', { yPercent: -18, opacity: 0.2, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__panel', { yPercent: -40, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    ST.refresh();
  }

  document.addEventListener('DOMContentLoaded', () => { inquiry(); const y = document.getElementById('yr'); if (y) y.textContent = new Date().getFullYear(); });
  document.addEventListener('ll:ready', () => { sampleReport(); motion(); });
})();
