## Aggregate — Warpline Move-3 dogfood (FULL)

Symbol-bearing concurrent admissions (denominator): **144**  ·  total concurrent: 144  ·  total admissions: 192  ·  sessions: 12

### Scoring labels
| label | count |
|---|---|
| FALSE-CLEAN | 8 |
| FALSE-KNOT | 3 |
| MEANING-DECISIVE:auto-resolve | 20 |
| MEANING-DECISIVE:silent-mismerge | 12 |
| agree-clean | 96 |
| agree-conflict | 5 |

### §3 metrics
| metric | value |
|---|---|
| meaning-decisive rate | 22.2% (32/144) |
| — auto-resolve wins | 20 |
| — silent-mismerge catches | 12 |
| false-KNOT count | 3 (guardrail: ≤ meaning-decisive 32 → OK) |
| FALSE-CLEAN (wrong-merge) | 8 (must be 0 → HARD STOP) |
| H1-wall rate (CLEAN unsealed / CLEAN) | 0.0% (0/124) |
| byte-fallback rate | 0.0% |
| moat: linked survival | 76.7% (graded n=30) |
| moat: independent survival | 79.3% (graded n=92) |
| moat: prior gap (linked − indep) | -2.7 pts |
| moat: two-proportion z-test | z=-0.311, p=0.7555  |

### §3.7 KILL evaluation
| gate | result |
|---|---|
| K1 meaning-decisive < 2% | false |
| K2 false-KNOT > meaning-decisive | false |
| K3 prior indistinguishable (gap<15pts OR p≥0.05) | true |
| hard-stop FALSE-CLEAN | true |

### Per-stratum outcomes
| stratum | n | warpline statuses | labels |
|---|---|---|---|
| AUTO-RESOLVE-WIN-indep | 10 | CLEAN:10 | MEANING-DECISIVE:auto-resolve:10 |
| AUTO-RESOLVE-WIN-linked | 10 | CLEAN:10 | MEANING-DECISIVE:auto-resolve:10 |
| INDEPENDENT | 80 | CLEAN:80 | FALSE-CLEAN:8, agree-clean:72 |
| LINKED-CLEAN | 21 | CLEAN:21 | agree-clean:21 |
| NEGATIVE-CONTROL | 3 | CLEAN:3 | agree-clean:3 |
| NEGCTRL-RIPPLE | 3 | KNOT:3 | FALSE-KNOT:3 |
| TRUE-INTERFERENCE-direct | 5 | KNOT:5 | agree-conflict:5 |
| TRUE-INTERFERENCE-ripple | 12 | KNOT:12 | MEANING-DECISIVE:silent-mismerge:12 |

### Classification fidelity (supplementary — not a pre-registered gate)
| stratum | expected confidence | as-expected | n |
|---|---|---|---|
| LINKED-CLEAN | linked | 100% | 21/21 |
| AUTO-RESOLVE-WIN-linked | linked | 100% | 10/10 |
| AUTO-RESOLVE-WIN-indep | independent | 100% | 10/10 |
| INDEPENDENT | independent | 100% | 80/80 |
| NEGATIVE-CONTROL | independent | 100% | 3/3 |

### Graded outcomes by prior class (grade.json)
| prior class | survived | overturned | pending |
|---|---|---|---|
| fast-admit | 21 | 7 | 0 |
| independent | 73 | 19 | 1 |
| linked | 23 | 7 | 1 |

### Machinery checks (full-run sanity)
| check | pass |
|---|---|
| admit_json_shape_ok | ✓ |
| no_admit_errors | ✓ |
| fast_admit_seen | ✓ |
| clean_linked_seen | ✓ |
| clean_independent_seen | ✓ |
| knot_seen | ✓ |
| h1_relaxation_merge_onto_merge | ✓ |
| meaning_decisive_fired | ✓ |
| silent_mismerge_caught | ✓ |
| negctrl_not_false_knot | ✓ |
| no_false_clean | ✗ |

**Machinery verdict: INCOMPLETE ✗**
