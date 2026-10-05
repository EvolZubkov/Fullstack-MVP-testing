/**
 * @module shared/lms-export/parse
 * @description Разбор листа выгрузки отчёта LMS (PRD-54 раздел 3).
 *
 * Вход — лист как массив строк, значения уже приведены к строкам. Модуль не знает ни про exceljs,
 * ни про базу: так он проверяется без файла и одинаково работает на сервере и в браузере.
 *
 * Форма листа: девять служебных колонок, дальше по ЧЕТЫРЕ подколонки на каждое взаимодействие.
 * Идентификатор взаимодействия стоит в первой строке над первой подколонкой блока, во второй
 * строке идут подписи «Тип», «Продолжительность (сек.)», «Результат», «Полученный ответ».
 */
import { RESPONSE_FORMAT_INTERACTION_ID } from "./response-codec";
import {
  TEST_VERSION_INTERACTION_ID,
  VARIANT_INTERACTION_ID,
  decodeVariantForms,
  parseTestVersion,
} from "./meta";
import { parseExportSeconds } from "./duration";

/** Ширина блока одного взаимодействия. */
const BLOCK = 4;
/** Смещения подколонок блока: тип, продолжительность, результат, полученный ответ. */
const BLOCK_COLUMNS = [0, 1, 2, 3];
/** Число служебных колонок перед первым блоком у ИСХОДНОЙ выгрузки LMS. */
const SERVICE = 9;

/**
 * Заголовки колонок, которые МОЖЕТ добавить внешний обезличиватель (PRD-54 раздел 4.2).
 *
 * `external_id` — обезличенный идентификатор участника, `learner_id` — идентификатор обучающегося
 * в LMS (BR-54-32). Технические, а не человекочитаемые: колонки ставит скрипт, а не человек, и по
 * техническому имени их ни с чем не спутать при переводе шапки.
 */
const EXTRA_HEADERS = { externalId: "external_id", learnerId: "learner_id" } as const;
type ExtraColumn = keyof typeof EXTRA_HEADERS;

/**
 * Где стоит колонка с заголовком `header`; иначе `null`.
 *
 * Место НЕ ЗАДАНО: колонку ищут по заголовку в любой из двух строк шапки и в любом месте листа —
 * в начале, среди служебных, между блоками или в конце. Скрипт обезличивания пишет не человек из
 * нашей команды, и привязка к позиции превратила бы его любую вольность в молча испорченный файл.
 * При нескольких таких колонках берётся первая.
 */
function columnOf(sheet: string[][], header: string): number | null {
  const [head = [], sub = []] = sheet;
  const width = Math.max(head.length, sub.length);
  for (let i = 0; i < width; i += 1) {
    if (cell(head, i).toLowerCase() === header || cell(sub, i).toLowerCase() === header) return i;
  }
  return null;
}

/**
 * Лист без дописанных обезличивателем колонок и сами их значения по строкам.
 *
 * Колонки ВЫРЕЗАЮТСЯ из каждой строки, после чего лист имеет ровно форму исходной выгрузки LMS:
 * служебные поля и блоки взаимодействий читаются по своим обычным местам, где бы колонки ни
 * стояли. Пересчитывать смещения под каждое возможное место было бы хрупко — одно забытое
 * смещение, и разбор поехал бы молча.
 *
 * @param sheet лист как массив строк
 * @returns лист исходной формы и значения колонок по индексам строк (пусто — колонки нет)
 */
