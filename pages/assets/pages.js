/* The one script for the public pages. Deferred; every page is complete without it.
   It adds three things: the theme key, the Copy keys, and the ripple on the symbol graph.
   It makes no request and reads nothing but the page and this device's stored theme. */
(function () {
  'use strict';
  var root = document.documentElement;
  var each = function (sel, fn, el) { Array.prototype.forEach.call((el || document).querySelectorAll(sel), fn); };

  /* theme key: Auto, Light, Dark. Auto follows the system and stores nothing. */
  var side = document.querySelector('.mast-side');
  if (side) {
    var order = ['auto', 'light', 'dark'];
    var names = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    var key = document.createElement('button');
    key.type = 'button';
    key.className = 'theme-key';
    var now = function () { return root.getAttribute('data-theme') || 'auto'; };
    var draw = function () {
      var c = now();
      key.innerHTML = order.map(function (o) { return o === c ? '<b>' + names[o] + '</b>' : names[o]; }).join(' · ');
      key.setAttribute('aria-label', 'Auto · Light · Dark: theme, now ' + names[c] + (c === 'auto' ? ', following your system' : ''));
    };
    key.addEventListener('click', function () {
      var next = order[(order.indexOf(now()) + 1) % order.length];
      try {
        if (next === 'auto') { root.removeAttribute('data-theme'); localStorage.removeItem('pages-theme'); }
        else { root.setAttribute('data-theme', next); localStorage.setItem('pages-theme', next); }
      } catch (e) { /* storage is off: the theme still changes for this page */ }
      draw();
    });
    draw();
    side.appendChild(key);
  }

  /* Copy keys: on every command line and prompt line. "Copied" for two seconds, said once in a polite live region. */
  if (navigator.clipboard && navigator.clipboard.writeText) {
    var live = document.createElement('p');
    live.className = 'vh';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
    var addCopy = function (host, source, what) {
      var b = document.createElement('button');
      var timer;
      b.type = 'button';
      b.className = 'key';
      b.textContent = 'Copy';
      b.setAttribute('aria-label', 'Copy ' + what);
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(source.textContent.trim()).then(function () {
          clearTimeout(timer);
          b.textContent = 'Copied';
          b.setAttribute('data-done', '');
          live.textContent = 'Copied';
          timer = setTimeout(function () { b.textContent = 'Copy'; b.removeAttribute('data-done'); live.textContent = ''; }, 2000);
        }, function () { /* refused: the text is still selectable */ });
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
      var first = true;
      each('.station', function (s) {
        var on = seen.indexOf(s.id) > -1;
        s.classList.toggle('done', on);
        s.classList.toggle('current', !on && first && s.classList.contains('level'));
        if (!on && s.classList.contains('level')) first = false;
        s.querySelector('.saw input').checked = on;
      }, path);
      clear.hidden = !seen.length;
      try { localStorage.setItem('pages-path', JSON.stringify(seen)); } catch (e) { /* not stored; still ticked on this page */ }
    };
    each('.station', function (s) {
      var l = document.createElement('label');
      var c = document.createElement('input');
      l.className = 'saw';
      c.type = 'checkbox';
      l.appendChild(c);
      l.appendChild(document.createTextNode('I saw it'));
      c.addEventListener('change', function () {
        seen = seen.filter(function (x) { return x !== s.id; });
        if (c.checked) seen.push(s.id);
        mark();
      });
      s.querySelector('.station-body').appendChild(l);
    }, path);
    clear.addEventListener('click', function () { seen = []; mark(); });
    path.parentNode.insertBefore(clear, path.nextSibling);
    mark();
    /* a link to a station opens it */
    var openHash = function () { var el = location.hash && document.getElementById(location.hash.slice(1)); var d = el && el.querySelector && el.querySelector('details'); if (d) d.open = true; };
    window.addEventListener('hashchange', openHash);
    openHash();
  }
})();
