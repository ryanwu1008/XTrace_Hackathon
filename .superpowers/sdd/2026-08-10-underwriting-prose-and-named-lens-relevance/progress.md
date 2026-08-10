# SDD ledger — plan: docs/superpowers/plans/2026-08-10-underwriting-prose-and-named-lens-relevance.md

Baseline: 45dd7b1 — npm test: 1644 tests, 1573 passed, 0 failed, 71 skipped.
Task 1: fix round 1/5 (3 addressed, 0 open — semantic audit; immutable resolver; loader digest propagation; commits 4c92451..8bc1cb4)
Task 1: complete (commits 45dd7b1..8bc1cb4, review clean)
Task 2: minor (deferred): add focused negative finalization tests for empty attempt coverage, sub-four completed selections, swapped judgment/passage identities, unresolved evidence IDs, incorrect classifications, and inconsistent presentation refs; fix-round covering tests may absorb these.
Task 2: fix round 1/5 (6 addressed, 3 open — component Card grounding; ranked presentation order; unknown/conclusion citation resolution; commits 9a0121f..88ecb72)
Task 2: fix round 2/5 (3 addressed, 0 open — exact component grounding; ranked presentation order; segment citation resolution; commits 88ecb72..1662189)
Task 2: minor resolved in fix rounds: focused negative finalization coverage added for the previously deferred cases.
Task 2: complete (commits 8bc1cb4..1662189, review clean)
Task 3: minor (deferred): replace free-form withheld/unavailable reason-code uppercasing with a typed audit vocabulary; final review must triage this before merge.
Task 3: fix round 1/5 (3 addressed, 0 open — canonical Sample source IDs; selected-only synthesis; exact passage word counting; commits 890dee9..476d8ed)
Task 3: complete (commits 1662189..476d8ed, review clean)
Task 4: minor (deferred): expand plain-text validation to reject inline code, ordered-list, and single-marker emphasis Markdown; final review must triage before merge.
Task 4: fix round 1/5 (2 addressed, 2 open — cache idempotence and cache candidate integrity addressed; prose safety and withheld replay contract remain open; commits d55366b..30138c1)
Task 4: fix round 2/5 (1 addressed, 1 open — all stage outcomes and input fingerprints now bind the exact current contract; prose safety remains open; commits 30138c1..590c2bf)
Task 4: fix round 3/5 (structural person-alias, same-sentence advice/action, and quote classification implemented; 2 open — action morphology and quote-internal apostrophe parsing; uncommitted fix based on 590c2bf)
Task 4: fix round 4/5 (taxonomy-derived action morphology and delimiter scanner implemented; 2 open — abbreviation-aware sentence segmentation and ambiguous unmatched-single-quote pairing; uncommitted fix based on 590c2bf)
Task 4: fix round 5/5 (2 addressed, 1 open — formal sentence segmentation and marker-level apostrophe policy addressed; rare Unicode quotation-marker inventory remains; commits 590c2bf..b8426e0)
Task 4: parked — rare Unicode quotation markers `⹂`, `﹁﹂﹃﹄`, `｢｣`, and contextual `＇` are not yet classified — ruling: real but deferred under the product owner's explicit functional-demo/avoid-edge-case priority; standard English, common curly, guillemet, and standard CJK quote families are fail-closed, all 75 focused tests pass, and no downstream interface depends on accepting these rare code points. Final whole-branch review must re-triage before release.
Task 4: complete (commits 476d8ed..b8426e0, 1 parked)
Task 5: fix round 1/5 (5 addressed, 0 open — saved catalog authority; deep passage/presentation grounding; typed null-safe versions and identities; exact attempt-set authorization; ACL/lifecycle negatives; based on 0924eb1)
Task 5: complete through fix round 1 (fresh PostgreSQL 17.6 focused 6/6 and broad 34/34; static 43 passed, 0 failed, 6 expected skips; no production changes)
Task 5: fix round 2/5 (1 addressed, 0 open — bidirectional authoritative applicable judgment and eligible catalog equality; based on 5a8aefe)
Task 5: complete through fix round 2 (fresh PostgreSQL 17.6 focused 6/6 and broad 34/34; static 43 passed, 0 failed, 6 expected skips; typecheck and release bookkeeping clean)
Task 6: controller prep gaps resolved (requested/source identity; immutable logical attempts; durable/checkpoint/provider ordering; timeout terminal ownership; honest USD telemetry; formal-artifact-preserving partials; completed/partial reuse; five-segment passage reconstruction; disposition-owned catalog reconstruction)
Task 6: verification complete (seven-file 109 passed, 0 failed, 9 expected skips; nominal four-file 72 passed, 0 failed, 9 expected skips; extra unit 37/37; typecheck/lint/diff-check clean; no production/deploy changes)
Task 6: review round 1/5 (2 addressed, 0 Task 6 open — versioned non-null USD telemetry; critical-incomplete available-decision preservation; one immutable-attempt/late-alias integration concern assigned to Task 7 pre-provider reuse normalization)
