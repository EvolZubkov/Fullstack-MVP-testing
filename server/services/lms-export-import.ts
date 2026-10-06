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
import { TOPIC_LEVEL_NOT_ACHIEVED, type LmsExportBook, type LmsExportRow } from "@shared/lms-export/parse";
import type { IStorage } from "../storage";
import type { ImportedAttemptKeyRow } from "../storage/scorm-repository";

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
   * Различитель попытки участника за эту дату (PRD-54 раздел 8.1): `r:<метка>`, если пакет
   * сообщил метку регистрации (BR-54-35), иначе {@link PlannedRow.contentKey} (BR-54-36).
   */
  attemptKey: string;
  /**
   * Ключ этой строки по отпечатку содержимого, `c:<отпечаток>:<n>`, — считается ВСЕГДА. У строки с
   * меткой он нужен, чтобы найти запись той же строки отчёта, загруженную до пересборки пакета
   * (BR-54-37).
   */
  contentKey: string;
  /** Сообщил ли пакет метку регистрации — то есть точен ли {@link PlannedRow.attemptKey}. */
  marked: boolean;
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
  /**
   * Тема -> достигнутый уровень, как его записал пакет (блоки `topic_<id>_level`).
   * Имя темы и «не достигнут» превращает {@link runImport}: для этого нужна база.
   */
  topicLevels: Record<string, string>;
  /** Тема -> `object_id` рекомендованных курсов WebTutor; в курс их превращает {@link runImport}. */
  topicCourses: Record<string, string[]>;
}

/** Достигнутый уровень темы в той же форме, что пишет живая телеметрия (`achieved_levels_json`). */
export interface ImportedLevel {
  topicId: string;
  topicName: string | null;
  /** `null` — уровень не достигнут. */
  levelName: string | null;
}

/** Рекомендованный курс в той же форме, что пишет живая телеметрия (`failed_topic_courses_json`). */
export interface ImportedCourse {
  title: string;
  url: string;
}

/**
 * `object_id` курса WebTutor из его адреса; `null`, если в адресе его нет.
 *
 * То же правило, по которому пакет кладёт курс в отчёт (`resultsPage.js`): иначе курс,
 * отправленный пакетом, не нашёлся бы при обратном разборе.
 *
 * @param url адрес курса
 * @returns `object_id` или `null`
 */
export function courseObjectIdOf(url: string | null | undefined): string | null {
  const match = /object_id=([^&]+)/.exec(String(url ?? ""));
  return match ? match[1] : null;
}

/**
 * Достигнутые уровни строки в форме телеметрии; `null`, если блоков уровней в строке нет.
 *
 * @param levels тема -> уровень как записан в выгрузке
 * @param topicNames имена тем теста
 * @returns список для `achieved_levels_json` или `null`
 */
export function importedLevelsOf(
  levels: Record<string, string>,
  topicNames: ReadonlyMap<string, string>,
): ImportedLevel[] | null {
  const list = Object.entries(levels).map(([topicId, value]) => ({
    topicId,
    topicName: topicNames.get(topicId) ?? null,
    levelName: value === TOPIC_LEVEL_NOT_ACHIEVED ? null : value,
  }));
  return list.length > 0 ? list : null;
}

/**
 * Рекомендованные курсы строки в форме телеметрии; `null`, если курсов нет.
 *
 * Курс, чей `object_id` в тесте не нашёлся (ссылку убрали после сборки пакета), не теряется:
 * он идёт под условным названием без адреса — факт рекомендации важнее его оформления.
 * Повторы по названию сворачиваются, как это делает пакет.
 *
 * @param courses тема -> `object_id` в порядке выгрузки
 * @param courseByObjectId курсы теста по `object_id`
 * @returns список для `failed_topic_courses_json` или `null`
 */
export function importedCoursesOf(
  courses: Record<string, string[]>,
  courseByObjectId: ReadonlyMap<string, ImportedCourse>,
): ImportedCourse[] | null {
  const byTitle = new Map<string, ImportedCourse>();
  for (const ids of Object.values(courses)) {
    for (const objectId of ids) {
      const course = courseByObjectId.get(objectId) ?? { title: `Курс WebTutor ${objectId}`, url: "" };
      if (!byTitle.has(course.title)) byTitle.set(course.title, course);
    }
  }
  return byTitle.size > 0 ? [...byTitle.values()] : null;
}

export interface ImportPlan {
  rows: PlannedRow[];
  warnings: string[];
}