function extractExtraColumns(sheet: string[][]): {
  sheet: string[][];
  extra: Record<ExtraColumn, string[]>;
  present: Record<ExtraColumn, boolean>;
} {
  const at = {} as Record<ExtraColumn, number | null>;
  for (const key of Object.keys(EXTRA_HEADERS) as ExtraColumn[]) at[key] = columnOf(sheet, EXTRA_HEADERS[key]);
  const cut = new Set(Object.values(at).filter((i): i is number => i !== null));
  const valuesOf = (i: number | null) => sheet.map((row) => (i === null ? "" : cell(row, i)));
  return {
    // `Array.from` уплотняет строку ДО вырезания: exceljs отдаёт пустые ячейки дырами разреженного
    // массива, а `filter` дыры пропускает — строка съехала бы влево на число пустых ячеек, и шапка
    // перестала бы опознаваться.
    sheet: cut.size === 0
      ? sheet
      : sheet.map((row) => Array.from(row ?? [], (v) => v ?? "").filter((_, i) => !cut.has(i))),
    extra: { externalId: valuesOf(at.externalId), learnerId: valuesOf(at.learnerId) },
    present: { externalId: at.externalId !== null, learnerId: at.learnerId !== null },
  };
}
/** Подписи подколонок блока — по ним лист и опознаётся. */
const SUBHEADERS = ["Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"];
/** Префикс служебных блоков пакета: не вопрос, не шкала, не показатель. */
const META_PREFIX = "meta_";
/** Блок достигнутого уровня темы: `topic_<topicId>_level` (адаптивный тест). */
const TOPIC_LEVEL_RE = /^topic_(.+)_level$/;
/** Блок рекомендованного курса темы: `topic_<topicId>_course_<n>`, ответ — `object_id` курса. */
const TOPIC_COURSE_RE = /^topic_(.+)_course_(\d+)$/;
/**
 * Что пакет пишет в блок уровня темы, когда уровень не достигнут.
 *
 * Пишется в ответ ДОСЛОВНО (`resultsPage.js`), поэтому разбор хранит строку как есть, а значение
 * «не достигнут» из неё извлекает импорт.
 */
export const TOPIC_LEVEL_NOT_ACHIEVED = "Уровень не достигнут";

export interface LmsExportRow {
  participantName: string;
  participantCode: string;
  org: string;
  /**
   * Подразделение и должность участника (колонки 4 и 5 выгрузки).
   *
   * Читаются с 2026-09-25, потому что вошли в псевдоним: табельный код в реальных выгрузках
   * пуст, а организация одна на всех — тёзок различают именно отдел и должность.
   */
  unit: string;
  position: string;
  /**
   * Идентификатор обучающегося в LMS, если его дописал внешний обезличиватель (BR-54-32);
   * пустая строка — колонки в файле нет. По нему импорт связывает прохождение напрямую.
   */
  learnerId: string;
  /**
   * Обезличенный идентификатор участника из колонки `external_id` (PRD-54 раздел 4); пустая
   * строка — колонки нет или ячейка пуста, и импорт вычислит его сам тем же алгоритмом.
   */
  externalId: string;
  courseActivatedAt: string;
  moduleActivatedAt: string;
  passed: boolean | null;
  points: number | null;
  /**
   * `q_<uuid>` без префикса -> строка «Полученный ответ».
   *
   * Ключи — это ВЫДАННЫЙ состав прохождения (PRD-66 FR-10a): задание, которого участник не
   * видел, сюда не попадает, а выданное и не отвеченное попадает с пустой строкой. Пустая
   * строка и отсутствие ключа — разные вещи, и путать их нельзя: первое значит «не стал
   * отвечать», второе — «не показывали».
   */
  answers: Record<string, string>;
  /** `q_<uuid>` без префикса -> `correct` | `incorrect` | `neutral`; пусто — не оценено. */
  results: Record<string, string>;
  /**
   * `q_<uuid>` без префикса -> время на задании в целых секундах.
   *
   * Ключа НЕТ, когда ячейка пуста: пакеты, собранные до измерения времени, шлют пусто, и
   * записать им ноль значило бы выдумать «ответил мгновенно».
   */
  latencySeconds: Record<string, number>;
  /** Ключ шкалы -> числовое значение. */
  scales: Record<string, number>;
  /** Ключ шкалы -> подпись уровня. */
  scaleLevels: Record<string, string>;
  /** Имя показателя -> значение строкой: показатель бывает и числом, и кодом. */
  variables: Record<string, string>;
  /**
   * Версия формата строки ответа, которую сообщил пакет этого прохождения; `null` — не сообщил.
   *
   * Читается ПОСТРОЧНО, а не на файл: в одном отчёте лежат прохождения, собранные разными
   * версиями пакета — колонка тогда общая, а значение своё у каждого участника.
   */
  responseFormat: number | null;
  /**
   * Версия публикации теста, по которой шло прохождение (PRD-56 FR-19a); `null` — не сообщена.
   *
   * Постро́чно по той же причине, что и версия формата: в отчёте лежат прохождения, собранные
   * пакетами разных версий. `null` уводит прохождение в разрез «версия не указана» — приписать
   * его текущей версии значит сделать разрез слепым ровно там, где он и нужен.
   */
  testVersion: number | null;
  /** Идентификаторы выданных вариантов (PRD-17); пустой список — вариантов не было. */
  formIds: string[];
  /**
   * Идентификатор темы -> достигнутый уровень, как его записал пакет (блок `topic_<id>_level`).
   *
   * Строка {@link TOPIC_LEVEL_NOT_ACHIEVED} значит «уровень не достигнут»; ключа нет — блок
   * не пришёл (тест не адаптивный или тема не выдавалась).
   */
  topicLevels: Record<string, string>;
  /**
   * Идентификатор темы -> `object_id` рекомендованных курсов WebTutor (блоки
   * `topic_<id>_course_<n>`) в порядке `n`; пустые ячейки отброшены, пустых списков нет.
   */
  topicCourses: Record<string, string[]>;
}

