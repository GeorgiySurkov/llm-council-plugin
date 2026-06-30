# LLM Council — a Claude Code plugin

Ask a hard question and five advisors answer it, each from a different angle. They read each other's answers blind, with no names attached, and call out the weak spots. Then a chairman reads everything and writes the verdict. It all runs inside Claude Code, from a single command.

This is a Claude Code port of [Andrej Karpathy's `llm-council`](https://github.com/karpathy/llm-council): ask one question to several advisors, have them rank each other's answers blind, and let a chairman write the final verdict. His version gets its variety from different models — GPT, Gemini, Claude, Grok. This one runs on Claude subagents and gets its variety from **personas** instead, so you don't need OpenRouter keys or any model beyond the one Claude Code already runs on.

Unlike other Claude Code ports of the idea, the council runs on a deterministic workflow script rather than the model orchestrating itself. That buys a few things you can't get when the model runs its own process:

- **The blind review is blind by construction** — each answer loses its name and gets relabeled in code before anyone reviews it, so a reviewer can't favor a name they recognize.
- **The vote tally is real arithmetic** — the script counts the votes instead of asking the model who won.
- **Every step runs, in order** — no advisor gets skipped and no stage gets quietly merged, because the script decides what comes next, not the model.

## Install

From inside Claude Code, with the slash commands:

```
/plugin marketplace add GeorgiySurkov/llm-council-plugin
/plugin install llm-council@llm-council-workflow
```

Or from the CLI, with the same two steps — register the marketplace, then install the plugin from it:

```bash
# Add this repo as a plugin marketplace (its name is "llm-council-workflow")
claude plugin marketplace add GeorgiySurkov/llm-council-plugin

# Install the llm-council plugin from that marketplace
claude plugin install llm-council@llm-council-workflow
```

`marketplace add` takes anything `git clone` understands, so a URL works too if you'd rather be explicit: `claude plugin marketplace add https://github.com/GeorgiySurkov/llm-council-plugin`. The `plugin@marketplace` form in the install step is what ties the plugin name to the marketplace you just added.

Or run it without installing at all, straight from a clone of the repo:

```bash
claude --plugin-dir ./plugins/llm-council
```

Either way, kick it off by saying what you're deciding: "council this: should we drop Postgres for SQLite?" The skill triggers on phrases like *council this*, *should I X or Y*, *stress-test this*, *I'm torn between*.

## When it's worth running

Use it when a decision has real tradeoffs and a single answer feels too tidy. Things like:

- "Should I rewrite this service or keep patching it?"
- "Take the offer or stay?"
- "Which of these two architectures do we commit to?"

Skip it for factual lookups, yes/no questions, and anything low-stakes. Five advisors and a chairman is overkill for "what's the syntax for X."

The question can be about anything. The advisors are defined by how they think, not by a domain, so the same council works for a code-review call, a hiring decision, or where to take a holiday.

## How it works

Five advisors, each with one job:

- **The Contrarian** hunts for the fatal flaw you're not looking at.
- **The First Principles Thinker** strips the assumptions and reframes the problem from scratch.
- **The Expansionist** looks for upside everyone else is underrating.
- **The Outsider** answers with no domain expertise, to catch the curse of knowledge.
- **The Executor** ignores theory and tells you what to do Monday morning.

They answer independently. Then every answer gets stripped of its name, relabeled A–E, and handed to the others for review, so a reviewer judges the argument rather than the author. Each reviewer picks the strongest answer and the biggest blind spot, the votes get counted, and the chairman writes the final verdict. The chairman can overrule the majority when the minority argument is stronger.

You get two things back. The verdict prints straight into the chat: where the council agreed, where it clashed, the blind spots it caught, the recommendation, and the first concrete step to take. A full report also lands on disk:

```
council/<date>-<slug>/
  README.md       # index
  verdict.md      # the chairman's call
  question.md     # your question + how it got framed
  transcript.md   # everything in one file
  tally.json      # the vote count
  advisors/       # each advisor's full answer
  reviews/        # each blind review
```

## What's in the repo

```
llm-council-plugin/                  # this repo, which doubles as a marketplace
├── .claude-plugin/
│   └── marketplace.json             # marketplace manifest
└── plugins/
    └── llm-council/                 # the plugin itself
        ├── .claude-plugin/
        │   └── plugin.json          # plugin manifest
        └── skills/
            └── llm-council/         # the skill
                ├── SKILL.md         # instructions + trigger phrases
                ├── llm-council.js   # the workflow script
                └── save-report.mjs  # writes the report folder
```

The workflow isn't a separate plugin component (Claude Code has no such thing). It ships as a support file inside the skill and runs via `Workflow({ scriptPath })` at `${CLAUDE_SKILL_DIR}/llm-council.js`.

## Requirements

`save-report.mjs` runs under Node, so you need Node.js on your PATH. The workflow script itself is executed by Claude Code's host, so there's nothing else to install.
