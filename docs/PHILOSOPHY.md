# Philosophy — Why This Harness Exists

> Bilingual. EN first, RU below each section. The "why" behind every design
> choice in [`HARNESS.en.md`](HARNESS.en.md) / [`HARNESS.ru.md`](HARNESS.ru.md).

---

## The core problem

**EN.** An LLM coding agent is a brilliant intern with three flaws: it forgets
everything between sessions, it follows written instructions inconsistently, and
it will confidently claim work is done when it isn't. You cannot patch these
with a longer prompt. Two measured facts make that clear:

- A `CLAUDE.md` rule is *advisory*, not policy — followed ~80% of the time, and
  it decays hard after ~15 tool calls because system-prompt tokens lose
  attention weight as tool-call history fills the window.
- Skills fire *probabilistically* — sandboxed evals put baseline activation near
  a coin flip (~50%). The model keyword-matches at the activation layer, so
  "my component re-renders" misses a skill 60-80% of the time.

The conclusion: soft guidance is not enough. You need a **harness** — a
deterministic layer that turns advice into physics.

**RU.** LLM-агент для кодинга — гениальный стажёр с тремя изъянами: забывает всё
между сессиями, непоследовательно следует письменным инструкциям и уверенно
заявит, что работа готова, когда это не так. Длинным промптом это не залатать.
Два измеренных факта это доказывают:

- Правило в `CLAUDE.md` — *совет*, а не политика — соблюдается ~80% времени и
  резко деградирует после ~15 вызовов инструментов: токены системного промпта
  теряют вес внимания по мере заполнения окна историей вызовов.
- Скиллы срабатывают *вероятностно* — sandbox-эвалы дают базовую активацию около
  подброса монеты (~50%). Модель матчит по ключевым словам на слое активации, и
  «мой компонент ре-рендерится» промахивается мимо скилла в 60-80% случаев.

Вывод: мягкого руководства недостаточно. Нужен **харнесс** — детерминированный
слой, превращающий совет в физику.

---

## Four talks, one thesis

### Nick Nisi — WorkOS, "Case"

**EN.** *Enforce, don't instruct. Guide, don't prescribe. Measure, don't
assume.* Agents lie — they say "ran the tests" after `touch`-ing the marker
file. The cure: make doing the work cheaper than faking it, and prove it
cryptographically. He deleted 95% of his skills (10k lines → 553 lines of
gotchas) and the pass rate went **up**, because comprehensive docs send the
model on goose chases — one skill took a task from 97% correct to 77%. He only
knew because he **measured**. The thesis: *every failure is a harness bug, not a
code bug.* Fix the harness, not the output.

**RU.** *Принуждай, не инструктируй. Направляй, не предписывай. Измеряй, не
предполагай.* Агенты врут — говорят «прогнал тесты» после `touch`-а
файла-маркера. Лекарство: сделать работу дешевле подделки и доказать
криптографически. Он удалил 95% своих скиллов (10k строк → 553 строки граблей),
и pass rate **вырос**: исчерпывающие доки отправляют модель за призраками — один
скилл уронил задачу с 97% до 77%. Он узнал это только потому, что **измерял**.
Тезис: *любой сбой — это баг харнесса, а не баг кода.* Чини харнесс, а не вывод.

→ In this harness: the **evidence gate** (un-fakeable proof), the **accumulator
counters** (measure), and **retro's hot/dead-guard detection** (delete what
doesn't earn its place).

### Luke Alvoeiro — Factory, "Missions"

**EN.** The validation contract is written *before* the code — tests written
after implementation only confirm decisions, they don't catch bugs. Validators
never see the implementation (adversarial by design). Structured handoffs with
command exit codes = self-healing at milestone boundaries. Serial execution plus
read-only parallelism beats naive fan-out. Orchestration logic lives in
prompts/skills, not a hardcoded state machine — so the system gets *better* with
each model release instead of being frozen to one model's quirks.

**RU.** Контракт валидации пишется *до* кода — тесты после реализации лишь
подтверждают решения, а не ловят баги. Валидаторы не видят реализацию
(состязательно по дизайну). Структурированные передачи с кодами возврата =
самовосстановление на границах вех. Последовательное исполнение плюс read-only
параллелизм бьёт наивный fan-out. Логика оркестрации живёт в промптах/скиллах, а
не в захардкоженном автомате — так система *улучшается* с каждым релизом модели,
а не заморожена под причуды одной.

→ In this harness: the **Stop-gate exit codes** (self-healing at the turn
boundary) and the doctrine that **rules live in data, not the runner**.

### Michael Grinich — WorkOS, harness keynote

**EN.** The harness, not the model, is the product. Every model change forces a
harness rebuild. The human moves up the stack: from writing lines of code to
reviewing intent. The leverage is in the scaffolding, not the model weights.

**RU.** Продукт — это харнесс, а не модель. Каждая смена модели вынуждает
перестроить харнесс. Человек поднимается выше по стеку: от написания строк кода к
ревью намерений. Рычаг — в обвязке, а не в весах модели.

→ In this harness: **retro proposes, human approves** — review stays up the
stack; the harness is the artifact that's maintained and improved.

### Chase — graphify

**EN.** Structure-first navigation beats grep: cheaper and more accurate. Build
a knowledge graph of the codebase and query *structure* instead of scanning text.

**RU.** Навигация от структуры бьёт grep: дешевле и точнее. Построй граф знаний
кодовой базы и запрашивай *структуру*, а не сканируй текст.

→ In this harness: the **serena-first cadence** enforced by `prompt-context.sh`
and measured by the `grep-before-serena` counter.

---

## The doctrine that falls out

**EN.** Combine the four and you get five invariants every part of the harness
obeys:

1. **Enforce over instruct** — anything that can be a hook *is* a hook.
2. **Ratchet over rewrite** — grandfather existing debt, block only net-new.
3. **Data out of the runner** — patterns live in JSON; the runner stays clean.
4. **Measure everything** — every gate fire is a counted signal.
5. **Propose, don't auto-mutate** — the human approves promotions.

**RU.** Сложи четыре доклада — получишь пять инвариантов, которым подчиняется
каждая часть харнесса:

1. **Принуждение важнее инструкции** — всё, что может быть хуком, *является* им.
2. **Храповик важнее переписывания** — амнистируй старый долг, блокируй лишь новый.
3. **Данные вне раннера** — паттерны в JSON; раннер чист.
4. **Измеряй всё** — каждое срабатывание гейта — это посчитанный сигнал.
5. **Предлагай, не правь сам** — продвижения одобряет человек.
