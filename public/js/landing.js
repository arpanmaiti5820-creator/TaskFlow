/* Landing page interactions */
document.addEventListener('DOMContentLoaded', () => {
  $('#yr').textContent = new Date().getFullYear();

  // Rotating word
  const words = ['more', 'faster', 'better', 'together'];
  const rot = $('#rotator'); let i = 0;
  setInterval(() => {
    rot.classList.add('swap');
    setTimeout(() => { i = (i + 1) % words.length; rot.textContent = words[i]; rot.classList.remove('swap'); }, 350);
  }, 2400);

  // Count-up numbers when visible
  const counters = $$('[data-count]');
  const io = new IntersectionObserver((ens) => ens.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target, to = +el.dataset.count, suf = el.dataset.suffix || '';
    const t0 = performance.now();
    const tick = (n) => {
      const p = Math.min((n - t0) / 1600, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e).toLocaleString() + (p === 1 ? suf : '');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick); io.unobserve(el);
  }), { threshold: 0.6 });
  counters.forEach((c) => io.observe(c));

  // Cursor glow on feature cards
  $$('.feature').forEach((card) => card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', e.clientX - r.left + 'px');
    card.style.setProperty('--my', e.clientY - r.top + 'px');
  }));

  // Hero mock parallax (desktop only)
  const mock = $('#mock');
  if (mock && matchMedia('(hover:hover) and (min-width: 981px)').matches) {
    const wrap = mock.parentElement;
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      mock.style.animation = 'none';
      mock.style.transform = `rotateY(${x * 14 - 6}deg) rotateX(${-y * 10 + 3}deg)`;
    });
    wrap.addEventListener('pointerleave', () => { mock.style.transform = ''; mock.style.animation = ''; });
  }
});
