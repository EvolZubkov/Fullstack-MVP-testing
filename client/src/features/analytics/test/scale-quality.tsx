/**
 * @module features/analytics/test/scale-quality
 * @description PRD-66 FR-29 — FR-32: качество измерительных ШКАЛ.
 *
 * У заданий без эталона нет ни трудности, ни дискриминации: проверять нечего. Единица анализа
 * для них — шкала, и вопрос к пункту другой: согласован ли он с остальными пунктами своей
 * шкалы и различает ли он людей вообще.
 *
 * РАСПРЕДЕЛЕНИЕ РИСУЕТСЯ ГИСТОГРАММОЙ, а не строкой долей через разделитель (FR-30a): пять
 * чисел подряд читаются как текст, и форму распределения по ним не увидеть. Мёртвый пункт
 * виден мгновенно — один столбик почти во всю высоту.
 *
 * ПРИЗНАК НЕ УТВЕРЖДАЕТ ПРИЧИНУ (FR-31a). Отрицательная корреляция пункта с остатком шкалы
 * означает ровно одно: пункт ведёт себя противоположно шкале. Причин минимум четыре, и
 * различить их можно только прочитав формулировку, чего расчёт не делает. Поэтому подпись
 * даёт ВЫЧИСЛИМОЕ следствие — какой стала бы альфа с перевёрнутым вкладом.
 */
import {
  Card, CardBody, CardHeader, DataGrid, Stack, Tag, Text, Tooltip,
} from "@skillum/ui-kit";

import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import { pluralize } from "@/lib/i18n";

// Общий формат психометрического числа: запятая и типографский минус — как у связи с остатком
// на вкладке заданий («−0,44» в эскизе, а не «-0,44»).
import { FloatingHint } from "./floating-hint";
import { num } from "./psychometrics-format";
import { TermHint } from "./term-hint";
import { percent, percentOfShare } from "../format";

/** Пункт шкалы с его психометрикой. */
export interface ScaleItemRow {
  questionId: string;
  prompt: string;
  /** Тип вопроса — только для пиктограммы: сырой тип на экране недопустим. */
  questionType?: string;
  /**
   * Вклад пункта в шкалу: на сколько она сдвигается за шаг ответа. `exact: false` — вклады
   * градаций неравномерны, и число передаёт направление; `null` — одним числом вклад не
   * выражается (зависит от выбранного варианта).
   */
  contribution?: { value: number; exact: boolean } | null;
  observations: number;
  itemRest: number | null;
  distribution: number[];
  gradeLabels: string[];
  dead: boolean;
  againstScale: boolean;
  alphaIfMirrored: number | null;
}

/** Шкала целиком. */
export interface ScaleQualityRow {
  scaleKey: string;
  label: string;
  reliability:
    | { alpha: number; items: number; respondents: number; totalSd: number; dichotomous: boolean }
    | "too-few-items" | "too-few-respondents" | "no-variance";
  respondents: number;
  ipsative: boolean;
  items: ScaleItemRow[];
}

export interface ScaleQualityPanelProps {
  scales: ScaleQualityRow[];
}

/**
 * Вклад со знаком, как в эскизе: «+1», «−1», «+0,5». Минус — типографский (U+2212): в колонке
 * чисел дефис читается как прочерк, а знак здесь — главное, что о пункте сказано.
 */
export function signedContribution(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  const digits = Number.isInteger(rounded) ? String(Math.abs(rounded)) : String(Math.abs(rounded)).replace(".", ",");
  return `${rounded > 0 ? "+" : "−"}${digits}`;
}

/**
 * Порог «мёртвого» пункта задаёт движок (`DEAD_ITEM_SHARE` в `shared/psychometrics/scales`);
 * экран не пересчитывает признак, а только называет число, которое его вызвало (FR-50): долю
 * самой частой градации.
 */
function topGradeShare(distribution: number[]): number {
  return distribution.length === 0 ? 0 : Math.round(Math.max(...distribution) * 100);
}

