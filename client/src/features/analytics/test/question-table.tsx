/**
 * @module features/analytics/test/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Одна строка отвечает на вопрос «что с этим заданием»: доля верных, пропуски, экспозиция,
 * время и авторская трудность рядом. Тип задания — пиктограммой, той же, что в дереве контента
 * и в таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами прямо в
 * строке: вид без объяснения читается как приговор заданию, а решение принимает автор.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и ноль
 * в этой колонке был бы про него ложью — поэтому прочерк.
 */
import { useEffect, useMemo, useState } from "react";

import { Ban } from "lucide-react";
import { useLocation } from "wouter";

import {
  Banner, Button, Card, CardBody, CardHeader, DataGrid, ModalDialog, ProgressBar, ProgressStacked,
  SegmentedControl, Stack, Text,
} from "@skillum/ui-kit";

import type { QuestionType } from "@shared/questions/question-type";
import { questionInTopicHref } from "@/features/content/question-link";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { pluralize } from "@/lib/i18n";

import { percent } from "../format";
import { DeliveryExclusionDialog, type ExclusionTarget } from "./delivery-exclusion-dialog";
import { COEFFICIENT_MIN, DIFFICULTY_HINT, ITEM_REST_HINT, num } from "./psychometrics-format";
import { QuestionRowMenu } from "./question-row-menu";
import { TermHint } from "./term-hint";

/**
 * Толкования терминов в заголовках колонок (FR-14b) — дословно из эскиза prd66-item-quality,
 * состояние wf-items. Трудность и дискриминативность толкуются теми же словами, что на вкладке
 * «Качество вопросов» (`psychometrics-format`): одна величина на двух экранах не объясняется
 * двумя способами.
 */
const HINTS = {
  skip: "Доля показов, в которых на вопрос не ответили. Считается по веб-прохождениям: состав выданной формы пакет SCORM не сообщает.",
  exposure: "Доля прохождений, в которые попал вопрос. Высокая экспозиция при малом банке — ответ быстро становится известен.",
  latency: "Типичное время на вопрос: половина участников отвечает быстрее, половина — дольше. Медиана не зависит от брошенных и забытых открытыми вкладок.",
  declared: "Трудность, которую автор заявил при создании вопроса: 0 — легко, 100 — сложно. Сравнивается с наблюдаемой в разборе вопроса.",
  points: "Сколько баллов вопрос приносит в этом тесте: цена, заданная вопросу в тесте, иначе цена раздела, иначе цена теста.",
  otherTests: "В скольких других тестах вопрос выдавался за окно наблюдения экспозиции (по умолчанию 12 месяцев). Вопрос, который показывают в нескольких тестах, быстрее становится известен.",
} as const;

/** Признак ревизии — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface ReviewFlagView {
  kind: string;
  reason: string;
}

/** Строка таблицы заданий. */
export interface QuestionRow {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicName: string;
  difficulty: number;
  totalAnswers: number;
  gradedAnswers: number;
  correctAnswers: number;
  /** `null` — оценивать было нечего (измерительное задание). */
  correctPercent: number | null;
  /** Доля пропусков; `null` — состав выдачи неизвестен (прохождения только из LMS). */
  skipShare: number | null;
  exposurePercent: number | null;
  /** В скольких ДРУГИХ тестах задание выдавалось за окно экспозиции (PRD-55 FR-32). */
  otherTestsCount?: number;
  /** Цена задания в этом тесте; `null` — измерительное задание, баллов не приносит. */
  points?: number | null;
  latencyMedianMs: number | null;
  latencySampleSize: number;
  reviewFlags: ReviewFlagView[];
  /** PRD-56 FR-17a: задание исключено из выдачи ЭТОГО теста. */
  excludedFromDelivery?: boolean;
  /**
   * PRD-56 FR-22: разброс ответов измерительного задания — то, чем у него заменена доля
   * верных. `null` — задание оценивается либо разбрасывать нечего.
   */
  spread?: { options: Array<{ label: string; share: number; correct?: boolean }>; answered: number } | null;
  /**
   * PRD-57 FR-32: сводка свободного текста — сколько написали и как длинно. Частотная
   * таблица развёрнутому ответу не годится: двух одинаковых ответов не бывает.
   */
  volume?: { answered: number; medianLength: number; minLength: number; maxLength: number } | null;
}

