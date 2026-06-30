#!/usr/bin/env node
// Раскладывает результат workflow `llm-council` в структурированное дерево папок.
// Это обычный node-скрипт (НЕ workflow-скрипт), поэтому Date/fs здесь доступны.
//
// Использование:
//   node save-report.mjs <result.json> [baseDir]
// где result.json — JSON, возвращённый воркфлоу:
//   { question, slug, framed, advisors[], reviews[], tally, verdict }
// baseDir по умолчанию "council" (относительно текущей рабочей папки).
//
// Печатает в stdout абсолютный путь созданной папки отчёта.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , resultPath, baseDirArg] = process.argv
if (!resultPath) {
  console.error('Usage: node save-report.mjs <result.json> [baseDir]')
  process.exit(1)
}

const r = JSON.parse(readFileSync(resultPath, 'utf8'))
const baseDir = baseDirArg || 'council'

// ── Имя папки: <timestamp>-<slug> ──────────────────────────────────────────
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

// ── verdict.md (заголовочный документ) ─────────────────────────────────────
const verdictMd = `# Вердикт совета

> ${(r.question || '').trim()}

## Где совет согласен
${v.agreements || '—'}

## Где совет расходится
${v.clashes || '—'}

## Слепые пятна, что поймал совет
${v.blindSpots || '—'}

## Рекомендация
${v.recommendation || '—'}

## Первое, что сделать
${v.firstStep || '—'}
`
writeFileSync(join(root, 'verdict.md'), verdictMd)

// ── question.md ────────────────────────────────────────────────────────────
writeFileSync(join(root, 'question.md'),
  `# Вопрос\n\n## Исходная формулировка\n${r.question || '—'}\n\n## Фрейминг (с контекстом)\n${r.framed || '—'}\n`)

// ── advisors/NN-id.md ──────────────────────────────────────────────────────
advisors.forEach((a, i) => {
  const name = `${p(i + 1)}-${a.id || 'advisor'}.md`
  writeFileSync(join(advisorsDir, name),
    `# ${a.name || a.id || 'Advisor'}\n\n${a.response || '—'}\n`)
})

// ── reviews/review-NN.md ───────────────────────────────────────────────────
reviews.forEach((rv, i) => {
  const md = `# Review ${p(i + 1)}

**Сильнейший:** ${rv.strongest?.name || '—'}
${rv.strongestWhy || ''}

**Слепое пятно:** ${rv.blindSpot?.name || '—'}
${rv.blindSpotWhy || ''}

**Все упустили:** ${rv.allMissed || '—'}
`
  writeFileSync(join(reviewsDir, `review-${p(i + 1)}.md`), md)
})

// ── tally.json ─────────────────────────────────────────────────────────────
writeFileSync(join(root, 'tally.json'), JSON.stringify(r.tally || {}, null, 2) + '\n')

// ── transcript.md (всё в одном файле) ──────────────────────────────────────
const transcript = [
  `# Транскрипт совета — ${ts}`,
  ``,
  `## Вопрос`,
  r.question || '—',
  ``,
  `## Фрейминг`,
  r.framed || '—',
  ``,
  `## Ответы советников`,
  ...advisors.map((a) => `\n### ${a.name || a.id}\n${a.response || '—'}`),
  ``,
  `## Peer-ревью (деанонимизированные)`,
  ...reviews.map((rv, i) =>
    `\n### Review ${p(i + 1)}\n- Сильнейший: **${rv.strongest?.name || '—'}** — ${rv.strongestWhy || ''}\n- Слепое пятно: **${rv.blindSpot?.name || '—'}** — ${rv.blindSpotWhy || ''}\n- Все упустили: ${rv.allMissed || '—'}`),
  ``,
  `## Подсчёт голосов «сильнейший»`,
  '```json',
  JSON.stringify(r.tally || {}, null, 2),
  '```',
  ``,
  `## Вердикт Chairman`,
  verdictMd.split('\n').slice(1).join('\n').trim(),
  ``,
].join('\n')
writeFileSync(join(root, 'transcript.md'), transcript)

// ── README.md (индекс папки) ───────────────────────────────────────────────
const readme = `# Council report — ${ts}

**Вопрос:** ${(r.question || '').trim()}

- [verdict.md](verdict.md) — итоговый вердикт Chairman
- [question.md](question.md) — исходный вопрос + фрейминг
- [transcript.md](transcript.md) — всё одним файлом
- [tally.json](tally.json) — подсчёт голосов
- advisors/ — ответы советников (${advisors.length})
- reviews/ — peer-ревью (${reviews.length})
`
writeFileSync(join(root, 'README.md'), readme)

console.log(root)