/** Почему альфы нет — словами, а не пустым местом. */
const RELIABILITY_GAP: Record<string, string> = {
  "too-few-items": "в шкале меньше двух пунктов",
  "too-few-respondents": "меньше двух участников с полным набором пунктов",
  "no-variance": "все ответили одинаково",
};

/**
 * Подсказки к терминам таблиц шкал — дословно из эскиза `prd66-item-quality.html` (FR-14b).
 *
 * Внутри шкалы опросника единица — «пункт», а не «вопрос».
 */
const HINT = {
  items: "Сколько пунктов опросника вносят вклад в шкалу. Альфа по двум-трём пунктам ненадёжна сама по себе.",
  alpha: "Насколько согласованно пункты шкалы меряют одно и то же. Приемлемо от 0,70, хорошо от 0,80. У ипсативной методики занижена по построению и дефектом не считается.",
  respondents: "Сколько участников ответили на все пункты шкалы: по ним считается альфа.",
  verdict: "Годится ли шкала: альфа от 0,70 — приемлемо, от 0,80 — хорошо. Ниже — пункты шкалы меряют разное.",
  contribution: "С каким знаком ответ на пункт входит в шкалу. У обратного пункта вклад должен быть отрицательным — иначе он портит согласованность шкалы.",
  itemRest: "Связь ответа на этот пункт с суммой по ОСТАЛЬНЫМ пунктам той же шкалы. Показывает, тянет ли пункт в ту же сторону, что шкала целиком. Отрицательная — пункт работает против своей шкалы: чаще всего у обратного пункта забыли поставить отрицательный вклад.",
  quality: "Что не так с пунктом: «Работает против шкалы» — ответы идут противоположно остальным пунктам; «мёртвый» — почти все выбирают одну градацию.",
  // Одна форма гистограммы на все случаи (решение владельца 2026-09-26, FR-30): номера под
  // столбиками, словами — только края, расшифровка номеров — в подсказке ячейки.
  distribution: "Доли участников по градациям ответа. Под столбиками — номера градаций, словами подписаны крайние; расшифровка номеров — в подсказке ячейки.",
} as const;

/**
 * Число градаций словом, с прописной — оно открывает подзаголовок карточки («Пять градаций
 * ответа»). Больше десяти — цифрами: словом такое число читается хуже, чем числом.
 */
const GRADE_COUNT_WORD: Record<number, string> = {
  1: "Одна", 2: "Две", 3: "Три", 4: "Четыре", 5: "Пять",
  6: "Шесть", 7: "Семь", 8: "Восемь", 9: "Девять", 10: "Десять",
};

/**
 * Число градаций пункта. Подписи задаёт автор, распределение считается по ним же; берётся
 * большее, чтобы пункт без ответов на крайнюю градацию не терял её.
 */
function gradeCount(row: ScaleItemRow): number {
  return Math.max(row.distribution.length, row.gradeLabels.length);
}

/**
 * Подзаголовок карточки пунктов шкалы: сколько градаций у ответа и на скольких прохождениях
 * посчитана шкала.
 *
 * Градации считаются только у пунктов Ликерта (PRD-26): у распределения баллов, одиночного
 * выбора и прочих типов «градаций ответа» нет, и шкала из одних таких пунктов называет лишь
 * число прохождений. Пункты с разным числом градаций дают диапазон «от 5 до 7».
 *
 * @param scale шкала с пунктами
 * @returns строка подзаголовка
 */
export function scaleItemsSubtitle(scale: ScaleQualityRow): string {
  const passages = `${scale.respondents} ${pluralize(scale.respondents, "прохождение", "прохождения", "прохождений")}`;
  const counts = scale.items
    .filter(row => row.questionType === "scale")
    .map(gradeCount)
    .filter(count => count > 0);
  if (counts.length === 0) return passages;

  const min = Math.min(...counts);
  const max = Math.max(...counts);
  if (min !== max) return `от ${min} до ${max} градаций ответа · ${passages}`;

  const word = GRADE_COUNT_WORD[min] ?? String(min);
  return `${word} ${pluralize(min, "градация", "градации", "градаций")} ответа · ${passages}`;
}