/** Строка списка ответов — то, что отдаёт `GET .../questions/:id/answers` (FR-32). */
interface AnswerRow {
  attemptId: string;
  source: string;
  participant: string;
  at: string | null;
  answer: string;
  length: number;
  result: string;
  latencyMs: number | null;
}

export interface QuestionTableProps {
  questions: QuestionRow[];
  /** Э3.4: вид, с которым таблица открывается, — блок «Требует внимания» ведёт в нужный. */
  initialView?: QuestionsView;
  /**
   * Тест измерительный: вместо доли верных таблица показывает разброс ответов (FR-22).
   *
   * Признак приходит сверху, а не выводится из строк: таблица, где доля верных пуста у всех
   * заданий, бывает и у оцениваемого теста, по которому ещё никто не проходил, а набор
   * колонок от количества прохождений зависеть не должен.
   */
  measurement?: boolean;
  /** Порог наблюдений: ниже него разброс не печатается, потому что он шум (FR-06d). */
  minObservations?: number;
  /** Уйти в реестр к прохождениям, где на этом задании ошиблись (FR-17). */
  onOpenRegistry?: (questionId: string) => void;
  /** Переключить состояние «исключён из выдачи» (FR-17a). Без него действие не предлагается. */
  onDeliveryChange?: (questionId: string, excluded: boolean) => void;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
  /** Завершённых прохождений — объём, по которому считана таблица (эскиз: подзаголовок). */
  passages?: number;
  /**
   * PRD-66 FR-02, FR-03: трудность и дискриминативность задания, посчитанные движком
   * психометрики.
   *
   * Приходят сверху отдельным запросом, а не считаются здесь: то же число показывает вкладка
   * «Качество вопросов», и второй расчёт развёл бы их при первой же правке движка. Отсутствие
   * записи — «ещё не посчитано», и это прочерк, а не ноль.
   */
  psychometrics?: Record<string, QuestionPsychometrics>;
  /**
   * Открыть разбор задания — уровень вопроса (FR-03, Э3.3). `order` — вопросы в порядке таблицы,
   * как она отсортирована сейчас: по нему ходят «Предыдущий / Следующий».
   */
  onOpenQuality?: (questionId: string, order: string[]) => void;
}

/** Психометрика одного задания — ровно то, что нужно строке таблицы. */
export interface QuestionPsychometrics {
  /** Доля набранного балла: 0 — не решил никто, 1 — решили все. */
  difficulty: number | null;
  /** Корреляция задание-остаток; `null` — считать не на чем. */
  itemRest: number | null;
  observations: number;
  /** `insufficient` — наблюдений меньше порога коэффициентов (FR-38a). */
  coefficientConfidence: "insufficient" | "tentative" | "reliable";
}

/** Вид таблицы «Вопросы». */
export type QuestionsView = "all" | "review" | "excluded";
type View = QuestionsView;
type SortDir = "asc" | "desc";

/** Где браузер помнит, что пояснение о смене числа уже прочитано (FR-02). */
const DIFFICULTY_NOTICE_KEY = "tb.analytics.difficulty-notice-hidden";

/** Время на задание: минуты и секунды, как их читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Значение для сортировки: отсутствующее всегда уезжает в конец. */
function sortValue(row: QuestionRow, key: string, psycho?: QuestionPsychometrics): number {
  const byKey: Record<string, number | null> = {
    difficulty: psycho?.difficulty ?? null,
    itemRest: psycho?.itemRest ?? null,
    skip: row.skipShare,
    exposure: row.exposurePercent,
    otherTests: row.otherTestsCount ?? null,
    points: row.points ?? null,
    latency: row.latencyMedianMs,
    declared: row.difficulty,
  };
  const value = key in byKey ? byKey[key] : row.totalAnswers;
  return value ?? Number.POSITIVE_INFINITY;
}

/**
 * Сколько долей печатается в строке разброса; остальные — «ещё N».
 *
 * У шкалы подписи — градации в слово или цифру, их влезает четыре. У распределения баллов
 * подпись это утверждение на строку, и больше двух в колонку не помещается никак.
 */
