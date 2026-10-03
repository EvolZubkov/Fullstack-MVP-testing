/**
 * @module features/analytics/test/item-breakdown
 * @description PRD-66 FR-24 — FR-26: разбор одного задания.
 *
 * Таблица вкладки говорит, ЧТО с заданием не так; разбор — ГДЕ именно. Трудность и
 * дискриминативность стоят плитками в одном ряду со временем и замыслом автора: у каждой
 * величины два-три числа, и отдельная карточка под каждую осталась бы пустой на три четверти.
 *
 * Разрез по крайним группам — не украшение: именно он показывает, ЧЕМ дистрактор привлекателен.
 * Доли считаются ОТ СВОЕЙ ГРУППЫ (FR-26b) — колонка целиком даёт сто процентов, — и это главный
 * источник непонимания, поэтому знаменатель назван в подсказке заголовка.
 *
 * Группы различают КОЛОНКИ и подписи, а не цвет (FR-26c): проверка палитры показала, что пара
 * «акцент + синий» неразличима при дейтеранопии.
 */
import {
  Button, Card, CardBody, CardHeader, DataGrid, Grid, Stack, Tag, Text,
} from "@skillum/ui-kit";
import { ArrowLeft } from "lucide-react";

import { TermHint } from "./term-hint";
// Общий формат чисел: типографский минус (U+2212). Своя копия без него печатала «-0,33» на
// плитке поправки — дефис в колонке чисел читается как прочерк (приёмка 5.5).
import { num } from "./psychometrics-format";
import { percentOfShare } from "../format";

import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import { pluralize } from "@/lib/i18n";

/** Вариант ответа с частотами и признаками. */
export interface OptionRow {
  index: number;
  label: string;
  correct: boolean;
  share: number;
  bottomShare: number | null;
  topShare: number | null;
  restCorrelation: number | null;
  dead: boolean;
  inverted: boolean;
  /** Верный вариант, который выбирают слабые, — симптом испорченного ключа. */
  correctButWeak?: boolean;
}

/** Разбор задания — то, что отдаёт `GET .../psychometrics/:testId/items/:questionId`. */
export interface ItemBreakdownView {
  questionId: string;
  prompt: string;
  questionType: string;
  item: {
    observations: number;
    difficulty: number | null;
    correctedDifficulty: number | null;
    itemRest: number | null;
    discrimination: number | null;
    declaredDifficulty: number | null;
    timing: { medianMs: number; q1Ms: number; q3Ms: number; measured: number } | null;
  };
  groups: { size: number; share: number; topDifficulty: number; bottomDifficulty: number } | null;
  options: OptionRow[] | null;
  /** Редакции содержания, встреченные в выборке (FR-49). */
  versions?: VersionRow[];
  /** Тема вопроса — первая часть подзаголовка «Тема · подтема · N наблюдений». */
  topicName?: string;
  /** Подтемы вопроса — его теги (PRD-11). */
  tags?: string[];
  /** Отпечаток текущей редакции вопроса; `null` — неизвестен. */
  currentVersion?: string | null;
  /**
   * По какой редакции посчитана карточка: отпечаток, `null` — «версия неизвестна»; поля нет —
   * редакция одна, и карточка считается по всей выборке.
   */
  selectedVersion?: string | null;
}

/** Строка таблицы редакций. */
export interface VersionRow {
  psychoHash: string | null;
  observations: number;
  difficulty: number | null;
  /** Корреляция вопрос-остаток по этой редакции; `null` — наблюдений меньше порога коэффициентов. */
  itemRest?: number | null;
  firstAt: string;
  lastAt: string;
}

export interface ItemBreakdownPanelProps {
  view: ItemBreakdownView;
  /**
   * Вернуться к таблице вопросов. Не задан — у панели нет своей шапки: на уровне вопроса (Э2)
   * заголовок и путь назад даёт шапка уровня с крошками.
   */
  onBack?: () => void;
  /**
   * Какую редакцию выбрал автор: строка-отпечаток, `null` — «версия неизвестна»; `undefined` —
   * ещё не выбирал, и отмечена та, по которой сервер посчитал карточку (`view.selectedVersion`).
   */
  version?: string | null;
  /** Показать другую редакцию — это смена ВЫБОРКИ, а не отдельный экран (FR-49a). */
  onSelectVersion?: (version: string | null | undefined) => void;
}


