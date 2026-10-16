# Arky — confirmation pass on gnomon.md v2 (2026-10-15)

20 findings: 15 closed, 3 partial, 0 open. 12 new citations spot-checked, 11 accurate (agents.ts:447-452 misses --model at :454).
Partial: (a) admission oracle uses shadowAdmit, but which credential p:kernel presents to warplined is unstated (kernel holds no Warpline token under D14) — L497; (b) node id still embeds contractId[0..12] while contractId hashes nodes — exclude id from the preimage or hash only refs (L360, 364); (c) M1.6 still carries G-KRN-01 (needs a permit; fuse is M1.7) and G-RUN-04 (needs M1.12 clients) — move to M1.12 or put M1.7 before M1.6 (L772, 778).
New defects:
1. No producer for `contract.built` (claim expiry L507, next-verb rule L433 depend on it); sessions have no log.append (L420); kernel-owned list (L429) omits built and claim though §9.1 L581 lists them → node lifecycle can't progress in git mode. Fix: contract.claim{op:'built'} or supervisor-derived; kernel-owned.
2. Appendix A heading outside the skip rule (rule 1 L477 opens sections only at numbered headings) → its rows fall into §A.2 and ~70 ids bind to ^certified/#oracle-sandbox; G-HON-01 fails. Fix: `(compile: skip)` applies to any heading.
3. Namespace ownership has no default: verdict.founder (feeds credit, L527), gate-class, blob.pruned, digest.consumed unlisted (L429) → forging path; loop.paused written by the kernel (L545) in a userland namespace. Fix: anything unlisted is kernel-owned.
4. Repo id from the root commit collides across clones and is undefined for shallow/multi-root repos (L292). Fix: root commit + repoId in project.yaml.
5. Minor: CAS_LOST reuses exit code 5 (STALE_BASE, refusal.ts:225); L716 "compile ops proxy the kernel" contradicts L476; Session column allows contract.register (L424); L444 budget.release → permit.release.
