# Gnomon mod naming and versioning (slice S0b of the Desk O1)

Status: design RATIFIED 2026-10-20. Founder approved the direction. Arky wrote the design; Aegis ruled APPROVE-WITH-FIXES, and all fixes are folded in below. Founder rulings are marked **[F]**.
Lore: L-2026-10-20-ascend-213259-001 (approval) and L-2026-10-20-ascend-213931-001 (design). Implementation lands on the integration branch `feat/gnomon-desk-o1`, after S0 to S3 merge.

## 1. Identity

| Item | Rule |
|---|---|
| publisher | `^[a-z0-9](?:[a-z0-9]\|-(?=[a-z0-9])){0,38}$` (1..39). ASCII only, with no `u` flag; a test pins this. Declared in manifest:2 `publisher`. |
| name | `^[a-z](?:[a-z0-9]\|-(?=[a-z0-9])){0,23}$` (1..24) |
| mod id | `<publisher>.<name>`. The total must be ≤ 60, checked SEPARATELY from the segment regexes, since 39+1+24 = 64 (boundary test). The principal label becomes `mod-<publisher>.<name>`. |
| first-party | Publisher `gnomon`, AND the FIRST_PARTY_PACKAGE_HASHES pin at stage / the root-signed grant.trust tier at load. Both directions are refused with PUBLISHER. |
| `local` | Assigned by the kernel only (format-1 alias mapping). A manifest that declares `local` is refused. |
| folder publisher | Any non-reserved publisher, shown as "(unverified, local folder)" EVERYWHERE the id appears: card, principal label, offers, roster, MCP surfaces. |
| git publisher, github.com | Must equal the URL owner (first path segment, lowercased). |
| git publisher, other hosts **[F: allowed in 8.0]** | Publisher identity is `(host, namespace)`, where namespace = every path segment except the repo (this covers GitLab subgroups). The first approved install records a root-signed `grant.publisher{publisher, host, namespace}` (TOFU). A later install claiming the same publisher from a different host or namespace is refused (PUBLISHER) unless the human re-binds it through a full card. A non-GitHub publisher ALWAYS displays with its host: `acme @ gitlab.com`. github.com owners bind implicitly by the owner rule, and an explicit binding on another host for the same publisher string is refused unless re-bound by a card. |

### Reserved publishers
- Kernel and platform: gnomon (first-party only), local (kernel-assigned only), kernel, system, paradigm, claude, anthropic, admin, root, first-party, mod, mods, modns, desk, mcp, core, builtin, human, user, plus KERNEL_NAMESPACE_TOKENS. KERNEL_NAMESPACE_TOKENS is checked against the publisher AND the name.
- Windows device names: con, prn, aux, nul, com0-9, lpt0-9. These apply to the publisher AND the name.
- Legacy and first-party mod names: workshop, ledger, paradigm-context, neurons, constellation (all of FIRST_PARTY_MOD_NAMES).
- **[F]** Founder brands: ascend42, a-company, warpline, nevr, nevrland, conductor.
  - `ascend42` is allowed only as the github.com owner `ascend42`. Folder claims and skeleton matches are refused.
  - `a-company` is refused from EVERY source. github.com/a-company belongs to an unrelated person.
  - warpline, nevr, nevrland and conductor are refused from every source until the founder binds an owner.
- A git owner equal to a reserved publisher is refused with PUBLISHER. It is never downgraded.
- Confusable skeleton, a fixed compiled transform: lowercase, strip `-`, then 0→o, 1→l, i→l, 3→e, 5→s, rn→m, vv→w, cl→d.
  - A match against a reserved publisher or a first-party mod name is refused.
  - A match against another installed third-party publisher gets a "looks like `<other>` (installed)" card line, which stays visible on the short update card.

### Display
- Glyph + name.
- The publisher is always on the install card, and shown elsewhere on a name clash, for an unverified publisher, or for a non-GitHub host.
- Non-gnomon publishers stay REFUSED from first-party mod names and prefixes and their skeletons. "Always shows its publisher" is not reliable on MCP, LLM and truncated surfaces.

## 2. Derived names