/**
 * Вывод по шкале (FR-29): годится ли она, словами и тоном.
 *
 * Ипсативная методика — не дефект: альфа там занижена по построению, и тон предупреждения
 * выносил бы приговор, которого методика не заслуживает.
 */
function ScaleVerdict({ scale }: { scale: ScaleQualityRow }) {
  if (scale.ipsative) {
    return (
      <Stack gap={1} align="start">
        <Tag tone="info" size="s">Ипсативная</Tag>
        <Text variant="body-xs" tone="muted">сумма баллов фиксирована, альфа занижена</Text>
      </Stack>
    );
  }
  if (typeof scale.reliability === "string") {
    return (
      <Text variant="body-xs" tone="muted">
        не посчитана: {RELIABILITY_GAP[scale.reliability] ?? "данных не хватает"}
      </Text>
    );
  }
  const { alpha } = scale.reliability;
  if (alpha >= 0.8) return <Tag tone="success" size="s">Хорошо</Tag>;
  if (alpha >= 0.7) return <Tag tone="success" size="s">Приемлемо</Tag>;
  const against = scale.items.filter(row => row.againstScale).length;
  // align="start": без него тег в столбце растягивается на всю ширину колонки (приёмка 5.6).
  return (
    <Stack gap={1} align="start">
      <Tag tone="warning" size="s">Ниже приемлемого</Tag>
      <Text variant="body-xs" tone="muted">
        порог 0,70{against > 0 ? `; ${against} ${pluralize(against, "пункт", "пункта", "пунктов")} против шкалы` : ""}
      </Text>
    </Stack>
  );
}

/**
 * Мини-гистограмма распределения по градациям (FR-30a — FR-30c).
 *
 * Форма ОДНА при любом числе и длине градаций (решение владельца 2026-09-26): под столбиками —
 * номера 1…N, словами подписаны только края, и одной строкой, без переноса. Подписи словами
 * под каждым столбиком наезжали друг на друга или растягивали колонку, а перенесённые — не
 * читались. Расшифровка номеров — нумерованным списком в подсказке ячейки. Высота
 * отсчитывается от общей шкалы 0 — 100 %, поэтому строки таблицы сравнимы между собой.
 */
function GradeHistogram({ distribution, labels }: { distribution: number[]; labels: string[] }) {
  // Градаций у ответа нет вовсе — так бывает у распределения баллов и ранжирования, где
  // участник не выбирает один вариант. Прочерк молча читался бы как «не посчитали», поэтому
  // причина названа в подсказке.
  if (distribution.length === 0) {
    return (
      <FloatingHint
        content="Участник не выбирает один вариант, а раскладывает ответ между утверждениями: градаций, по которым строится распределение, у такого вопроса нет."
      >
        <Text variant="body-xs" tone="muted">—</Text>
      </FloatingHint>
    );
  }
  const last = distribution.length - 1;
  const first = labels[0]?.trim() ?? "";
  const final = last > 0 ? labels[last]?.trim() ?? "" : "";

  // Расшифровка — нумерованным списком в порядке градаций: номер пункта списка и есть номер
  // под столбиком. Строка через запятую читалась сплошным текстом.
  const decoding = (
    <ol className="tb-psy-hist__list">
      {distribution.map((share, i) => {
        const label = labels[i]?.trim();
        const shareText = percentOfShare(share);
        return <li key={i}>{label ? `${label} — ${shareText}` : shareText}</li>;
      })}
    </ol>
  );

  return (
    <FloatingHint title="Градации ответа" content={decoding}>
      <span
        className="tb-psy-hist"
        style={{ gridTemplateColumns: `repeat(${distribution.length}, 1fr)` }}
      >
        {distribution.map((share, i) => (
          <span key={i} className="tb-psy-hist__box">
            <span className="tb-psy-hist__bar" style={{ height: `${Math.round(share * 100)}%` }} />
          </span>
        ))}
        {distribution.map((_, i) => (
          <span key={`label-${i}`} className="tb-psy-hist__label ou-text ou-text--body-xs">
            {String(i + 1)}
          </span>
        ))}
        {first || final ? (
          // Края словами — строкой во всю ширину гистограммы: первый у левого края, последний
          // у правого, в одну строку с многоточием, а не переносом.
          <span className="tb-psy-hist__edges">
            <Text variant="body-xs" tone="muted" truncate>{first}</Text>
            <Text variant="body-xs" tone="muted" truncate align="end">{final}</Text>
          </span>
        ) : null}
      </span>
    </FloatingHint>
  );
}

