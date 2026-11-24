/* The one script for the public pages. Deferred; every page is complete without it.
   It adds: the theme key, the Copy keys, the ripple on the symbol graph, the stamp on Gnomon's card, and the path's ticks.
   It makes no request and reads nothing but the page and what this device has stored for it. */
(function () {
  'use strict';
  var root = document.documentElement;
  var each = function (sel, fn, el) { Array.prototype.forEach.call((el || document).querySelectorAll(sel), fn); };
  var live = document.createElement('p');
  live.className = 'vh';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);

  /* theme key: Auto, Light, Dark, as three buttons. Auto follows the system and stores nothing. */
  var side = document.querySelector('.mast-side');
  if (side) {
    var names = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    var group = document.createElement('div');
    group.className = 'theme-key';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Theme');
    var draw = function () {
      var now = root.getAttribute('data-theme') || 'auto';
      each('button', function (b) { b.setAttribute('aria-pressed', String(b.value === now)); }, group);
    };
    Object.keys(names).forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.value = name;
      b.textContent = names[name];
      b.addEventListener('click', function () {
        try {
          if (name === 'auto') { root.removeAttribute('data-theme'); localStorage.removeItem('pages-theme'); }
          else { root.setAttribute('data-theme', name); localStorage.setItem('pages-theme', name); }
        } catch (e) { /* storage is off: the theme still changes for this page */ }
        draw();
      });
      group.appendChild(b);
    });
    draw();
    side.appendChild(group);
  }

  /* Copy keys: on every command line and prompt line. "Copied" for two seconds, said once in a polite live region.
     If the clipboard refuses, the key says so; the text is still selectable. */
  if (navigator.clipboard && navigator.clipboard.writeText) {
    var addCopy = function (host, source, what) {
      var b = document.createElement('button');
      var timer;
      var say = function (word, told, done) {
        clearTimeout(timer);
        b.textContent = word;
        if (done) b.setAttribute('data-done', '');
        live.textContent = told;
        timer = setTimeout(function () { b.textContent = 'Copy'; b.removeAttribute('data-done'); live.textContent = ''; }, 2000);
      };
      b.type = 'button';
      b.className = 'key';
      b.textContent = 'Copy';
      b.setAttribute('aria-label', 'Copy ' + what);
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(source.textContent.trim()).then(
          function () { say('Copied', 'Copied', true); },
          function () { say('Not copied', 'Not copied. Your browser refused; select the text instead.', false); }
        );
      });
      host.appendChild(b);
    };
    each('.cmd', function (c) { addCopy(c, c.querySelector('code'), 'the command'); });
    each('.say', function (s) { addCopy(s, s.querySelector('q'), 'the prompt'); });
  }

  /* the symbol graph: hover or focus a node and the change ripples to what depends on it.
     Weight and fill only, no travel; the stylesheet drops the transition under reduced motion. */
  each('svg.graph', function (g) {
    var nodes = g.querySelectorAll('.node');
    var edges = g.querySelectorAll('.edge');
    var paint = function (n) {
      var reach = n ? ' ' + n.getAttribute('data-ripple') + ' ' : '';
      var id = n && n.getAttribute('data-id');
      Array.prototype.forEach.call(nodes, function (x) {
        x.classList.toggle('at', n ? x === n : x.hasAttribute('data-o'));
        x.classList.toggle('hit', n ? reach.indexOf(' ' + x.getAttribute('data-id') + ' ') > -1 : x.hasAttribute('data-d'));
      });
      Array.prototype.forEach.call(edges, function (e) {
        e.classList.toggle('hit', n ? e.getAttribute('data-b') === id : e.hasAttribute('data-d'));
        e.classList.toggle('lists', !!n && e.getAttribute('data-a') === id);
      });
    };
    var held = function () { var a = document.activeElement; return a && a.parentNode === g ? a : null; };
    Array.prototype.forEach.call(nodes, function (n) {
      n.addEventListener('mouseenter', function () { paint(n); });
      n.addEventListener('mouseleave', function () { paint(held()); });
      n.addEventListener('focus', function () { paint(n); });
      n.addEventListener('blur', function () { paint(null); });
    });
  });

  /* Gnomon's plate: the card is stamped once, when it comes into view. Without this, and under reduced motion, it is simply stamped. */
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still && 'IntersectionObserver' in window) {
    each('.gplate.stamps', function (p) {
      p.classList.add('wait');
      var io = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { p.classList.remove('wait'); p.classList.add('land'); io.disconnect(); }
      }, { threshold: 0.6 });
      io.observe(p);
    });
  }

  /* the path: tick "I saw it" on a station. Kept on this device only. */
  var path = document.querySelector('.path');
  if (path) {
    var seen = [];
    try { seen = JSON.parse(localStorage.getItem('pages-path') || '[]'); } catch (e) { seen = []; }
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'path-clear';
    clear.textContent = 'Clear my ticks';
    var mark = function () {
      var current = null;
      each('.station', function (s) {
        var on = seen.indexOf(s.id) > -1;
        var isCurrent = !on && !current && s.classList.contains('level');
        s.classList.toggle('done', on);
        s.classList.toggle('current', isCurrent);
        if (isCurrent) current = s;
        s.querySelector('.saw input').checked = on;
      }, path);
      clear.hidden = !seen.length;
      try { localStorage.setItem('pages-path', JSON.stringify(seen)); } catch (e) { /* not stored; still ticked on this page */ }
      return current;
    };
    each('.station', function (s) {
      var l = document.createElement('label');
      var c = document.createElement('input');
      l.className = 'saw';
      c.type = 'checkbox';
      l.appendChild(c);
      l.appendChild(document.createTextNode('I saw it: ' + s.querySelector('.station-name').textContent));
      c.addEventListener('change', function () {
        seen = seen.filter(function (x) { return x !== s.id; });
        if (c.checked) seen.push(s.id);
        mark();
      });
      s.querySelector('.station-body').appendChild(l);
    }, path);
    clear.addEventListener('click', function () {
      seen = [];
      mark();
      live.textContent = 'Ticks cleared.';
      path.querySelector('summary').focus();
    });
    path.parentNode.insertBefore(clear, path.nextSibling);
    /* on return, the station you are on is the one that is open */
    var here = mark();
    if (seen.length && here) {
      each('details', function (d) { d.open = false; }, path);
      here.querySelector('details').open = true;
    }
    /* a link to a station opens it */
    var openHash = function () { var el = location.hash && document.getElementById(location.hash.slice(1)); var d = el && el.querySelector && el.querySelector('details'); if (d) d.open = true; };
    window.addEventListener('hashchange', openHash);
    openHash();
  }
})();
