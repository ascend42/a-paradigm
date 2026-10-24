// p09 ed25519 test body — classic script, no modules, no eval. Runs unchanged in
// Node (vm), in every engine page (served under the §11.2 CSP as /ed25519-test.js)
// and inlined verbatim into safari.html (the probe checks they stay in sync).
// BEGIN p09Ed25519Test
globalThis.p09Ed25519Test = async function p09Ed25519Test() {
  var r = { secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null };
  var subtle = globalThis.crypto && globalThis.crypto.subtle;
  r.subtle = !!subtle;
  var hex = function (h) { return new Uint8Array(h.match(/../g).map(function (x) { return parseInt(x, 16); })); };
  var ED = { name: 'Ed25519' };
  var steps = [];
  if (!subtle) {
    r.error = 'no crypto.subtle';
  } else {
    try {
      var kp = await subtle.generateKey(ED, true, ['sign', 'verify']);
      steps.push('generate');
      var msg = new TextEncoder().encode('gnomon:auth-server:v1 p09 probe');
      var sig = new Uint8Array(await subtle.sign(ED, kp.privateKey, msg));
      r.sigLen = sig.length;
      steps.push('sign');
      r.verify = await subtle.verify(ED, kp.publicKey, sig, msg);
      var forged = sig.slice(); forged[0] ^= 1;
      r.forgedSigRejected = !(await subtle.verify(ED, kp.publicKey, forged, msg));
      var msg2 = msg.slice(); msg2[0] ^= 1;
      r.forgedMsgRejected = !(await subtle.verify(ED, kp.publicKey, sig, msg2));
      steps.push('verify');
      // The GUI pins the kernel key from the launch fragment as SPKI (§11.2 rule 2).
      var spki = await subtle.exportKey('spki', kp.publicKey);
      var pub2 = await subtle.importKey('spki', spki, ED, false, ['verify']);
      r.spkiRoundTrip = await subtle.verify(ED, pub2, sig, msg);
      steps.push('spki');
      // RFC 8032 §7.1 TEST 2 (one-byte message 0x72): the gating
      // cross-implementation vector. Gnomon never signs an empty preimage.
      var rpk2 = await subtle.importKey('raw', hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'), ED, false, ['verify']);
      var rsig2 = hex('92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00');
      r.rfc8032 = await subtle.verify(ED, rpk2, rsig2, new Uint8Array([0x72]));
      steps.push('rfc8032');
      // Informational: RFC 8032 TEST 1 (EMPTY message), and an own-key
      // sign/verify of an empty message — engines differ on empty input.
      var rpk = await subtle.importKey('raw', hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'), ED, false, ['verify']);
      var rsig = hex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
      r.rfc8032EmptyMessage = await subtle.verify(ED, rpk, rsig, new Uint8Array(0));
      var esig = new Uint8Array(await subtle.sign(ED, kp.privateKey, new Uint8Array(0)));
      r.ownKeyEmptyMessage = await subtle.verify(ED, kp.publicKey, esig, new Uint8Array(0));
      steps.push('empty-message');
      // Informational (not gating): strict S < L. Add L to S (little-endian) —
      // a lax verifier accepts this malleated signature.
      var L = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;
      var s = 0n;
      for (var i = 63; i >= 32; i--) s = (s << 8n) | BigInt(rsig2[i]);
      s += L;
      var mal = rsig2.slice();
      for (var j = 32; j < 64; j++) { mal[j] = Number(s & 0xffn); s >>= 8n; }
      r.nonCanonicalSRejected = !(await subtle.verify(ED, rpk2, mal, new Uint8Array([0x72])));
      steps.push('strict-s');
    } catch (e) {
      r.error = (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : String(e));
    }
  }
  r.steps = steps;
  r.ok = r.verify === true && r.forgedSigRejected === true && r.forgedMsgRejected === true && r.spkiRoundTrip === true && r.rfc8032 === true;
  // The paste-back line (format documented in probes/README.md, P09 section).
  // Each mark is what verify() did: ✓ accepted, ✕ rejected. A correct engine
  // shows ✓ verify · ✕ forged · ✓ rfc8032 · ✓ spki and ends in PASS.
  var m = function (accepted) { return accepted === undefined ? '?' : accepted ? '✓' : '✕'; };
  var forgedAccepted = r.forgedSigRejected === undefined ? undefined : !(r.forgedSigRejected && r.forgedMsgRejected);
  r.line = r.error && steps.length === 0
    ? 'ed25519 ✕ unsupported (' + r.error + ') · FAIL'
    : 'ed25519 ' + m(r.verify) + ' verify · ' + m(forgedAccepted) + ' forged · ' + m(r.rfc8032) + ' rfc8032 · ' + m(r.spkiRoundTrip) + ' spki · '
      + m(r.nonCanonicalSRejected === undefined ? undefined : !r.nonCanonicalSRejected) + ' non-canonical-s · ' + m(r.rfc8032EmptyMessage) + ' empty-msg · ' + (r.ok ? 'PASS' : 'FAIL')
      + (r.error ? ' (' + r.error + ')' : '');
  return r;
};
// END p09Ed25519Test