export interface LmsExportBook {
  questionIds: string[];
  scaleKeys: string[];
  variableNames: string[];
  /** Идентификаторы блоков, которые импорт не разбирает (неизвестные префиксы). */
  unknownColumns: string[];
  /** Есть ли в файле колонка `external_id` — то есть готовил ли его внешний обезличиватель. */
  hasExternalId: boolean;
  rows: LmsExportRow[];
}

function cell(row: string[] | undefined, i: number): string {
  return String(row?.[i] ?? "").trim();
}

/**
 * Похож ли лист на выгрузку отчёта LMS.
 *
 * Опознание идёт по ДВУМ признакам сразу: четвёрка подписей во второй строке и хотя бы один блок с
 * нашим префиксом в первой. Одного мало — четвёрка встречается в чужих отчётах, префикс сам по себе
 * может оказаться в произвольной книге.
 */
export function looksLikeLmsExport(input: string[][]): boolean {
  // Дописанные обезличивателем колонки опознанию не мешают, где бы они ни стояли.
  const [head = [], sub = []] = extractExtraColumns(input).sheet;
  if (head.length < SERVICE + BLOCK) return false;
  const firstBlock = SUBHEADERS.every((label, i) => cell(sub, SERVICE + i) === label);
  if (!firstBlock) return false;
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id.startsWith("q_") || id.startsWith("scale_") || id.startsWith("var_")) return true;
  }
  return false;
}

/**
 * Разобрать лист.
 *
 * @param sheet лист как массив строк; первые две строки — шапка, дальше данные
 * @returns состав колонок и разобранные строки
 */
