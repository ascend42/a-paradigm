# Gnomon — `pages/gnomon/index.html`

Copy by Wren. Numbers and sources by Sage. Reading rules are at the top of `hub.md`.

---

## 1. Hero

**Headline**

Every decision from every session, on one stack. Your answer is signed.

**What it is, in two sentences**

Gnomon is a signed Mac app that runs your Claude Code sessions inside a macOS sandbox. Every permission request, question and plan arrives as a card on one decision stack, and you answer with Touch ID or your password.

**Standing line**

- Built — signed and notarized app. {{gnomon.platform}} only.
- In progress — boards, {{gnomon.boards}}.
- Untested — on any Mac but the one it was built on.
- As of {{gnomon.notarized.measured}}. Source: `spctl` on the npm package; `git log`.

**Command**

```
gnomon
```

Line under it: The first run sets up this Mac. It asks for Touch ID or your password {{gnomon.setup-prompts}} times, then opens the desk.

**Preflight** (the four requirements, as a checklist the reader can tick by eye)

1. An Apple silicon Mac, macOS 15 or later, with System Integrity Protection on.
2. Claude Code from the native installer, signed in with your Claude subscription. Gnomon refuses API-key billing.
3. Touch ID, or your login password.
4. Node 24 or later, for the install. The app runs on its own pinned Node.

**One limit, stated here and not in small print**

The Mac helper does not yet check which program is calling it. Another program running as you could ask it to sign. Every signature still needs your Touch ID or password.

