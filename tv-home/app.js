/* =========================================================
   TV Home — app.js
   1. Content      — the apps, shows and movies (all made up)
   2. Drawing      — turns that content into tiles on screen
   3. Focus        — remembers which tile is "selected"
   4. Remote keys  — arrow keys, Enter and Back
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. Content ---------- */

  // Colour sets used to paint placeholder "artwork" with gradients.
  var ART = {
    ember:  ['#2a0906', '#b4361b', '#ffb36b'],
    ocean:  ['#03101f', '#0e4a7a', '#5fd3ff'],
    forest: ['#06150f', '#1d6b4a', '#b8f28a'],
    dusk:   ['#140823', '#6b2fa8', '#ff8ad8'],
    gold:   ['#160f04', '#8a5a12', '#ffd36b'],
    steel:  ['#0a0d12', '#3a4a5e', '#c9d6e8'],
    rose:   ['#20050c', '#a3123a', '#ff9a9a'],
    mint:   ['#031816', '#0f7c74', '#8affe6']
  };

  function artCSS(name) {
    var c = ART[name] || ART.steel;
    return 'radial-gradient(circle at 72% 28%, ' + c[2] + ' 0%, rgba(0,0,0,0) 38%),' +
           'radial-gradient(ellipse at 18% 85%, ' + c[1] + ' 0%, rgba(0,0,0,0) 60%),' +
           'radial-gradient(ellipse at 90% 100%, ' + c[1] + ' 0%, rgba(0,0,0,0) 50%),' +
           'linear-gradient(140deg, ' + c[0] + ' 0%, #050507 100%)';
  }

  var APPS = [
    { id: 'appletv', name: 'Apple TV', logo: 'Apple TV', match: 'apple tv', ids: ['3201807016597'],
      hero: { eyebrow: 'Apple TV', title: 'The Long Light', meta: 'Series · Drama · New episode Friday', art: 'gold',
              desc: 'In a town where the sun never sets, one detective chases the only shadow left.' } },
    { id: 'netflix', name: 'Netflix', logo: 'NETFLIX', match: 'netflix', ids: ['3201907018807', '11101200001'],
      hero: { eyebrow: 'Netflix', title: 'Midnight Harbor', meta: 'Series · Thriller · 2026', art: 'ocean',
              desc: 'A lighthouse keeper uncovers a secret the sea has kept for a hundred years.' } },
    { id: 'youtube', name: 'YouTube', logo: '<span class="yt-play"></span>YouTube', match: 'youtube', ids: ['111299001912'],
      hero: { eyebrow: 'YouTube', title: 'Trending Today', meta: 'Free · Videos', art: 'rose',
              desc: 'Catch up on the most-watched videos — music, gaming, cooking and more.' } },
    { id: 'prime', name: 'Prime Video', logo: '<span>prime</span><small>video</small><span class="prime-smile"></span>', match: 'prime video', ids: ['3201910019365', '3201512006785'],
      hero: { eyebrow: 'Prime Video', title: 'The Last Orbit', meta: 'Movie · Sci-Fi · 2h 04m', art: 'steel',
              desc: 'Six astronauts. One failing station. Forty-eight hours to get home.' } },
    { id: 'disney', name: 'Disney+', logo: 'Disney+', match: 'disney+', ids: ['3201901017640'],
      hero: { eyebrow: 'Disney+', title: 'Kingdom of Lanterns', meta: 'Movie · Family · Animated', art: 'dusk',
              desc: 'A young inventor lights up a forgotten city — and wakes something ancient.' } }
  ];

  // Each menu section has a featured banner and some rows.
  var SECTIONS = {
    home: {
      hero: APPS[0].hero,
      rows: [
        { title: 'Apps', kind: 'apps' },
        { title: 'Up Next', kind: 'wide', items: [
          { title: 'Midnight Harbor', meta: 'S1 · E4 · 22 min left', art: 'ocean', progress: 0.6, desc: 'The storm cuts the island off — and someone opens the old vault.' },
          { title: 'The Long Light', meta: 'S2 · E1', art: 'gold', progress: 0.15, desc: 'A new case begins on the brightest day of the year.' },
          { title: 'Kitchen Wars', meta: 'S3 · E7 · 8 min left', art: 'ember', progress: 0.85, desc: 'Finale week: one dish decides everything.' },
          { title: 'Wild Coast', meta: 'S1 · E2', art: 'forest', progress: 0.3, desc: 'Following an orca family along a frozen coastline.' }
        ] },
        { title: 'Top Picks For You', kind: 'wide', items: [
          { title: 'Kingdom of Lanterns', meta: 'Movie · Family', art: 'dusk', desc: 'A young inventor lights up a forgotten city.' },
          { title: 'Neon Tide', meta: 'Movie · Action', art: 'mint', desc: 'A courier races through a flooded future city.' },
          { title: 'The Last Orbit', meta: 'Movie · Sci-Fi', art: 'steel', desc: 'Forty-eight hours to get home.' },
          { title: 'Paper Hearts', meta: 'Movie · Romance', art: 'rose', desc: 'Two pen pals finally decide to meet.' },
          { title: 'Desert Echo', meta: 'Movie · Mystery', art: 'ember', desc: 'A radio signal from a town that no longer exists.' }
        ] }
      ]
    },
    movies: {
      hero: { eyebrow: 'Movies · Featured', title: 'Neon Tide', meta: 'Movie · Action · 1h 52m', art: 'mint',
              desc: 'A courier with one last delivery races through a flooded city that never sleeps.' },
      rows: [
        { title: 'Trending Movies', kind: 'poster', items: [
          { title: 'Neon Tide', meta: 'Action · 1h 52m', art: 'mint' },
          { title: 'The Last Orbit', meta: 'Sci-Fi · 2h 04m', art: 'steel' },
          { title: 'Paper Hearts', meta: 'Romance · 1h 41m', art: 'rose' },
          { title: 'Desert Echo', meta: 'Mystery · 1h 58m', art: 'ember' },
          { title: 'Kingdom of Lanterns', meta: 'Family · 1h 36m', art: 'dusk' },
          { title: 'Iron Valley', meta: 'Western · 2h 10m', art: 'gold' },
          { title: 'Green Room', meta: 'Comedy · 1h 30m', art: 'forest' }
        ] },
        { title: 'New Releases', kind: 'poster', items: [
          { title: 'Silent Peaks', meta: 'Adventure · 2h 01m', art: 'steel' },
          { title: 'Sunday Club', meta: 'Comedy · 1h 34m', art: 'gold' },
          { title: 'Deep Blue', meta: 'Documentary · 1h 28m', art: 'ocean' },
          { title: 'Firelight', meta: 'Drama · 1h 55m', art: 'ember' },
          { title: 'Velvet Night', meta: 'Thriller · 1h 47m', art: 'dusk' },
          { title: 'Moss & Stone', meta: 'Fantasy · 2h 12m', art: 'forest' }
        ] }
      ]
    },
    tv: {
      hero: { eyebrow: 'TV Shows · Featured', title: 'Kitchen Wars', meta: 'Series · Reality · Season 3', art: 'ember',
              desc: 'Twelve home cooks. One professional kitchen. Only the boldest flavours survive.' },
      rows: [
        { title: 'Continue Watching', kind: 'wide', items: [
          { title: 'Kitchen Wars', meta: 'S3 · E7 · 8 min left', art: 'ember', progress: 0.85 },
          { title: 'Midnight Harbor', meta: 'S1 · E4 · 22 min left', art: 'ocean', progress: 0.6 },
          { title: 'Wild Coast', meta: 'S1 · E2', art: 'forest', progress: 0.3 }
        ] },
        { title: 'Popular Shows', kind: 'poster', items: [
          { title: 'The Long Light', meta: 'Drama · 2 seasons', art: 'gold' },
          { title: 'Office Hours', meta: 'Comedy · 4 seasons', art: 'steel' },
          { title: 'Star Market', meta: 'Sci-Fi · 1 season', art: 'dusk' },
          { title: 'Wild Coast', meta: 'Nature · 1 season', art: 'forest' },
          { title: 'Night Shift', meta: 'Medical · 3 seasons', art: 'mint' },
          { title: 'Red Line', meta: 'Crime · 2 seasons', art: 'rose' }
        ] }
      ]
    },
    settings: {
      hero: { eyebrow: 'Settings', title: 'Make it yours', meta: '', art: 'steel',
              desc: 'Press Enter on a tile to change it. Your choices are remembered on this device.' },
      rows: [ { title: 'Preferences', kind: 'settings' } ]
    }
  };

  // Settings that really work in this prototype.
  var SETTINGS = [
    { key: 'motion',   name: 'Animations', values: ['On', 'Off'] },
    { key: 'clock',    name: 'Clock',      values: ['12-hour', '24-hour'] },
    { key: 'textSize', name: 'Text Size',  values: ['Normal', 'Large'] }
  ];
  var prefs = loadPrefs();

  /* ---------- 2. Drawing ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var main = $('main');
  var rowsEl = $('rows');
  var currentSection = 'home';

  function renderSection(name) {
    currentSection = name;
    var section = SECTIONS[name];
    var html = '';

    section.rows.forEach(function (row, r) {
      html += '<section class="row"><h2 class="row-title">' + row.title + '</h2>' +
              '<div class="track" data-row="r' + r + '">';
      if (row.kind === 'apps') {
        APPS.forEach(function (app, i) {
          html += '<button class="tile app app-' + app.id + ' focusable" data-action="app" data-index="' + i + '">' +
                  '<span class="tile-face"><span class="logo">' + app.logo + '</span></span>' +
                  '<span class="tile-label">' + app.name + '</span></button>';
        });
      } else if (row.kind === 'settings') {
        SETTINGS.forEach(function (s, i) {
          html += '<button class="tile setting focusable" data-action="setting" data-index="' + i + '">' +
                  '<span class="tile-face"><span class="setting-name">' + s.name + '</span>' +
                  '<span class="setting-value">' + prefs[s.key] + '</span></span></button>';
        });
      } else {
        row.items.forEach(function (item, i) {
          var progress = item.progress ? '<span class="progress"><span style="width:' + Math.round(item.progress * 100) + '%"></span></span>' : '';
          html += '<button class="tile ' + row.kind + ' focusable" data-action="card" data-row-index="' + r + '" data-index="' + i + '">' +
                  '<span class="tile-face' + (progress ? ' has-progress' : '') + '" style="background-image:' + artCSS(item.art) + '">' +
                  '<span class="card-title">' + item.title + '</span>' + progress + '</span>' +
                  '<span class="tile-label">' + item.meta + '</span></button>';
        });
      }
      html += '</div></section>';
    });

    rowsEl.innerHTML = html;
    main.scrollTop = 0;
    $('heroButtons').style.display = name === 'settings' ? 'none' : '';
    showHero(section.hero, true);

    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle('active', navItems[i].getAttribute('data-section') === name);
    }
  }

  // The banner: cross-fade the picture and swap the words.
  var heroTimer = null;
  var shownHero = null;
  var artLayer = 0;

  function showHero(hero, immediate) {
    clearTimeout(heroTimer);
    if (hero === shownHero) return;
    function swap() {
      shownHero = hero;
      var layers = [$('heroArtA'), $('heroArtB')];
      artLayer = 1 - artLayer;
      layers[artLayer].style.backgroundImage = artCSS(hero.art);
      layers[artLayer].classList.add('show');
      layers[1 - artLayer].classList.remove('show');

      var info = $('heroInfo');
      function setText() {
        $('heroEyebrow').textContent = hero.eyebrow;
        $('heroTitle').textContent = hero.title;
        $('heroMeta').textContent = hero.meta;
        $('heroDesc').textContent = hero.desc;
        info.classList.remove('swap');
      }
      if (immediate) { setText(); return; }
      info.classList.add('swap');
      setTimeout(setText, 180);
    }
    // Wait a moment so quickly scrolling past tiles doesn't flicker.
    if (immediate) swap(); else heroTimer = setTimeout(swap, 280);
  }

  // Works out which banner to show for a tile.
  function heroFor(el) {
    var action = el.getAttribute('data-action');
    var i = +el.getAttribute('data-index');
    if (action === 'app') return APPS[i].hero;
    if (action === 'card') {
      var row = SECTIONS[currentSection].rows[+el.getAttribute('data-row-index')];
      var item = row.items[i];
      if (!item.hero) {
        item.hero = { eyebrow: row.title, title: item.title, meta: item.meta, art: item.art,
                      desc: item.desc || 'Press Enter to start watching.' };
      }
      return item.hero;
    }
    return null;
  }

  // Fade the banner as you scroll down.
  main.addEventListener('scroll', function () {
    $('hero').style.opacity = Math.max(0.2, 1 - main.scrollTop / (window.innerHeight * 0.6));
  });

  /* ---------- 3. Focus ---------- */

  var focused = null;
  var focusBeforeOverlay = null;

  function overlayOpen() { return $('overlay').classList.contains('open'); }

  // All the rows you can move between, top to bottom.
  function getRows() {
    var selector = overlayOpen() ? '#overlay [data-row]' : 'body > header [data-row], #main [data-row]';
    return Array.prototype.slice.call(document.querySelectorAll(selector))
      .filter(function (row) { return row.offsetParent !== null; }); // skip hidden rows
  }
  function itemsIn(row) {
    return Array.prototype.slice.call(row.querySelectorAll('.focusable'));
  }

  function setFocus(el) {
    if (!el || el === focused) return;
    if (focused) focused.classList.remove('is-focused');
    focused = el;
    el.classList.add('is-focused');
    el.focus({ preventScroll: true });
    if (!overlayOpen()) {
      keepInView(el);
      var hero = heroFor(el);
      if (hero) showHero(hero);
    }
  }

  // Scroll so the focused tile is never hidden off the edge.
  function keepInView(el) {
    var track = el.parentNode.classList.contains('track') ? el.parentNode : null;
    if (track) {
      var pad = track.clientWidth * 0.06;
      var left = el.offsetLeft - pad;
      var right = el.offsetLeft + el.offsetWidth + pad - track.clientWidth;
      if (track.scrollLeft > left) track.scrollTo({ left: left, behavior: 'smooth' });
      else if (track.scrollLeft < right) track.scrollTo({ left: right, behavior: 'smooth' });
    }
    // The menu, the banner buttons and the first row: show the full banner.
    var rows = getRows();
    var rowIndex = rows.indexOf(rowOf(el));
    var target = 0;
    if (rowIndex > 2) {
      var section = rowOf(el).parentNode;
      target = section.offsetTop - window.innerHeight * 0.3;
    }
    main.scrollTo({ top: target, behavior: 'smooth' });
  }

  function rowOf(el) {
    while (el && !el.hasAttribute('data-row')) el = el.parentNode;
    return el;
  }

  function centerX(el) {
    var r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  function move(direction) {
    var rows = getRows();
    if (!focused) { setFocus(itemsIn(rows[0])[0]); return; }
    var row = rowOf(focused);
    var items = itemsIn(row);
    var i = items.indexOf(focused);

    if (direction === 'left' || direction === 'right') {
      var next = items[i + (direction === 'right' ? 1 : -1)];
      if (next) setFocus(next); else bump(focused);
      return;
    }

    // Up / down: jump to the row above or below, picking the tile
    // that is closest horizontally to where you are now.
    var targetRow = rows[rows.indexOf(row) + (direction === 'down' ? 1 : -1)];
    if (!targetRow) { bump(focused); return; }
    var x = centerX(focused);
    var best = null, bestDist = Infinity;
    itemsIn(targetRow).forEach(function (el) {
      var d = Math.abs(centerX(el) - x);
      if (d < bestDist) { bestDist = d; best = el; }
    });
    setFocus(best);
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  /* ---------- What Enter does ---------- */

  function activate(el) {
    var action = el.getAttribute('data-action');
    var i = +el.getAttribute('data-index');

    if (action === 'section') {
      renderSection(el.getAttribute('data-section'));
    } else if (action === 'app') {
      var app = APPS[i];
      if (!onTV) {
        openOverlay('Opening ' + app.name + '…',
          'On the Samsung TV, this opens the real ' + app.name + ' app. On a laptop it just shows this message.',
          app.hero.art);
        return;
      }
      openOverlay('Opening ' + app.name + '…', 'One moment.', app.hero.art);
      launchApp(app, function () {
        setTimeout(closeOverlay, 1500); // so it's gone when you come back
      }, function () {
        $('overlayText').textContent = app.name + " isn't installed on this TV. Install it from the Apps section of your TV's Samsung home screen, then try again.";
      });
    } else if (action === 'card') {
      var hero = heroFor(el);
      openOverlay('Now Playing: ' + hero.title, hero.meta + '. (Placeholder — no real video in the prototype.)', hero.art);
    } else if (action === 'play') {
      openOverlay('Now Playing: ' + shownHero.title, 'This is where the video would start.', shownHero.art);
    } else if (action === 'info') {
      openOverlay(shownHero.title, shownHero.desc, shownHero.art);
    } else if (action === 'setting') {
      var s = SETTINGS[i];
      var v = s.values[(s.values.indexOf(prefs[s.key]) + 1) % s.values.length];
      prefs[s.key] = v;
      savePrefs();
      applyPrefs();
      el.querySelector('.setting-value').textContent = v;
    } else if (action === 'close') {
      closeOverlay();
    }
  }

  function openOverlay(title, text, art) {
    focusBeforeOverlay = focused;
    $('overlayTitle').textContent = title;
    $('overlayText').textContent = text;
    $('overlayArt').style.backgroundImage = artCSS(art);
    $('overlay').classList.add('open');
    $('overlay').setAttribute('aria-hidden', 'false');
    setFocus(itemsIn(getRows()[0])[0]);
  }

  function closeOverlay() {
    $('overlay').classList.remove('open');
    $('overlay').setAttribute('aria-hidden', 'true');
    if (focusBeforeOverlay) setFocus(focusBeforeOverlay);
  }

  // Back: close the pop-up, jump up to the menu, or (on the TV) leave the app.
  function goBack() {
    if (overlayOpen()) { closeOverlay(); return; }
    var nav = document.querySelector('.nav-item.active');
    if (focused !== nav) setFocus(nav);
    else if (onTV) {
      try { tizen.application.getCurrentApplication().exit(); } catch (err) {}
    }
  }

  /* ---------- Opening the real apps (only works on the Samsung TV) ---------- */

  // "tizen" only exists inside the Samsung TV, so this tells us where we're running.
  var onTV = typeof tizen !== 'undefined';
  var installedApps = null;
  if (onTV) {
    try { tizen.application.getAppsInfo(function (list) { installedApps = list; }); } catch (err) {}
  }

  // Samsung gives each app a number. We look it up by name on the TV first,
  // then fall back to the numbers we already know.
  function appIdsFor(app) {
    var exact = [], partial = [];
    (installedApps || []).forEach(function (info) {
      var name = (info.name || '').toLowerCase();
      if (name === app.match) exact.push(info.id);
      // "Amazon Prime Video" counts as Prime Video, but "YouTube Kids" isn't YouTube.
      else if (name.length > app.match.length &&
               name.slice(-app.match.length) === app.match) partial.push(info.id);
    });
    var ids = exact.concat(partial);
    app.ids.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }

  function launchApp(app, onOpened, onFailed) {
    var ids = appIdsFor(app);
    (function tryNext(n) {
      if (n >= ids.length) { onFailed(); return; }
      try {
        tizen.application.launch(ids[n], onOpened, function () { tryNext(n + 1); });
      } catch (err) { tryNext(n + 1); }
    })(0);
  }

  /* ---------- 4. Remote keys ---------- */

  var KEYS = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'enter',
    27: 'back', 8: 'back',
    10009: 'back' // the Back button on a Samsung TV remote
  };

  document.addEventListener('keydown', function (e) {
    var key = KEYS[e.keyCode];
    if (!key) return;
    e.preventDefault();
    if (key === 'enter') { if (focused) activate(focused); }
    else if (key === 'back') goBack();
    else move(key);
  });

  // Mouse support too, handy while testing on the MacBook.
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('.focusable') : null;
    if (el && (!overlayOpen() || el.closest('#overlay'))) setFocus(el);
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.focusable') : null;
    if (el) { setFocus(el); activate(el); }
  });

  /* ---------- Settings + clock ---------- */

  function loadPrefs() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('tvHomePrefs')) || {}; } catch (err) {}
    var p = {};
    SETTINGS.forEach(function (s) {
      p[s.key] = s.values.indexOf(saved[s.key]) >= 0 ? saved[s.key] : s.values[0];
    });
    return p;
  }
  function savePrefs() {
    try { localStorage.setItem('tvHomePrefs', JSON.stringify(prefs)); } catch (err) {}
  }
  function applyPrefs() {
    document.body.classList.toggle('reduce-motion', prefs.motion === 'Off');
    document.documentElement.classList.toggle('large-text', prefs.textSize === 'Large');
    updateClock();
  }

  function updateClock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var mm = (m < 10 ? '0' : '') + m;
    if (prefs.clock === '24-hour') {
      $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + mm;
    } else {
      $('clock').textContent = (h % 12 || 12) + ':' + mm + (h < 12 ? ' AM' : ' PM');
    }
  }
  setInterval(updateClock, 10000);

  /* ---------- Start ---------- */

  if (onTV) {
    document.querySelector('.hint').innerHTML = 'Arrows to move &nbsp;·&nbsp; OK to select &nbsp;·&nbsp; Back to go back';
  }
  applyPrefs();
  renderSection('home');
  setFocus(document.querySelector('.app'));
})();