export function parseLmsExport(input: string[][]): LmsExportBook {
  // Колонки `external_id` и `learner_id` вырезаются до разбора — дальше лист исходной формы.
  const { sheet, extra, present } = extractExtraColumns(input);
  const head = sheet[0] ?? [];
  const blocks: Array<{ at: number; id: string }> = [];
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id) blocks.push({ at: i, id });
  }

  const questionIds: string[] = [];
  const scaleKeys: string[] = [];
  const variableNames: string[] = [];
  const unknownColumns: string[] = [];

  for (const b of blocks) {
    if (b.id.startsWith("q_")) questionIds.push(b.id.slice(2));
    else if (b.id.startsWith("scale_")) {
      const key = b.id.slice(6);
      if (!key.endsWith("_level")) scaleKeys.push(key);
    } else if (b.id.startsWith("var_")) variableNames.push(b.id.slice(4));
    // Служебные блоки пакета (`meta_*`) разбираются отдельно и неопознанными НЕ считаются:
    // иначе импорт предупреждал бы «пакет собран под другой версией теста» на каждой выгрузке.
    else if (b.id.startsWith(META_PREFIX)) continue;
    // Уровни и рекомендованные курсы тем читаются построчно ниже; прочие `topic_*` неизвестны.
    else if (TOPIC_LEVEL_RE.test(b.id) || TOPIC_COURSE_RE.test(b.id)) continue;
    else unknownColumns.push(b.id);
  }

  const rows: LmsExportRow[] = [];
  for (let r = 2; r < sheet.length; r += 1) {
    const raw = sheet[r];
    if (!raw || raw.every((v) => String(v ?? "").trim() === "")) continue;

    const row: LmsExportRow = {
      participantName: cell(raw, 0),
      participantCode: cell(raw, 1),
      org: cell(raw, 2),
      unit: cell(raw, 3),
      position: cell(raw, 4),
      courseActivatedAt: cell(raw, 5),
      moduleActivatedAt: cell(raw, 6),
      passed: cell(raw, 7) === "" ? null : cell(raw, 7) === "Пройден",
      points: cell(raw, 8) === "" ? null : Number(cell(raw, 8)),
      // BR-54-32: идентификатор обучающегося, если его дописал внешний обезличиватель.
      learnerId: extra.learnerId[r],
      externalId: extra.externalId[r],
      answers: {},
      results: {},
      latencySeconds: {},
      scales: {},
      scaleLevels: {},
      variables: {},
      responseFormat: null,
      testVersion: null,
      formIds: [],
      topicLevels: {},
      topicCourses: {},
    };
    // Курсы собираются с номером блока: колонки могут стоять не по порядку, а номера — с дырами
    // (пакет пропускает курс без `object_id`, не сдвигая нумерацию).
    const courses: Record<string, Array<{ n: number; id: string }>> = {};

    for (const b of blocks) {
      const result = cell(raw, b.at + 2);
      const value = cell(raw, b.at + 3);
      // PRD-66 FR-10a: пакет пишет взаимодействие только по ВЫДАННОМУ заданию, поэтому блок, где
      // пусты все четыре подколонки, означает «задания не показывали». Такое взаимодействие в
      // наблюдения не попадает вовсе. Раньше разбор читал три подколонки и сводил пустую ячейку
      // результата к `neutral` — невыданное задание становилось неотличимо от измерительного и
      // портило обе статистики разом: трудность считалась с лишним знаменателем, а измерительные
      // пункты тонули в наблюдениях, которых не было. Различие даёт ИМЕННО четвёртая подколонка,
      // «Тип»: у выданного, но не отвеченного задания заполнена она одна.
      if (BLOCK_COLUMNS.every((offset) => cell(raw, b.at + offset) === "")) continue;
      if (b.id.startsWith("q_")) {
        row.answers[b.id.slice(2)] = value;
        row.results[b.id.slice(2)] = result;
        // Вторая подколонка блока — «Продолжительность (сек.)». Ключ появляется только при
        // измеренном времени, см. `latencySeconds`.
        const seconds = parseExportSeconds(cell(raw, b.at + 1));
        if (seconds !== null) row.latencySeconds[b.id.slice(2)] = seconds;
      } else if (b.id.startsWith("scale_")) {
        const key = b.id.slice(6);
        if (key.endsWith("_level")) row.scaleLevels[key.slice(0, -"_level".length)] = value;
        else if (value !== "") row.scales[key] = Number(value);
      } else if (b.id.startsWith("var_")) {
        row.variables[b.id.slice(4)] = value;
      } else if (b.id === RESPONSE_FORMAT_INTERACTION_ID) {
        // Пустая ячейка = прохождение старого пакета в общей колонке: версии оно не сообщало.
        const n = Number(value);
        row.responseFormat = value !== "" && Number.isFinite(n) ? n : null;
      } else if (b.id === TEST_VERSION_INTERACTION_ID) {
        // PRD-56 FR-19a: пустая ячейка означает «не сообщено», а не текущую версию.
        row.testVersion = parseTestVersion(value);
      } else if (b.id === VARIANT_INTERACTION_ID) {
        row.formIds = decodeVariantForms(value);
      } else {
        const level = TOPIC_LEVEL_RE.exec(b.id);
        const course = level ? null : TOPIC_COURSE_RE.exec(b.id);
        if (level && value !== "") row.topicLevels[level[1]] = value;
        else if (course && value !== "") (courses[course[1]] ??= []).push({ n: Number(course[2]), id: value });
      }
    }
    for (const [topicId, list] of Object.entries(courses)) {
      row.topicCourses[topicId] = list.sort((a, b) => a.n - b.n).map((c) => c.id);
    }

    rows.push(row);
  }

  return { questionIds, scaleKeys, variableNames, unknownColumns, hasExternalId: present.externalId, rows };
}
