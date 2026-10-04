# Final selection race fix

2026-10-02 JST. Changed src/discovery.ts only; existing tests unchanged.

Selection preserves the complete participating candidate snapshot before offline/scope/rank filtering. After the final asynchronous registry refresh, it compares that relevant registration set with the current authorized host/operation/role/explicit-target-filtered set. Any addition, removal or registration change returns registration_changed. It then recalculates freshness for every original participating observation before issuing the binding; stale outside-scope observations return blocked_unobserved. Explicit targets keep their isolated participant set. Fresh matched offline observations remain excluded through the existing reason semantics.

Actual verification:
- node --test tests/discovery.test.ts exit 0: 46 PASS, 0 FAIL. The two existing red race tests now pass.
- bash scripts/verify.sh exit 0: 66 PASS, 0 FAIL. Output captured in /tmp/claudex-race-verification.txt.

No new native observer, sending tool, abstraction, manifest or other documentation was added. Revalidation and existing authorization checks are unchanged. This is selection validation only and does not establish atomic native delivery.
