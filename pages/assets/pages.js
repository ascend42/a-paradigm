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
})();
