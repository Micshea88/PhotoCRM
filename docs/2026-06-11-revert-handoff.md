# Revert handoff — 2026-06-11

**Status: RESOLVED. Mike confirmed option (1). Revert executed, tier-2 green, pushed to origin/main.**

## Resolution (2026-06-11, later session)

Mike picked **option (1): target HEAD = 6540523**, verified 8-commit range (`75470ed` IN, `d35a800` OUT).

Executed:

- Reverted all 8 commits in order — **zero conflicts**: ab8e1e6, 17d5f24, 73327b7, 06e60a8, 0fb2e15, 3862299, 0e497cf, 75470ed
- `git diff 6540523 HEAD` → **empty** (tree byte-identical to target)
- `pnpm verify --tier=2` → **passed** (83.67s)
- Pushed: `ab8e1e6..2b5a70e  main -> main`

Migration `0044_light_jocasta.sql` was removed by the `0e497cf` revert. The DB column `call_log.disposition` remains in prod (harmless — nullable, future writes leave it null). No DB action taken, per the impact analysis below.

Production should now serve the working audio-fix state once Vercel redeploys `2b5a70e`. Mike to run the post-revert call tests (see "What Mike should test" below) and confirm Vercel routed `2b5a70e` to Production, not Preview.

---

## Original halt record (preserved below)

**Status: HALTED. No revert executed. Awaiting Mike's clarification on the revert target.**

## Why I stopped

Mike's executive-decision spec said to revert main back to commit `6540523` (the audio fix), naming this 8-commit list to revert (newest first):

```
ab8e1e6 — transfer cut + diag cleanup
17d5f24 — decline inbound + transfer disposition
73327b7 — observe-only inbound listener
0fb2e15 — diagnostic logs
06e60a8 — duration-only classifier
3862299 — duration fallback classifier
0e497cf — disposition classification + badge UI
d35a800 — auto-log outbound calls
```

His protocol step: _"(Confirm this list against `git log 6540523..HEAD --oneline` before reverting. If there are commits not in this list, stop and report.)"_

When I ran the confirmation, **the list does not match git history.** Two discrepancies:

1. **`d35a800` is NOT in the `6540523..HEAD` range.** It's an ancestor of `6540523`, not a descendant. Reverting to 6540523 means d35a800 stays in place (auto-logging continues to run at the target state).
2. **`75470ed` IS in the `6540523..HEAD` range** but Mike's list didn't name it. It's the "preserve loader's structured title for calls + M:SS duration format" commit (the entryTitleText fix + duration format fix).

### Actual main timeline (verified)

Oldest → newest, single-parent walk along main:

```
… → 996d4f1 → d35a800 → 6540523 (TARGET) → 75470ed → 0e497cf → 3862299 → 0fb2e15 → 06e60a8 → 73327b7 → 17d5f24 → ab8e1e6 (CURRENT HEAD)
```

### Verification commands run

```
git log --oneline 6540523 -1
  → 6540523 fix(telephony): stop local-mic loopback echo + apply DSP constraints to outbound audio

git log --oneline 6540523..HEAD
  → ab8e1e6, 17d5f24, 73327b7, 06e60a8, 0fb2e15, 3862299, 0e497cf, 75470ed
  (8 commits — none is d35a800; 75470ed is present)

git merge-base --is-ancestor d35a800 HEAD
  → "d35a800 IS ancestor of HEAD"

git merge-base --is-ancestor 6540523 HEAD
  → "6540523 IS ancestor of HEAD"

git log --oneline 75470ed~1 -1
  → 6540523 (confirms 75470ed's direct parent is 6540523)

git log d35a800 --max-count=3
  → d35a800 / 996d4f1 / cad853b
  (confirms d35a800's parent is 996d4f1, which sits BEFORE 6540523)
```

## Most likely intent — and the question Mike needs to answer

The most defensible reading of Mike's spec is **target HEAD = 6540523**:

- The named target is `6540523`
- The spec's working-state description matches 6540523's actual state (audio fix present, auto-log from d35a800 present, no disposition badges yet)
- "The ONLY thing missing was call disposition tracking on the activity feed" matches 6540523's reality: rows ARE being written by auto-log, but the badge/classifier work hadn't shipped yet

Under that interpretation, the actual revert list should be:

```
ab8e1e6   — transfer cut + diag cleanup
17d5f24   — decline inbound + transfer disposition
73327b7   — observe-only inbound listener
06e60a8   — duration-only classifier
0fb2e15   — diagnostic logs
3862299   — duration fallback classifier
0e497cf   — disposition classification + badge UI (+ migration 0044 adds `call_log.disposition` column)
75470ed   — preserve loader's structured title for calls + M:SS duration format
```