/** Доля как процент для чтения: сервер отдаёт здесь доли 0-1, а не проценты. */
const percent = percentOfShare;

/** Время в минутах и секундах — так его и читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Линейчатая шкала доли: значение, за ним дорожка (FR-26a).
 *
 * Шкалы обеих колонок одной длины, поэтому строки и колонки сравниваются взглядом: у верного
 * ответа длиннее правая шкала, у работающего дистрактора — левая, у мёртвого варианта обе
 * почти пусты.
 */
function ShareScale({ value }: { value: number | null }) {
  if (value === null) return <Text variant="body-s" tone="muted">—</Text>;
  return (
    <span className="tb-psy-scale">
      <span className="tb-psy-scale__value ou-text ou-text--body-s">{percent(value)}</span>
      <span className="tb-psy-scale__track">
        <span className="tb-psy-scale__fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  );
}

/** Признак варианта: симптом словами, без догадки о причине. */
function optionFlag(option: OptionRow): { tone: "success" | "warning" | "error"; label: string } {
  // Верный вариант, который выбирают СЛАБЫЕ, — самый яркий симптом испорченного ключа, и
  // нейтральный ярлык «Верный ответ» на нём читался бы как «здесь всё в порядке».
  if (option.correct && option.correctButWeak) return { tone: "error", label: "Верный ответ выбирают слабые" };
  // Что вариант верный, уже сказано подписью под ним; колонка отвечает на другой вопрос —
  // работает ли он (эскиз).
  if (option.correct) return { tone: "success", label: "Работает" };
  if (option.dead) return { tone: "warning", label: "Мёртвый вариант" };
  if (option.inverted) return { tone: "error", label: "Выбирают сильные" };
  return { tone: "success", label: "Работает" };
}

/**
 * На сколько пунктов замысел может разойтись с наблюдением, не считаясь расхождением (FR-18a).
 *
 * Десять пунктов шкалы 0–100: автор ставит сложность на глаз, и разница в пять-семь пунктов —
 * точность его оценки, а не находка.
 */
const INTENT_TOLERANCE = 10;

/** Вывод о расхождении замысла и наблюдения словами (FR-18a). */
function intentVerdict(declared: number, observed: number | null): string {
  if (observed === null) return "наблюдения нет";
  const gap = observed - declared;
  if (Math.abs(gap) <= INTENT_TOLERANCE) return "расхождения нет";
  return gap > 0 ? `труднее задуманного на ${gap}` : `легче задуманного на ${-gap}`;
}

/** Ориентир трудности из FR-13 — стоит под числом всегда, чтобы было с чем сравнить. */
const DIFFICULTY_RANGE = "приемлемо: 0,20 — 0,80";

/**
 * Подпись плитки трудности: ориентир и, если число за ним, вывод (FR-13).
 *
 * Границы — те же, что у признаков списка: ниже 0,20 «слишком трудный», выше 0,90 «слишком
 * лёгкий». Полоса 0,80 — 0,90 признаком не метится, но и в ориентир не входит: там вопрос
 * «лёгкий» — отсеивает мало, но ещё отсеивает.
 */
function difficultyCaption(p: number | null): string {
  if (p === null) return DIFFICULTY_RANGE;
  const rounded = Math.round(p * 100) / 100;
  if (rounded < 0.2) return `слишком трудный · ${DIFFICULTY_RANGE}`;
  if (rounded > 0.9) return `слишком лёгкий · ${DIFFICULTY_RANGE}`;
  if (rounded > 0.8) return `лёгкий · ${DIFFICULTY_RANGE}`;
  return DIFFICULTY_RANGE;
}

/**
 * Полоса индекса дискриминации, в которую попало число (FR-14): вывод и её границы.
 *
 * Сравнивается число, ОКРУГЛЁННОЕ так же, как на плитке: иначе под «0,40» стояло бы «хорошо
 * 0,30 — 0,39».
 */
function discriminationBand(d: number): string {
  const rounded = Math.round(d * 100) / 100;
  if (rounded < 0) return "дефект: ниже 0";
  if (rounded < 0.2) return "слабое: ниже 0,20";
  if (rounded < 0.3) return "приемлемо 0,20 — 0,29";
  if (rounded < 0.4) return "хорошо 0,30 — 0,39";
  return "отлично от 0,40";
}

/** Число вариантов словом, как в эскизе («четыре варианта»); больше десяти — цифрами. */
const COUNT_WORDS = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять"];

function optionsCount(count: number): string {
  const word = COUNT_WORDS[count] || String(count);
  return `${word} ${pluralize(count, "вариант", "варианта", "вариантов")}`;
}

/** Дата редакции — «04.09.2026». */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

/**
 * Подписи строки таблицы версий (эскиз): текущая — «С дд.мм.гггг — текущая», прежние —
 * диапазоном дат, серия без отпечатка — «Версия неизвестна» с объяснением, откуда она.
 *
 * @param row строка редакции
 * @param current отпечаток текущей редакции вопроса
 * @param stampedSince когда в выборке появились редакции с отпечатком — граница серии без него
 */
function versionLabel(
  row: VersionRow,
  current: string | null | undefined,
  stampedSince: string | null,
): { title: string; sub: string | null } {
  if (row.psychoHash === null) {
    return {
      title: "Версия неизвестна",
      sub: `импорт выгрузок и прохождения до ${day(stampedSince ?? row.lastAt)}`,
    };
  }
  if (current && row.psychoHash === current) return { title: `С ${day(row.firstAt)} — текущая`, sub: null };
  return { title: `${day(row.firstAt)} — ${day(row.lastAt)}`, sub: "предыдущая редакция" };
}

/**
 * Подсказки к терминам разбора — дословно из эскиза `prd66-item-quality.html` (FR-14b).
 *
 * Трудность и дискриминативность повторяются в плитках и в таблице версий: текст у них один,
 * иначе один и тот же термин объяснялся бы по-разному.
 */
const HINT = {
  difficulty: "Средняя доля набранного балла: 0 — не решил никто, 1 — решили все. Приемлемо 0,20 — 0,80; выше 0,90 вопрос ничего не отсеивает.",
  corrected: "Трудность за вычетом случайных попаданий — для вопроса с одним верным ответом. Ноль и ниже: вопрос решают не лучше, чем наугад. Частичное знание модель не учитывает.",
  itemRest: "Отделяет ли вопрос сильных от слабых: корреляция балла за него с баллом за остальные вопросы формы. Хорошо от 0,30, отрицательная — почти всегда ошибка в ключе.",
  discrimination: "Разница доли балла у сильных и слабых — верхних и нижних 27 % участников. От 0,30 — хорошо, ниже 0,20 — слабо, отрицательный — дефект.",
  intent: "Трудность, заявленная автором, рядом с наблюдаемой, в одной шкале 0 — 100. Расхождение больше 10 пунктов: вопрос оказался легче или труднее задуманного.",
  time: "Типичное время на вопрос: половина участников отвечает быстрее, половина — дольше. Медиана не зависит от брошенных и забытых открытыми вкладок.",
  share: "Доля всех участников, выбравших этот вариант. Вариант, который почти никто не выбирает, не работает как дистрактор.",
  bottom: "Нижние 27 % участников по баллу за весь тест. Число — доля ИЗ ЭТОЙ ГРУППЫ, выбравшая вариант; колонка целиком даёт 100 %. Дистрактор работает, когда здесь больше, чем у сильных.",
  top: "Верхние 27 % участников по баллу за весь тест. Число — доля ИЗ ЭТОЙ ГРУППЫ, выбравшая вариант; колонка целиком даёт 100 %. У верного ответа здесь должно быть больше, чем у слабых.",
  optionRest: "Корреляция выбора варианта с баллом за остальные вопросы. У верного ответа должна быть положительной, у дистрактора — отрицательной. Положительная у дистрактора значит, что его выбирают сильные: вариант частично верен либо ключ неверен.",
  optionQuality: "Работает ли вариант: у верного ответа выбор должен расти с баллом, у дистрактора — падать. «Выбирают сильные» — дистрактор притягивает тех, кто знает материал.",
  version: "Версия текста вопроса. После правки формулировки наблюдения копятся заново: числа разных редакций описывают разные вопросы и не складываются.",
  versionN: "Сколько участников видели вопрос в этой редакции. Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100.",
  cardStats: "По какой редакции посчитаны плитки и варианты ответа выше. По умолчанию — текущая; другую выбирают кнопкой «Показать».",
} as const;

/** Карточка разбора задания. */
/**
 * Подзаголовок разбора — «Тема · подтема · N наблюдений» (эскиз); пустые части не печатаются.
 * Общий у панели и шапки уровня вопроса.
 */
export function breakdownSubtitle(view: ItemBreakdownView): string {
  return [
    view.topicName,
    view.tags?.length ? view.tags.join(", ") : "",
    `${view.item.observations} ${pluralize(view.item.observations, "наблюдение", "наблюдения", "наблюдений")}`,
  ].filter(Boolean).join(" · ");
}

/** Заголовок разбора: пиктограмма типа вопроса и его текст. */
export function BreakdownTitle({ view }: { view: ItemBreakdownView }) {
  return (
    <>
      {view.questionType
        ? <QuestionTypeIcon type={view.questionType as QuestionType} size={20} />
        : null}
      {" "}{view.prompt}
    </>
  );
}

export function ItemBreakdownPanel({ view, onBack, version, onSelectVersion }: ItemBreakdownPanelProps) {
  const { item, groups, options } = view;
  // FR-18a: наблюдение — в шкале автора (0 — легко, 100 — сложно). Трудность p растёт в
  // обратную сторону (1 — решили все), и сравнивать их напрямую значило бы читать лёгкое
  // задание как трудное.
  const observedHardness = item.difficulty === null ? null : Math.round((1 - item.difficulty) * 100);
  // Порядок эскиза: текущая редакция первой, за ней прежние от новых к старым, серия «версия
  // неизвестна» — последней. Автор после правки сравнивает «стало» с «было», и «стало» — сверху.
  const versions = [...(view.versions ?? [])].sort((a, b) => {
    const rank = (row: typeof a) => (row.psychoHash === null ? 2 : row.psychoHash === view.currentVersion ? 0 : 1);
    return rank(a) - rank(b) || (b.lastAt < a.lastAt ? -1 : b.lastAt > a.lastAt ? 1 : 0);
  });
  // Выбранная автором редакция; до выбора — та, по которой сервер посчитал карточку (текущая).
  const selectedVersion = version !== undefined ? version : view.selectedVersion;
  // Граница серии «версия неизвестна»: с какого дня в выборке есть редакции с отпечатком.
  const stampedSince = versions
    .filter(row => row.psychoHash !== null)
    .map(row => row.firstAt)
    .sort()[0] ?? null;
  const subtitle = breakdownSubtitle(view);
  // Размер крайних групп — в заголовке колонки: 27 % не четверть, и число не подменяется словом.
  const groupPercent = percentOfShare(groups?.share ?? 0.27);

  const columns = [
    {
      key: "option",
      // Доли эскиза (30/9/19/19/10/13) сдвинуты к последней колонке: тег «Мёртвый вариант» не
      // помещался в 13 % и вылезал за край, включая горизонтальную прокрутку (приёмка 5.5).
      width: "28%",
      header: "Вариант",
      frozen: true,
      render: (row: OptionRow) => (
        <Stack gap={1}>
          <span className="tb-psy-prompt">{row.label}</span>
          {row.correct ? <Text variant="body-xs" tone="muted">верный ответ</Text> : null}
        </Stack>
      ),
    },
    {
      key: "share",
      width: "9%",
      header: <TermHint term="Выбрали" hint={HINT.share} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: OptionRow) => <Text variant="body-s">{percent(row.share)}</Text>,
    },
    {
      key: "bottom",
      width: "17%",
      header: <TermHint term={`Слабые ${groupPercent}`} hint={HINT.bottom} />,
      render: (row: OptionRow) => <ShareScale value={row.bottomShare} />,
    },
    {
      key: "top",
      width: "17%",
      header: <TermHint term={`Сильные ${groupPercent}`} hint={HINT.top} />,
      render: (row: OptionRow) => <ShareScale value={row.topShare} />,
    },
    {
      key: "rest",
      width: "12%",
      // Неразрывный пробел держит предлог при слове: в колонке 10 % заголовок иначе ломался в три
      // строки с одиноким «с» посередине, а так — не больше двух.
      header: <TermHint term={"Корреляция с остатком"} hint={HINT.optionRest} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: OptionRow) => <Text variant="body-s">{num(row.restCorrelation)}</Text>,
    },
    {
      key: "flag",
      width: "17%",
      header: <TermHint term="Качество варианта" hint={HINT.optionQuality} />,
      render: (row: OptionRow) => {
        const flag = optionFlag(row);
        return <Tag tone={flag.tone} size="s">{flag.label}</Tag>;
      },
    },
  ];

  return (
    <Stack gap={4}>
      {onBack && (
        <Stack gap={1} align="start">
          <Button variant="ghost" size="s" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
            Ко всем вопросам
          </Button>
          <Text variant="heading-l"><BreakdownTitle view={view} /></Text>
          <Text variant="body-m" tone="muted">{subtitle}</Text>
        </Stack>
      )}

      {/* FR-48b: СТРОГО три в ряд. Автоподбор давал на широком мониторе пять плиток и одну
          на второй строке, а пары величин разъезжались по разным строкам. */}
      <Grid cols={3} gap={1}>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.difficulty)}</Text>
              <Text variant="body-s" tone="muted"><TermHint term="Трудность" hint={HINT.difficulty} /></Text>
              <Text variant="body-xs" tone="subtle">{difficultyCaption(item.difficulty)}</Text>
            </Stack>
          </CardBody>
        </Card>
        {item.correctedDifficulty !== null ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">{num(item.correctedDifficulty)}</Text>
                <Text variant="body-s" tone="muted"><TermHint term="С поправкой на угадывание" hint={HINT.corrected} /></Text>
                {/* Сколько вариантов и какой доли ждать от случайного выбора — как в эскизе.
                    FR-17b (частичное знание модель не учитывает) эскиз перенёс в подсказку
                    термина: под числом у каждой плитки одна строка. */}
                {view.options?.length ? (
                  <Text variant="body-xs" tone="subtle">
                    {`${optionsCount(view.options.length)}, ожидание ${num(1 / view.options.length)}`}
                  </Text>
                ) : null}
              </Stack>
            </CardBody>
          </Card>
        ) : null}
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.itemRest)}</Text>
              <Text variant="body-s" tone="muted"><TermHint term="Дискриминативность (r)" hint={HINT.itemRest} /></Text>
              <Text variant="body-xs" tone="subtle">корреляция вопрос-остаток · хорошо от 0,30</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.discrimination)}</Text>
              <Text variant="body-s" tone="muted"><TermHint term="Индекс дискриминации (D)" hint={HINT.discrimination} /></Text>
              <Text variant="body-xs" tone="subtle">
                {/* Эскиз: «крайние четверти, 27 % · хорошо 0,30 — 0,39» — расшифровка из FR-14a
                    и полоса FR-14, в которую попало число. */}
                {groups
                  ? `крайние четверти, ${percentOfShare(groups.share)}${item.discrimination === null ? "" : ` · ${discriminationBand(item.discrimination)}`}`
                  : "крайние группы не сложились"}
              </Text>
            </Stack>
          </CardBody>
        </Card>
        {item.declaredDifficulty !== null ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">
                  {item.declaredDifficulty} → {observedHardness === null ? "—" : observedHardness}
                </Text>
                <Text variant="body-s" tone="muted"><TermHint term="Замысел и наблюдение" hint={HINT.intent} /></Text>
                {/* FR-18a: два числа и вывод о расхождении — без вывода плитка ничего не утверждает. */}
                <Text variant="body-xs" tone="subtle">{intentVerdict(item.declaredDifficulty, observedHardness)}</Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
        {item.timing ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">{duration(item.timing.medianMs)}</Text>
                <Text variant="body-s" tone="muted"><TermHint term="Время, медиана" hint={HINT.time} /></Text>
                <Text variant="body-xs" tone="subtle">
                  половина ответов {duration(item.timing.q1Ms)} — {duration(item.timing.q3Ms)} · {item.timing.measured} {pluralize(item.timing.measured, "наблюдение", "наблюдения", "наблюдений")}
                </Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Grid>

      {options ? (
        <Card variant="outlined">
          <CardHeader
            title="Варианты ответа"
            subtitle={`Частота выбора и связь с остальным баллом · ${item.observations} ${pluralize(item.observations, "наблюдение", "наблюдения", "наблюдений")}`}
          />
          <CardBody>
            <DataGrid
              // Фиксированная раскладка по долям эскиза: иначе доли колонок — лишь пожелание, и
              // таблица на карточке ~1000 px уходила в горизонтальную прокрутку (приёмка 5.5).
              className="tb-psy-grid"
              columns={columns}
              rows={options}
              rowKey={row => String(row.index)}
              emptyMessage="Вариантов ответа у вопроса нет"
            />
          </CardBody>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardBody>
            {/* FR-27: у сопоставления и ранжирования «вариантов» нет — есть пары и порядок. */}
            <Text variant="body-s" tone="muted">
              Для этого типа вопроса разбор вариантов не применяется: по нему работают трудность и
              дискриминативность.
            </Text>
          </CardBody>
        </Card>
      )}

      {/* FR-49: версии содержания — последним блоком: это разрез выборки, а не свойство задания. */}
      {versions.length > 1 && onSelectVersion ? (
        <Card variant="outlined">
          <CardHeader
            title="Версии содержания"
            subtitle="Наблюдения разных редакций не складываются"
          />
          <CardBody>
            <DataGrid
              // Фиксированная раскладка по долям эскиза: иначе доли колонок — лишь пожелание, и
              // таблица на карточке ~1000 px уходила в горизонтальную прокрутку (приёмка 5.5).
              className="tb-psy-grid"
              columns={[
                {
                  key: "version",
                  width: "30%",
                  header: <TermHint term="Редакция" hint={HINT.version} />,
                  frozen: true,
                  render: (row: VersionRow) => {
                    // FR-49b: серия, собранная до появления штампа, выбирается так же, как
                    // остальные, — иначе эти наблюдения были бы недоступны вовсе; её числа
                    // приглушены как приблизительные.
                    const label = versionLabel(row, view.currentVersion, stampedSince);
                    return (
                      <Stack gap={1}>
                        {row.psychoHash === null
                          ? <Text variant="body-s" tone="muted">{label.title}</Text>
                          : <span className="ou-grid__cell-strong">{label.title}</span>}
                        {label.sub ? <Text variant="body-xs" tone="muted">{label.sub}</Text> : null}
                      </Stack>
                    );
                  },
                },
                {
                  key: "observations",
                  width: "10%",
                  header: <TermHint term="n" hint={HINT.versionN} align="end" />,
                  align: "right" as const,
                  numeric: true,
                  render: (row: VersionRow) => <Text variant="body-s">{row.observations}</Text>,
                },
                {
                  key: "difficulty",
                  width: "16%",
                  header: <TermHint term="Трудность" hint={HINT.difficulty} align="end" />,
                  align: "right" as const,
                  numeric: true,
                  render: (row: VersionRow) => (
                    <Text variant="body-s" tone={row.psychoHash === null ? "muted" : undefined}>{num(row.difficulty)}</Text>
                  ),
                },
                {
                  key: "itemRest",
                  width: "22%",
                  header: <TermHint term="Дискриминативность" hint={HINT.itemRest} align="end" />,
                  align: "right" as const,
                  numeric: true,
                  render: (row: VersionRow) => (
                    <Text variant="body-s" tone={row.psychoHash === null || row.itemRest == null ? "muted" : undefined}>
                      {num(row.itemRest ?? null)}
                    </Text>
                  ),
                },
                {
                  key: "action",
                  width: "22%",
                  header: <TermHint term="Статистика карточки" hint={HINT.cardStats} />,
                  render: (row: VersionRow) => {
                    // FR-49a: отметка выбранной редакции переезжает в нажатую строку. «Показать
                    // все вместе» нет: наблюдения разных редакций не складываются.
                    const shown = selectedVersion !== undefined && selectedVersion === row.psychoHash;
                    return shown
                      ? <Tag tone="info" size="s">Выбрана</Tag>
                      : (
                        <Button variant="secondary" size="s" onClick={() => onSelectVersion(row.psychoHash)}>
                          Показать
                        </Button>
                      );
                  },
                },
              ]}
              rows={versions}
              rowKey={row => row.psychoHash ?? "unknown"}
              emptyMessage="Редакций в выборке нет"
            />
          </CardBody>
        </Card>
      ) : null}
    </Stack>
  );
}
