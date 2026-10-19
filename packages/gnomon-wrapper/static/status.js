'use strict';
// #gnomon-wrapper status page: the window's content until the kernel's page
// is verified (serverSig + bundle pin), and again whenever the wrapper refuses.
// The native side calls gnomonStatus({state, detail}) through webview.eval;
// every string reaches the DOM as a text node, never as markup. This page has
// no IPC, no network (connect-src 'none') and never sees a token.
(function () {
  function show(s) {
    var state = document.getElementById('state');
    var detail = document.getElementById('detail');
    if (!state || !detail || !s || typeof s.state !== 'string') return;
    state.textContent = s.state;
    state.className = s.error ? 'state error' : 'state';
    if (typeof s.detail === 'string' && s.detail) {
      detail.textContent = s.detail;
      detail.hidden = false;
    } else {
      detail.textContent = '';
      detail.hidden = true;
    }
  }
  Object.defineProperty(window, 'gnomonStatus', { value: show, writable: false, configurable: false });
  // a status the native side set before this script ran
  if (window.gnomonStatusPending) show(window.gnomonStatusPending);
})();