**d35a800 stays in place. 75470ed gets reverted.**

But Mike's spec listed `d35a800` for revert and didn't list `75470ed`. That could mean:

- **(A)** Mike's revert list was approximately written from memory, target HEAD is still 6540523, and the actual range to revert is what I derived above (`d35a800` not touched; `75470ed` added).
- **(B)** Mike intended a deeper revert — past 6540523 — back to a state where auto-log doesn't exist. In that case target would be d35a800's parent (`996d4f1`) and all of d35a800 + 6540523 + the eight subsequent commits get reverted. But this contradicts the named target of 6540523.
- **(C)** Something else I haven't considered.

Interpretation (A) seems vastly more likely given the named target. But the protocol said _"If you have ANY ambiguity, STOP"_, and this qualifies.

### Real-world impact of getting this wrong

- If Mike meant (A) but I executed (B): auto-log row writes would also disappear → no `call_log` rows being written → activity feed shows empty for new calls, no recovery without re-deploying d35a800.
- If Mike meant (B) but I executed (A): auto-log keeps running but writes rows that won't render any useful UI (no disposition badge, possibly broken title). Activity feed shows "Call by Mike" with no duration. Mike's described "working state" is preserved on the SIP/audio side but the activity-feed UX regression Mike accepted is what he'd see.
- If a revert touches `0e497cf` but not its companion migration (`0044_light_jocasta.sql`), the schema column `call_log.disposition` will remain in the DB while the code that writes it has been reverted out. **Harmless** — column is nullable, future writes leave it null, existing 10 backfilled rows still hold their values. **No DB action needed** if Mike confirms (A).

## What I need Mike to confirm before I execute anything

Pick one:

