/**
 * team.js: the Developed By page.
 *
 * The details come from site-data.js (window.SITE). Whatever a person enters in "Edit the team details"
 * is kept in this browser (localStorage) and shown straight away; "Download site-data.js" writes a new copy
 * of site-data.js so the details become part of the website folder.
 * Photographs are cropped to a square and shrunk so the file stays small.
 */
(function () {
  'use strict';
  const UI = window.BTreeUI;
  const $ = (id) => document.getElementById(id);
  const { esc } = UI;

  const BASE = window.SITE || { project: {}, team: [], guide: {} };
  const PHOTO_PX = 320;
  const MAX_STUDENTS = 8;

  function load() {
    let saved = null;
    try { saved = JSON.parse(UI.store.get('team') || 'null'); } catch (e) { saved = null; }
    const team = (saved && Array.isArray(saved.team) ? saved.team : BASE.team || []).map((s) => ({
      name: String(s.name || '').trim(), register: String(s.register || '').trim(), photo: String(s.photo || '')
    }));
    return team.length ? team : [{ name: '', register: '', photo: '' }];
  }
  let team = load();
  const guide = Object.assign({ name: 'Dr. Swaminathan A', role: 'Assistant Professor', photo: '' }, BASE.guide || {});
  (function () {
    let saved = null;
    try { saved = JSON.parse(UI.store.get('team') || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.guidePhoto === 'string') guide.photo = saved.guidePhoto;
  })();
  const project = Object.assign({ title: 'B-tree Visualizer', subject: 'Database Management Systems', institution: '' }, BASE.project || {});

  const initials = (name) => (name.match(/[A-Za-z]/g) ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?');
  const named = () => team.filter((s) => s.name || s.register);

  function renderCards() {
    const list = named();
    $('teamNotice').hidden = list.length > 0;
    $('teamGrid').innerHTML = (list.length ? list : []).map((s) =>
      `<li class="team-card">` +
      (s.photo
        ? `<img class="team-photo" src="${esc(s.photo)}" alt="Photograph of ${esc(s.name || 'the student')}" width="160" height="160">`
        : `<div class="team-photo placeholder" role="img" aria-label="No photograph added yet for ${esc(s.name || 'this student')}"><span>${esc(initials(s.name))}</span></div>`) +
      `<p class="team-name">${esc(s.name || 'Name not added')}</p>` +
      `<p class="team-reg"><span class="muted">Register number</span> <b>${esc(s.register || 'not added')}</b></p></li>`).join('');
    $('guidePhotoBox').innerHTML = guide.photo
      ? `<img class="team-photo guide-photo" src="${esc(guide.photo)}" alt="Photograph of ${esc(guide.name)}" width="160" height="160">`
      : '';
    $('guideThumbBox').innerHTML = guide.photo
      ? ` <img class="team-thumb" src="${esc(guide.photo)}" alt="Photograph chosen for the guide" width="48" height="48"> <button type="button" class="textbtn" id="btnGuideClear">Remove the photograph</button>`
      : '';
    $('guideName').textContent = guide.name;
    $('guideRole').textContent = guide.role;
    $('aboutTitle').textContent = project.title;
    $('aboutCourse').textContent = project.subject + (project.institution ? ', ' + project.institution : '');
  }

  // ---- the edit form ----
  function renderForm() {
    $('teamForm').innerHTML = team.map((s, i) =>
      `<fieldset class="team-row" data-i="${i}"><legend>Student ${i + 1}</legend>` +
      `<div class="field"><label for="tfName${i}">Full name</label><input type="text" id="tfName${i}" data-f="name" value="${esc(s.name)}" maxlength="60" autocomplete="off"></div>` +
      `<div class="field"><label for="tfReg${i}">Register number</label><input type="text" id="tfReg${i}" data-f="register" value="${esc(s.register)}" maxlength="30" autocomplete="off"></div>` +
      `<div class="field"><label for="tfPhoto${i}">Photograph</label><input type="file" id="tfPhoto${i}" data-f="photo" accept="image/*">` +
      (s.photo ? `<img class="team-thumb" src="${esc(s.photo)}" alt="Photograph chosen for student ${i + 1}" width="48" height="48"> <button type="button" class="textbtn" data-clear="${i}">Remove the photograph</button>` : '') +
      `</div>` +
      (team.length > 1 ? `<button type="button" class="textbtn" data-remove="${i}">Remove this student</button>` : '') +
      `</fieldset>`).join('');
  }
  function readText() {
    document.querySelectorAll('#teamForm .team-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('input[type="text"]').forEach((inp) => { team[i][inp.dataset.f] = inp.value.trim(); });
    });
  }
  function status(msg) { $('teamStatus').textContent = msg; }

  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) { reject(new Error('That file is not a picture.')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        const c = document.createElement('canvas');
        c.width = c.height = Math.min(PHOTO_PX, side);
        c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be read. Try a JPG or PNG file.')); };
      img.src = url;
    });
  }

  $('teamForm').addEventListener('change', (e) => {
    const inp = e.target;
    if (inp.type !== 'file' || !inp.files || !inp.files[0]) return;
    const i = Number(inp.closest('.team-row').dataset.i);
    readText();
    shrinkPhoto(inp.files[0]).then((data) => { team[i].photo = data; renderForm(); status('Photograph added. Press "Save in this browser" to keep it.'); })
      .catch((err) => status(err.message));
  });
  $('teamForm').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.clear !== undefined) { readText(); team[Number(t.dataset.clear)].photo = ''; renderForm(); }
    if (t.dataset && t.dataset.remove !== undefined) { readText(); team.splice(Number(t.dataset.remove), 1); renderForm(); }
  });
  $('guidePhotoInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    shrinkPhoto(f).then((data) => { guide.photo = data; renderCards(); status('Guide photograph added. Press "Save in this browser" to keep it.'); })
      .catch((err) => status(err.message));
  });
  $('guideRow').addEventListener('click', (e) => {
    if (e.target.id === 'btnGuideClear') { guide.photo = ''; $('guidePhotoInput').value = ''; renderCards(); }
  });
  $('btnTeamAdd').addEventListener('click', () => {
    readText();
    if (team.length >= MAX_STUDENTS) { status(`The page has room for ${MAX_STUDENTS} students.`); return; }
    team.push({ name: '', register: '', photo: '' });
    renderForm();
    const last = $('tfName' + (team.length - 1));
    if (last) last.focus();
  });
  $('btnTeamSave').addEventListener('click', () => {
    readText();
    const missing = team.map((s, i) => ((s.name || s.register) && !(s.name && s.register) ? i + 1 : 0)).filter(Boolean);
    if (missing.length) { status(`Student ${missing.join(', ')}: enter both the name and the register number.`); return; }
    const json = JSON.stringify({ team, guidePhoto: guide.photo });
    UI.store.set('team', json);
    if (!UI.store.get('team')) { status('This browser did not allow saving. Use "Download site-data.js" instead.'); }
    else status(`Saved ${named().length} student${named().length === 1 ? '' : 's'} in this browser.`);
    renderCards();
    document.dispatchEvent(new CustomEvent('btree:teamchanged'));
  });
  $('btnTeamReset').addEventListener('click', () => {
    try { localStorage.removeItem('btree.team'); } catch (e) { /* ignore */ }
    guide.photo = (BASE.guide && BASE.guide.photo) || '';
    team = (BASE.team && BASE.team.length ? BASE.team : [{ name: '', register: '', photo: '' }]).map((s) => Object.assign({ name: '', register: '', photo: '' }, s));
    renderForm();
    renderCards();
    status('What you entered here has been forgotten. The page shows the details in site-data.js again.');
    document.dispatchEvent(new CustomEvent('btree:teamchanged'));
  });
  function siteDataText() {
    readText();
    const data = { project, team: team.filter((s) => s.name || s.register), guide };
    if (!data.team.length) data.team = [{ name: '', register: '', photo: '' }];
    return '/**\n * site-data.js: who built the project. Replace the file with this name in the website folder.\n * name = full name, register = register number, photo = a data: address of the picture (or a file name such as "photos/anita.jpg").\n */\nwindow.SITE = ' +
      JSON.stringify(data, null, 2) + ';\n';
  }
  $('btnTeamDownload').addEventListener('click', () => {
    if (!team.some((s) => s.name || s.register) && !$('teamForm').querySelector('input[type="text"]').value) { status('Enter at least one student first.'); return; }
    const blob = new Blob([siteDataText()], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'site-data.js';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    status('site-data.js downloaded. Put it in the website folder in place of the old one.');
  });

  renderCards();
  renderForm();
  window.BTreeTeam = {
    get() { return { project: Object.assign({}, project), team: named().map((s) => ({ name: s.name, register: s.register })), guide: Object.assign({}, guide) }; },
    rendered: () => document.querySelectorAll('#teamGrid .team-card').length
  };
})();
