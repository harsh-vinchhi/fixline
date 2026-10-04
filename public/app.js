/* ==========================================================================
   Fixline front end: one script shared by every page.
   --------------------------------------------------------------------------
   Each HTML page has <body data-page="report"> (or "track", "staff" ...).
   This file reads that name (P) and runs ONLY the code for that page.

   Sections:
     1. Small helpers and constants
     2. Talking to the server (api)
     3. Who is logged in? (nav bar, footer, page guard)
     4. Shared issue card
     5. One section per page: login, home, report, track, staff, manager
   ========================================================================== */

/* ---------- 1. Helpers and constants ---------- */
const $ = id => document.getElementById(id);              // short for getElementById
const P = document.body.dataset.page;                      // which page are we on?
const ST = ['New', 'Acknowledged', 'Assigned', 'In progress', 'Resolved'];       // status steps
const LOC = ['Block A', 'Block B', 'Block C', 'Lift / lobby', 'Parking', 'Garden / clubhouse', 'Other'];
const CAT = ['Plumbing / leak', 'Electrical', 'Lift', 'Security', 'Cleaning', 'Other'];
const PRI = { urgent: ['Urgent', 4], normal: ['Normal', 24], low: ['Low', 72] };  // [label, hours to acknowledge]
// Escape text before putting it into HTML, so nobody can inject scripts through a title.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const opts = a => a.map(x => `<option>${x}</option>`).join('');
const fmt = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// An issue is overdue if nobody acknowledged it in time, or its expected fix date has passed.
const late = t => t.status !== 'Resolved' && ((t.status === 'New' && Date.now() > t.t + PRI[t.pri][1] * 36e5) || (t.eta && Date.now() > new Date(t.eta).getTime() + 864e5));
const HOME = { resident: 'track.html', staff: 'staff.html', manager: 'manager.html' };   // where each role lands after login

/* ---------- 2. Talking to the server ---------- */
// api('/tickets') GETs; api('/tickets', {method:'POST', body:{...}}) sends JSON.
// On an error status it throws an Error whose message is the server's explanation.
async function api(url, o = {}) {
  let r;
  try {
    r = await fetch('/api' + url, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined, credentials: 'same-origin' });
  } catch (e) {
    throw new Error('Cannot reach the Fixline server. Start it with "npm start" and open http://localhost:3000');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
  return j;
}
const fail = e => alert(e.message || 'Something went wrong');

// Opening the .html files by double-clicking uses file:// and there is no server behind it.
if (location.protocol === 'file:') {
  document.body.insertAdjacentHTML('afterbegin', '<div class="banner" role="alert"><b>This page was opened as a file, so it cannot reach the server.</b> In a terminal run <code>npm install</code> then <code>npm start</code>, and open <a href="http://localhost:3000">http://localhost:3000</a> in your browser.</div>');
}

/* ---------- 3. Who is logged in? Nav bar, footer, page guard ---------- */
const ME = api('/me').then(r => r.user).catch(() => null);   // a promise; many parts await it

