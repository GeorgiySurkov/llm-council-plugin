#!/usr/bin/env node
// Lays the result of the `llm-council` workflow out into a structured folder tree.
// This is a plain node script (NOT a workflow script), so Date/fs are available here.
//
// Usage:
//   node save-report.mjs <result.json> [baseDir]
// where result.json is the JSON returned by the workflow:
//   { question, slug, framed, advisors[], reviews[], tally, verdict }
// baseDir defaults to "council" (relative to the current working directory).
//
// Prints the absolute path of the created report folder to stdout.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , resultPath, baseDirArg] = process.argv
if (!resultPath) {
  console.error('Usage: node save-report.mjs <result.json> [baseDir]')
  process.exit(1)
}

const r = JSON.parse(readFileSync(resultPath, 'utf8'))
const baseDir = baseDirArg || 'council'

// ── Folder name: <timestamp>-<slug> ────────────────────────────────────────
const d = new Date()
const p = (n) => String(n).padStart(2, '0')
const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`

function slugify(s) {
  const base = String(s ?? '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .split(/\s+/).slice(0, 6).join('-')
    .replace(/-+/g, '-')
    .slice(0, 50)
  return base || 'council'
}
const slug = r.slug || slugify(r.question)

const root = resolve(baseDir, `${ts}-${slug}`)
const advisorsDir = join(root, 'advisors')
const reviewsDir = join(root, 'reviews')
mkdirSync(advisorsDir, { recursive: true })
mkdirSync(reviewsDir, { recursive: true })

const advisors = Array.isArray(r.advisors) ? r.advisors : []
const reviews = Array.isArray(r.reviews) ? r.reviews : []
const v = r.verdict || {}

// ── verdict.md (header document) ───────────────────────────────────────────
const verdictMd = `# Council verdict

> ${(r.question || '').trim()}

## Where the Council Agrees
${v.agreements || '—'}

## Where the Council Clashes
${v.clashes || '—'}

## Blind Spots the Council Caught
${v.blindSpots || '—'}

## The Recommendation
${v.recommendation || '—'}

## The One Thing to Do First
${v.firstStep || '—'}
`
writeFileSync(join(root, 'verdict.md'), verdictMd)

// ── question.md ────────────────────────────────────────────────────────────
writeFileSync(join(root, 'question.md'),
  `# Question\n\n## Original phrasing\n${r.question || '—'}\n\n## Framing (with context)\n${r.framed || '—'}\n`)

// ── advisors/NN-id.md ──────────────────────────────────────────────────────
advisors.forEach((a, i) => {
  const name = `${p(i + 1)}-${a.id || 'advisor'}.md`
  writeFileSync(join(advisorsDir, name),
    `# ${a.name || a.id || 'Advisor'}\n\n${a.response || '—'}\n`)
})

// ── reviews/review-NN.md ───────────────────────────────────────────────────
reviews.forEach((rv, i) => {
  const md = `# Review ${p(i + 1)}

**Strongest:** ${rv.strongest?.name || '—'}
${rv.strongestWhy || ''}

**Blind spot:** ${rv.blindSpot?.name || '—'}
${rv.blindSpotWhy || ''}

**Everyone missed:** ${rv.allMissed || '—'}
`
  writeFileSync(join(reviewsDir, `review-${p(i + 1)}.md`), md)
})

// ── tally.json ─────────────────────────────────────────────────────────────
writeFileSync(join(root, 'tally.json'), JSON.stringify(r.tally || {}, null, 2) + '\n')

// ── transcript.md (everything in one file) ─────────────────────────────────
const transcript = [
  `# Council transcript — ${ts}`,
  ``,
  `## Question`,
  r.question || '—',
  ``,
  `## Framing`,
  r.framed || '—',
  ``,
  `## Advisor answers`,
  ...advisors.map((a) => `\n### ${a.name || a.id}\n${a.response || '—'}`),
  ``,
  `## Peer reviews (de-anonymized)`,
  ...reviews.map((rv, i) =>
    `\n### Review ${p(i + 1)}\n- Strongest: **${rv.strongest?.name || '—'}** — ${rv.strongestWhy || ''}\n- Blind spot: **${rv.blindSpot?.name || '—'}** — ${rv.blindSpotWhy || ''}\n- Everyone missed: ${rv.allMissed || '—'}`),
  ``,
  `## "Strongest" vote count`,
  '```json',
  JSON.stringify(r.tally || {}, null, 2),
  '```',
  ``,
  `## Chairman verdict`,
  verdictMd.split('\n').slice(1).join('\n').trim(),
  ``,
].join('\n')
writeFileSync(join(root, 'transcript.md'), transcript)

// ── README.md (folder index) ───────────────────────────────────────────────
const readme = `# Council report — ${ts}

**Question:** ${(r.question || '').trim()}

- [verdict.md](verdict.md) — the chairman's final verdict
- [question.md](question.md) — original question + framing
- [transcript.md](transcript.md) — everything in one file
- [tally.json](tally.json) — vote count
- advisors/ — advisor answers (${advisors.length})
- reviews/ — peer reviews (${reviews.length})
`
writeFileSync(join(root, 'README.md'), readme)

console.log(root)