/** JSON с упорядоченными ключами объектов: одно содержимое — одна строка, в любом порядке полей. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Отпечаток содержимого строки выгрузки (PRD-54 BR-54-36): первые 16 знаков sha-256.
 *
 * Поля личности в отпечаток НЕ входят — они уже стоят в ключе псевдонимом. Не входит и метка
 * регистрации: по отпечатку запись, загруженная до пересборки пакета, узнаётся в строке, которая
 * метку уже несёт (BR-54-37). Дата активации курса не входит тоже: она про назначение, а не про
 * прохождение.
 *
 * @param row разобранная строка
 * @returns 16 шестнадцатеричных знаков
 */
export function rowFingerprint(row: LmsExportRow): string {
  const content = {
    moduleActivatedAt: row.moduleActivatedAt,
    passed: row.passed,
    points: row.points,
    answers: row.answers,
    results: row.results,
    latencySeconds: row.latencySeconds,
    scales: row.scales,
    scaleLevels: row.scaleLevels,
    variables: row.variables,
    responseFormat: row.responseFormat,
    testVersion: row.testVersion,
    formIds: row.formIds,
    topicLevels: row.topicLevels,
    topicCourses: row.topicCourses,
  };
  return createHash("sha256").update(stableJson(content)).digest("hex").slice(0, 16);
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

  if (book.unknownColumns.length > 0) {
    warnings.push(`Не разобраны колонки: ${book.unknownColumns.join(", ")}.`);
  }

  const rows: PlannedRow[] = [];
  // BR-54-36: номер строки среди строк того же участника за ту же дату с тем же отпечатком. Две
  // попытки с одинаковыми ответами так остаются двумя, а повторная загрузка файла даёт те же номера.
  const sameContent = new Map<string, number>();
  // BR-54-34: сколько строк у участника за одну дату — для протокола.
  const sameDay = new Map<string, number>();
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
    const day = `${key}|${r.moduleActivatedAt}`;
    sameDay.set(day, (sameDay.get(day) ?? 0) + 1);
    const fingerprint = rowFingerprint(r);
    const nth = (sameContent.get(`${day}|${fingerprint}`) ?? 0) + 1;
    sameContent.set(`${day}|${fingerprint}`, nth);
    const contentKey = `c:${fingerprint}:${nth}`;
    const mark = (r.registrationMark ?? "").trim();
    const marked = mark !== "";
    // Процент берётся только у ОЦЕНЁННОГО прохождения — с хотя бы одним исходом «верно/неверно».
    // Пакеты до 2026-09-12 слали измерительному тесту «0 баллов» (PRD-54 §14 п.1), и такие
    // выгрузки в ходу: без этой проверки опросник стал бы оцененным на ноль.
    const graded = Object.values(r.results).some((v) => v === "correct" || v === "incorrect");
    const percent = graded ? percentOf(r.points) : null;

    rows.push({
      participantKey: key,
      attemptKey: marked ? `r:${mark}` : contentKey,
      contentKey,
      marked,
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
      topicLevels: r.topicLevels ?? {},
      topicCourses: r.topicCourses ?? {},
    });
  }

  const repeatedDays = [...sameDay.values()].filter((n) => n > 1).length;
  if (repeatedDays > 0) {
    warnings.push(
      `Несколько прохождений одного участника за одну дату: ${repeatedDays}. Каждое — отдельное прохождение.`,
    );
  }

  return { rows, warnings };
}

/** Где искать уже загруженные записи участника за дату: псевдоним и момент активации модуля. */
function dayKeyOf(participant: string, startedAt: Date): string {
  return `${participant}|${startedAt.getTime()}`;
}

/**
 * Запись участника за дату в рабочем списке сопоставления: из базы либо добавленная строкой этого
 * же файла (`fresh`). Строки файла между собой в протокол «не совпало» не идут — расходиться
 * можно только с тем, что лежало в базе до загрузки.
 */
type SlotEntry = ImportedAttemptKeyRow & { fresh?: boolean };

/** Итог сопоставления строки файла с базой (PRD-54 BR-54-37). */
interface KeyResolution {
  /** Есть ли уже запись с этим ключом — после передачи ключа в том числе. */
  exists: boolean;
  /** Запись, которая перенимает ключ строки; `null` — передавать нечего. */
  heirId: string | null;
  /** Строка без метки не нашла своей записи, хотя в базе у участника за эту дату записи есть. */
  unmatchedSameDay: boolean;
}

/**
 * Сопоставить строку файла с уже загруженными записями того же участника за ту же дату.
 *
 * Своя запись (тот же ключ) — обновится. Иначе ключ перенимает запись без различителя (загружена
 * до 2026-10-06) или, для строки с меткой, запись с её же отпечатком (загружена до пересборки
 * пакета). Только после этого строка считается новой. Список мутируется: строки одного файла
 * видят решения, принятые для предыдущих, — иначе одна старая запись досталась бы двум строкам.
 *
 * @param slot записи участника за дату; дополняется и правится на месте
 * @param row строка плана
 * @returns решение для строки
 */
