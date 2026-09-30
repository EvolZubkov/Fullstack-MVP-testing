/**
 * @module server/services/lms-export-import
 * @description Импорт выгрузки отчёта LMS в общие с телеметрией таблицы (PRD-54).
 *
 * Модуль делится надвое намеренно. {@link buildImportPlan} — чистая функция без базы и
 * ввода-вывода, поэтому режимы обезличивания проверяются тестом без подготовки хранилища.
 * {@link runImport} добавляет к плану только запись и связывание.
 *
 * Числа берутся ИЗ ФАЙЛА и не пересчитываются (PRD-54 решение 2): пакет мог быть собран под более
 * ранней версией теста, и пересчёт дал бы не то, что видел участник.
 */
import { createHash, randomUUID } from "node:crypto";
import { participantKey } from "../utils/crypto";
import { decodeLearnerResponse } from "@shared/lms-export/response-codec";
import { hasBlanks, isMeasurementOnly } from "@shared/questions/question-type";
import type { LmsExportBook } from "@shared/lms-export/parse";
import type { IStorage } from "../storage";

/**
 * Имена пропусков задания в порядке НАБОРА ПРАВИЛ — в том, в каком пакет их кодировал.
 *
 * Порядок берётся из эталона, а не из текста задания: кодирует пакет по `correct.blanks`,
 * и расхождение развалило бы раскладку значений по полям (PRD-57 FR-24h).
 */
function blankIdsOf(question: { type: string; correctJson?: unknown }): string[] | null {
  if (!hasBlanks(question.type)) return null;
  const key = (question.correctJson ?? {}) as { blanks?: Array<{ id?: unknown }> };
  if (!Array.isArray(key.blanks)) return null;
  return key.blanks.map((blank) => String(blank?.id ?? ""));
}

/**
 * Режимы одной загрузки. Обезличивание и связывание независимы — см. раздел 8.5 спеки.
 *
 * Признака «файл уже обезличен» здесь нет: готовил ли файл внешний обезличиватель, видно по самой
 * книге — по колонке `external_id` (PRD-54 раздел 4).
 */
/** Потолок корневого балла, который пакет сообщает LMS: балл — это процент. */
const LMS_SCORE_MAX = 100;

/**
 * Процент прохождения из колонки «Баллы»; `null`, если балла нет или он не число.
 *
 * Значение вне 0..100 обрезается, а не отбрасывается: процент чужой LMS мог приехать с
 * округлением за край, и выбросить из-за этого вердикт было бы хуже, чем прижать к границе.
 */
function percentOf(points: number | null): number | null {
  if (points === null || !Number.isFinite(points)) return null;
  return Math.round(Math.min(LMS_SCORE_MAX, Math.max(0, points)));
}

export interface ImportOptions {
  anonymize: boolean;
  linkUsers: boolean;
}

