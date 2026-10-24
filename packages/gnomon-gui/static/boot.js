'use strict';
// #gui boot (spec §11.2 rule 2, S25-L2): the FIRST script on the page. It reads the launch fragment once and clears it with
// history.replaceState before any other script runs, so the token is in no history entry, no Referer and no server log.
// The two values stay in this closure until app.js takes them once (takeLaunch deletes itself); nothing is stored.
(function () {
  var raw = location.hash;
  if (raw) history.replaceState(null, '', location.pathname + location.search);
  var taken = false;
  Object.defineProperty(globalThis, 'gnomonTakeLaunch', {
    configurable: true,
    enumerable: false,
    value: function () {
      if (taken) return '';
      taken = true;
      delete globalThis.gnomonTakeLaunch;
      var v = raw;
      raw = '';
      return v;
    },
  });
})();
