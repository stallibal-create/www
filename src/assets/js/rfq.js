// 3-step RFQ form: per-step validation, review, real submission (no fake success, no duplicate on retry).
const form = document.getElementById('rfq');
if (form) {
  const T = JSON.parse(document.getElementById('rfq-i18n').textContent);
  const steps = [...form.querySelectorAll('fieldset.step')];
  const marks = [...form.querySelectorAll('.steps li')];
  const btnBack = form.querySelector('[data-action="back"]');
  const btnNext = form.querySelector('[data-action="next"]');
  const btnSubmit = form.querySelector('[data-action="submit"]');
  const status = form.querySelector('.step-status');
  const summary = form.querySelector('.err-summary');
  const result = document.getElementById('rfq-result');
  const files = form.querySelector('#f-files');
  const ALLOWED = ['pdf', 'dwg', 'dxf'];
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : ''));
  let cur = 0;

  // prefill from ?product=slug
  const prod = new URLSearchParams(location.search).get('product');
  if (prod && T.products[prod]) {
    form.querySelector('#f-category').value = prod;
    const ta = form.querySelector('#f-req');
    if (!ta.value) ta.value = fmt(T.productPrefill, { p: T.products[prod] }) + '\n';
  }

  function show(i, focus = true) {
    cur = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    marks.forEach((m, k) => m.classList.toggle('on', k <= i));
    btnBack.hidden = i === 0;
    btnNext.hidden = i === steps.length - 1;
    btnSubmit.hidden = i !== steps.length - 1;
    status.textContent = fmt(T.stepOf, { n: i + 1 }) + ' — ' + T.steps[i];
    if (i === 2) buildReview();
    if (focus) { const lg = steps[i].querySelector('legend'); lg.setAttribute('tabindex', '-1'); lg.focus(); }
  }

  function setErr(input, msg) {
    const e = document.getElementById('e-' + input.id.replace(/^f-/, ''));
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (e) e.textContent = msg || '';
  }

  function fileErrors() {
    const list = files ? [...(files.files || [])] : [];
    if (list.length > T.maxFiles) return fmt(T.errFileCount, { max: T.maxFiles });
    for (const f of list) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED.includes(ext)) return fmt(T.errFileType, { f: f.name });
      if (f.size > T.maxFileMB * 1024 * 1024) return fmt(T.errFileSize, { f: f.name, mb: T.maxFileMB });
    }
    return '';
  }

  function validate(i, focus = true) {
    let first = null; const bad = [];
    const fs = steps[i];
    for (const el of fs.querySelectorAll('[required]')) {
      let msg = '';
      if (el.type === 'checkbox') msg = el.checked ? '' : T.errConsent;
      else if (!el.value.trim()) msg = T.errRequired;
      else if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim())) msg = T.errEmail;
      setErr(el, msg);
      if (msg) { bad.push([el, msg]); if (!first) first = el; }
    }
    if (files && fs.contains(files)) { const m = fileErrors(); setErr(files, m); if (m) { bad.push([files, m]); if (!first) first = files; } }
    summary.replaceChildren();
    summary.hidden = !first;
    if (first) {
      const p = document.createElement('p'); p.textContent = T.errSummary; summary.append(p);
      const ul = document.createElement('ul');
      for (const [el, msg] of bad) {
        const label = form.querySelector(`label[for="${el.id}"]`);
        const a = document.createElement('a'); a.href = '#' + el.id;
        a.textContent = `${(label ? label.textContent : el.name).replace('*', '').trim()} — ${msg}`;
        a.addEventListener('click', e => { e.preventDefault(); el.focus(); });
        const li = document.createElement('li'); li.append(a); ul.append(li);
      }
      summary.append(ul);
      // one error: go straight to the field; several: focus the linked summary
      if (focus) (bad.length > 1 ? summary : first).focus();
    }
    return !first;
  }

  // live-clear errors
  form.addEventListener('input', e => { if (e.target.getAttribute('aria-invalid') === 'true') setErr(e.target, ''); });
  if (files) files.addEventListener('change', () => setErr(files, fileErrors())); // no field when attachments are off (drawings by e-mail)

  function buildReview() {
    const d = new FormData(form);
    const cat = form.querySelector('#f-category');
    const tl = form.querySelector('#f-timeline');
    const rows = [
      [T.name, d.get('name'), 0], [T.company, d.get('company'), 0], [T.email, d.get('email'), 0], [T.phone, d.get('phone'), 0], [T.country, d.get('country'), 0],
      [T.category, cat.value ? cat.options[cat.selectedIndex].text : '', 1], [T.timeline, tl.options[tl.selectedIndex].text, 1],
      [T.material, d.get('material'), 1], [T.quantity, d.get('quantity'), 1], [T.requirements, d.get('requirements'), 1],
      ...(files ? [[T.files.split('(')[0].trim(), [...files.files].map(f => `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`).join('\n') || T.noFiles, 1]] : []),
    ];
    const dl = document.getElementById('rfq-review');
    dl.replaceChildren();
    rows.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = (v && String(v).trim()) || T.none;
      dl.append(dt, dd);
    });
    [0, 1].forEach(s => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn edit-btn';
      b.textContent = `${T.edit} — ${T.steps[s]}`; b.addEventListener('click', () => show(s));
      const dd = document.createElement('dd'); dd.className = 'edit'; dd.append(b); dl.append(dd);
    });
  }

  btnNext.addEventListener('click', () => { if (validate(cur)) show(cur + 1); });
  btnBack.addEventListener('click', () => show(cur - 1));
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && cur < 2) { e.preventDefault(); btnNext.click(); }
  });

  function showResult(ok, title, text) {
    result.className = 'result ' + (ok ? 'ok' : 'fail');
    result.setAttribute('role', ok ? 'status' : 'alert');
    result.replaceChildren();
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = text;
    result.append(h, p); result.hidden = false; result.focus();
  }

  // One id per quote: a retry (network error, notification failure) is recognised and never duplicated.
  const newSid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
  let sid = newSid();
  const post = async (url, body, json) => {
    try {
      const res = await fetch(url, { method: 'POST', body: json ? JSON.stringify(body) : body, credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) } });
      return { res, body: await res.json().catch(() => ({})) };
    } catch { return { res: null, body: {} }; }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Drawings go straight to private storage with short-lived upload links; the server checks them afterwards.
  // A server without /start (self-hosted server.mjs) answers 404/405: the whole form is then posted as before.
  async function sendWithFiles(list, d) {
    const fields = Object.fromEntries([...d].filter(([k, v]) => typeof v === 'string' && !['lang', 'sid', 'cf-turnstile-response'].includes(k)));
    const st = await post(form.action + '/start', { lang: d.get('lang'), sid, fields, turnstile: d.get('cf-turnstile-response') || '',
      files: list.map(f => ({ name: f.name, size: f.size })) }, true);
    if (st.res && (st.res.status === 404 || st.res.status === 405)) return post(form.action, d);
    if (!st.res || !st.res.ok || !st.body.ok) return st;
    if (st.body.done) return st;
    for (const [i, u] of st.body.uploads.entries()) {
      btnSubmit.textContent = fmt(T.uploading, { n: i + 1, total: list.length });
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try { ok = (await fetch(u.url, { method: 'PUT', body: list[i], headers: u.headers })).ok; } catch { ok = false; }
      }
      if (!ok) return { res: null, body: { error: 'upload_failed' } };
    }
    btnSubmit.textContent = T.sending;
    let fin;
    for (let attempt = 0; attempt < 4; attempt++) {
      fin = await post(form.action + '/finish', { ref: st.body.ref, token: st.body.token }, true);
      if (!(fin.res && fin.res.status === 409 && fin.body.error === 'in_progress')) break;
      await wait(1500);
    }
    return fin;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (cur !== 2) { if (validate(cur)) show(cur + 1); return; }
    for (let i = 0; i < 3; i++) if (!validate(i, false)) { show(i, false); validate(i); return; }
    result.hidden = true;
    btnSubmit.disabled = true; btnBack.disabled = true;
    const label = btnSubmit.textContent; btnSubmit.textContent = T.sending;
    const d = new FormData(form); d.set('sid', sid);
    const list = files ? [...(files.files || [])] : [];
    if (!list.length) d.delete('files');
    const { res, body } = list.length ? await sendWithFiles(list, d) : await post(form.action, d);
    btnSubmit.disabled = false; btnBack.disabled = false; btnSubmit.textContent = label;

    if (res && res.ok && body.ok && body.ref) {
      showResult(true, T.okTitle, fmt(T.ok, { ref: body.ref }));
      form.reset(); sid = newSid(); steps.forEach(s => s.classList.remove('is-active'));
      form.querySelector('.form-nav').hidden = true; form.querySelector('.steps').hidden = true;
      return;
    }
    const code = body && body.error;
    const msg = code === 'not_configured' ? T.failNotConfigured
      : code === 'rate_limited' ? T.failRate
      : code === 'captcha' ? T.failCaptcha
      : code === 'invalid' ? T.failInvalid
      : code === 'uploads_unavailable' ? T.failUploadsOff
      : code === 'upload_failed' || code === 'upload_incomplete' ? T.failUpload
      : code === 'notify_failed' && body.ref ? fmt(T.failNotify, { ref: body.ref })
      : T.failGeneric;
    if (code === 'invalid' && (body.fields || []).includes('files')) sid = newSid(); // refused drawings: the next try is a new quote
    showResult(false, T.failTitle, msg);
    if (window.turnstile) try { window.turnstile.reset(); } catch { /* ignore */ }
  });

  // Turnstile, explicit mode: render when its script is ready; on failure say so instead of throwing
  const slot = form.querySelector('.ts-slot');
  if (slot) {
    const tsErr = form.querySelector('.ts-error');
    const fail = () => { tsErr.hidden = false; return true; }; // true: handled, Turnstile does not throw
    let tries = 0;
    const tick = setInterval(() => {
      if (window.turnstile) {
        clearInterval(tick);
        try {
          window.turnstile.render(slot, { sitekey: slot.dataset.sitekey, language: slot.dataset.language, theme: 'auto',
            'error-callback': fail, 'callback': () => { tsErr.hidden = true; } });
        } catch { fail(); }
      } else if (++tries > 75) { clearInterval(tick); fail(); } // 15 s: script blocked or offline
    }, 200);
  }

  show(0, false);
}