const LINKS = {   // the menu changes with the role
  guest: [['index', 'Home'], ['about', 'The problem'], ['how', 'How it works'], ['process', 'Design process']],
  resident: [['index', 'Home'], ['report', 'Report an issue'], ['track', 'My issues'], ['how', 'How it works']],
  staff: [['index', 'Home'], ['staff', 'My jobs'], ['how', 'How it works']],
  manager: [['index', 'Home'], ['manager', 'Dashboard'], ['how', 'How it works'], ['process', 'Design process']],
};
function renderNav(user) {
  const links = LINKS[user ? user.role : 'guest'].map(([h, l]) => `<a href="${h}.html"${h === P ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  const acct = user
    ? `<span class="who"><span class="avatar" aria-hidden="true">${esc(user.name[0].toUpperCase())}</span><span><b>${esc(user.name)}</b><small class="role ${user.role}">${user.role}</small></span></span><button class="btn ghost sm" id="logout" type="button">Log out</button>`
    : `<a class="btn ghost sm" href="login.html">Log in</a><a class="btn sm" href="login.html?tab=register">Register</a>`;
  $('nav').innerHTML = `<div class="wrap bar"><a class="brand" href="index.html"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1A3F91"/><path d="M9 22l8-8m0 0a4 4 0 105-5l-3 3-2-2 3-3a4 4 0 00-5 5z" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Fixline</a>
<button class="burger" id="burger" type="button" aria-expanded="false" aria-controls="menu">Menu</button>
<div class="menu" id="menu"><nav class="links" aria-label="Main">${links}</nav><div class="acct">${acct}</div></div></div>`;
  $('burger').onclick = () => { const m = $('menu').classList.toggle('open'); $('burger').setAttribute('aria-expanded', m); };
  if ($('logout')) $('logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.href = 'index.html'; };
}
$('nav').innerHTML = '<div class="wrap bar"><a class="brand" href="index.html">Fixline</a></div>';   // shown for a split second
ME.then(renderNav);

$('foot').innerHTML = '<div class="grid"><div><h3>Fixline</h3><p>One place to report, track and fix apartment maintenance issues.</p></div><div><h3>Residents</h3><a href="login.html?tab=register">Create an account</a><br><a href="report.html">Report an issue</a><br><a href="how.html">Help and FAQ</a></div><div><h3>Team</h3><a href="login.html">Staff and manager login</a></div><div><h3>Project</h3><a href="about.html">The problem</a><br><a href="process.html">Design process</a></div></div><div class="foot-bottom"><span>Prototype for a design thinking assignment.</span><span>Made for <span class="edit">[course]</span> by <span class="edit">[your names]</span></span></div>';

// Page guard. Pages with a private area contain <div id="auth"></div><div id="app" hidden>...</div>.
// gate(['resident'], start): not logged in -> go to login. Wrong role -> explain. OK -> reveal #app and run start().
async function gate(roles, start) {
  const user = await ME;
  if (!user) { location.replace('login.html?next=' + P + '.html'); return; }
  if (!roles.includes(user.role)) {
    $('auth').innerHTML = `<div class="box warn"><h2>This page is for ${roles.join(' / ')} accounts</h2><p>You are signed in as <b>${user.role}</b>. Your own page is here:</p><a class="btn" href="${HOME[user.role]}">Go to my page</a></div>`;
    return;
  }
  $('app').hidden = false;
  start(user);
}

/* ---------- 4. The issue card (used on Track; staff and manager have their own layouts) ---------- */
function card(t) {
  const i = ST.indexOf(t.status);
  const rate = t.status !== 'Resolved' || !t.mine ? '' : t.rate
    ? `<p><b>Your rating:</b> ${t.rate} of 5</p>`
    : `<p><label for="r${t.id}">Was it fixed properly? Rate it</label><select id="r${t.id}" style="max-width:200px"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select> <button class="btn sm rt" data-id="${t.id}" type="button">Save rating</button></p>`;
  const join = !t.mine && t.status !== 'Resolved' ? `<p class="joinbox"><button class="btn sm jn" data-id="${t.id}" type="button">+ I have this problem too</button> <small>Follow this issue to get its updates. No need to report it again.</small></p>` : '';
  return `<article class="card"><h3>#${t.id} ${esc(t.title)}${t.mine ? ' <span class="badge">✓ Following</span>' : ''}</h3>
<p class="meta">${esc(t.loc)} · ${t.cat} · <span class="pri ${t.pri}">${PRI[t.pri][0]}</span> · ${t.n} reported${late(t) ? ' <b class="late">Overdue</b>' : ''}</p>
${join}
<ol class="stepper">${ST.map((s, j) => `<li class="${j < i || t.status === 'Resolved' ? 'done' : j === i ? 'now' : ''}">${s}</li>`).join('')}</ol>
${t.img ? `<img class="ph" src="${t.img}" alt="Photo of the problem">` : ''}
<p><b>Owner:</b> ${t.owner ? esc(t.owner) : 'Not assigned yet'}<br><b>Expected fix:</b> ${t.eta || 'Not set yet. Acknowledgement due within ' + PRI[t.pri][1] + ' hours of reporting'}</p>
${rate}<details><summary>History</summary><ul>${t.hist.map(h => `<li>${esc(h[0])}, ${fmt(h[1])}</li>`).join('')}</ul></details></article>`;
}

/* ---------- 5. Pages ---------- */

/* ===== LOGIN / REGISTER ===== */
if (P === 'login') {
  const params = new URLSearchParams(location.search);
  const next = /^[a-z]+\.html$/.test(params.get('next') || '') ? params.get('next') : '';
  const show = tab => {   // switch between the two forms
    $('lf').hidden = tab !== 'login'; $('rf').hidden = tab !== 'register';
    $('tl').setAttribute('aria-pressed', tab === 'login'); $('tr').setAttribute('aria-pressed', tab === 'register');
    $('msg').hidden = true;
  };
  $('tl').onclick = () => show('login'); $('tr').onclick = () => show('register');
  show(params.get('tab') === 'register' ? 'register' : 'login');
  const submit = (form, url, body) => form.onsubmit = async e => {
    e.preventDefault(); $('msg').hidden = true;
    try {
      const { user } = await api(url, { method: 'POST', body: body() });
      // after login go to the page asked for, else to the role's own page
      location.href = next && (user.role === 'resident' ? ['report.html', 'track.html'] : [HOME[user.role]]).includes(next) ? next : HOME[user.role];
    } catch (x) { $('msg').hidden = false; $('msg').textContent = x.message; }
  };
  submit($('lf'), '/login', () => ({ email: $('le').value, password: $('lp').value }));
  submit($('rf'), '/register', () => ({ name: $('rn').value, email: $('re').value, flat: $('rfl').value, password: $('rp').value }));
  ME.then(u => { if (u) location.replace(HOME[u.role]); });   // already signed in? skip this page
  api('/config').then(c => { if (c.demo) $('demo').hidden = false; }).catch(() => {});   // show demo accounts when enabled
}

/* ===== HOME ===== */
if (P === 'index') {
  api('/stats').then(s => { $('s1').textContent = s.open; $('s2').textContent = s.resolved; $('s3').textContent = s.owned + ' of ' + s.open; }).catch(() => {});
  ME.then(u => {   // the big buttons depend on who is looking
    const b = !u ? '<a class="btn" href="login.html?tab=register">Create a resident account</a> <a class="btn ghost" href="login.html">Log in</a>'
      : u.role === 'resident' ? '<a class="btn" href="report.html">Report an issue</a> <a class="btn ghost" href="track.html">My issues</a>'
      : u.role === 'staff' ? '<a class="btn" href="staff.html">Open my jobs</a>'
      : '<a class="btn" href="manager.html">Open the dashboard</a>';
    $('heroCta').innerHTML = b;
    $('endCta').innerHTML = u ? b.replace('btn ghost', 'btn ghost light') : '<a class="btn" href="login.html?tab=register">Start with a resident account</a>';
  });
}

/* ===== REPORT (residents) ===== */
if (P === 'report') gate(['resident'], () => {
  $('loc').innerHTML = opts(LOC); $('cat').innerHTML = opts(CAT);
  // Shrink the chosen photo to 480px wide JPEG so it stays small in the database.
  const img = () => new Promise(r => {
    const f = $('photo').files[0]; if (!f) return r('');
    const im = new Image;
    im.onload = () => { const k = Math.min(1, 480 / im.width), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); r(c.toDataURL('image/jpeg', .6)); };
    im.onerror = () => r(''); im.src = URL.createObjectURL(f);
  });
  const done = t => {
    $('f').hidden = true; $('dup').hidden = true; $('ok').hidden = false;
    $('ok').innerHTML = `<p><b>Reported. Your issue number is #${t.id}.</b></p><p>Acknowledgement is due within ${PRI[t.pri][1]} hours. You can follow progress under My issues.</p><a class="btn" href="track.html">Go to My issues</a>`;
  };
  const create = async () => {
    try { done(await api('/tickets', { method: 'POST', body: { title: $('title').value.trim(), loc: $('loc').value, cat: $('cat').value, pri: document.querySelector('[name=pri]:checked').value, img: await img() } })); }
    catch (e) { fail(e); }
  };
  $('f').onsubmit = async e => {
    e.preventDefault(); if (!$('title').value.trim()) return;
    let all; try { all = await api('/tickets'); } catch (x) { return fail(x); }
    // Duplicate check: same place + same kind of problem, still open, and not already mine.
    const dup = all.find(t => t.loc === $('loc').value && t.cat === $('cat').value && t.status !== 'Resolved' && !t.mine);
    if (!dup) return create();
    $('dup').hidden = false;
    $('dup').innerHTML = `<p><b>This may already be reported:</b> #${dup.id} ${esc(dup.title)} (${dup.status}).</p><button class="btn" id="join" type="button">Add me to #${dup.id}</button> <button class="btn ghost" id="sep" type="button">It is a different problem</button>`;
    $('join').onclick = async () => { try { done(await api('/tickets/' + dup.id + '/join', { method: 'POST' })); } catch (x) { fail(x); } };
    $('sep').onclick = create;
  };
});