function resolveKey(slot: SlotEntry[], row: PlannedRow): KeyResolution {
  if (slot.some((e) => e.attemptKey === row.attemptKey)) {
    return { exists: true, heirId: null, unmatchedSameDay: false };
  }
  const heir = slot.find((e) => e.attemptKey === null)
    ?? (row.marked ? slot.find((e) => e.attemptKey === row.contentKey) : undefined);
  if (heir) {
    heir.attemptKey = row.attemptKey;
    return { exists: true, heirId: heir.id, unmatchedSameDay: false };
  }
  const unmatchedSameDay = !row.marked && slot.some((e) => !e.fresh);
  slot.push({
    id: "", participantKey: row.participantKey, startedAt: row.startedAt, attemptKey: row.attemptKey, fresh: true,
  });
  return { exists: false, heirId: null, unmatchedSameDay };
}

/**
 * Справочники для уровней и курсов тем: имена тем и курсы теста по `object_id`.
 *
 * Выгрузка знает тему только по идентификатору, а курс — только по `object_id` из его адреса.
 * Кандидаты в курсы — те же, из которых их выбирает пакет: курсы тем разделов теста и ссылки
 * уровней адаптивного теста. Читается один раз на партию.
 *
 * @param testId тест загрузки
 * @param rows строки плана: их темы тоже ищутся, даже если в разделах теста их уже нет
 * @param storage слой доступа к данным
 * @returns имена тем и курсы по `object_id`
 */