1. **Target HEAD = 6540523, revert list is the verified 8-commit range (`75470ed` IN, `d35a800` OUT).** This is my recommendation.
2. **Target HEAD is something other than 6540523** (e.g., `d35a800`'s parent `996d4f1`, if you really want auto-log gone too).
3. **Something else I missed.**

I will not execute a revert until Mike confirms the target.

## Current state of the repo (as of this halt)

- Branch: `main`
- HEAD: `ab8e1e6` (the cut + finalize commit that broke outbound audio)
- Working tree: clean, no uncommitted changes, no in-flight revert
- `origin/main` is at `ab8e1e6` — production code is the broken state
- Vercel: previously routed `ab8e1e6` to a Preview deployment (Mike's earlier observation). Production is still serving an older deploy. Mike should manually verify whether production is currently on `17d5f24` or somewhere else via the Vercel dashboard.

## When Mike returns

To unblock: paste a quick "Confirm option (1)" or "Use option (2) instead" and I'll execute the revert + tier-2 + push without further prompts. I have the verified commit list ready for either path.

If Mike picks option (1) — the recommendation — the execution sequence is:

```
git checkout main
git pull origin main
git revert ab8e1e6 --no-edit
git revert 17d5f24 --no-edit
git revert 73327b7 --no-edit
git revert 06e60a8 --no-edit
git revert 0fb2e15 --no-edit
git revert 3862299 --no-edit
git revert 0e497cf --no-edit
git revert 75470ed --no-edit
pnpm verify --tier=2
# if green: git push origin main
# if red: STOP, append failure to this doc
```

Stop conditions still in effect: any conflict during a revert → STOP. Any tier-2 failure → STOP. Any Vercel routing-to-Preview → STOP.

## What Mike should test once the system is back to working state

(Carrying forward from Mike's protocol step 6.4)

1. **Outbound call → audio both ways → hangup.** Confirm recipient heard Mike clearly.
2. **Transfer call test.** Mike's phone rings → he answers → bridge stays connected → recipient stays connected.
3. **Receive an inbound call.** Goes to RC mobile per his usual routing → Pathway does NOT hijack the laptop.

## The original problem that started today's chain

The activity feed didn't show call duration / outcome cleanly. "Call by Mike" rendered for every call regardless of how it ended. That render-side regression (the `entryTitleText` discarding the structured title) was then chased through 8 commits today, accumulating disposition-classification work, an SDK-event diagnostic round, an attempted inbound suppression, and finally a feature cut — culminating in an outbound-audio regression on the cut commit `ab8e1e6`.

## Notes for the safer-approach-next-time conversation

When the team revisits disposition tracking after the revert lands:

- **Smaller, more targeted change scope.** The disposition + badge work was 16 files in one push. Future attempts should split into (a) a passive `call_log` write that observes session lifecycle without modifying SDK behavior, (b) a separate UI badge addition, (c) only then tackle classification.
- **Live audio testing required before merge.** Tier-2 verifies typecheck/lint/tests/build. It does NOT test that a real outbound call still has audio. The audio regression introduced today (mediaStreamSet handler removed in the cut commit) was caught by tier-2 as clean. A real human-on-the-phone test would have caught it pre-merge.
- **Don't touch `transferToMobile` or inbound listeners** unless the change is specifically about transfer or inbound. The disposition work today reached into both and that's how the audio handler chain got disturbed.
- **Test in a Preview deployment, not directly to Production.** Mike's earlier observation that `ab8e1e6` routed to Preview turns out to be useful for this kind of high-risk change. Future high-risk telephony work should run on Preview with a manual UAT call before promotion to Production.
- **Be skeptical of SDK contract claims.** Three separate SDK ordering assumptions were wrong in today's chain (the "race-free" transfer comment, the `previousKind` signal being meaningful, the no-handler-means-no-inbound assumption). When tackling SDK integration, instrument first (the diagnostic-log commits did this well) and verify against live ground truth before designing on top of inferred behavior.

---

# Transfer diagnosis & final decision (2026-06-11/12)

**Decision: transfer is CUT. `main` restored to the `ab8e1e6` state (commit `3ff3234`).** The revert detour above (`2b5a70e`) was unnecessary — the audio issue was environmental, and the investigation below confirmed transfer never worked end-to-end. `ab8e1e6` already has transfer removed + working disposition badges + M:SS duration.

> **Correction to the detour record above:** the "safer-approach" note claiming the _cut commit removed the `mediaStreamSet` handler_ is **wrong**. Verified `ab8e1e6` RETAINS the `mediaStreamSet` DSP handler (`applyConstraints` + echoCancellation/noiseSuppression/autoGainControl, lines 311-317). The `6540523` audio fix is intact at `ab8e1e6`. Restoring to `ab8e1e6` did not reintroduce a code-level audio regression.

## Why transfer never worked (investigation, code-grounded)

Symptom: Mike clicks Transfer → his mobile rings → answering = dead call → original recipient → K&K voicemail. Audio + outbound calls fine; only transfer broken.

**Failure point:** `transferToMobile()` (`use-web-phone.ts`) calls the SDK's cold/blind `transfer()` → `_transfer()` sends a SIP **REFER** and resolves the promise **the instant RC returns a BYE for the desktop leg** — it never confirms the transferee answered or that a media bridge formed (verified in `node_modules/ringcentral-web-phone@2.4.4/dist/call-session/index.mjs`; README confirms "the current call session will auto end since SIP server will send a BYE").

What RC actually does with the REFER:

1. Accepts REFER, sends BYE to the WebPhone → `_transfer()` resolves → Pathway dispatches `session_ended reason:"transferred"` + `onTransferred`. **Pathway believes it succeeded (false positive).**
2. Forks the new leg to BOTH Mike's mobile (PSTN) AND the still-registered WebPhone (same RC extension).
3. WebPhone gets an inbound INVITE → SDK auto-replies 100/180 Ringing → `confirmReceive` → then stops: it only auto-answers `Alert-Info: Auto Answer` calls, and **Pathway registers no `inboundCall` handler anywhere** (`grep inboundCall src/ app/` → none). The leg rings forever.
4. Bridge never completes → recipient → voicemail, mobile → dead air.

**Could it ever have worked in this code state? No.** No `inboundCall` handler has ever existed; `transfer()` has always been bare REFER-and-wait-for-BYE. The only "success" signal was the BYE — a false positive — which is likely why the prior 8-commit chase targeted the wrong layer.

**What a correct rebuild would require (NOT built):**

- Use RC's `flip()` (purpose-built for "move my call to my own phone"), NOT cold `transfer()`. Caveat per README: flip does NOT auto-end the desktop session — the app must `hangup()` the desktop leg _after_ the mobile answers, or "you won't be able to talk/listen on your mobile phone" (exactly Mike's dead-call symptom). OR
- Register an `inboundCall` handler that answers/declines the REFER-back forked leg (drags in 3b inbound infra).
- Either way: stop treating the BYE-resolved promise as success; tie success to the transferee leg being answered.
- Verify on a **Preview deployment with a live UAT call** — tier-2 cannot catch SIP/media runtime behavior.
- Confirm what extension `userMobile` actually rings (memory #16: Pathway's RC grant ties to a user whose caller-ID is the Main Company Number — the "K&K voicemail" landing suggests the target resolves to the main company tree).

---

End of handoff doc.
