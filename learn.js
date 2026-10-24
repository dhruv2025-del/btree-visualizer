/**
 * learn.js: the two moving parts of the Learn page.
 *   1. The video. YouTube is only contacted when the person presses Play.
 *   2. "Watch a B-tree grow": a small animation drawn by the site itself (no internet needed).
 */
(function () {
  'use strict';
  const UI = window.BTreeUI;
  const $ = (id) => document.getElementById(id);

  // ---- 1. the video ----
  const VIDEO_ID = 'aZjYr87r1b8';
  const WATCH_URL = 'https://www.youtube.com/watch?v=' + VIDEO_ID;
  $('btnPlayVideo').addEventListener('click', () => {
    // A page opened straight from a folder (file://) cannot play YouTube inside itself, so open the video in a new tab.
    if (location.protocol === 'file:') { window.open(WATCH_URL, '_blank', 'noopener'); return; }
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + VIDEO_ID + '?autoplay=1&rel=0';
    f.title = 'B Trees and B+ Trees. How they are useful in Databases (video by Abdul Bari)';
    f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.loading = 'lazy';
    $('videoFrame').replaceChildren(f);
  });

  // ---- 2. the growing tree ----
  const KEYS = [10, 20, 30, 40, 50, 60, 70];
  const ORDER = 3;
  const STEP_MS = 1700, HOLD_MS = 3200;
  const fig = $('growFigure'), cap = $('growCaption');
  let step = 0, timer = null, playing = false;
  const trees = [];   // trees[i] = the tree after i keys, captions[i] = what happened
  const captions = [];
  (function precompute() {
    const e = new BTreeEngine(ORDER);
    e.setOrder(ORDER);
    trees.push(e.cloneTree());
    captions.push('An empty tree of order 3. A node may hold at most 2 keys.');
    KEYS.forEach((k) => {
      const s = e.frames.length;
      e.insert(k);
      const fr = e.frames.slice(s);
      const split = fr.some((f) => f.detail === 'split-overflow');
      const root = fr.some((f) => f.detail === 'root-split');
      let text = `Insert ${k}. `;
      if (!split) text += 'It goes to the end of the leaf, and the leaf has room.';
      else text += (root ? 'The leaf is too full, so it splits and the middle key moves up into a new root. The tree grows one level.' : 'The leaf is too full, so it splits and the middle key moves up into the parent.');
      trees.push(e.cloneTree());
      captions.push(text);
    });
  })();

  function show(i) {
    step = i;
    UI.drawFigure(fig, trees[i], { order: ORDER, minWidth: 300 });
    cap.textContent = captions[i];
  }
  function tick() {
    timer = null;
    if (!playing) return;
    // do nothing while the person is on another page or another tab
    if (document.hidden || document.body.dataset.tab !== 'tab-learn') { timer = setTimeout(tick, 600); return; }
    const next = step + 1;
    if (next > KEYS.length) { show(0); timer = setTimeout(tick, STEP_MS); return; }
    show(next);
    timer = setTimeout(tick, next === KEYS.length ? HOLD_MS : STEP_MS);
  }
  function setPlaying(on) {
    playing = on;
    $('btnGrowPlay').textContent = on ? 'Pause' : 'Play';
    clearTimeout(timer);
    timer = null;
    if (on) timer = setTimeout(tick, 400);
  }
  $('btnGrowPlay').addEventListener('click', () => setPlaying(!playing));
  $('btnGrowRestart').addEventListener('click', () => { show(0); setPlaying(true); });

  // The figure is redrawn by BTreeUI.redrawFigures() when the theme changes, so mark it as live.
  fig.classList.add('fig-live');
  if (UI.reducedMotion()) {
    // no movement for people who asked for none: show the finished tree and let them press Play
    show(KEYS.length);
    setPlaying(false);
  } else {
    show(0);
    setPlaying(true);
  }

  window.BTreeLearn = { videoId: VIDEO_ID, growSteps: KEYS.length, growCaptions: captions.slice() };
})();
