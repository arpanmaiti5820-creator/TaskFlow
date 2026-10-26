/* Login & Register logic + Google Identity Services */
(function () {
  if (Auth.token) { location.replace('/dashboard.html'); return; }

  const form = document.getElementById('authForm');
  const mode = form.dataset.mode;
  const err = document.getElementById('err');
  const btn = document.getElementById('submitBtn');

  function showError(msg) {
    err.textContent = msg; err.classList.remove('show'); void err.offsetWidth; err.classList.add('show');
  }
  function done(data) {
    Auth.save(data.token, data.user);
    toast('Welcome, ' + data.user.name.split(' ')[0] + '!');
    document.body.classList.add('page-out');
    setTimeout(() => (location.href = '/dashboard.html'), 450);
  }

  document.getElementById('eye').addEventListener('click', () => {
    const p = document.getElementById('password');
    p.type = p.type === 'password' ? 'text' : 'password';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.remove('show');
    const body = {
      email: form.email.value.trim(),
      password: form.password.value,
    };
    if (mode === 'register') body.name = form.name.value.trim();
    if (mode === 'register' && body.name.length < 2) return showError('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return showError('Please enter a valid email.');
    if (body.password.length < 6) return showError('Password must be at least 6 characters.');

    btn.classList.add('loading');
    try { done(await api('/auth/' + mode, { method: 'POST', body })); }
    catch (ex) { showError(ex.message); btn.classList.remove('loading'); }
  });

  /* ---- Google ---- */
  async function onGoogle(resp) {
    try { done(await api('/auth/google', { method: 'POST', body: { credential: resp.credential } })); }
    catch (ex) { showError(ex.message); }
  }
  const waitFor = (test, ms = 8000) => new Promise((res, rej) => {
    const t0 = Date.now();
    (function loop() { if (test()) return res(); if (Date.now() - t0 > ms) return rej(); setTimeout(loop, 100); })();
  });

  (async function initGoogle() {
    const box = document.getElementById('googleBtn');
    try {
      const { googleClientId } = await api('/config');
      if (!googleClientId) { box.innerHTML = '<p class="hint">Google sign-in is off. Add GOOGLE_CLIENT_ID to your .env file.</p>'; return; }
      await waitFor(() => window.google && google.accounts && google.accounts.id);
      google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogle, ux_mode: 'popup' });
      google.accounts.id.renderButton(box, {
        theme: 'filled_black', size: 'large', shape: 'pill', logo_alignment: 'left',
        text: mode === 'register' ? 'signup_with' : 'signin_with',
        width: Math.min(360, Math.max(240, box.clientWidth || 340)),
      });
    } catch {
      box.innerHTML = '<p class="hint">Could not load Google sign-in. Check your connection.</p>';
    }
  })();
})();