const SPREAD_VISIBLE: Record<string, number> = { scale: 4, allocation: 2 };

/** Типы, у которых сервер считает разброс ответов (`answer-spread.ts`); у прочих его нет. */
const SPREAD_TYPES = new Set(["scale", "allocation", "short", "single", "multiple"]);

/** Предел длины подписи варианта: утверждения опросника бывают в целое предложение. */
const SPREAD_LABEL_MAX = 44;

/**
 * Разброс ответов строкой: «Командный 62 % · Вдохновляющий 21 % · ещё 2» (FR-22).
 *
 * Два ограничения, и оба из данных, а не из вкуса. Варианты печатаются по убыванию доли и
 * только первые три: у распределения баллов их бывает десять, и полный перечень занял бы
 * строку на весь экран, ничего к ответу не добавив — хвост из процента-двух не о чём.
 * Подпись варианта режется, потому что у распределения это не слово «Командный», а целое
 * утверждение на строку; полный текст и полный перечень остаются в подсказке.
 *
 * У шкалы подписи короткие («1», «Иногда»), и между меткой и долей ставится тире: без него
 * «1 6 %» читается как одно число. У распределения тире лишнее — эскиз
 * prd56-test-analytics.html, состояние items-measurement.
 */
function spreadLabel(
  options: ReadonlyArray<{ label: string; share: number; correct?: boolean }>,
  type: string,
): { short: string; full: string } {
  // У выбора подпись — текст варианта, и бывает числом («3389»): без тире доля сливается с ним.
  const dash = type === "scale" || type === "single" || type === "multiple" ? " — " : " ";
  const say = (option: { label: string; share: number; correct?: boolean }, cut: boolean) => {
    const label = cut && option.label.length > SPREAD_LABEL_MAX
      ? `${option.label.slice(0, SPREAD_LABEL_MAX).trimEnd()}…`
      : option.label;
    // Верный вариант помечается: у оцениваемого задания разброс читают как «куда уходят
    // ошибившиеся», и без пометки лидирующий неверный вариант не отличить от верного.
    return `${option.correct ? "✓ " : ""}${label}${dash}${percent(option.share)}`;
  };

  const ranked = [...options].sort((a, b) => b.share - a.share);
  const visible = ranked.slice(0, SPREAD_VISIBLE[type] ?? 3);
  const hidden = ranked.length - visible.length;

  return {
    short: visible.map(option => say(option, true)).join(" · ")
      + (hidden > 0 ? ` · ещё ${hidden}` : ""),
    full: ranked.map(option => say(option, false)).join(" · "),
  };
}

/** Цвет сегмента верного варианта и два чередующихся оттенка прочих — эскиз, items-answers-b. */
const CORRECT_SEGMENT = "var(--ou-success-default)";
const OTHER_SEGMENTS = ["var(--ou-border-strong)", "var(--ou-fg-subtle)"] as const;

/**
 * Полоса «Что отвечали» оцениваемого вопроса: сегмент на каждый вариант (этап Э1 UX-аудита).
 *
 * Прежняя полоса показывала долю САМОГО ЧАСТОГО ответа нейтральным цветом, и 80 % читалось как
 * «80 % верных», даже когда лидировал неверный вариант. Теперь видно и долю верного (зелёный
 * сегмент), и куда уходят остальные. Порядок — как в подписи под полосой, по убыванию доли;
 * прочие варианты красятся через один, чтобы соседние не сливались.
 *
 * У «нескольких ответов» доли в сумме больше 100 % (каждый отмечает несколько вариантов): шкала
 * тогда берётся по сумме, иначе сегменты вылезли бы за край полосы.
 *
 * @param options доли вариантов из разброса ответов
 * @returns сегменты и масштаб для `ProgressStacked`
 */
export function answerSegments(
  options: ReadonlyArray<{ share: number; correct?: boolean }>,
): { segments: Array<{ value: number; color: string }>; max: number } {
  const ranked = [...options].filter(option => option.share > 0).sort((a, b) => b.share - a.share);
  let other = 0;
  const segments = ranked.map(option => ({
    value: option.share,
    color: option.correct ? CORRECT_SEGMENT : OTHER_SEGMENTS[other++ % OTHER_SEGMENTS.length],
  }));
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return { segments, max: Math.max(100, total) };
}

