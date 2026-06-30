export const meta = {
  name: 'llm-council',
  description: 'Прогон вопроса через 5 советчиков-персон, слепое peer-ревью и синтез Chairman. args = строка-вопрос или { question }.',
  whenToUse: 'Решение с реальными трейдоффами: "council this", "should I X or Y", "validate this", "стресс-тест решения".',
  phases: [
    { title: 'Frame' },
    { title: 'Council' },
    { title: 'Peer review' },
    { title: 'Chairman' },
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Доменно-независимые персоны. Это и делает воркфлоу универсальным по темам:
// стили мышления не привязаны к предметной области, вопрос приходит в args.
// (Опционально можно раздать model по персонам — см. опцию { model } в agent().)
// ──────────────────────────────────────────────────────────────────────────
const ADVISORS = [
  { id: 'contrarian',      name: 'The Contrarian',
    brief: 'Активно ищи фатальные изъяны, упущенные куски и точки отказа. Не сглаживай.' },
  { id: 'firstprinciples', name: 'The First Principles Thinker',
    brief: 'Сними допущения и переформулируй суть проблемы с нуля.' },
  { id: 'expansionist',    name: 'The Expansionist',
    brief: 'Найди недооценённые возможности и скрытый апсайд.' },
  { id: 'outsider',        name: 'The Outsider',
    brief: 'Отвечай БЕЗ доменной экспертизы — лови "проклятие знания" и неочевидные допущения.' },
  { id: 'executor',        name: 'The Executor',
    brief: 'Только осуществимость и конкретные шаги «с понедельника». Никакой воды.' },
]

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Схема ревью: ревьюер ссылается ТОЛЬКО буквами. enum строится под фактический
// набор меток, так что валидация ловит ссылку на несуществующий ответ (ретрай
// на уровне тул-колла), а деанонимизация в JS не падает.
function reviewSchema(labels) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['strongest', 'strongestWhy', 'biggestBlindSpot', 'blindSpotWhy', 'allMissed'],
    properties: {
      strongest:        { type: 'string', enum: labels },
      strongestWhy:     { type: 'string' },
      biggestBlindSpot: { type: 'string', enum: labels },
      blindSpotWhy:     { type: 'string' },
      allMissed:        { type: 'string' },
    },
  }
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['agreements', 'clashes', 'blindSpots', 'recommendation', 'firstStep'],
  properties: {
    agreements:     { type: 'string', description: 'Where the Council Agrees' },
    clashes:        { type: 'string', description: 'Where the Council Clashes' },
    blindSpots:     { type: 'string', description: 'Blind Spots the Council Caught' },
    recommendation: { type: 'string', description: 'The Recommendation (можно идти против большинства, если аргументы сильнее)' },
    firstStep:      { type: 'string', description: 'The One Thing to Do First' },
  },
}

// Детерминированный slug для имени папки отчёта (без Date/Math.random).
function slugify(s) {
  const base = String(s).toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .split(/\s+/).slice(0, 6).join('-')
    .replace(/-+/g, '-')
    .slice(0, 50)
  return base || 'council'
}

// args = "вопрос строкой" ИЛИ { question: "..." }
const question =
  (args && typeof args === 'object' && args.question) ? String(args.question)
  : (typeof args === 'string' ? args : '')
if (!question.trim()) {
  throw new Error('llm-council: не передан вопрос. Передай args в виде строки или { question: "..." }.')
}

// ── Step 1. Frame ──────────────────────────────────────────────────────────
phase('Frame')
const framed = (await agent(
  `Переформулируй вопрос для совета экспертов, обогатив контекстом.
Если в рабочей папке есть CLAUDE.md / memory/ / упомянутые файлы — прочитай их и втяни релевантное.
Включи: суть решения, релевантный контекст, ставки, ключевые числа. Без воды.

Вопрос пользователя:
${question}`,
  { phase: 'Frame', label: 'frame' },
)) || question