async function loadTopicOutcomeRefs(
  testId: string,
  rows: PlannedRow[],
  storage: IStorage,
): Promise<{ topicNames: Map<string, string>; courseByObjectId: Map<string, ImportedCourse> }> {
  const sections = await storage.getTestSections(testId);
  const levels = await storage.getAdaptiveLevelsByTest(testId);
  const topicIds = new Set<string>([
    ...sections.map((s) => s.topicId),
    ...levels.map((l) => l.topicId),
    ...rows.flatMap((r) => [...Object.keys(r.topicLevels), ...Object.keys(r.topicCourses)]),
  ]);

  const topicNames = new Map<string, string>();
  const courseByObjectId = new Map<string, ImportedCourse>();
  // Первый курс с данным `object_id` выигрывает: один курс WebTutor, привязанный к нескольким
  // темам, остаётся одним курсом.
  const addCourse = (title: string, url: string) => {
    const objectId = courseObjectIdOf(url);
    if (objectId && !courseByObjectId.has(objectId)) courseByObjectId.set(objectId, { title, url });
  };
  for (const topicId of Array.from(topicIds)) {
    const topic = await storage.getTopic(topicId);
    if (!topic) continue;
    topicNames.set(topicId, topic.name);
    for (const course of await storage.getTopicCourses(topicId)) addCourse(course.title, course.url);
  }
  for (const level of levels) {
    for (const link of await storage.getAdaptiveLevelLinks(level.id)) addCourse(link.title, link.url);
  }
  return { topicNames, courseByObjectId };
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
   * PRD-54 BR-54-38: сколько внешних учётных записей заведено для участников, которых в системе не
   * было (в сухом прогоне — сколько будет заведено). Считается по участникам, а не по строкам.
   */
  usersCreated: number;
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
  // Справочники тем и курсов читаются только когда в файле есть блоки тем: у теста без уровней
  // и рекомендаций лишних запросов не делается.
  const hasTopicBlocks = plan.rows.some(
    (r) => Object.keys(r.topicLevels).length > 0 || Object.keys(r.topicCourses).length > 0,
  );
  const { topicNames, courseByObjectId } = hasTopicBlocks
    ? await loadTopicOutcomeRefs(ctx.testId, plan.rows, storage)
    : { topicNames: new Map<string, string>(), courseByObjectId: new Map<string, ImportedCourse>() };

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
      // PRD-54 BR-54-38: связывание идёт всегда; колонка сохраняет смысл для старых партий.
      linkUsers: true,
      importedBy: ctx.userId,
    });
    batchId = batch.id;
  }

  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsLinked = 0;
  let usersCreated = 0;
  /**
   * Участник файла -> его учётная запись. Один человек встречается в файле многими строками, а
   * заводиться и считаться должен один раз. В сухом прогоне записи нет, и значение `null` значит
   * «будет заведена».
   */
  const resolvedUsers = new Map<string, string | null>();
  /** Что партия сделала с участником — копится по строкам и пишется один раз в конце (BR-54-43). */
  const batchUsers = new Map<string, { createdUser: boolean; addedToGroup: boolean }>();
  // BR-54-36: строки без метки, не совпавшие с уже загруженными записями участника за ту же дату.
  let unmatchedSameDay = 0;

  // PRD-54 BR-54-37: что уже лежит в базе по этому тесту — один запрос на партию, а не на строку.
  const existingByDay = new Map<string, SlotEntry[]>();
  for (const e of await storage.listImportedAttemptKeys(ctx.testId)) {
    const day = dayKeyOf(e.participantKey, e.startedAt);
    const slot = existingByDay.get(day);
    if (slot) slot.push(e);
    else existingByDay.set(day, [e]);
  }

  for (const row of plan.rows) {
    // ПОРЯДОК СВЯЗЫВАНИЯ (BR-54-33): сначала идентификатор обучающегося в LMS, если внешний
    // обезличиватель положил его в файл отдельной колонкой (BR-54-32), затем `external_id`
    // против внешнего ключа пользователя. Не нашлось — участник получает внешнюю учётную запись
    // (BR-54-38): связано каждое прохождение.
    let userId: string | null = null;
    const known = resolvedUsers.has(row.participantKey);
    if (known) {
      userId = resolvedUsers.get(row.participantKey) ?? null;
    } else {
      const user = (row.learnerId ? await storage.getUserByLmsLearnerId(row.learnerId) : undefined)
        ?? await storage.getUserByExternalKey(row.participantKey);
      if (user) {
        userId = user.id;
      } else {
        usersCreated += 1;
        if (!dryRun) {
          // BR-54-39: профиль новой записи — из файла; ФИО и организация только когда импорт
          // их хранит, подразделение и должность всегда, как у самого прохождения.
          const created = await storage.createImportedExternalUser({
            externalKey: row.participantKey,
            name: row.lmsUserName,
            lmsLearnerId: row.learnerId,
            organization: row.lmsUserOrg,
            unit: row.lmsUserUnit,
            position: row.lmsUserPosition,
          });
          userId = created.id;
          batchUsers.set(created.id, { createdUser: true, addedToGroup: false });
        }
      }
      resolvedUsers.set(row.participantKey, userId);
    }
    if (userId && !batchUsers.get(userId)?.createdUser) rowsLinked += 1;
    // BR-54-41: группа партии — это и членство. Ставится один раз на участника.
    if (!dryRun && userId && !known) {
      const entry = batchUsers.get(userId) ?? { createdUser: false, addedToGroup: false };
      if (ctx.groupId) entry.addedToGroup = await storage.ensureGroupMember(userId, ctx.groupId);
      batchUsers.set(userId, entry);
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

    const day = dayKeyOf(row.participantKey, row.startedAt);
    if (!existingByDay.has(day)) existingByDay.set(day, []);
    const resolution = resolveKey(existingByDay.get(day)!, row);
    if (resolution.unmatchedSameDay) unmatchedSameDay += 1;

    // Сухой прогон считает добавленные и обновлённые тем же сопоставлением, что и запись.
    if (dryRun) {
      if (resolution.exists) rowsUpdated += 1;
      else rowsCreated += 1;
      continue;
    }

    if (resolution.heirId) await storage.setImportedAttemptKey(resolution.heirId, row.attemptKey);

    const { id, created } = await storage.upsertImportedAttempt({
      snapshotId: row.testVersion === null ? null : snapshotByVersion.get(row.testVersion) ?? null,
      formsJson: Object.keys(formsJson).length > 0 ? formsJson : null,
      testId: ctx.testId,
      participantKey: row.participantKey,
      attemptKey: row.attemptKey,
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
      // Уровни тем и рекомендованные курсы — в ТЕ ЖЕ колонки и той же формы, что у телеметрии:
      // выгрузка книги и разбор прохождения читают оба источника одним кодом.
      achievedLevelsJson: importedLevelsOf(row.topicLevels, topicNames),
      failedTopicCoursesJson: importedCoursesOf(row.topicCourses, courseByObjectId),
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

  if (batchId) {
    for (const [userId, flags] of batchUsers) await storage.recordImportBatchUser(batchId, userId, flags);
  }

  if (unmatchedSameDay > 0) {
    warnings.push(
      `Строк без метки регистрации, не совпавших с уже загруженными прохождениями того же участника за ту же дату: ${unmatchedSameDay}. Это новые прохождения: новая попытка либо прежняя, изменившаяся между выгрузками.`,
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
    usersCreated,
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
