---
name: llm-council
description: Use when a decision has real tradeoffs and needs multiple independent perspectives before committing — triggers "council this", "run the council", "war room this", "pressure-test this", "stress-test this", "debate this", "should I X or Y", "which option", "what would you do", "validate this", "get multiple perspectives", "I can't decide", "I'm torn between". Runs a 5-advisor council with blind peer review and a chairman synthesis via a bundled workflow script. Do NOT use for simple yes/no, factual lookups, or low-stakes questions.
---

# LLM Council

Прогоняет вопрос через 5 советчиков-персон с разными стилями мышления, затем слепое
peer-ревью и синтез Chairman. Вся механика (фан-аут, анонимизация A–E, деанонимизация,
подсчёт голосов) — детерминированный JS; модель отвечает только за содержание
(рассуждения, ревью, синтез).

**Скилл самодостаточен.** Рядом с этим `SKILL.md` лежат два файла, которые едут вместе со
скиллом (в т.ч. внутри плагина):
- `llm-council.js` — сам workflow-скрипт (запускается инструментом `Workflow` по `scriptPath`).
- `save-report.mjs` — helper, раскладывающий результат в дерево папок.

Путь к этой папке доступен в рантайме как `$CLAUDE_SKILL_DIR` (в bash-командах внутри скилла).
Если переменная недоступна — это директория, где лежит данный `SKILL.md`.

## Когда запускать

Запускай при наличии **реальных ставок и трейдоффов**. НЕ запускай на простых yes/no,
фактических справках и мелких вопросах без последствий.

## Как запускать

1. **Определи папку скилла.** Выполни в Bash: `echo "$CLAUDE_SKILL_DIR"` — получишь
   абсолютный путь `DIR` к этой папке (где лежат `llm-council.js` и `save-report.mjs`).

2. **Собери вопрос.** Возьми формулировку пользователя. Контекст рабочей папки
   (CLAUDE.md, memory/, упомянутые файлы) фаза Frame воркфлоу прочитает сама.

3. **Запусти workflow** инструментом `Workflow`, указав путь к скрипту:
   ```
   Workflow({ scriptPath: "<DIR>/llm-council.js", args: { question: "<вопрос пользователя>" } })
   ```
   `args` можно передать и просто строкой. Воркфлоу вернёт объект:
   `{ question, slug, framed, advisors[], reviews[], tally, verdict }`.

   _(Альтернатива для разовых локальных запусков: положить копию `llm-council.js` в
   `.claude/workflows/` и звать `Workflow({ name: "llm-council" })`. В плагине используем `scriptPath`.)_

4. **Покажи вердикт** в чате как markdown (не HTML-файлами), по секциям из `verdict`:
   - **Где совет согласен** — `verdict.agreements`
   - **Где совет расходится** — `verdict.clashes`
   - **Слепые пятна, что поймал совет** — `verdict.blindSpots`
   - **Рекомендация** — `verdict.recommendation`
   - **Первое, что сделать** — `verdict.firstStep`

   Держи скан-френдли: буллеты, чёткие заголовки. `tally` («кого сочли сильнейшим»)
   можно показать короткой сводкой.

5. **Сохрани структурированный отчёт (всегда).** У workflow-скрипта нет доступа к ФС,
   поэтому раскладку в дерево папок делает helper `save-report.mjs`.
   - Запиши объект, возвращённый воркфлоу, как есть в JSON-файл (можно во временную
     папку-скретчпад), например `result.json`.
   - Запусти helper:
     ```
     node "<DIR>/save-report.mjs" <путь к result.json> [baseDir]
     ```
     `baseDir` по умолчанию `council` (в текущей рабочей папке). Helper печатает путь
     созданной папки — покажи его пользователю.
   - Структура отчёта:
     ```
     council/<YYYY-MM-DD-HHMM>-<slug>/
       README.md        # индекс
       verdict.md       # вердикт Chairman (заголовочный документ)
       question.md      # исходный вопрос + фрейминг
       transcript.md    # всё одним файлом
       tally.json       # подсчёт голосов
       advisors/NN-<id>.md
       reviews/review-NN.md
     ```
   - `slug` для имени папки воркфлоу считает сам (детерминированно); `timestamp` ставит helper.

## Заметки

- Все советчики и ревьюеры — субагенты Claude; диверсификация от **персон**
  (стили мышления), а не от разных вендоров.
- Слепое ревью гарантировано структурно: ревьюер-субагент получает только обезличенный
  текст A–E; соответствие «буква → советчик» остаётся в скрипте.
- Chairman вправе идти против большинства, если аргументы сильнее.