/** Вкладка качества шкал. */
export function ScaleQualityPanel({ scales }: ScaleQualityPanelProps) {
  if (scales.length === 0) {
    return (
      <Card variant="outlined">
        <CardBody>
          <Text variant="body-s" tone="muted">
            Шкал, по которым набраны наблюдения, в этом тесте нет.
          </Text>
        </CardBody>
      </Card>
    );
  }

  // Сколько прохождений легло в сводку: у шкал оно может разниться (пункты разных форм),
  // и подзаголовок называет наибольшее — объём выборки вкладки.
  const passes = Math.max(...scales.map(scale => scale.respondents));

  const summaryColumns = [
    {
      key: "scale",
      width: "26%",
      header: "Шкала",
      frozen: true,
      render: (row: ScaleQualityRow) => <span>{row.label}</span>,
    },
    {
      key: "items",
      width: "10%",
      header: <TermHint term="Пунктов" hint={HINT.items} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? row.items.length : row.reliability.items}
        </Text>
      ),
    },
    {
      key: "alpha",
      width: "10%",
      header: <TermHint term="Альфа Кронбаха" hint={HINT.alpha} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? "—" : num(row.reliability.alpha)}
        </Text>
      ),
    },
    {
      key: "respondents",
      width: "8%",
      header: <TermHint term="n" hint={HINT.respondents} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? row.respondents : row.reliability.respondents}
        </Text>
      ),
    },
    {
      key: "verdict",
      width: "46%",
      header: <TermHint term="Вывод по шкале" hint={HINT.verdict} />,
      render: (row: ScaleQualityRow) => <ScaleVerdict scale={row} />,
    },
  ];

  return (
    <Stack gap={4}>
      <Card variant="outlined">
        <CardHeader
          title="Шкалы методики"
          subtitle={`Согласованность пунктов внутри шкалы · ${passes} ${pluralize(passes, "прохождение", "прохождения", "прохождений")}`}
        />
        <CardBody>
          <DataGrid
            // Доли сводки — из эскиза: 26 / 10 / 10 / 8 / 46 %.
            className="tb-psy-grid"
            columns={summaryColumns}
            rows={scales}
            rowKey={row => row.scaleKey}
            emptyMessage="Шкал в этом тесте нет"
          />
        </CardBody>
      </Card>

      {scales.map(scale => {
        const reliability = typeof scale.reliability === "string" ? null : scale.reliability;

        // Доли колонок — из эскиза (colgroup состояния wf-scales): 24 / 8 / 14 / 34 / 20 %. При
        // фиксированной раскладке (`tb-psy-grid`) они и есть ширины: таблица на карточке
        // ~1000 px не уходит в горизонтальную прокрутку.
        const columns = [
          {
            key: "item",
            width: "24%",
            header: "Пункт",
            frozen: true,
            // Как в эскизе: пиктограмма типа и текст пункта, без счётчика ответов под ним.
            render: (row: ScaleItemRow) => (
              <span className="ou-stack ou-stack--row ou-stack--gap-1 ou-stack--ai-center">
                {row.questionType
                  ? <QuestionTypeIcon type={row.questionType as QuestionType} size={16} />
                  : null}
                <span className="tb-psy-prompt">{row.prompt}</span>
              </span>
            ),
          },
          // Порядок колонок — как в эскизе: вклад и число связи рядом с пунктом, гистограмма
          // за ними, признак последним.
          {
            key: "contribution",
            width: "8%",
            header: <TermHint term="Вклад" hint={HINT.contribution} align="end" />,
            align: "right" as const,
            numeric: true,
            render: (row: ScaleItemRow) => {
              const contribution = row.contribution ?? null;
              if (contribution === null) {
                return (
                  <FloatingHint
                    content="Вклад зависит от того, какой вариант выбран, и одним числом не выражается."
                  >
                    <Text variant="body-s" tone="muted">—</Text>
                  </FloatingHint>
                );
              }
              if (!contribution.exact) {
                // Вклады градаций неравномерны: число — направление пункта, а не точный шаг.
                return (
                  <FloatingHint
                    content="Вклады градаций неравномерны: число показывает направление пункта — на сколько в среднем сдвигается шкала за одну градацию."
                  >
                    <Text variant="body-s">≈{signedContribution(contribution.value)}</Text>
                  </FloatingHint>
                );
              }
              return <Text variant="body-s">{signedContribution(contribution.value)}</Text>;
            },
          },
          {
            key: "itemRest",
            width: "14%",
            // Перенос после первого слова (решение владельца 2026-09-26): «Корреляция» /
            // «с остатком шкалы», а не как придётся по ширине колонки. Пробел перед <br /> держит
            // термин одним текстом для поиска и экранного диктора.
            header: <TermHint term={<>Корреляция <br />с остатком шкалы</>} hint={HINT.itemRest} align="end" />,
            align: "right" as const,
            numeric: true,
            render: (row: ScaleItemRow) => <Text variant="body-s">{num(row.itemRest)}</Text>,
          },
          {
            key: "distribution",
            width: "34%",
            header: <TermHint term="Распределение ответов" hint={HINT.distribution} />,
            render: (row: ScaleItemRow) => (
              <GradeHistogram distribution={row.distribution} labels={row.gradeLabels} />
            ),
          },
          {
            key: "flag",
            width: "20%",
            header: <TermHint term="Качество пункта" hint={HINT.quality} />,
            render: (row: ScaleItemRow) => {
              if (row.againstScale) {
                return (
                  <Stack gap={1} align="start">
                    <Tag tone="error" size="s">Работает против шкалы</Tag>
                    {row.alphaIfMirrored !== null && reliability ? (
                      // Вычислимое следствие вместо догадки о причине (FR-31b).
                      <Text variant="body-xs" tone="muted">
                        с вкладом −1 альфа {num(reliability.alpha)} → {num(row.alphaIfMirrored)}
                      </Text>
                    ) : null}
                  </Stack>
                );
              }
              if (row.dead) {
                return (
                  <Stack gap={1} align="start">
                    <Tag tone="warning" size="s">Мёртвый пункт</Tag>
                    {/* FR-50: признак несёт число, которое его вызвало. */}
                    <Text variant="body-xs" tone="muted">
                      {percent(topGradeShare(row.distribution))} в одной градации
                    </Text>
                  </Stack>
                );
              }
              // «Работает» — вывод по связи с остатком шкалы. Где её посчитать не на чем,
              // утверждать нечего, и стоит прочерк.
              return row.itemRest === null
                ? <Text variant="body-xs" tone="muted">—</Text>
                : <Tag tone="success" size="s">Работает</Tag>;
            },
          },
        ];

        return (
          <Card key={scale.scaleKey} variant="outlined">
            <CardHeader
              // Согласованность шкалы — в сводке «Шкалы методики»; здесь только её пункты.
              title={`Пункты шкалы «${scale.label}»`}
              subtitle={scaleItemsSubtitle(scale)}
              trail={scale.ipsative
                ? (
                  <Tooltip
                    content="Участник раздаёт фиксированный запас баллов, поэтому высокий балл одному пункту неизбежно означает низкий другому. Вклады связаны по построению, и согласованность здесь систематически занижена."
                    placement="bottom"
                    wrap
                  >
                    <Tag tone="info" size="s">Ипсативная методика</Tag>
                  </Tooltip>
                )
                : null}
            />
            <CardBody>
              <DataGrid
                // Фиксированная раскладка по долям эскиза, как у таблиц разбора вопроса.
                className="tb-psy-grid"
                columns={columns}
                rows={scale.items}
                rowKey={row => row.questionId}
                emptyMessage="Пунктов с наблюдениями в этой шкале нет"
              />
            </CardBody>
          </Card>
        );
      })}
    </Stack>
  );
}
