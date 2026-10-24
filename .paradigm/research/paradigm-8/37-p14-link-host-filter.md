# 37 — P14 re-plan: the `link` profile cannot name a host (Arky, 2026-10-17)

Trigger: M1.0 falsifier rule — probe p14-link-outbound (darwin, macOS 15.7.3 arm64) returned `fail`, so this re-plan memo comes before any build that depends on the ruling. Result: `packages/gnomon/probes/results/p14-link-outbound.darwin.json`. Nothing is blocked today: M2.8/M2.9 are deferred (P8-D77), and no Move-1 milestone depends on `link`.

## What breaks, what holds
- **Breaks:** §15.5 `link` (macOS cell): "outbound TCP only to the relay `ip:port` pairs (remote allow-list)". SBPL rejects a literal IP: `host must be * or localhost`. Only `*:P` and `localhost:P` compile. `*:P` admits **any host** on port P. `localhost:P` also admitted this Mac's own en0 address. `G-LNK-11` ("connect anywhere but the configured relay addresses") therefore cannot be met by SBPL alone. The P14 row's mac claim fails.
- **Holds:** under deny-default, every other refusal held (EPERM): other-port TCP, UDP, listen, file read, home listing, exec, unix-socket connect. The unsandboxed control reached all of them, so the refusals are real. The rest of §3.9 is untouched. The child still has no keys, no plaintext and no home.

## Threat, sized
A compromised `gnomon-link` child holds only ciphertext and metadata. The kernel runs every Noise handshake and parses every plaintext frame. So "exfil" means ciphertext plus timing, not content. The real loss from `*:P` is **reach**:
- a command-and-control channel to an attacker host on port P;
- a pivot onto other LAN or internet services listening on P.

An IP pin was never authentication anyway: anyone on the LAN can ARP-spoof the relay's IP. Noise IK against the relay's pinned static key (and against peer keys) is the real identity control.

## Options
| | Mechanism | vs. compromised child | Windows parity | Cost / privilege |
|---|---|---|---|---|
| a | `*:P` + allowlist check inside the child before connect | none: the check runs in the process we assume is compromised | same weakness | trivial; rejected |
| **b** | **Kernel dials the root-signed `ip:port` and passes the connected socket to the child (SCM_RIGHTS via Node's built-in IPC handle passing). The child profile has no `network-outbound` at all; to reconnect, the child asks the kernel.** | strong: the child cannot open any connection; the host is chosen by root-signed config in the kernel | libuv passes TCP handles over IPC pipes on Windows too (`WSADuplicateSocketW`), so the child token or AppContainer can carry **no** network capability, and link stops depending on the S29-08 allow-list | small; zero dependencies (`child_process` `send(msg, socket)`); no entitlement, no root |
| c | Kernel loopback forwarder on `localhost:P` that forwards only to the relay | medium: reach collapses to localhost, but the en0 alias is admitted and there is a new loopback listener any same-user process (sessions) can reach unless denied | needs a loopback-only filter | more moving parts than (b) |
| d | Network Extension content filter | strong | n/a | entitlement, system extension, user approval; out of scope for 8.0 |
| e | PF anchor per relay IP | weak: PF is not per-process | n/a | root; rejected |
| f | Accept `*:P`; Noise is the control | reach residual as above | S29-08 port-scoped filter | none; **needs ratification** |

## Recommendation (Arky)
Adopt **(b)**. If the follow-up probe fails, fall back to **(f)** with port-only `*:P` and the §A.5(h) text below. That fallback is a **recommendation for founder ratification**, because it accepts a residual. (b) also narrows `G-LNK-11` to a stronger claim: the child connects nowhere, the relay address included.

Unverified assumptions (P14b checks both): the macOS sandbox does not block reads and writes on a socket the child received already connected; Node can pass a TCP socket to a child on Windows (libuv).

## Spec edits
- **§15.5 `link`, macOS cell:** "default-deny with **no** `network-outbound` and no `network-bind`. The kernel dials the relay `ip:port` from root-signed config and hands the connected socket to the child over its IPC channel. The child opens no socket that reaches the network and redials only by asking the kernel. (SBPL cannot name a host: P14, only `*` or `localhost` compile.)"
- **§15.5 `link`, Windows cell:** "the kernel duplicates the socket to the child. Restricted token or AppContainer with no network capability. The S29-08 allow-list only if P14b-w fails."
- **§3.9 Architecture:** replace "outbound TCP to the relay addresses in root-signed config" with "a connected TCP socket the kernel dialed to a relay address in root-signed config and handed over (fd passing), plus stdio and an IPC channel to the kernel".
- **`G-LNK-11`:** "…cannot read keys, home or the link store, exec, listen, or open any network connection. It uses only the socket the kernel handed it."
- **§16 link row:** the same wording for both OS columns.
- **§19.1 P14 row:** status `fail (mac) → re-planned, research 37`; align "configured LAN `ip:port`" with §3.9/§15.5's "relay `ip:port` pairs". Add a **P14b** row (below).
- **§0 / decision log:** a new P8-D row recording (b) and the fallback.
- **§A.5 (fallback only):** add "(h) **link reach**: on <OS> the `link` child may connect to any host on the relay port. Noise IK against pinned keys is the identity control; the child holds no keys or plaintext. Revisit trigger: before internet reach, or any falsifier-15 detection."

**Milestone:** M2.8 absorbs the kernel dialer, the IPC handle pass, the reconnect-request frame on the child channel and the profile-generator change. M1.7's spawner only needs to allow an IPC fd for this child class; no Move-1 contract changes.

## Follow-up probe: P14b `link-fdpass`
Darwin now, cheap, closes P14 for mac. Windows half in the Windows parity phase.

1. A kernel stand-in dials a listener and sends the socket to a child via `subprocess.send(msg, socket)`.
2. The child runs under deny-default with no `network*` allows.

Pass requires:
- (i) full-duplex read/write on the handed socket, 4 MiB frames both ways;
- (ii) the peer's close is seen;
- (iii) a second handoff after a kernel redial works;
- (iv) the child's own `connect` to the **same** `ip:port`, another port, another host, UDP, listen and unix-socket connect are all EPERM;
- (v) file read, home listing and exec are EPERM (as P14).

Windows (P14b-w): the same, via libuv duplication into a restricted-token child, then into an AppContainer with no capabilities.

If (i)–(iii) fail, fall back to (f) and take §A.5(h) to the founder.
