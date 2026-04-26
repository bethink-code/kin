---
name: When testing, audit content + latency + navigation — not just wiring
description: After an e2e or smoke run, the audit pass covers three things — what was said (content vs project rules), how long it took (latency vs reasonable bar), and whether the obvious next click actually works (navigation paths). "All assertions passed" only means wiring works; it says nothing about whether a real user would be happy.
type: feedback
---

When I run e2e walkthroughs or smoke tests, my default has been to assert that wiring works (messages got persisted, notes got written, state-changes fired) and treat that as "passed." That's incomplete on three fronts. Garth has had to flag all three of them after I shipped:

1. **Content** — Ally said *"From here, we move into the advice conversation"* in my smoke output. Direct FAIS violation. I had the transcript and didn't read it for tone.
2. **Latency** — Smoke output literally printed `analyseStatements done in 89.142s` and `buildAnalysisDraft done in 157s`. I logged the numbers but didn't flag them as "this is unacceptable for a real user." Garth had to come back later and tell me "Ally is so slow."
3. **Navigation** — I never tested click paths in the smoke. I called `agreeSubStep` and `onStateChange` directly. The "See your analysis" → peek-loop bug only surfaced when Garth clicked a button in the actual UI.

**Why this matters:** "Wiring passed" only means *the message reached the database* / *the function executed*. It says nothing about what the message said, how long it took, or whether the obvious next click does what the user expects. With deterministic code, those are usually the same thing. With LLM output and complex routing, they aren't.

**How to apply** — after wiring assertions pass, run three explicit audits:

### 1. Content audit
Read every LLM-generated turn / artefact against:
- **No advice language.** Forbidden: "advice", "advise", "recommend", "suggest", "you should". The next phase is the *plan*, never "the advice conversation."
- **No prescribed products / providers / specific actions.** No "open an X at Y", no "switch to Z."
- **No financial-planning jargon framed as recommendation.** Topic = fine, prescription = not.
- **Voice fits.** Warm, observational, plain language. No corporate hedging, no bullet summaries unless the spec calls for them.
- **Project-specific copy rules.** Always "record of conversation", never "record of advice". Other naming rules in CLAUDE.md and memories.

If a violation is in LLM output, it's almost always a prompt issue, not a wiring issue. Fix the prompt before claiming the system works.

### 2. Latency audit
Flag any timing that wouldn't fly for a real user:
- **Chat turn > 5s** — too long. Investigate model, max_tokens, payload size, caching.
- **Analyse / generation > 30s** — too long for a foreground "Ally is working" wait. The story rotator only buys you so much patience.
- **GET endpoint > 1s** — slow page load. Check DB query, parallelism.
- **Cache miss when it should hit** — `cache_read_tokens = 0` on a turn that should have cache. Verify breakpoints.

Log the numbers in the report. Don't just say "test took 5 minutes" — break it down per call so the slow one is visible.

### 3. Navigation audit
For every button / CTA introduced, verify the click path actually works end-to-end against the real backend. Not by calling the underlying function directly — by simulating the same data flow the click would trigger. Specifically:
- **Each forward CTA**: clicking it lands you on the screen the label promises (not a peek view, not a loop, not the same screen).
- **Each beat tile in the canvas pill**: navigates without dead-ending.
- **Recovery paths**: after an error or peek, the "back" / "see result" path returns the user somewhere coherent.
- **Browser refresh on each beat**: lands you on the same beat, not stuck in a loading state.

If I can't drive a real browser, I can at least trace the routing logic with the same state the click would produce — verify `effectiveBeat` and `effectiveCanvas` resolve to the right component before declaring the path works.

### Trigger
Any time I run a script that generates LLM output, advances state, or wires a new UI path. Three audits, named explicitly in the report. Never "all assertions passed ✓" without the content / latency / nav columns filled in.