/* ===== TRACK / MY ISSUES (residents) ===== */
if (P === 'track') gate(['resident'], () => {
  let show = 'mine-open', q = '';
  const draw = async () => {
    let d; try { d = await api('/tickets'); } catch (e) { $('list').innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const open = t => t.status !== 'Resolved';
    d = d.filter(t => show === 'mine-open' ? t.mine && open(t) : show === 'mine-done' ? t.mine && !open(t) : open(t));
    if (q) d = d.filter(t => String(t.id) === q);
    $('list').innerHTML = d.length ? d.sort((a, b) => b.t - a.t).map(card).join('') : '<p>No issues found here. <a href="report.html">Report one</a>.</p>';
  };
  document.querySelectorAll('.chips button').forEach(b => b.onclick = () => {
    show = b.dataset.k; document.querySelectorAll('.chips button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  });
  $('q').oninput = () => { q = $('q').value.replace('#', '').trim(); draw(); };
  // One click handler for all buttons inside the list ("event delegation")
  $('list').onclick = async e => {
    const id = e.target.dataset.id;
    try {
      if (e.target.classList.contains('rt')) await api(`/tickets/${id}/rate`, { method: 'POST', body: { rate: +$('r' + id).value } });
      else if (e.target.classList.contains('jn')) await api(`/tickets/${id}/join`, { method: 'POST' });
      else return;
      draw();
    } catch (x) { fail(x); }
  };
  draw();
});

/* ===== STAFF: my jobs ===== */
if (P === 'staff') gate(['staff'], user => {
  $('hello').textContent = 'Hello, ' + user.name;
  const draw = async () => {
    const d = (await api('/tickets')).filter(t => t.status !== 'Resolved').sort((a, b) => PRI[a.pri][1] - PRI[b.pri][1]);   // server only sends MY jobs
    $('jobs').innerHTML = d.length ? d.map(t => `<div class="card"><h3>#${t.id} ${esc(t.title)}</h3>
<p class="meta">${esc(t.loc)} · ${t.cat} · <span class="pri ${t.pri}">${PRI[t.pri][0]}</span> priority${late(t) ? ' <b class="late">Overdue</b>' : ''}</p>
${t.img ? `<img class="ph" src="${t.img}" alt="Photo of the problem">` : ''}
<p>Status: <b>${t.status}</b>. Expected fix: ${t.eta || 'no date set'}<br>Reported by: ${esc(t.reporter)}${t.reporter_flat ? ' (flat ' + esc(t.reporter_flat) + ')' : ''}, ${t.n} resident(s) affected</p>
<button class="btn sm act" data-id="${t.id}" data-s="In progress" type="button">Start work</button> <button class="btn sm act" data-id="${t.id}" data-s="Resolved" type="button">Mark resolved</button></div>`).join('') : '<p>No open jobs. Enjoy the quiet.</p>';
  };
  $('jobs').onclick = async e => {
    if (!e.target.classList.contains('act')) return;
    try { await api(`/tickets/${e.target.dataset.id}/status`, { method: 'POST', body: { status: e.target.dataset.s } }); draw(); } catch (x) { fail(x); }
  };
  draw();
});

/* ===== MANAGER: dashboard ===== */
if (P === 'manager') gate(['manager'], () => {
  // two tabs: issues / staff accounts
  const tab = k => { $('issues').hidden = k !== 'issues'; $('staffTab').hidden = k !== 'staff'; $('t1').setAttribute('aria-pressed', k === 'issues'); $('t2').setAttribute('aria-pressed', k === 'staff'); };
  $('t1').onclick = () => tab('issues'); $('t2').onclick = () => tab('staff');

  let staff = [];
  const drawIssues = async () => {
    const d = await api('/tickets'), open = d.filter(t => t.status !== 'Resolved'), rated = d.filter(t => t.rate), c = {};
    d.forEach(t => { const k = t.loc + ' / ' + t.cat; c[k] = (c[k] || 0) + 1; });
    const rec = Object.entries(c).filter(e => e[1] > 1);   // same place + kind more than once = recurring
    $('stats').innerHTML = `<div><b>${open.length}</b>open</div><div><b>${open.filter(late).length}</b>overdue</div><div><b>${open.filter(t => !t.owner_id).length}</b>no owner</div><div><b>${d.length - open.length}</b>resolved</div><div><b>${rated.length ? (rated.reduce((a, t) => a + t.rate, 0) / rated.length).toFixed(1) : '-'}</b>avg rating</div>`;
    $('rec').innerHTML = rec.length ? '<b>Recurring problems:</b> ' + rec.map(e => esc(e[0]) + ' (' + e[1] + ' times)').join(', ') : 'No recurring problems yet.';
    const ownerOpts = id => '<option value="">Unassigned</option>' + staff.map(s => `<option value="${s.id}"${s.id === id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    $('rows').innerHTML = d.sort((a, b) => (a.status === 'Resolved') - (b.status === 'Resolved') || PRI[a.pri][1] - PRI[b.pri][1]).map(t => `<tr data-id="${t.id}">
<td><b>#${t.id}</b> ${esc(t.title)}<br><small>${esc(t.loc)} · ${t.cat} · <span class="pri ${t.pri}">${PRI[t.pri][0]}</span> · ${t.n} reported${late(t) ? ' <b class="late">Overdue</b>' : ''}<br>By ${esc(t.reporter || 'unknown')}${t.reporter_flat ? ', flat ' + esc(t.reporter_flat) : ''}</small></td>
<td><select class="st" aria-label="Status">${ST.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
<td><select class="own" aria-label="Owner">${ownerOpts(t.owner_id)}</select></td>
<td><input type="date" class="eta" aria-label="Expected fix date" value="${t.eta}"></td><td><button class="btn sm sv" type="button">Save</button></td></tr>`).join('');
  };
  const drawStaff = async () => {
    staff = await api('/staff');
    $('staffRows').innerHTML = staff.length ? staff.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td><button class="btn ghost sm rm" data-id="${s.id}" type="button">Remove</button></td></tr>`).join('') : '<tr><td colspan="3">No staff yet. Add one above.</td></tr>';
  };
  $('rows').onclick = async e => {
    if (!e.target.classList.contains('sv')) return;
    const tr = e.target.closest('tr');
    try {
      await api('/tickets/' + tr.dataset.id, { method: 'PATCH', body: { status: tr.querySelector('.st').value, owner_id: tr.querySelector('.own').value || null, eta: tr.querySelector('.eta').value } });
      drawIssues();
    } catch (x) { fail(x); }
  };
  $('sf').onsubmit = async e => {
    e.preventDefault(); $('sm').hidden = true;
    try {
      await api('/staff', { method: 'POST', body: { name: $('sn').value, email: $('se').value, password: $('sp').value } });
      $('sf').reset(); await drawStaff(); drawIssues();
    } catch (x) { $('sm').hidden = false; $('sm').textContent = x.message; }
  };
  $('staffRows').onclick = async e => {
    if (!e.target.classList.contains('rm') || !confirm('Remove this staff account? Their jobs become unassigned.')) return;
    try { await api('/staff/' + e.target.dataset.id, { method: 'DELETE' }); await drawStaff(); drawIssues(); } catch (x) { fail(x); }
  };
  $('reset').onclick = async () => {
    if (!confirm('Delete all issues and restore the demo issues?')) return;
    try { await api('/reset', { method: 'POST' }); await drawStaff(); drawIssues(); } catch (x) { fail(x); }
  };
  drawStaff().then(drawIssues).catch(fail);
});