// ── Step 2. Council (барьер: ревью нужен ПОЛНЫЙ набор ответов) ──────────────
phase('Council')
const raw = await parallel(ADVISORS.map((a) => () =>
  agent(
    `Ты — ${a.name}. ${a.brief}

Вопрос:
${framed}

Дай разбор на 150–300 слов. Без хеджирования, без «с одной стороны / с другой». Прямо и по делу.`,
    { phase: 'Council', label: a.id },
  ),
))

// Сохраняем выравнивание «индекс = личность»; роняем только упавших советчиков.
const present = ADVISORS
  .map((advisor, i) => ({ advisor, text: raw[i] }))
  .filter((x) => x.text)
if (present.length < 2) {
  throw new Error(`llm-council: советчиков ответило слишком мало (${present.length}).`)
}

// ── Анонимизация: чистый JS. map наружу LLM-ке НЕ уходит. ───────────────────
// Своя ротация набора для каждого ревьюера — позиционный байас размазывается.
// Детерминированно (Math.random в скриптах недоступен и сломал бы resume);
// ротация/латинский квадрат для дебиаса даже лучше случайной перетасовки.
function blindPacketFor(reviewerIdx) {
  const n = present.length
  const order = present.map((_, k) => (k + reviewerIdx) % n)
  const map = {}                                   // label -> индекс в present
  const block = order.map((pIdx, pos) => {
    const label = LABELS[pos]
    map[label] = pIdx
    return `### Response ${label}\n${present[pIdx].text}`
  }).join('\n\n')
  return { block, map, labels: LABELS.slice(0, n) }
}

// ── Step 3. Peer review (барьер: Chairman'у нужны ВСЕ ревью) ────────────────
phase('Peer review')
const reviews = (await parallel(present.map((_, ri) => () => {
  const { block, map, labels } = blindPacketFor(ri)
  return agent(
    `Перед тобой обезличенные ответы советников. Оцени их и ссылайся ТОЛЬКО буквами (${labels.join(', ')}):
- Какой сильнее всего и почему?
- У какого самый большой слепой пятно?
- Что упустили ВСЕ?
Меньше 200 слов, прямой язык.

${block}`,
    { phase: 'Peer review', label: `review-${ri}`, schema: reviewSchema(labels) },
  ).then((r) => r && ({                            // ДЕАНОНИМИЗАЦИЯ — простой lookup
    reviewer:  ri,
    strongest: present[map[r.strongest]].advisor,
    strongestWhy: r.strongestWhy,
    blindSpot: present[map[r.biggestBlindSpot]].advisor,
    blindSpotWhy: r.blindSpotWhy,
    allMissed: r.allMissed,
  }))
}))).filter(Boolean)

// ── Агрегат голосов в JS (никакого суждения LLM) ───────────────────────────
const tally = {}
for (const { advisor } of present) tally[advisor.name] = 0
for (const rv of reviews) tally[rv.strongest.name]++

// ── Step 4. Chairman ───────────────────────────────────────────────────────
phase('Chairman')
const advisorsBlock = present
  .map(({ advisor, text }) => `## ${advisor.name}\n${text}`)
  .join('\n\n')
const reviewsBlock = reviews
  .map((rv) => `- Сильнейший: ${rv.strongest.name} — ${rv.strongestWhy}\n  Слепое пятно: ${rv.blindSpot.name} — ${rv.blindSpotWhy}\n  Все упустили: ${rv.allMissed}`)
  .join('\n')

const verdict = await agent(
  `Ты — Chairman совета. Синтезируй вердикт. Можешь идти против большинства, если аргументы сильнее.

Вопрос:
${framed}

Ответы советников:
${advisorsBlock}

Деанонимизированные peer-ревью:
${reviewsBlock}

Подсчёт голосов «сильнейший» (детерминированный): ${JSON.stringify(tally)}`,
  { phase: 'Chairman', label: 'chairman', schema: VERDICT_SCHEMA },
)

log(`Council готов: ${present.length} советников, ${reviews.length} ревью.`)

return {
  question,
  slug: slugify(question),
  framed,
  advisors: present.map(({ advisor, text }) => ({ id: advisor.id, name: advisor.name, response: text })),
  reviews,
  tally,
  verdict,
}
