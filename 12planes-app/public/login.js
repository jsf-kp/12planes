(function () {
  const $ = id => document.getElementById(id);
  let email = '';
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
    return j;
  }
  $('f1').addEventListener('submit', async e => {
    e.preventDefault(); $('msg').textContent = ''; $('b1').disabled = true;
    email = $('email').value.trim();
    try {
      await post('/auth/request', { email });
      $('f1').hidden = true; $('f2').hidden = false;
      $('title').textContent = 'Check your inbox';
      $('lead').textContent = 'If ' + email + ' has access, a code is on its way. It works for 10 minutes.';
      $('code').focus();
    } catch (x) { $('msg').textContent = x.message; } finally { $('b1').disabled = false; }
  });
  $('f2').addEventListener('submit', async e => {
    e.preventDefault(); $('msg').textContent = ''; $('b2').disabled = true;
    try { await post('/auth/verify', { email, code: $('code').value }); location.href = '/'; }
    catch (x) { $('msg').textContent = x.message; $('b2').disabled = false; }
  });
  $('back').addEventListener('click', () => { $('f2').hidden = true; $('f1').hidden = false; $('title').textContent = 'Enter your email'; $('lead').textContent = 'We send a six-digit code to your inbox. Only people the team has invited can sign in.'; $('msg').textContent = ''; });
})();