| Item | Rule |
|---|---|
| events | `modns.<publisher>.<name>.*`. The kernel keeps `mod.*`. Ownership checks match whole segments with a trailing dot. |
| MCP server | `gm_<publisher>_<name>` if ≤ 28 characters, else `gx_<name[0..13]>_<hash10>`, where hash10 = lowercase base32 of sha256(id). `-` is never turned into `_`. At install AND at load, refuse with COLLISION any server name equal to one already installed or in the user's `.mcp.json`. Repo mcp.json entries starting with `gm_`, `gx_` or `gnomon-` are dropped (S1 H1). |
| tool cap | The whole `mcp__<server>__<tool>` is ≤ 64. It is checked for every handoffTool at install AND re-checked at load. |
| env own-prefix | third-party `<PUB>__<NAME>__` (double underscore; hyphens become single `_`, so `__` can't be forged); first-party `<NAME>__` plus the upstream server's own vars. The env denylist runs AFTER the prefix allowance and is never skipped. MCP_ENV_NAME cap is 127. Secret-marked env names are refused in the override (S1 M2). |
| playbook | `skills/<name>/SKILL.md`. Per A7, its prose loads only at first-party or signed tiers. |
| provides.mcp | At most 1 entry in manifest:2, and the entry has no `name` key. The kernel derives the name. |

## 3. Versioning
- **Mod version:** semver `version`, max 64 characters, prerelease bounded.
  - The card line (index 3, after `runs commands`) is decided by comparing the packageHash against approved history, NOT by semver alone. The classes: first / update / downgrade / same-version-new-bytes / format-only.
  - A short card only when the widening set is empty.
  - A downgrade always shows a prominent DOWNGRADE line, even to a previously approved version.
  - Follow-up: a kernel-compiled yanked-packageHash list.
- **Git source:**
  - The source string is `git:<canonical https url>#<sha40>`.
  - Canonical form: lowercase host; no userinfo, port, query or percent-encoding; no dot segments.
  - Fetch with `http.followRedirects=false` (repo-jacking). The other D4 clone flags are in S4.
  - sha40 is the fetch locator only. Integrity comes from the packageHash (sha256), verified at stage and at load.
  - A sha256-format repo (64 hex) is refused in 8.0.
  - On update, a changed owner, host or namespace is a source change and gets the full card.
- **Folder replacing git (same id):** a source change. Always the full card, never coexisting. Tested.
- **Format:**
  - `manifest` is an integer. CURRENT = 2; accepted = [1, 2] for LOADING existing pins and historical first-party hashes only. FRESH format-1 installs are refused.
  - `upgradeManifestV1` is pure. It reads only the raw object plus the kernel-derived publisher (alias table: `gnomon` or `local`), and never writes to disk.
  - The full V2 validator always runs after upgrading.
  - The install grant records `upgradedHash`. A mismatch at load re-cards through the widening check.
  - manifestHash = raw bytes; widening compares V2 vs V2.
  - An unknown future major is refused with FORMAT ("needs Gnomon ≥ X").
  - Format-invariant keys: manifest, publisher, name, version, engines.
- **Compatibility:**
  - `engines.gnomon` uses a small TOKENIZER, never a regex. Only `>= > <= < =` comparators, space-joined (AND), max 64 characters.
  - It is refused with ENGINE at stage and at load.
  - `abi: "mod-abi:vN"` follows the N/N−1 rule.
  - No modAbiId range.
- **What moves which id:** clientApiId moves for desk.modId, the request.mod.install `commit`, the offer-spec handoffTool pattern, and published refusal codes. modAbiId does not move.

## 4. Migration
- The bundled workshop, ledger and paradigm-context move to manifest:2, publisher gnomon, 1.1.0, and are repinned.
- The workshop event becomes `modns.gnomon.workshop.moved`.
- The alias table is a frozen compiled constant. A legacy bare name maps to `gnomon.N` only if N ∈ {workshop, ledger, paradigm-context} AND the grant.trust tier is first-party AND the packageHash is a historical first-party pin. Anything else maps to `local.N`.
- Migration happens at read time only, never by rewriting.
- A test fails if format-1 support is removed while the table remains.
- Only alias-table entries may append their legacy `modns.<legacyName>.*`. A `local.N` mod gets `modns.local.N.*`.
- grant.install/uninstall use a versioned row schema for full ids. Older kernels fail closed on new rows (documented).
- `request.offer.mute` = `{mod, scope:'repo', hsid, muted}`. The kernel derives the repo from the session and writes `offer.muted{mod, repo, muted, hsid}`. Unmuting from Settings with no live session is deferred.
- neurons-brain → `gnomon.neurons` (server `gm_gnomon_neurons`); constellation → `gnomon.constellation`.