**Plate** (Gnomon's own ground: papercraft in light, phosphor in dark)

[[slot: gnomon-card-and-log-row]] DIRECTION asks for one real decision card and the signed, hash-chained log row it produced. We have not captured one: nobody launched Gnomon for this page. Until a real row exists, the plate shows a drawn card, labelled as an illustration, with no log row beside it. The build must not invent a hash.

**Prints:** `gnomon.platform`, `gnomon.boards`, `gnomon.notarized`, `gnomon.setup-prompts`, `gnomon.requirements`, `gnomon.helper-caller`, `gnomon.one-machine`.

---

## 2. What it holds

**Headline**

What it holds.

**The problem it removes** (one paragraph above the rows)

Run several Claude Code sessions and each one asks for permission in its own terminal. Each can read your credentials. Nothing records who approved what. You end up approving by reflex, in whichever window is in front.

**Rows**

One stack
: Requests from every session arrive in one place, as cards. Silence means deny, and only a person decides. An "Always allow" rule is built from signed rows in the log, and you can list and revoke rules with `gnomon rules list`.
: Proof: `CHANGELOG.md`, line 231 onward; `packages/gnomon/test/approval-broker.test.ts`.

Signed and chained
: Your answer is signed with a key held in the Mac's Secure Enclave. Every session, approval and grant goes into one log where each row carries the hash of the row before it. Change, delete or cut off a row and the chain no longer checks. `gnomon replay` verifies it.
: Proof: `docs/specs/gnomon.md`, section 3.2; `packages/gnomon/test/kernel-log.test.ts`.

Sandboxed sessions
: Claude Code runs headless under a default-deny sandbox profile. Sessions cannot read `~/.ssh`, `~/.aws`, `~/.gnomon` or other credential stores.
: Proof: `CHANGELOG.md`, line 238; `packages/gnomon/test/session-sandbox.test.ts`.

Spending, measured
: Gnomon meters usage across sessions and shows it. It does not cap it. The changelog's words: "{{gnomon.spend}}". The spec's words for runaway spend: "visible, not prevented".
: Proof: `CHANGELOG.md`, line 235; `docs/specs/gnomon.md`, line 1893.

**Line under the rows**

For the first three rows, "proof" means the spec states it and a test file names it. We did not run those suites for this page.

**Prints:** `gnomon.spend`, `gnomon.sandbox-denies`. Excerpt: `gnomon.threat-row-3`.

---

## 3. Measured

**Headline**

Don't take our word for the app. Run four commands.

**The strongest proof** (leads the section)

The app you install is Developer ID signed, notarized by Apple and stapled, and its zip matches the hash we publish. You can check all of it yourself, without trusting us. Download the package from npm, unpack it, and run the checks:

```
npm pack @a-company/gnomon-darwin-arm64@8.1.0
shasum -a 256 Gnomon.app.zip
spctl -a -vv Gnomon.app
xcrun stapler validate Gnomon.app
```

What we got:

```
Gnomon.app: accepted
source=Notarized Developer ID
The validate action worked!
```

Source line: recorded output, `pages/captures/gnomon-verification.txt`, run {{gnomon.notarized.measured}} on version {{gnomon.version}}. The capture has every step, including unpacking the zip. Published hash: {{gnomon.sha256}}.

**Fact lines** (four)

{{gnomon.threats}} threats
: listed in the spec, each with what is still exposed after our defence. Row 3 says runaway spend is "visible, not prevented".
: Source: `docs/specs/gnomon.md`, lines 1887 to 1923.

{{gnomon.spec-ids-tested.referenced_by_tests}} of {{gnomon.spec-ids-tested.in_specs}} test ids
: in the Gnomon specs are referenced by a test file. {{gnomon.spec-ids-tested.no_test}} are not. Most of those belong to features that are not built.
: Source: the evidence dossier, {{gnomon.spec-ids-tested.measured}}. "Referenced by a test file" is weaker than "the test passes".

{{gnomon.ci-latest}} CI jobs
: passed on the latest run on main. The macOS probes job failed.
: Source: `gh run view 43286257168`, {{gnomon.ci-latest.measured}}.

{{gnomon.first-release-days}} days
: from the first package commit to the first npm release. That is how new this is.
: Source: `git log`; `CHANGELOG.md`, line 212.

**Proof excerpt**

[[slot: gnomon-card-and-log-row]] A real log row with its hash link, and the `gnomon replay` output that verifies the chain. Not captured. Fallback: the excerpt is threat row 3, `docs/specs/gnomon.md`, line 1893, copied by the build.

**Prints:** `gnomon.notarized`, `gnomon.stapled`, `gnomon.sha256`, `gnomon.version`, `gnomon.verify-commands`, `gnomon.threats`, `gnomon.spec-ids-tested`, `gnomon.ci-latest`, `gnomon.first-release-days`. Excerpts: `gnomon.verification`, `gnomon.threat-row-3`.

---

## 4. The desk, drawn

**Headline**

The desk, drawn.

**Caption** (the plate at full width; an illustration built from the real GUI's markup and CSS, and said to be drawn)

This is a drawing of the desk, made from the app's own markup and styles. It is not a screenshot.

**The four regions, named**

Sessions, on the left
: Your active sessions, grouped by project. Each project has its own colour.

The session, in the centre
: The conversation with one session, and one composer. Cards that belong to this session are pinned above the composer.

The stack, on the right
: Every card from every session, most urgent first. Decide a card here or in its session, and it leaves both.

Workshop, along the foot
: What needs you, what is working, and one status line.

**Prints:** none. Source for the region names: `.atelier/systems/gnomon/DESIGN.md`, lines 36 to 46.

---

## 5. Lately

**Headline**

What changed lately.

**Rows** (the release's own lead sentence, stamped from `CHANGELOG.md`)

- In progress, not released — Boards. First slice on a branch. Standing mark: in progress. [[session: boards-in-public]]
- {{lately.gnomon[0].date}} · {{lately.gnomon[0].version}} — "{{lately.gnomon[0].lead}}"
- {{lately.gnomon[1].date}} · {{lately.gnomon[1].version}} — "{{lately.gnomon[1].lead}}" Standing mark: the app, not built to built.
- {{lately.gnomon[2].date}} · {{lately.gnomon[2].version}} — "{{lately.gnomon[2].lead}}"

**Prints:** `lately.gnomon[0..2]`, `gnomon.boards`. Capture: `pages/captures/lately.txt`.

---

## 6. Where it stands

**Headline**

Where it stands.

**Ledger** (stamped from `standing.gnomon.ledger` in `facts.json`)

Built
- The app: signed, notarized, stapled, hash-matched. — the four commands above.
- The decision stack: cards, deny on silence, signed answers. — `CHANGELOG.md:231-238`; a named test file.
- The hash-chained log. — spec section 3.2; a named test file. Writing to it measured {{gnomon.log-append}} on one Mac.
- Sandboxed sessions, credential folders denied. — `CHANGELOG.md:238`; a named test file.
- Subscription only. — `docs/specs/gnomon.md:1338`; a named test file.
- Local models with tools, under the same cards. — `CHANGELOG.md:75`.
- A published threat list. — {{gnomon.threats}} threats, each with its residual.

In progress
- Boards. — a branch and a decision record.
- Test coverage of the spec. — {{gnomon.spec-ids-tested.referenced_by_tests}} of {{gnomon.spec-ids-tested.in_specs}} test ids referenced by tests.
- CI. — {{gnomon.ci-latest}} jobs passing on the latest run on main.
- Windows. — tested in CI and probes; not shipped.

Untested or not built
- A spending cap. Gnomon meters; it does not stop anything. — `CHANGELOG.md:235`.
- The helper checking which program calls it. — `CHANGELOG.md:298`.
- Loops. Specified, and {{gnomon.loops}}. — `CHANGELOG.md:130`.
- Spawning from contracts, kernel linking, CI signing. Specified, not built. — `CHANGELOG.md:302`.
- Any machine but the founder's. {{gnomon.one-machine}} probe results come from one Mac, and no outside user has reported back yet. — the evidence dossier.
- Intel Macs, Windows, Linux. Refused at start. — `CHANGELOG.md:295`.

**Limits** (short list; each is a ledger row said plainly)

- Apple silicon only.
- Needs a Claude subscription. It refuses API-key billing.
- It shows spending. It does not cap it.
- The helper does not yet check its caller.
- Loops are off in the app you install.
- The evidence so far is from one machine.
- The sandbox uses `sandbox-exec`, which Apple has deprecated. The spec lists that as a residual risk.

**Requirements**

The four from the preflight: {{gnomon.requirements}}.

**Prints:** `gnomon.log-append`, `gnomon.threats`, `gnomon.spec-ids-tested`, `gnomon.ci-latest`, `gnomon.loops`, `gnomon.one-machine`, `gnomon.requirements`, `gnomon.spend`, `gnomon.helper-caller`, `gnomon.platform`. Standing rows: `standing.gnomon.ledger`.

---

## 7. Start

**Headline**

The first thing to do.

**Steps**

1. Check the four requirements above. Gnomon refuses to start a session if Claude Code is not the native install, or if an API key is set in your environment.
2. If you have not installed Paradigm yet, do that. It brings the `gnomon` command.

```
npm install -g @a-company/paradigm
```

3. In a repo, run it.

```
gnomon
```

4. Start a session and let it ask for something.

**What you should see**

A card on the stack. Approve it with Touch ID or your password. That card is the product: one request, one signed answer, one row in the log.

Links: Next — Warpline. Start the path.

**Prints:** none.
