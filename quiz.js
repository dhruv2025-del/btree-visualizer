/**
 * quiz.js: the QUIZ page.
 *
 * The person chooses how many questions (1 to 30) and a difficulty (Easy, Medium, Hard). The questions
 * are made by BTreePractice.generate() when the quiz starts: Easy uses the "beginner" makers, Medium the
 * "intermediate" ones and Hard the "gate" ones. They are shown one at a time. The person picks an answer
 * and submits it, and is told whether it was right, with the explanation, in both cases.
 *
 * When a quiz ends, its result is kept in BTreeQuiz.last so the Download page can put it in the report.
 */
(function () {
  'use strict';

  const UI = window.BTreeUI;
  const P = window.BTreePractice;
  const $ = (id) => document.getElementById(id);
  const { esc } = UI;

  const MIN_Q = 1, MAX_Q = 30;
  const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const LETTERS = ['A', 'B', 'C', 'D'];
  const MSG_RIGHT = 'Yes, you have correctly answered the question.';
  const MSG_WRONG = 'Yet to answer correctly.';

  const state = { level: 'medium', total: 0, items: [], i: 0, chosen: null, answered: false, running: false };

  const plain = (html) => String(html).replace(/<\/?(?:p|div|li|ol|ul|br|h[1-6]|table|tr|td|th)[^>]*>/gi, ' ').replace(/<sup>(.*?)<\/sup>/gi, '^$1').replace(/<sub>(.*?)<\/sub>/gi, '_$1').replace(/<[^>]*>/g, '').replace(/&minus;/g, '-').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&ldquo;|&rdquo;/g, '"').replace(/&rsquo;/g, "'").replace(/&middot;/g, '*')
    .replace(/&le;/g, '<=').replace(/&ge;/g, '>=').replace(/&emsp;/g, '  ').replace(/&times;/g, 'x').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();

  function show(which) {
    $('quizSetup').hidden = which !== 'setup';
    $('quizRun').hidden = which !== 'run';
    $('quizResult').hidden = which !== 'result';
  }

  function addFigure(parent, tree, order, label) {
    if (label) {
      const cap = document.createElement('p');
      cap.className = 'fig-label';
      cap.textContent = label;
      parent.appendChild(cap);
    }
    const box = document.createElement('div');
    box.className = 'q-figure fig-live';
    parent.appendChild(box);
    UI.drawFigure(box, tree, { order });
  }

  // ---- step 1: choose ----
  function readSetup() {
    const raw = $('quizCount').value.trim();
    if (raw === '') return { error: 'Type how many questions you want, a whole number from 1 to 30.' };
    if (!/^\d+$/.test(raw)) return { error: `"${raw}" is not a whole number. Type a whole number from 1 to 30.` };
    const n = parseInt(raw, 10);
    if (n < MIN_Q) return { error: 'The quiz needs at least 1 question.' };
    if (n > MAX_Q) return { error: `The most you can ask for is ${MAX_Q} questions.` };
    const level = (document.querySelector('input[name="quizLevel"]:checked') || {}).value;
    if (!LEVEL_LABEL[level]) return { error: 'Choose Easy, Medium or Hard.' };
    return { n, level };
  }
  function setupError(msg) {
    const e = $('quizSetupError');
    e.textContent = msg || '';
    e.hidden = !msg;
    $('quizCount').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  // n different questions of one level. Two questions count as the same when their wording, figure and answer match.
  function makeQuestions(level, n) {
    const out = [], seen = new Set();
    const sig = (q) => q.stem + '|' + (q.context || []).join('') + '|' + q.correct;
    for (let tries = 0; out.length < n && tries < n * 60; tries++) {
      const q = P.generate(P.LEVEL_FOR[level]);
      const k = sig(q);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
    while (out.length < n) out.push(P.generate(P.LEVEL_FOR[level]));      // the pool ran dry: repeats are better than a short quiz
    return out;
  }

  function startQuiz(level, n) {
    state.level = level;
    state.total = n;
    state.items = makeQuestions(level, n).map((q) => ({ q, picked: null, ok: null }));
    state.i = 0;
    state.running = true;
    show('run');
    showQuestion();
  }

  // ---- step 2: one question ----
  function showQuestion() {
    const it = state.items[state.i], q = it.q;
    state.chosen = null;
    state.answered = false;
    $('quizProgress').textContent = `Question ${state.i + 1} of ${state.total}`;
    $('quizLevelTag').textContent = LEVEL_LABEL[state.level];
    $('quizLiveScore').textContent = String(state.items.filter((x) => x.ok).length);
    $('quizBarFill').style.width = `${(state.i / state.total) * 100}%`;
    const h = $('quizQuestion');
    h.innerHTML = q.stem;
    const ctx = $('quizContext');
    ctx.innerHTML = (q.context || []).join('');
    if (q.tree) addFigure(ctx, q.tree, q.order);
    $('quizOptions').innerHTML = q.options.map((o, j) =>
      `<button type="button" class="option" role="radio" aria-checked="false" tabindex="${j === 0 ? 0 : -1}" data-i="${j}"><span class="letter">${LETTERS[j]}</span><span class="body">${o.html}</span></button>`).join('');
    $('quizHintText').innerHTML = q.hint || '';
    $('quizHintText').hidden = true;
    $('btnQuizHint').textContent = 'Show a hint';
    $('btnQuizHint').hidden = !q.hint;
    $('quizPickError').hidden = true;
    $('quizFeedback').hidden = true;
    $('quizNextRow').hidden = true;
    $('quizSubmitRow').hidden = false;
    $('btnQuizSubmit').disabled = false;
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: false });
  }

  function choose(j) {
    if (state.answered) return;
    state.chosen = j;
    $('quizPickError').hidden = true;
    $('quizOptions').querySelectorAll('.option').forEach((b, k) => {
      const on = k === j;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('is-picked', on);
      b.tabIndex = on ? 0 : -1;
    });
  }

  function submit() {
    if (state.answered) return;
    if (state.chosen === null) {
      $('quizPickError').hidden = false;
      return;
    }
    const it = state.items[state.i], q = it.q;
    const ok = state.chosen === q.answerIndex;
    it.picked = state.chosen;
    it.ok = ok;
    state.answered = true;
    $('quizLiveScore').textContent = String(state.items.filter((x) => x.ok).length);
    $('quizBarFill').style.width = `${((state.i + 1) / state.total) * 100}%`;

    $('quizOptions').querySelectorAll('.option').forEach((b, j) => {
      b.setAttribute('aria-disabled', 'true');
      b.classList.remove('is-picked');
      const body = b.querySelector('.body');
      if (j === q.answerIndex) { b.classList.add('is-correct'); body.insertAdjacentHTML('beforeend', '<span class="tag">Correct answer</span>'); }
      else if (j === state.chosen) { b.classList.add('is-wrong'); body.insertAdjacentHTML('beforeend', '<span class="tag">Your answer</span>'); }
    });

    const fb = $('quizFeedback');
    fb.dataset.kind = ok ? 'ok' : 'del';
    $('quizVerdict').textContent = ok ? MSG_RIGHT : MSG_WRONG;
    const body = $('quizExplain');
    body.innerHTML = `<p class="right-answer"><b>Correct answer: ${LETTERS[q.answerIndex]}.</b> ${q.options[q.answerIndex].html}</p>` + q.explain;
    if (q.afterTree) addFigure(body, q.afterTree, q.order, q.afterLabel || 'The tree afterwards:');
    fb.hidden = false;

    $('quizSubmitRow').hidden = true;
    $('quizNextRow').hidden = false;
    $('btnQuizTry').hidden = !q.scenario;
    const last = state.i === state.total - 1;
    $('btnQuizNext').textContent = last ? 'See my score' : 'Next question';
    $('btnQuizNext').focus();
  }

  function next() {
    if (!state.answered) return;
    if (state.i >= state.total - 1) { finish(false); return; }
    state.i++;
    showQuestion();
  }

  // ---- step 3: the result ----
  function verdictFor(pct) {
    if (pct >= 90) return 'Excellent. You know B-trees well.';
    if (pct >= 70) return 'Good work. Look again at the questions you missed, then try a harder level.';
    if (pct >= 50) return 'A fair start. Read the Learn page, try the same steps on the Visualizer, then take the quiz again.';
    return 'Keep going. The Learn page and the Visualizer show each rule step by step; try the Easy level again after them.';
  }

  function finish(stopped) {
    state.running = false;
    const done = state.items.filter((x) => x.ok !== null);
    const right = done.filter((x) => x.ok).length;
    const asked = done.length;
    const pct = asked ? Math.round((right / asked) * 100) : 0;
    window.BTreeQuiz.last = {
      level: LEVEL_LABEL[state.level], requested: state.total, answered: asked, correct: right, percent: pct, stopped: !!stopped,
      finishedAt: new Date(),
      items: done.map((x, n) => ({
        n: n + 1, question: plain(x.q.stem), yours: plain(x.q.options[x.picked].html), right: plain(x.q.options[x.q.answerIndex].html),
        ok: x.ok, explanation: plain(x.q.explain)
      }))
    };
    $('quizResultHeading').textContent = stopped ? `Quiz stopped after ${asked} of ${state.total}` : 'Quiz finished';
    $('quizFinalScore').textContent = `${right} / ${asked}`;
    $('quizFinalPercent').textContent = asked ? `${pct}% correct, ${LEVEL_LABEL[state.level]} level` : '';
    $('quizFinalVerdict').textContent = asked ? verdictFor(pct) : 'No question was answered, so there is no score.';
    $('quizSummaryBody').innerHTML = window.BTreeQuiz.last.items.map((r) =>
      `<tr><td>${r.n}</td><td>${esc(r.question.length > 140 ? r.question.slice(0, 137) + '...' : r.question)}</td><td>${esc(r.yours)}</td><td>${esc(r.right)}</td>` +
      `<td><span class="status ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'Correct' : 'Not yet'}</span></td></tr>`).join('') || '<tr><td colspan="5">Nothing answered.</td></tr>';
    show('result');
    const h = $('quizResultHeading');
    h.setAttribute('tabindex', '-1');
    h.focus();
    document.dispatchEvent(new CustomEvent('btree:quizdone'));
  }

  // ---- wiring ----
  $('quizSetup').addEventListener('submit', (e) => {
    e.preventDefault();
    const r = readSetup();
    if (r.error) { setupError(r.error); $('quizCount').focus(); return; }
    setupError('');
    startQuiz(r.level, r.n);
  });
  $('quizCount').addEventListener('input', () => setupError(''));

  $('quizOptions').addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('.option') : null;
    if (b) choose(Number(b.dataset.i));
  });
  $('quizOptions').addEventListener('keydown', (e) => {
    const opts = Array.from($('quizOptions').querySelectorAll('.option'));
    const cur = opts.indexOf(document.activeElement);
    if (cur < 0 || state.answered) return;
    let j = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (cur + 1) % opts.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (cur - 1 + opts.length) % opts.length;
    if (j === null) return;
    e.preventDefault();
    opts[j].focus();
    choose(j);
  });
  $('btnQuizSubmit').addEventListener('click', submit);
  $('btnQuizNext').addEventListener('click', next);
  $('btnQuizHint').addEventListener('click', () => {
    const p = $('quizHintText');
    p.hidden = !p.hidden;
    $('btnQuizHint').textContent = p.hidden ? 'Show a hint' : 'Hide the hint';
  });
  $('btnQuizTry').addEventListener('click', () => {
    const q = state.items[state.i] && state.items[state.i].q;
    if (q && q.scenario) UI.loadScenario(Object.assign({}, q.scenario));
  });
  $('btnQuizQuit').addEventListener('click', () => finish(true));
  $('btnQuizAgain').addEventListener('click', () => { setupError(''); show('setup'); $('quizCount').focus(); });
  $('btnQuizSame').addEventListener('click', () => startQuiz(state.level, state.total));

  // The letters A to D pick an answer while a quiz is running (not while typing in a box).
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'tab-quiz' || !state.running || state.answered) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const j = LETTERS.indexOf((e.key || '').toUpperCase());
    const n = state.items[state.i] ? state.items[state.i].q.options.length : 0;
    if (e.key && e.key.length === 1 && j >= 0 && j < n) {
      choose(j);
      const b = $('quizOptions').querySelectorAll('.option')[j];
      if (b) b.focus();
    }
  });

  window.BTreeQuiz = {
    last: null,
    // for the checks and for people who want to look: a quiz can be run without the page
    make: makeQuestions,
    messages: { right: MSG_RIGHT, wrong: MSG_WRONG },
    limits: { min: MIN_Q, max: MAX_Q }
  };
  show('setup');
})();
