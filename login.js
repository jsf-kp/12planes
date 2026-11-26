(function () {
  const $ = id => document.getElementById(id);
  try { const n = localStorage.getItem('kp12-name'); if (n) $('name').value = n; } catch (_) {}
  $('f').addEventListener('submit', async e => {
    e.preventDefault(); $('msg').textContent = ''; $('go').disabled = true;
    const name = $('name').value.trim();
    try {
      const r = await fetch('/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password: $('pw').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
      try { localStorage.setItem('kp12-name', name); } catch (_) {}
      location.href = '/';
    } catch (x) { $('msg').textContent = x.message; $('go').disabled = false; $('pw').value = ''; $('pw').focus(); }
  });
})();
