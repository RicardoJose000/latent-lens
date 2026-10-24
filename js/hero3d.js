/* Hero scene: a refractive glass lens looking through a latent-space particle field. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('hero3d');
const hero = document.querySelector('.hero');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { canvas.remove(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 760 ? 1.25 : 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x050811, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050811, 0.045);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  /* video backdrop inside the scene so the glass actually refracts it */
  const vid = document.querySelector('.hero__video video');
  let backdrop;
  if (vid) {
    const tex = new THREE.VideoTexture(vid);
    tex.colorSpace = THREE.SRGBColorSpace;
    backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.32, 0.42, 0.55), fog: false }));
    backdrop.position.z = -8;
    scene.add(backdrop);
  }

  /* the lens */
  const lens = new THREE.Group();
  scene.add(lens);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 128, 128),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, transmission: 1, thickness: 1.6, roughness: 0.04, ior: 1.52, metalness: 0,
      iridescence: 0.75, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 480], clearcoat: 1, clearcoatRoughness: 0.05,
      attenuationColor: new THREE.Color(0x67e8f9), attenuationDistance: 4.5, envMapIntensity: 1.35, specularIntensity: 1
    })
  );
  glass.scale.set(1, 1, 0.5);
  lens.add(glass);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.045, 48, 256), new THREE.MeshStandardMaterial({ color: 0xbfe9ff, metalness: 1, roughness: 0.18, envMapIntensity: 1.6 }));
  lens.add(rim);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.85 }));
  lens.add(core);
  const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 32), new THREE.MeshBasicMaterial({ color: 0xbaf6ff }));
  lens.add(coreGlow);

  /* aperture rings with tick marks */
  const rings = [];
  [[1.85, 0x22d3ee, 0.55], [2.3, 0x2dd4bf, 0.35], [2.9, 0xa78bfa, 0.22]].forEach(([r, c, o], i) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 300), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o }));
    g.add(ring);
    const ticks = []; const n = 72 + i * 24;
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const len = k % 6 === 0 ? 0.12 : 0.05; ticks.push(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o * 0.9 })));
    g.rotation.x = 0.35 * (i + 1) * (i % 2 ? -1 : 1);
    g.rotation.y = 0.25 * i;
    g.userData.speed = (i % 2 ? -1 : 1) * (0.12 + i * 0.05);
    lens.add(g); rings.push(g);
  });

  /* latent-space particles; ~3% are red "hallucinations" that flicker */
  const N = window.innerWidth < 760 ? 3500 : 7000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
  const palette = [new THREE.Color(0x22d3ee), new THREE.Color(0x2dd4bf), new THREE.Color(0x38bdf8), new THREE.Color(0xa78bfa), new THREE.Color(0xe7f2ff)];
  const red = new THREE.Color(0xfb7185);
  for (let i = 0; i < N; i++) {
    const arm = i % 3; const t = Math.random();
    const r = 2.2 + Math.pow(t, 0.7) * 7.5;
    const a = arm * (Math.PI * 2 / 3) + r * 0.55 + (Math.random() - 0.5) * 0.9;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * (0.6 + r * 0.18); pos[i * 3 + 2] = Math.sin(a) * r;
    const isRed = Math.random() < 0.03; const c = isRed ? red : palette[(Math.random() * palette.length) | 0];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    seed[i] = isRed ? -Math.random() : Math.random();
    size[i] = (isRed ? 2.2 : 1) * (0.6 + Math.random() * 1.6);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  pg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const pmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float seed; attribute float size; uniform float uTime; uniform float uPR; varying vec3 vColor; varying float vAlpha;
      void main(){
        vec3 p = position; float r = length(p.xz);
        float ang = uTime * (0.05 + 0.25 / r);
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        p.y += sin(uTime * 0.6 + r * 1.3 + abs(seed) * 6.28) * 0.08;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float flick = seed < 0.0 ? 0.35 + 0.65 * step(0.55, fract(sin(floor(uTime * 3.0 + abs(seed) * 40.0)) * 43758.5453)) : 1.0;
        vAlpha = flick * smoothstep(14.0, 4.0, -mv.z);
        vColor = color;
        gl_PointSize = size * uPR * (seed < 0.0 ? 34.0 : 22.0) / -mv.z;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vColor, a * a * vAlpha); }`
  });
  const points = new THREE.Points(pg, pmat);
  points.rotation.x = 0.42;
  scene.add(points);

  /* scanning beam through the lens */
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 7), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  lens.add(beam);

  const light = new THREE.PointLight(0x22d3ee, 18, 12); light.position.set(2, 2, 3); scene.add(light);
  const light2 = new THREE.PointLight(0xa78bfa, 10, 12); light2.position.set(-3, -2, 2); scene.add(light2);

  /* post */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.65, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* layout */
  let lensX = 0;
  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    lensX = w > 960 ? 2.15 : 0; const s = w > 960 ? 1 : 0.78;
    lens.scale.setScalar(s); points.position.x = lensX;
    if (backdrop) { const d = camera.position.z - backdrop.position.z; const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d; const ar = (vid.videoWidth || 16) / (vid.videoHeight || 9); const vw = vh * camera.aspect; backdrop.scale.set(Math.max(vw, vh * ar) * 1.15, Math.max(vh, vw / ar) * 1.15, 1); }
  }
  window.addEventListener('resize', resize); if (vid) vid.addEventListener('loadedmetadata', resize);
  resize();

  /* interaction */
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  let scrollP = 0;
  window.addEventListener('scroll', () => { scrollP = Math.min(1, window.scrollY / hero.clientHeight); }, { passive: true });

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(hero);

  document.documentElement.classList.add('has-3d');
  const clock = new THREE.Clock();
  let intro = 0;

  /* adaptive quality: measure real frame cost and step down until the page stays smooth */
  let tier = 0, samples = [], lastT = performance.now(), useBloom = true, skip = 0, frameNo = 0;
  function adapt() {
    const now = performance.now(); samples.push(now - lastT); lastT = now;
    if (samples.length < 10) return;
    samples.sort((a, b) => a - b);
    const med = samples[5]; samples = []; // median ignores one-off shader-compile stalls
    const steps = med > 90 ? 3 : med > 28 ? 1 : 0;
    for (let s = 0; s < steps && tier < 3; s++) {
      tier++;
      if (tier === 1) { renderer.setPixelRatio(1); pmat.uniforms.uPR.value = 1; resize(); }
      if (tier === 2) { useBloom = false; glass.material.transmission = 0; glass.material.opacity = 0.35; glass.material.transparent = true; }
      if (tier === 3) { skip = 3; } // very slow device: animate at a quarter rate
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    adapt();
    if (skip && (frameNo++ % skip)) return;
    const t = clock.getElapsedTime();
    intro = Math.min(1, t * 0.45);
    const e = 1 - Math.pow(1 - intro, 4);
    mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;

    pmat.uniforms.uTime.value = reduced ? 0 : t;
    lens.position.set(lensX + mouse.x * 0.25, 0.1 - mouse.y * 0.15 + scrollP * 1.6, (1 - e) * -6);
    lens.rotation.y = (reduced ? 0 : Math.sin(t * 0.35) * 0.35) + mouse.x * 0.45;
    lens.rotation.x = -mouse.y * 0.3 + Math.sin(t * 0.27) * 0.08;
    glass.rotation.z = t * 0.1;
    core.rotation.set(t * 0.5, t * 0.7, 0);
    coreGlow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.25);
    rings.forEach((g) => { g.rotation.z += g.userData.speed * 0.01; });
    beam.rotation.z = t * 0.6; beam.material.opacity = 0.25 + Math.sin(t * 1.4) * 0.15;
    points.rotation.y = mouse.x * 0.15; points.rotation.x = 0.42 + mouse.y * 0.08;
    camera.position.z = 10 + scrollP * 2.5;
    camera.position.x = mouse.x * 0.3; camera.position.y = -mouse.y * 0.2;
    camera.lookAt(lensX * 0.35, 0, 0);
    if (useBloom) composer.render(); else renderer.render(scene, camera);
  }
  frame();
}

// Start after the preloader so the lens "flies in" as the curtain lifts (and never competes with it for frames).
if (canvas && hero) {
  if (document.querySelector('.preloader')) document.addEventListener('ll:ready', () => setTimeout(start, 1150), { once: true });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
