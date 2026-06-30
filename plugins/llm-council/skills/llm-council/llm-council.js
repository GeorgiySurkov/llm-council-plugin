export const meta = {
  name: 'llm-council',
  description: 'Run a question through 5 persona advisors, blind peer review, and a chairman synthesis. args = question string or { question }.',
  whenToUse: 'A decision with real tradeoffs: "council this", "should I X or Y", "validate this", "stress-test a decision".',
  phases: [
    { title: 'Frame' },
    { title: 'Council' },
    { title: 'Peer review' },
    { title: 'Chairman' },
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Domain-agnostic personas. This is what makes the workflow universal across
// topics: the thinking styles aren't tied to any subject area, the question
// arrives via args.
// (Optionally you can assign a model per persona — see the { model } option in agent().)
// ──────────────────────────────────────────────────────────────────────────
const ADVISORS = [
  { id: 'contrarian',      name: 'The Contrarian',
    brief: 'Actively hunt for fatal flaws, missed pieces, and failure points. Do not soften.' },
  { id: 'firstprinciples', name: 'The First Principles Thinker',
    brief: 'Strip the assumptions and reframe the core problem from scratch.' },
  { id: 'expansionist',    name: 'The Expansionist',
    brief: 'Find the underrated opportunities and the hidden upside.' },
  { id: 'outsider',        name: 'The Outsider',
    brief: 'Answer WITHOUT domain expertise — catch the "curse of knowledge" and non-obvious assumptions.' },
  { id: 'executor',        name: 'The Executor',
    brief: 'Only feasibility and concrete "starting Monday" steps. No fluff.' },
]

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Review schema: the reviewer references ONLY by letters. The enum is built for the
// actual set of labels, so validation catches a reference to a non-existent answer
// (retry at the tool-call level), and de-anonymization in JS won't crash.
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
    recommendation: { type: 'string', description: 'The Recommendation (may go against the majority if the arguments are stronger)' },
    firstStep:      { type: 'string', description: 'The One Thing to Do First' },
  },
}

// Deterministic slug for the report folder name (no Date/Math.random).
function slugify(s) {
  const base = String(s).toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .split(/\s+/).slice(0, 6).join('-')
    .replace(/-+/g, '-')
    .slice(0, 50)
  return base || 'council'
}

// args = "question as a string" OR { question: "..." }
const question =
  (args && typeof args === 'object' && args.question) ? String(args.question)
  : (typeof args === 'string' ? args : '')
if (!question.trim()) {
  throw new Error('llm-council: no question provided. Pass args as a string or { question: "..." }.')
}

// ── Step 1. Frame ──────────────────────────────────────────────────────────
phase('Frame')
const framed = (await agent(
  `Reframe the question for a council of experts, enriching it with context.
If the working directory has CLAUDE.md / memory/ / mentioned files — read them and pull in what's relevant.
Include: the core decision, relevant context, the stakes, the key numbers. No fluff.

The user's question:
${question}`,
  { phase: 'Frame', label: 'frame' },
)) || question

// ── Step 2. Council (barrier: review needs the FULL set of answers) ─────────
phase('Council')
const raw = await parallel(ADVISORS.map((a) => () =>
  agent(
    `You are ${a.name}. ${a.brief}

Question:
${framed}

Give a 150–300 word analysis. No hedging, no "on one hand / on the other". Direct and to the point.`,
    { phase: 'Council', label: a.id },
  ),
))

// Keep the "index = persona" alignment; drop only the advisors that failed.
const present = ADVISORS
  .map((advisor, i) => ({ advisor, text: raw[i] }))
  .filter((x) => x.text)
if (present.length < 2) {
  throw new Error(`llm-council: too few advisors responded (${present.length}).`)
}

// ── Anonymization: pure JS. The map never goes out to the LLM. ──────────────
// A per-reviewer rotation of the set spreads out positional bias.
// Deterministic (Math.random is unavailable in scripts and would break resume);
// rotation / a Latin square for debiasing is even better than a random shuffle.
function blindPacketFor(reviewerIdx) {
  const n = present.length
  const order = present.map((_, k) => (k + reviewerIdx) % n)
  const map = {}                                   // label -> index in present
  const block = order.map((pIdx, pos) => {
    const label = LABELS[pos]
    map[label] = pIdx
    return `### Response ${label}\n${present[pIdx].text}`
  }).join('\n\n')
  return { block, map, labels: LABELS.slice(0, n) }
}

// ── Step 3. Peer review (barrier: the Chairman needs ALL reviews) ───────────
phase('Peer review')
const reviews = (await parallel(present.map((_, ri) => () => {
  const { block, map, labels } = blindPacketFor(ri)
  return agent(
    `Below are anonymized advisor answers. Evaluate them and reference them ONLY by letter (${labels.join(', ')}):
- Which is the strongest and why?
- Which has the biggest blind spot?
- What did they ALL miss?
Under 200 words, direct language.

${block}`,
    { phase: 'Peer review', label: `review-${ri}`, schema: reviewSchema(labels) },
  ).then((r) => r && ({                            // DE-ANONYMIZATION — a simple lookup
    reviewer:  ri,
    strongest: present[map[r.strongest]].advisor,
    strongestWhy: r.strongestWhy,
    blindSpot: present[map[r.biggestBlindSpot]].advisor,
    blindSpotWhy: r.blindSpotWhy,
    allMissed: r.allMissed,
  }))
}))).filter(Boolean)

// ── Aggregate votes in JS (no LLM judgment) ─────────────────────────────────
const tally = {}
for (const { advisor } of present) tally[advisor.name] = 0
for (const rv of reviews) tally[rv.strongest.name]++

// ── Step 4. Chairman ───────────────────────────────────────────────────────
phase('Chairman')
const advisorsBlock = present
  .map(({ advisor, text }) => `## ${advisor.name}\n${text}`)
  .join('\n\n')
const reviewsBlock = reviews
  .map((rv) => `- Strongest: ${rv.strongest.name} — ${rv.strongestWhy}\n  Blind spot: ${rv.blindSpot.name} — ${rv.blindSpotWhy}\n  Everyone missed: ${rv.allMissed}`)
  .join('\n')

const verdict = await agent(
  `You are the Chairman of the council. Synthesize the verdict. You may go against the majority if the arguments are stronger.

Question:
${framed}

Advisor answers:
${advisorsBlock}

De-anonymized peer reviews:
${reviewsBlock}

"Strongest" vote count (deterministic): ${JSON.stringify(tally)}`,
  { phase: 'Chairman', label: 'chairman', schema: VERDICT_SCHEMA },
)

log(`Council done: ${present.length} advisors, ${reviews.length} reviews.`)

return {
  question,
  slug: slugify(question),
  framed,
  advisors: present.map(({ advisor, text }) => ({ id: advisor.id, name: advisor.name, response: text })),
  reviews,
  tally,
  verdict,
}