/** Одна строка выгрузки, приведённая к тому, что пишется в базу. */
export interface PlannedRow {
  /**
   * `external_id` участника: из колонки файла либо вычисленный при импорте ТЕМ ЖЕ алгоритмом, что
   * у внешнего обезличивателя (BR-54-22). Пишется в `participant_key` и сверяется с
   * `users.external_key` — ключ у участника один.
   */
  participantKey: string;
  /**
   * Идентификатор обучающегося в LMS, если внешний обезличиватель добавил его колонкой
   * (BR-54-32). В базу не пишется: он нужен только чтобы найти учётную запись.
   */
  learnerId: string | null;
  lmsUserName: string | null;
  lmsUserOrg: string | null;
  /** Подразделение и должность: входят в `external_id`, поэтому хранятся рядом с прохождением. */
  lmsUserUnit: string | null;
  lmsUserPosition: string | null;
  startedAt: Date;
  finishedAt: Date;
  resultPassed: boolean | null;
  totalPoints: number | null;
  /**
   * Процент прохождения и шкала, в которой он записан.
   *
   * Колонка «Баллы» выгрузки — это `cmi.score.raw`, а пакет отправляет его ПРОЦЕНТОМ при
   * `cmi.score.max = 100` (`lmsScoreFor`, `shared/scoring/lms-score.ts`). Без этих полей аналитика не
   * видит у импортированной строки оценивания вовсе: процента нет, вердикт не выносится, и
   * контрольный тест, пройденный только через LMS, читается как измерительный. Пустые
   * «Баллы» или ни одного исхода «верно/неверно» в строке — измерительное прохождение: оба поля
   * `null`.
   */
  resultPercent: number | null;
  maxPoints: number | null;
  /**
   * PRD-55 FR-08/FR-09: выданный состав — задания, блок которых непуст хотя бы в одной
   * подколонке (PRD-66 FR-10a). Шире ответов: выданное, но не отвеченное задание показано.
   */
  deliveredQuestionIds: string[];
  scalesJson: Record<string, number>;
  variablesJson: Record<string, string>;
  answers: Array<{ questionId: string; raw: string; result: string; latencyMs: number | null }>;
  /**
   * Версия формата строк ответа этого прохождения; `null` — пакет её не сообщал.
   *
   * Живёт на СТРОКЕ, а не на файле: в одном отчёте бывают прохождения разных версий пакета.
   */
  responseFormat: number | null;
  /** PRD-56 FR-19a: версия публикации прохождения; `null` — пакет её не сообщал. */
  testVersion: number | null;
  /** PRD-56 FR-18: идентификаторы выданных вариантов; тему им вернёт {@link runImport}. */
  formIds: string[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  warnings: string[];
}

/**
 * Превратить разобранную книгу в план записи (PRD-54 разделы 4 и 8).
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @returns строки к записи и предупреждения для протокола
 */
export function buildImportPlan(book: LmsExportBook, opts: ImportOptions): ImportPlan {
  const warnings: string[] = [];

  if (opts.anonymize && opts.linkUsers) {
    warnings.push(
      "Обезличивание и связывание включены одновременно: ФИО не сохраняется, но прохождение указывает на конкретного пользователя.",
    );
  }
  if (book.unknownColumns.length > 0) {
    warnings.push(`Не разобраны колонки: ${book.unknownColumns.join(", ")}.`);
  }

  const rows: PlannedRow[] = [];
  for (const r of book.rows) {
    if (!r.moduleActivatedAt) {
      // Имя в предупреждении раскрывается только тогда, когда мы его и так сохраняем: иначе
      // протокол импорта стал бы обходным путём к тем самым данным, которые обезличивание убирает.
      const who = opts.anonymize ? "скрыто" : r.participantName;
      warnings.push(`Строка участника «${who}» без даты активации модуля пропущена.`);
      continue;
    }
    const at = new Date(r.moduleActivatedAt);
    // `external_id` из файла берётся как есть: повторное хеширование разорвало бы связь с тем,
    // что посчитал внешний обезличиватель. Нет колонки — импорт считает его сам ТЕМ ЖЕ
    // алгоритмом, поэтому один человек получает одно значение, кто бы его ни вычислил.
    const key = r.externalId || participantKey(r.participantName, r.org, r.unit, r.position);
    // Процент берётся только у ОЦЕНЁННОГО прохождения — с хотя бы одним исходом «верно/неверно».
    // Пакеты до 2026-09-12 слали измерительному тесту «0 баллов» (PRD-54 §14 п.1), и такие
    // выгрузки в ходу: без этой проверки опросник стал бы оцененным на ноль.
    const graded = Object.values(r.results).some((v) => v === "correct" || v === "incorrect");
    const percent = graded ? percentOf(r.points) : null;

    rows.push({
      participantKey: key,
      learnerId: r.learnerId || null,
      lmsUserName: opts.anonymize ? null : r.participantName,
      lmsUserOrg: opts.anonymize ? null : r.org,
      // Отдел и должность хранятся ВСЕГДА, даже при обезличивании: они входят в `external_id`,
      // и без них разъезд ключей после перевода человека нечем объяснить. Персональными данными
      // они не являются — это свойства позиции, а не личности, и без имени рядом никого не
      // опознают.
      lmsUserUnit: r.unit || null,
      lmsUserPosition: r.position || null,
      // Дата активации модуля идёт и в начало, и в конец: других дат о самом прохождении файл не
      // даёт, а без `finishedAt` строка выпала бы из аналитики, которая отбирает завершённые
      // попытки. Цена — неизвестная длительность, и разбор попытки подписывает источник явно.
      startedAt: at,
      finishedAt: at,
      resultPassed: r.passed,
      totalPoints: r.points,
      resultPercent: percent,
      maxPoints: percent === null ? null : LMS_SCORE_MAX,
      // Ключи ответов — это и есть выданный состав: разбор кладёт туда только блоки, где
      // заполнена хотя бы одна подколонка, с пустой строкой у неотвеченного.
      deliveredQuestionIds: Object.keys(r.answers),
      scalesJson: r.scales,
      variablesJson: r.variables,
      answers: Object.keys(r.answers).map((questionId) => ({
        questionId,
        raw: r.answers[questionId],
        // PRD-66 FR-10a: пустая ячейка сюда и попадает пустой. Сведение её к `neutral`
        // объявляло измерительным всё, чей исход файл не сообщил, — и невыданное задание
        // в том числе. Решение, чем считать пустой исход, принимается ниже, где известен
        // ТИП задания: у измерительного пустота законна, у оцениваемого это пробел.
        result: r.results[questionId] ?? "",
        // Выгрузка даёт целые секунды, база хранит миллисекунды — как и живая телеметрия,
        // иначе два источника не сравнить одним запросом. Нет измерения — нет и числа;
        // отсутствие самой карты означает то же (выгрузка пакета, времени не мерившего).
        latencyMs: (r.latencySeconds || {})[questionId] != null
          ? (r.latencySeconds || {})[questionId] * 1000
          : null,
      })),
      responseFormat: r.responseFormat ?? null,
      // PRD-56 FR-19a/FR-18: разрешение версии в снимок и варианта в тему требует базы,
      // поэтому план несёт их как есть, а превращает `runImport`.
      testVersion: r.testVersion ?? null,
      formIds: r.formIds ?? [],
    });
  }

  return { rows, warnings };
}

/** Что известно о загрузке помимо самой книги. */
export interface ImportContext {
  testId: string;
  groupId: string | null;
  fileName: string;
  fileBuffer: Buffer;
  userId: string;
  dryRun?: boolean;
}

export interface ImportResult {
  batchId: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  /**
   * PRD-66 FR-11: сколько взаимодействий файла не удалось привязать к заданию теста.
   *
   * Считается по ВЗАИМОДЕЙСТВИЯМ, а не по колонкам: одна чужая колонка в файле на тысячу
   * прохождений — это тысяча потерянных наблюдений, и доля потерь выборки видна только так.
   */
  rowsUnmatched: number;
  warnings: string[];
}

/**
 * Выполнить импорт: партия, прохождения, ответы (PRD-54 разделы 8.3 — 8.5).
 *
 * При `dryRun` не создаётся НИЧЕГО, но счётчики считаются теми же ветками кода, что и при настоящей
 * записи, — иначе план обещал бы одно, а импорт делал другое.
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @param ctx тест, группа, файл и автор загрузки
 * @param storage слой доступа к данным
 * @returns счётчики и предупреждения протокола
 */
export async function runImport(
  book: LmsExportBook,
  opts: ImportOptions,
  ctx: ImportContext,
  storage: IStorage,
): Promise<ImportResult> {
  const plan = buildImportPlan(book, opts);
  const warnings = [...plan.warnings];
  const dryRun = ctx.dryRun === true;

  const questions = await storage.getQuestionsByIds(book.questionIds);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const foreign = book.questionIds.filter((id) => !questionById.has(id));
  if (foreign.length > 0) {
    warnings.push(`Вопросы не из этого теста (${foreign.length}): пакет собран под другой версией.`);
  }

  /**
   * PRD-56 FR-19a: номера версий превращаются в снимки ОДНИМ разрешением на партию.
   *
   * В файле тысячи прохождений и три-четыре версии, поэтому спрашивается каждая версия, а не
   * каждая строка. Версии, которой у теста нет (снимок подчищен, тест заведён заново), карта
   * отдаёт `null`: такое прохождение идёт в разрез «версия не указана», а не приписывается
   * текущей версии.
   */
  const snapshotByVersion = new Map<number, string | null>();
  for (const version of new Set(plan.rows.map((r) => r.testVersion).filter((v): v is number => v !== null))) {
    const snapshot = await storage.getSnapshotByVersion(ctx.testId, version);
    snapshotByVersion.set(version, snapshot?.id ?? null);
    if (!snapshot) {
      warnings.push(
        `Версия публикации ${version} у теста не найдена: такие прохождения загружены без версии.`,
      );
    }
  }

  /**
   * PRD-56 FR-18: тема варианта по его идентификатору.
   *
   * Выгрузка знает только идентификаторы форм — тему им возвращает набор форм раздела, и тогда
   * `forms_json` импорта совпадает по форме с телеметрией и с вебом. Форма читается ТОЛЬКО если
   * в файле вообще есть варианты: у теста без них лишнего запроса не делается.
   */
  const topicByForm = new Map<string, string>();
  if (plan.rows.some((r) => r.formIds.length > 0)) {
    for (const section of await storage.getTestSections(ctx.testId)) {
      for (const form of section.formSetJson?.forms ?? []) {
        topicByForm.set(form.id, section.topicId);
      }
    }
  }
  const unknownForms = new Set<string>();
  // PRD-66 FR-10a: сколько взаимодействий пришло без исхода у ОЦЕНИВАЕМОГО задания. Не потеря
  // сопоставления (задание найдено), а пробел в самом файле — и считается отдельно.
  let resultsMissing = 0;
  // PRD-66 FR-11: сколько взаимодействий не нашли своего задания в тесте. Протокол загрузки
  // живёт один раз, а психометрике доля потерь нужна постоянно — рядом с числом наблюдений.
  let rowsUnmatched = 0;

  let batchId: string | null = null;
  if (!dryRun) {
    const batch = await storage.createLmsImportBatch({
      id: randomUUID(),
      testId: ctx.testId,
      groupId: ctx.groupId,
      fileName: ctx.fileName,
      // Хеш СОДЕРЖИМОГО, а не имени: тот же файл под другим именем — тот же файл.
      fileHash: createHash("sha256").update(ctx.fileBuffer).digest("hex"),
      anonymized: opts.anonymize,
      // Колонка прежнего флажка теперь значит «файл пришёл с `external_id`»: признак берётся из
      // книги, а не со слов загрузившего.
      sourceAnonymized: book.hasExternalId === true,
      linkUsers: opts.linkUsers,
      importedBy: ctx.userId,
    });
    batchId = batch.id;
  }

  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsLinked = 0;

  for (const row of plan.rows) {
    // ПОРЯДОК СВЯЗЫВАНИЯ (BR-54-33): сначала идентификатор обучающегося в LMS, если внешний
    // обезличиватель положил его в файл отдельной колонкой (BR-54-32), затем `external_id`
    // против внешнего ключа пользователя. `learner_id` в базу не попадает: он нужен только
    // чтобы найти учётную запись (PRD-54 раздел 8.5).
    let userId: string | null = null;
    if (opts.linkUsers) {
      const user = (row.learnerId ? await storage.getUserByLmsLearnerId(row.learnerId) : undefined)
        ?? await storage.getUserByExternalKey(row.participantKey);
      if (user) {
        userId = user.id;
        rowsLinked += 1;
      }
    }

    // Карта «тема -> вариант» этого прохождения. Форма, которой в тесте больше нет (раздел
    // переведён на случайную выдачу), в карту не попадает и уходит в предупреждения: терять её
    // молча нельзя, но и ронять из-за неё загрузку не за что.
    const formsJson: Record<string, string> = {};
    for (const formId of row.formIds) {
      const topicId = topicByForm.get(formId);
      if (topicId) formsJson[topicId] = formId;
      else unknownForms.add(formId);
    }

    if (dryRun) {
      rowsCreated += 1;
      continue;
    }

    const { id, created } = await storage.upsertImportedAttempt({
      snapshotId: row.testVersion === null ? null : snapshotByVersion.get(row.testVersion) ?? null,
      formsJson: Object.keys(formsJson).length > 0 ? formsJson : null,
      testId: ctx.testId,
      participantKey: row.participantKey,
      origin: "import",
      batchId,
      groupId: ctx.groupId,
      userId,
      lmsUserName: row.lmsUserName,
      lmsUserOrg: row.lmsUserOrg,
      lmsUserUnit: row.lmsUserUnit,
      lmsUserPosition: row.lmsUserPosition,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      lastActivityAt: row.finishedAt,
      resultPassed: row.resultPassed,
      totalPoints: row.totalPoints,
      resultPercent: row.resultPercent,
      maxPoints: row.maxPoints,
      // Только задания этого теста: чужой идентификатор завёл бы экспозицию несуществующему
      // заданию, и он уже назван в предупреждении о чужих вопросах.
      deliveredQuestionIds: row.deliveredQuestionIds.filter((id) => questionById.has(id)),
      totalQuestions: row.answers.length,
      scalesJson: row.scalesJson,
      variablesJson: row.variablesJson,
    });
    if (created) rowsCreated += 1;
    else rowsUpdated += 1;

    await storage.replaceImportedAnswers(
      id,
      row.answers.flatMap((a) => {
        const q = questionById.get(a.questionId);
        // Вопроса нет в базе — записать ответ не во что: `scorm_answers` требует тип и текст
        // вопроса. Такая строка уже названа в предупреждении о чужих вопросах.
        if (!q) {
          rowsUnmatched += 1;
          return [];
        }
        // PRD-66 FR-10a: `neutral` остаётся ТОЛЬКО за измерительным заданием — у него эталона
        // нет вовсе, и пустой исход законен. У оцениваемого пустой исход значит, что файл его
        // не сообщил: приписать «неверно» — выдумать ответ, которого могло не быть, приписать
        // `neutral` — объявить измерительным то, что оценивается. Наблюдения нет, есть пробел,
        // и партия о нём говорит.
        const known = a.result === "correct" || a.result === "incorrect";
        if (!known && !isMeasurementOnly({ type: q.type, correctJson: q.correctJson })) {
          resultsMissing += 1;
          return [];
        }
        return [{
          id: randomUUID(),
          attemptId: id,
          questionId: a.questionId,
          questionPrompt: q.prompt,
          questionType: q.type,
          topicId: q.topicId,
          // Версия формата берётся у САМОГО прохождения: индексы распределения баллов
          // выравнены с версии 2, а выданные до неё пакеты шлют старый формат вечно.
          // PRD-57 FR-34: у пропусков строка несёт одни значения, а имена — в эталоне
          // задания; без них разложить ответ по полям нечем.
          userAnswerJson: decodeLearnerResponse(q.type, a.raw, row.responseFormat, blankIdsOf(q)),
          // Три состояния вместо булева: измерительный ответ не может быть неверным
          // (PRD-54 раздел 5.3). Всё, что не «верно» и не «неверно», — `neutral`.
          result: a.result === "correct" || a.result === "incorrect" ? a.result : "neutral",
          isCorrect: a.result === "correct" ? true : a.result === "incorrect" ? false : null,
          points: null,
          maxPoints: null,
          correctAnswerJson: null,
          latencyMs: a.latencyMs,
          answeredAt: row.finishedAt,
        }];
      }),
    );
  }

  if (resultsMissing > 0) {
    warnings.push(
      `Взаимодействий без исхода у оцениваемых заданий: ${resultsMissing}. Наблюдениями они не стали — выгрузка не сообщила, верен ответ или нет.`,
    );
  }
  if (unknownForms.size > 0) {
    warnings.push(
      `Варианты выдачи не найдены в тесте (${[...unknownForms].join(", ")}): раздел мог быть переведён на случайную выдачу.`,
    );
  }

  const result: ImportResult = {
    batchId,
    rowsTotal: book.rows.length,
    rowsCreated,
    rowsUpdated,
    rowsSkipped: book.rows.length - plan.rows.length,
    rowsLinked,
    rowsUnmatched,
    warnings,
  };

  // PRD-55 FR-08: экспозиция пополняется ПЕРЕСЧЁТОМ среза теста, а не прибавкой — повторная
  // загрузка того же файла обновляет те же прохождения и не должна удваивать счётчик.
  if (!dryRun) await storage.rebuildImportExposure(ctx.testId);

  if (!dryRun && batchId) {
    await storage.updateLmsImportBatch(batchId, {
      rowsTotal: result.rowsTotal,
      rowsCreated: result.rowsCreated,
      rowsUpdated: result.rowsUpdated,
      rowsSkipped: result.rowsSkipped,
      rowsLinked: result.rowsLinked,
      rowsUnmatched: result.rowsUnmatched,
      warnings: result.warnings,
    });
  }
  return result;
}
