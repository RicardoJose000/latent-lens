/* Latent Lens - shared UI runtime: storage, auth (demo), motion system */
(function () {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) document.documentElement.classList.add('reduced');
  document.documentElement.classList.remove('no-js');

  /* ---------- storage (browser-only demo; production = Supabase Postgres) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ll_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ll_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('ll_' + k); } catch (e) { /* ignore */ } }
  };

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const auth = {
    user() { return store.get('session', null); },
    async signUp(name, email, password) {
      email = email.trim().toLowerCase();
      const users = store.get('users', {});
      if (users[email]) throw new Error('An account with this email already exists.');
      const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
      users[email] = { name: name.trim(), salt, hash: await sha256(salt + password), created: Date.now() };
      store.set('users', users);
      store.set('session', { email, name: name.trim() });
      return auth.user();
    },
    async signIn(email, password) {
      email = email.trim().toLowerCase();
      const u = store.get('users', {})[email];
      if (!u || u.hash !== (await sha256(u.salt + password))) throw new Error('Email or password is incorrect.');
      store.set('session', { email, name: u.name });
      return auth.user();
    },
    signOut() { store.del('session'); location.href = 'index.html'; }
  };

  const runs = {
    key() { const u = auth.user(); return 'runs_' + (u ? u.email : 'guest'); },
    all() { return store.get(runs.key(), []); },
    add(r) { const list = runs.all(); list.unshift(r); store.set(runs.key(), list.slice(0, 200)); },
    remove(id) { store.set(runs.key(), runs.all().filter((r) => r.id !== id)); }
  };

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('is-on'), 2600);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.LL = { store, auth, runs, toast, esc, reduced };

  /* ---------- nav ---------- */
  function initNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const burger = nav.querySelector('.nav__burger');
    if (burger) burger.addEventListener('click', () => nav.classList.toggle('is-open'));
    nav.querySelectorAll('.nav__links a').forEach((a) => { if (a.getAttribute('href') === location.pathname.split('/').pop()) a.classList.add('is-active'); });
    let last = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 40);
      nav.classList.toggle('is-hidden', y > 400 && y > last && !nav.classList.contains('is-open'));
      last = y;
    }, { passive: true });
    // swap CTA when signed in
    const u = auth.user();
    const slot = nav.querySelector('[data-auth-slot]');
    if (slot && u) slot.innerHTML = `<a class="btn btn--ghost btn--sm" href="dashboard.html"><span class="avatar" style="width:22px;height:22px;font-size:11px">${esc(u.name.charAt(0).toUpperCase())}</span>Dashboard</a>`;
  }

  /* ---------- cursor ---------- */
  function initCursor() {
    if (reduced || window.matchMedia('(hover: none)').matches) return;
    const ring = document.createElement('div'); ring.className = 'cursor';
    const dot = document.createElement('div'); dot.className = 'cursor-dot';
    document.body.append(ring, dot);
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px)`; }, { passive: true });
    (function loop() { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(loop); })();
    document.addEventListener('mouseover', (e) => { ring.classList.toggle('is-hover', !!e.target.closest('a,button,.cap,.frame,mark,label,summary,input,textarea,select')); });
  }

  /* ---------- magnetic buttons ---------- */
  function initMagnetic() {
    if (reduced) return;
    document.querySelectorAll('.btn--primary, .btn--lg').forEach((b) => {
      b.addEventListener('mousemove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.32}px)`; });
      b.addEventListener('mouseleave', () => { b.style.transform = ''; });
    });
  }

  /* ---------- 3D tilt + spotlight ---------- */
  function initTilt() {
    document.querySelectorAll('[data-tilt]').forEach((el) => {
      const max = parseFloat(el.dataset.tilt) || 8;
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', px * 100 + '%'); el.style.setProperty('--my', py * 100 + '%');
        if (!reduced) el.style.transform = `perspective(1000px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------- split text into animated lines/words ---------- */
  function splitLines(el) {
    const html = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = html.map((l) => `<span class="split-line"><span>${l}</span></span>`).join('');
    return el.querySelectorAll('.split-line > span');
  }

  /* ---------- lazy-play videos only when visible ---------- */
  function initVideos() {
    const vids = document.querySelectorAll('video[data-autoplay]');
    const probe = document.createElement('video');
    const useMp4 = !!probe.canPlayType('video/mp4; codecs="avc1.640028"');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const v = en.target;
        if (en.isIntersecting) {
          if (!v.src && v.dataset.src) { v.src = useMp4 ? v.dataset.src : v.dataset.src.replace(/\.mp4$/, '.webm'); }
          const p = v.play(); if (p && p.catch) p.catch(() => {});
        } else if (!v.paused) v.pause();
      });
    }, { rootMargin: '200px' });
    vids.forEach((v) => { v.muted = true; v.playsInline = true; v.loop = true; io.observe(v); });
  }

  /* ---------- motion system (GSAP + ScrollTrigger + Lenis) ---------- */
  function initMotion() {
    const gsap = window.gsap;
    if (!gsap) { document.querySelectorAll('[data-reveal]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; }); return; }
    gsap.registerPlugin(window.ScrollTrigger);
    const ST = window.ScrollTrigger;

    if (!reduced && window.Lenis) {
      const lenis = new window.Lenis({ duration: 1.15, smoothWheel: true });
      lenis.on('scroll', ST.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
      window.LL.lenis = lenis;
      document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
        const id = a.getAttribute('href'); if (id.length < 2) return; const t = document.querySelector(id); if (!t) return;
        e.preventDefault(); lenis.scrollTo(t, { offset: -80 });
      }));
    }

    const prog = document.querySelector('.scroll-progress');
    if (prog) gsap.to(prog, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

    if (reduced) { document.querySelectorAll('[data-reveal]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; }); return; }

    document.querySelectorAll('[data-split]').forEach((el) => {
      const lines = splitLines(el);
      gsap.from(lines, { yPercent: 110, rotate: 3, duration: 1.2, ease: 'expo.out', stagger: 0.09, delay: el.dataset.delay ? +el.dataset.delay : 0,
        scrollTrigger: el.hasAttribute('data-now') ? null : { trigger: el, start: 'top 88%' } });
    });
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      gsap.to(el, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', delay: +(el.dataset.reveal || 0), scrollTrigger: { trigger: el, start: 'top 90%' } });
    });
    document.querySelectorAll('[data-stagger]').forEach((wrap) => {
      gsap.from(wrap.children, { opacity: 0, y: 60, rotateX: -12, transformOrigin: '50% 100%', duration: 1.1, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: wrap, start: 'top 85%' } });
    });
    document.querySelectorAll('[data-parallax]').forEach((el) => {
      const amt = parseFloat(el.dataset.parallax) || 12;
      gsap.fromTo(el, { yPercent: -amt }, { yPercent: amt, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    document.querySelectorAll('[data-count]').forEach((el) => {
      const end = parseFloat(el.dataset.count); const dec = (el.dataset.count.split('.')[1] || '').length; const o = { v: 0 };
      gsap.to(o, { v: end, duration: 2, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%' }, onUpdate: () => { el.textContent = o.v.toFixed(dec) + (el.dataset.suffix || ''); } });
    });
  }

  /* ---------- preloader ---------- */
  function initPreloader(done) {
    const pre = document.querySelector('.preloader');
    if (!pre) return done();
    // Timer-driven (not rAF-driven) so a slow GPU can never hold the page hostage.
    const c = pre.querySelector('.preloader__count');
    const start = performance.now(), DUR = 1300;
    const iv = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / DUR);
      if (c) c.textContent = String(Math.round(100 * (1 - Math.pow(1 - t, 3)))).padStart(3, '0');
    }, 40);
    setTimeout(() => {
      clearInterval(iv); if (c) c.textContent = '100';
      pre.classList.add('is-out');
      done();
      setTimeout(() => pre.remove(), 1100);
    }, DUR);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav(); initCursor(); initMagnetic(); initTilt(); initVideos();
    initPreloader(() => { initMotion(); document.dispatchEvent(new Event('ll:ready')); });
  });
})();
