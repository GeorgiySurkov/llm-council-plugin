---
name: llm-council
description: Use when a decision has real tradeoffs and needs multiple independent perspectives before committing — triggers "council this", "run the council", "war room this", "pressure-test this", "stress-test this", "debate this", "should I X or Y", "which option", "what would you do", "validate this", "get multiple perspectives", "I can't decide", "I'm torn between". Runs a 5-advisor council with blind peer review and a chairman synthesis via a bundled workflow script. Do NOT use for simple yes/no, factual lookups, or low-stakes questions.
---

# LLM Council

Runs a question through 5 persona advisors with different thinking styles, then a blind
peer review and a chairman synthesis. All the mechanics (fan-out, A–E anonymization,
de-anonymization, vote tallying) are deterministic JS; the model is only responsible for
content (reasoning, reviews, synthesis).

**The skill is self-contained.** Two files live next to this `SKILL.md` and travel with the
skill (including inside the plugin):
- `llm-council.js` — the workflow script itself (run by the `Workflow` tool via `scriptPath`).
- `save-report.mjs` — a helper that lays the result out into a folder tree.

The path to this folder is available at runtime as `$CLAUDE_SKILL_DIR` (in bash commands inside the skill).
If the variable isn't available — it's the directory this `SKILL.md` lives in.

## When to run

Run it when there are **real stakes and tradeoffs**. Do NOT run it on simple yes/no questions,
factual lookups, or small inconsequential questions.

## How to run

1. **Determine the skill folder.** Run in Bash: `echo "$CLAUDE_SKILL_DIR"` — this gives the
   absolute path `DIR` to this folder (where `llm-council.js` and `save-report.mjs` live).

2. **Assemble the question.** Take the user's phrasing. The workflow's Frame phase reads the
   working-directory context (CLAUDE.md, memory/, mentioned files) on its own.

3. **Run the workflow** with the `Workflow` tool, passing the path to the script:
   ```
   Workflow({ scriptPath: "<DIR>/llm-council.js", args: { question: "<the user's question>" } })
   ```
   `args` can also be passed as a plain string. The workflow returns an object:
   `{ question, slug, framed, advisors[], reviews[], tally, verdict }`.

   _(Alternative for one-off local runs: drop a copy of `llm-council.js` into
   `.claude/workflows/` and call `Workflow({ name: "llm-council" })`. In the plugin we use `scriptPath`.)_

4. **Show the verdict** in chat as markdown (not as HTML files), section by section from `verdict`:
   - **Where the Council Agrees** — `verdict.agreements`
   - **Where the Council Clashes** — `verdict.clashes`
   - **Blind Spots the Council Caught** — `verdict.blindSpots`
   - **The Recommendation** — `verdict.recommendation`
   - **The One Thing to Do First** — `verdict.firstStep`

   Keep it scan-friendly: bullets, clear headings. `tally` ("who was judged strongest")
   can be shown as a short summary.

5. **Save the structured report (always).** The workflow script has no filesystem access,
   so the helper `save-report.mjs` does the folder-tree layout.
   - Write the object returned by the workflow as-is to a JSON file (a temporary
     scratchpad folder is fine), e.g. `result.json`.
   - Run the helper:
     ```
     node "<DIR>/save-report.mjs" <path to result.json> [baseDir]
     ```
     `baseDir` defaults to `council` (in the current working directory). The helper prints the
     path of the created folder — show it to the user.
   - Report structure:
     ```
     council/<YYYY-MM-DD-HHMM>-<slug>/
       README.md        # index
       verdict.md       # the chairman's verdict (header document)
       question.md      # original question + framing
       transcript.md    # everything in one file
       tally.json       # vote count
       advisors/NN-<id>.md
       reviews/review-NN.md
     ```
   - The workflow computes the `slug` for the folder name itself (deterministically); the helper sets the `timestamp`.

## Notes

- All advisors and reviewers are Claude subagents; the diversification comes from **personas**
  (thinking styles), not from different vendors.
- Blind review is guaranteed structurally: the reviewer subagent only ever receives the
  anonymized A–E text; the "letter → advisor" mapping stays inside the script.
- The chairman may go against the majority when the arguments are stronger.