export function QuestionTable({
  questions, onOpenRegistry, onDeliveryChange, testId, measurement, minObservations = 0,
  psychometrics, onOpenQuality, passages, initialView = "all",
}: QuestionTableProps) {
  const [view, setView] = useState<View>(initialView);
  const [sortKey, setSortKey] = useState(measurement ? "answers" : "difficulty");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Вопрос, для которого открыто окно подтверждения исключения. */
  const [pending, setPending] = useState<ExclusionTarget | null>(null);
  const [, navigate] = useLocation();
  /** Задание, ответы которого открыты списком (FR-32). */
  const [reading, setReading] = useState<QuestionRow | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[] | null>(null);
  /**
   * Закрыто ли разовое пояснение о смене числа в колонке (FR-02).
   *
   * Отказ живёт в браузере читателя, а не в его учётной записи: это заметка «я прочитал»,
   * а не настройка продукта, и синхронизировать её между устройствами незачем. Хранилище
   * бывает недоступно (приватное окно, запрет на данные сайта), поэтому отказ читается и
   * пишется под try/catch, а недоступность значит «показать»: пояснение важнее тишины.
   */
  const [noticeHidden, setNoticeHidden] = useState(() => {
    try {
      return window.localStorage.getItem(DIFFICULTY_NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hideNotice = () => {
    setNoticeHidden(true);
    try {
      window.localStorage.setItem(DIFFICULTY_NOTICE_KEY, "1");
    } catch {
      // Не сохранилось — пояснение вернётся в следующий раз. Это мелкое неудобство, а
      // падение экрана аналитики из-за заметки «я прочитал» — нет.
    }
  };

  const flagged = useMemo(
    () => questions.filter(question => question.reviewFlags.length > 0),
    [questions],
  );
  const excludedRows = useMemo(
    () => questions.filter(question => question.excludedFromDelivery),
    [questions],
  );
  /**
   * Есть ли в тесте задания, на которые ПИШУТ (PRD-57 FR-28x, FR-32).
   *
   * У них своя колонка, и в ОБЫЧНОМ тесте тоже: у короткого ответа разброс написаний
   * дополняет долю верных (варианты там не заданы заранее), а у свободного текста заменяет
   * её объёмом и длиной. До этого колонка показывалась только у теста, целиком собранного
   * из измерительных заданий, — и всё, что считал сервер с Э3, автор не видел.
   */
  const hasWrittenAnswers = useMemo(
    () => questions.some(question => question.volume || (question.spread && question.correctPercent !== null)),
    [questions],
  );

  /**
   * Фиксированная раскладка с долями колонок эскиза (prd66-item-quality, состояние wf-items):
   * 24 / 11 / 17 / 10 / 11 / 12 / 11 / 4 %. При `table-layout: auto` доли — лишь пожелание, и
   * заголовки-термины со значком подсказки распирали таблицу до горизонтальной прокрутки
   * («Замысел» уезжал за край, приёмка 5.2). Только для обычного набора колонок: у опросника и
   * у теста с письменными ответами свой состав, и там раскладка прежняя.
   */
  const fixedLayout = !measurement && !hasWrittenAnswers;
  const share = (width: string) => (fixedLayout ? { width } : {});

  // FR-32: сами ответы приходят отдельным запросом и только по открытию окна — свободный
  // текст участника не грузится вместе с таблицей, где его никто не просил.
  useEffect(() => {
    if (!reading) {
      setAnswers(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${reading.questionId}/answers`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { rows: AnswerRow[] };
        if (alive) setAnswers(data.rows);
      } catch {
        if (alive) setAnswers([]);
      }
    })();
    return () => { alive = false; };
  }, [reading, testId]);

  const rows = useMemo(() => {
    const shown = view === "review" ? flagged : view === "excluded" ? excludedRows : questions;
    return [...shown].sort((a, b) => {
      const diff = sortValue(a, sortKey, psychometrics?.[a.questionId])
        - sortValue(b, sortKey, psychometrics?.[b.questionId]);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [questions, flagged, excludedRows, view, sortKey, sortDir, psychometrics]);

  const columns = [
    {
      key: "question",
      // Вкладка «Вопросы» говорит «вопрос», как в эскизе и как в теме, откуда вопрос пришёл;
      // «задание» — термин психометрики и живёт на вкладке «Качество вопросов» (PRD-66).
      header: "Вопрос",
      frozen: true,
      // У опросника колонка ограничена: рядом с ней стоит разброс ответов, и текст вопроса,
      // растянувший её по себе, вытолкнул бы за край экрана всё, что правее.
      ...(measurement ? { width: "40%" } : share("20%")),
      render: (row: QuestionRow) => (
        // Текст задания переносится, иначе строка вопроса распирает столбец по себе: ячейки
        // стола по умолчанию не переносятся, и это верно для чисел, но не для предложения.
        // `tb-psy-question` держит НИЖНИЙ предел ширины: с приходом колонки
        // «Дискриминативность» условие сжималось в столбик по три слова (PRD-66, приёмка).
        <Stack gap={1} className={`ou-grid__cell-wrap${measurement || fixedLayout ? "" : " tb-psy-question"}`}>
          <Stack direction="row" gap={2} align="center">
            <QuestionTypeIcon type={row.questionType as QuestionType} />
            {/*
              FR-17a: состояние выдачи метится перечёркнутым кругом с подсказкой, а НЕ тегом:
              тег стоит в одном ряду с темой и подтемой и читается как ярлык содержания, а
              речь идёт о состоянии выдачи.
            */}
            {row.excludedFromDelivery && (
              <span
                className="tb-qscoring__qtype"
                title="Исключён из выдачи — в новые прохождения не попадает"
                aria-label="Исключён из выдачи"
              >
                <Ban size={16} color="var(--ou-error-default)" aria-hidden="true" />
              </span>
            )}
            <span className="ou-grid__cell-strong">{row.questionPrompt}</span>
          </Stack>
          <Text variant="body-xs" tone="muted">{row.topicName}</Text>
          {/* Признак назван прямо в строке: отбор без объяснения — это приговор без основания. */}
          {row.reviewFlags.map(flag => (
            <Text key={flag.kind} variant="body-xs" tone="warning">{flag.reason}</Text>
          ))}
        </Stack>
      ),
    },
    // FR-22: у опросника эталона нет, и доля верных заменяется разбросом ответов — полосой
    // с долей лидирующего варианта и полным перечнем долей подписью. Полоса АКЦЕНТНАЯ, без
    // тонов «успех / предупреждение»: высокая доля градации не хороша и не плоха, оценивать
    // её не относительно чего (FR-21b). У оцениваемого теста эталон есть, и колонка «Что
    // отвечали» рисует полосу из сегментов по всем вариантам с верным зелёным
    // (`answerSegments`, эскиз prd56-test-analytics, состояние items-answers-b).
    ...(measurement || hasWrittenAnswers ? [{
      key: "spread",
      header: measurement ? "Разброс ответов" : "Что отвечали",
      // Ширина задана, иначе перечень долей растягивает колонку и выталкивает за край
      // экрана те, что стоят правее: у распределения баллов подпись варианта — утверждение.
      width: "34%",
      render: (row: QuestionRow) => {
        // PRD-57 FR-32: у свободного текста вместо долей — объём и длина, а сами работы
        // открываются списком: частот у написанного не бывает, и читать их незачем.
        if (row.volume) {
          if (row.totalAnswers < minObservations) {
            return <Text variant="body-s" tone="muted">мало данных</Text>;
          }
          return (
            <Stack gap={1} className="ou-grid__cell-wrap">
              <Text variant="body-xs" tone="muted">
                {row.volume.answered} {pluralize(row.volume.answered, "ответ", "ответа", "ответов")}
                {" · медиана "}{row.volume.medianLength} {pluralize(row.volume.medianLength, "знак", "знака", "знаков")}
                {" (от "}{row.volume.minLength}{" до "}{row.volume.maxLength}{")"}
              </Text>
              <Button
                variant="ghost"
                size="s"
                aria-label={`Прочитать ответы: ${row.questionPrompt}`}
                onClick={() => setReading(row)}
              >
                Прочитать ответы
              </Button>
            </Stack>
          );
        }
        // Разброс считается только у шкалы, распределения и короткого ответа. У выбора,
        // сопоставления и ранжирования его нет по устройству: «мало данных» там читалось как
        // нехватка ответов у вопроса, на который ответили сотни человек.
        if (!SPREAD_TYPES.has(row.questionType)) {
          return <Text variant="body-s" tone="muted">—</Text>;
        }
        if (!row.spread || row.totalAnswers < minObservations) {
          return <Text variant="body-s" tone="muted">мало данных</Text>;
        }
        const label = spreadLabel(row.spread.options, row.questionType);
        if (measurement) {
          const leader = row.spread.options.reduce(
            (top, option) => (option.share > top.share ? option : top),
            row.spread.options[0],
          );
          return (
            <Stack gap={1} className="ou-grid__cell-wrap">
              <ProgressBar size="s" value={Math.round(leader.share)} hideHeader />
              <Text variant="body-xs" tone="muted" title={label.full}>
                {label.short}
              </Text>
            </Stack>
          );
        }
        return (
          <Stack gap={1} className="ou-grid__cell-wrap">
            <ProgressStacked
              size="s"
              role="img"
              aria-label={label.full}
              {...answerSegments(row.spread.options)}
            />
            <Text variant="body-xs" tone="muted" title={label.full}>
              {label.short}
            </Text>
          </Stack>
        );
      },
    }] : []),
    ...(measurement ? [{
      key: "answers",
      header: "Ответов",
      align: "center" as const,
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => row.totalAnswers,
    }] : [
      // PRD-66 FR-02: место доли верных заняла трудность. Доля верных схлопывала верность к
      // «ровно максимум» и у задания с частичным кредитом была просто неверна; держать обе
      // колонки значило бы закрепить неверное число рядом с верным.
      {
        key: "difficulty",
        ...share("10%"),
        header: <TermHint term="Трудность" hint={DIFFICULTY_HINT} />,
        numeric: true,
        align: "center" as const,
        sortable: true,
        render: (row: QuestionRow) => num(psychometrics?.[row.questionId]?.difficulty ?? null),
      },
      // FR-03: главное психометрическое число обязано быть видно там, где автор работает, —
      // иначе новая вкладка становится складом, куда никто не заходит.
      {
        key: "itemRest",
        ...share("15%"),
        header: <TermHint term="Дискриминативность" hint={ITEM_REST_HINT} />,
        numeric: true,
        align: "center" as const,
        sortable: true,
        render: (row: QuestionRow) => {
          const psycho = psychometrics?.[row.questionId];
          // FR-38a: у коэффициента свой порог, и он ВЫШЕ порога трудности. Строка, где
          // трудность есть, а дискриминативности нет, — это не сбой, и сказать об этом надо
          // словами: прочерк читался бы как «ноль» или «сломалось».
          if (!psycho || psycho.itemRest === null || psycho.coefficientConfidence === "insufficient") {
            return <Text variant="body-s" tone="muted">мало данных</Text>;
          }
          if (!onOpenQuality) return num(psycho.itemRest);
          return (
            <Button
              variant="ghost"
              size="s"
              aria-label={`Разбор вопроса: ${row.questionPrompt}`}
              onClick={() => onOpenQuality(row.questionId, rows.map(item => item.questionId))}
            >
              {num(psycho.itemRest)}
            </Button>
          );
        },
      },
    ]),
    {
      key: "skip",
      ...share("9%"),
      header: <TermHint term="Пропуски" hint={HINTS.skip} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => percent(row.skipShare),
    },
    // Экспозиция — свойство ВЫДАЧИ, и у опросника она есть, но эскиз её в этой таблице не
    // держит: строка опросника отвечает на «что выбирали», а как часто задание показывали —
    // вопрос вкладки «Выдача», где профиль банка и стоит (FR-20).
    ...(measurement ? [] : [{
      key: "exposure",
      ...share("10%"),
      // «Экспозиция» — как в эскизе и в пояснении под таблицей: то же слово, что у профиля
      // банка на вкладке «Выдача» (PRD-55).
      header: <TermHint term="Экспозиция" hint={HINTS.exposure} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => percent(row.exposurePercent),
    }, {
      // Колонка «Количество тестов» отчёта WebTutor. Считается по ВЫДАЧАМ, а не по составу
      // тестов: задание в теме чужого теста, которое там ни разу не выпало, участники не
      // видели, и для износа задания оно не в счёт (PRD-55 FR-32).
      key: "otherTests",
      ...share("7%"),
      header: <TermHint term="Другие тесты" hint={HINTS.otherTests} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => row.otherTestsCount ?? "—",
    }]),
    {
      key: "latency",
      ...share("10%"),
      header: <TermHint term="Время, медиана" hint={HINTS.latency} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => duration(row.latencyMedianMs),
    },
    // Авторская трудность у опросника бессмысленна: трудным бывает задание с верным ответом,
    // а здесь верного ответа нет вовсе.
    //
    // Называется «Замысел», потому что с PRD-66 FR-02 в таблице появилась НАБЛЮДАЕМАЯ
    // трудность: две колонки «Трудность» с разными числами читались бы как поломка, а
    // заявленная автором величина — это именно замысел, а не измерение.
    ...(measurement ? [] : [{
      key: "declared",
      ...share("8%"),
      header: <TermHint term="Замысел" hint={HINTS.declared} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => row.difficulty,
    }, {
      // Колонка «Вес» отчёта WebTutor. Цена та же, что у движка оценивания: иначе таблица
      // называла бы одну цену, а результат участника считался бы по другой.
      key: "points",
      ...share("7%"),
      header: <TermHint term="Цена" hint={HINTS.points} />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => (row.points === null || row.points === undefined
        ? "—"
        : row.points.toLocaleString("ru-RU")),
    }]),
    // Действия строки — ПОД ТРОЕТОЧИЕМ, как в эскизе (prd66-item-quality, состояние
    // wf-items). Двумя текстовыми кнопками они занимали 263 px — пятую часть таблицы, — и
    // с приходом колонки «Дискриминативность» правая уезжала за горизонтальную прокрутку
    // (вскрыто приёмкой в браузере). Порядок пунктов — как в эскизе prd56-test-analytics:
    // сначала куда перейти, потом что сделать с выдачей.
    {
      key: "rowActions",
      ...share("4%"),
      header: "",
      render: (row: QuestionRow) => (
        <QuestionRowMenu
          prompt={row.questionPrompt}
          onOpenQuality={onOpenQuality ? () => onOpenQuality(row.questionId, rows.map(item => item.questionId)) : undefined}
          onOpenInTopic={() => navigate(questionInTopicHref(row.questionId))}
          onOpenRegistry={onOpenRegistry && row.correctPercent !== null
            ? () => onOpenRegistry(row.questionId)
            : undefined}
          excluded={row.excludedFromDelivery}
          onExclude={onDeliveryChange
            ? () => setPending({
              questionId: row.questionId,
              prompt: row.questionPrompt,
              // Эскиз: «тема · N % показов при M % верных» — почему вопрос и стоит исключать.
              caption: [
                row.topicName,
                row.exposurePercent !== null && row.correctPercent !== null
                  ? `${percent(row.exposurePercent)} показов при ${percent(row.correctPercent)} верных`
                  : "",
              ].filter(Boolean).join(" · "),
            })
            : undefined}
          onRestore={onDeliveryChange ? () => onDeliveryChange(row.questionId, false) : undefined}
        />
      ),
    },
  ];

  return (
    <Stack gap={4}>
      {/*
        PRD-66 ОВ-01: число в колонке сменилось у экрана, который автор уже читает, и молча
        подменять его нельзя — он сравнивает сегодняшнюю таблицу со вчерашней. Пояснение
        разовое: закрывший его больше не увидит (FR-02).
      */}
      {!measurement && noticeHidden === false ? (
        <Banner
          variant="subtle"
          tone="info"
          size="sm"
          title="Колонка «Доля верных» заменена трудностью"
          description="Трудность считается долей набранного балла. У вопросов с точной оценкой число прежнее, у вопросов с частичным кредитом — выше."
          actions={[{ label: "Больше не показывать", onClick: hideNotice }]}
        />
      ) : null}

      <Card>
      <CardHeader
        title="Вопросы теста"
        subtitle={`${questions.length} ${pluralize(questions.length, "вопрос", "вопроса", "вопросов")} в выдаче${excludedRows.length > 0 ? `, ${excludedRows.length} ${pluralize(excludedRows.length, "исключён", "исключено", "исключено")} из выдачи` : ""}${passages !== undefined ? ` · ${passages} ${pluralize(passages, "прохождение", "прохождения", "прохождений")}` : ""} · доля пропусков считается по веб-прохождениям: состав выданной формы пакет не сообщает`}
        trail={
          <SegmentedControl
            size="s"
            value={view}
            onChange={value => setView(value as View)}
            items={[
              { value: "all", label: "Все вопросы" },
              { value: "review", label: "Требуют ревизии", badge: flagged.length },
              { value: "excluded", label: "Исключённые", badge: excludedRows.length },
            ]}
          />
        }
      />
      <CardBody>
        <DataGrid
          className={fixedLayout ? "tb-psy-grid" : undefined}
          columns={columns}
          rows={rows}
          rowKey={row => row.questionId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          // Э3.3: строка открывает вопрос — прежде клик по ней не делал ничего.
          onRowClick={onOpenQuality ? row => onOpenQuality(row.questionId, rows.map(item => item.questionId)) : undefined}
          emptyMessage={view === "review"
            ? "Признаки проблем не сошлись ни у одного вопроса: чинить нечего"
            : view === "excluded"
              ? "Из выдачи ничего не исключено"
              : "Вопросов в выдаче пока нет"}
        />
        {/*
          PRD-66 FR-04, FR-38a: два порога сосуществуют в одной строке, и экран обязан
          сказать, какой к какому числу относится. Выборка названа там же: трудность считается
          по первой попытке участника, а пропуски и время — по всем ответам, и автор, который
          сверит таблицу со вкладкой «Качество вопросов», должен знать почему.
        */}
        {!measurement ? (
          <Text variant="body-xs" tone="muted">
            Трудность и дискриминативность считаются по доле балла в первой попытке участника ·
            пропуски, экспозиция и время — от {minObservations || 10} наблюдений,
            дискриминативность — от {COEFFICIENT_MIN}
          </Text>
        ) : null}
      </CardBody>

      {/* FR-17b: исключение подтверждается отдельным окном — тем же, что у «Качества вопросов». */}
      <DeliveryExclusionDialog
        target={pending}
        testId={testId}
        onClose={() => setPending(null)}
        onConfirm={questionId => onDeliveryChange?.(questionId, true)}
      />

      {/*
        PRD-57 FR-32: сами работы — списком, с выгрузкой. Отдельного экрана трек не заводит:
        список читают оттуда же, где увидели сводку, и тем же окном, каким таблица уже
        пользуется для подтверждения исключения.
      */}
      <ModalDialog
        open={reading !== null}
        onClose={() => setReading(null)}
        size="l"
        title="Ответы на вопрос"
        description={reading?.questionPrompt}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setReading(null)}>Закрыть</Button>
            {reading && (
              <Button
                variant="primary"
                size="m"
                // Ссылкой, а не запросом: файл отдаёт сервер, и браузер сохраняет его сам.
                onClick={() => {
                  window.location.href =
                    `/api/analytics/tests/${testId}/questions/${reading.questionId}/answers/export/excel`;
                }}
              >
                Выгрузить в Excel
              </Button>
            )}
          </>
        }
      >
        <Stack gap={3}>
          {answers === null ? (
            <Text tone="muted">Читаем ответы…</Text>
          ) : answers.length === 0 ? (
            <Text tone="muted">На этот вопрос пока никто не ответил</Text>
          ) : (
            answers.map(row => (
              <Stack key={`${row.attemptId}-${row.length}`} gap={1} className="ou-grid__cell-wrap">
                <Text variant="body-xs" tone="muted">
                  {row.participant}
                  {row.at ? ` · ${new Date(row.at).toLocaleString("ru-RU")}` : ""}
                  {` · ${row.length} ${pluralize(row.length, "знак", "знака", "знаков")}`}
                  {row.latencyMs === null ? "" : ` · ${duration(row.latencyMs)}`}
                </Text>
                <Text>{row.answer}</Text>
              </Stack>
            ))
          )}
        </Stack>
      </ModalDialog>
      </Card>
    </Stack>
  );
}
