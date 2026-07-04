## Aggregate — Warpline Move-3 dogfood (PILOT)

Symbol-bearing concurrent admissions (denominator): **8**  ·  total concurrent: 8  ·  total admissions: 12

### Scoring labels
| label | count |
|---|---|
| MEANING-DECISIVE:silent-mismerge | 2 |
| agree-clean | 6 |

### §3 metrics
| metric | value |
|---|---|
| meaning-decisive rate | 25.0% (2/8) |
| — auto-resolve wins | 0 |
| — silent-mismerge catches | 2 |
| false-KNOT count | 0 (guardrail: ≤ meaning-decisive 2 → OK) |
| FALSE-CLEAN (wrong-merge) | 0 (must be 0 → OK) |
| H1-wall rate (CLEAN unsealed / CLEAN) | 0.0% |
| byte-fallback rate | 0.0% |
| moat: linked survival | 100% |
| moat: independent survival | 100% |
| moat: prior gap (linked − indep) | 0 pts |

### §3.7 KILL evaluation
| gate | result |
|---|---|
| K1 meaning-decisive < 2% | not-powered |
| K2 false-KNOT > meaning-decisive | false |
| K3 prior indistinguishable | not-powered |
| hard-stop FALSE-CLEAN | false |

### Machinery checks (the PILOT gate)
| check | pass |
|---|---|
| admit_json_shape_ok | ✓ |
| fast_admit_seen | ✓ |
| clean_linked_seen | ✓ |
| clean_independent_seen | ✓ |
| knot_seen | ✓ |
| h1_relaxation_merge_onto_merge | ✓ |
| meaning_decisive_fired | ✓ |
| silent_mismerge_caught | ✓ |
| negctrl_not_false_knot | ✓ |
| no_false_clean | ✓ |

**Machinery verdict: WORKS ✓**
