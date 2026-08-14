/**
 * @module features/tests/editor/sections/results-labels-pane
 * @description PRD-49 §7 — подраздел «Заголовки и подписи» и порядок подблоков итогов
 * во вкладке «Оформление».
 *
 * Перечень надписей объявляет ШАБЛОН (`manifest.labels[]`), значения хранит ТЕСТ
 * (`design_settings_json.labels`), поэтому панель ничего не выдумывает: строки берутся из
 * объявлений, а в черновик уходят только отклонения от них. Шаблон без объявлений
 * настройки не поддерживает — панель говорит об этом прямо, а не рисует пустой список.
 *
 * Три состояния надписи различимы явно (§2, решение 3): «не трогал» — ключа нет,
 * «своя формулировка» — `{ on: true, text }`, «надписи нет» — `{ on: false }`. Пустое поле
 * при включённом тумблере — это НЕ «убрать надпись»: ключ удаляется, и тест снова следует
 * за текстом шаблона.
 *
 * Компонент один на две стороны. На стороне итогов он правит общую формулировку, на
 * стороне отчёта — слой переопределений (`report_settings_json.labels`), где подсказкой
 * поля стоит уже разрешённый текст экрана итогов: строка по умолчанию говорит «как на
 * экране итогов».
 */

import { useMemo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Banner,
  Cluster,
  FormField,
  FormSection,
  IconButton,
  Input,
  Stack,
  Switch,
  Text,
} from "@universityrt/ui-kit";
import type { LabelDeclaration, LabelValue, LabelValues } from "@shared/template/labels";
import {
  DEFAULT_BLOCK_ORDER,
  resolveBlockOrder,
  type ResultsBlockKey,
} from "@shared/template/results-order";

// ─── Public API ───────────────────────────────────────────────────────────────

export type ResultsLabelsScreen = "results" | "report";

export type ResultsLabelsPaneProps = {
  /** Объявления активного шаблона (`manifest.labels[]`). Пусто — настройки нет. */
  declarations: readonly LabelDeclaration[];
  /** Значения ЭТОГО слоя: общие для итогов либо переопределения отчёта. */
  labels: LabelValues;
  /** Новый слой целиком: панель не мутирует переданный объект. */
  onChange: (next: LabelValues) => void;
  /** Экран слоя: решает, какое умолчание шаблона показывать подсказкой. */
  screen?: ResultsLabelsScreen;
  /**
   * Тексты, относительно которых правится ЭТОТ слой. Для отчёта — разрешённые надписи
   * экрана итогов, чтобы автор видел, от чего он отступает. Пусто — умолчания шаблона.
   */
  baseLabels?: Record<string, string>;
  /** Сохранённый порядок подблоков. Блок порядка рисуется только с `onOrderChange`. */
  order?: readonly ResultsBlockKey[];
  /** Состав и порядок, объявленные шаблоном для экрана итогов. */
  templateOrder?: readonly ResultsBlockKey[];
  onOrderChange?: (next: ResultsBlockKey[]) => void;
  readOnly?: boolean;
};

/**
 * Подписи подблоков на случай, если шаблон не объявил надписей второго уровня: список
 * порядка обязан оставаться читаемым и тогда — автор двигает блоки, а не ключи.
 */
const BLOCK_FALLBACK_NAMES: Record<ResultsBlockKey, string> = {
  summary: "Общий балл",
  scales: "По шкалам",
  indicators: "По показателям",
  topics: "По темам",
};

/** Ключ надписи второго уровня, подписывающей подблок. */
const BLOCK_LABEL_KEY: Record<ResultsBlockKey, string> = {
  summary: "results.summary",
  scales: "results.scales",
  indicators: "results.indicators",
  topics: "results.topics",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Группы в порядке ПЕРВОГО появления: порядок объявлений — решение шаблона. */
function groupDeclarations(
  declarations: readonly LabelDeclaration[],
): Array<{ group: string; items: LabelDeclaration[] }> {
  const out: Array<{ group: string; items: LabelDeclaration[] }> = [];
  const byGroup = new Map<string, LabelDeclaration[]>();
  for (const decl of declarations) {
    const group = decl.group || "Прочее";
    let items = byGroup.get(group);
    if (!items) {
      items = [];
      byGroup.set(group, items);
      out.push({ group, items });
    }
    items.push(decl);
  }
  return out;
}

/** Текст, от которого отступает этот слой: база слоя, иначе умолчание шаблона. */
function fallbackText(
  decl: LabelDeclaration,
  screen: ResultsLabelsScreen,
  baseLabels: Record<string, string> | undefined,
): string {
  const base = baseLabels?.[decl.key];
  if (base !== undefined) return base;
  return decl.defaults?.[screen] ?? decl.default;
}

/**
 * Записать значение одной надписи. Ключ УДАЛЯЕТСЯ, когда автор вернул строку в исходное
 * состояние (тумблер включён, поле пусто): «не трогал» — это отсутствие ключа, и хранить
 * вместо него пустую запись значило бы заморозить текст шаблона на сегодняшнем виде.
 */
function withLabel(labels: LabelValues, key: string, next: LabelValue | null): LabelValues {
  const out: LabelValues = { ...labels };
  if (next === null) delete out[key];
  else out[key] = next;
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResultsLabelsPane({
  declarations,
  labels,
  onChange,
  screen = "results",
  baseLabels,
  order,
  templateOrder,
  onOrderChange,
  readOnly = false,
}: ResultsLabelsPaneProps) {
  const groups = useMemo(() => groupDeclarations(declarations), [declarations]);

  if (declarations.length === 0) {
    return (
      <div data-testid="results-labels-pane">
        <Banner
          tone="info"
          title="Шаблон не поддерживает настройку заголовков"
          description="Выбранный шаблон печатает свои собственные заголовки блоков итогов и не объявляет надписей, которые можно переформулировать или выключить."
          data-testid="results-labels-empty"
        />
      </div>
    );
  }

  const setRow = (key: string, next: LabelValue | null) => onChange(withLabel(labels, key, next));

  return (
    <div data-testid="results-labels-pane">
      {groups.map(({ group, items }) => (
        // Заголовок группы НАД строками: подраздел живёт в панели-ящике (и в карточке
        // отчёта), где колонка заголовков в 280px отнимает у полей формулировки половину
        // ширины, а соседние подразделы оформления рисуют поля во всю ширину.
        <FormSection key={group} title={group} stacked>
          {items.map((decl) => (
            <LabelRow
              key={decl.key}
              decl={decl}
              value={labels[decl.key]}
              placeholder={fallbackText(decl, screen, baseLabels)}
              readOnly={readOnly}
              onChange={(next) => setRow(decl.key, next)}
            />
          ))}
        </FormSection>
      ))}
      {onOrderChange && (
        <BlockOrderList
          order={order}
          templateOrder={templateOrder}
          labels={labels}
          declarations={declarations}
          readOnly={readOnly}
          onChange={onOrderChange}
        />
      )}
    </div>
  );
}

/**
 * Строка надписи: тумблер показа и поле формулировки. Поле выключенной надписи
 * заблокировано — печатать нечего, и активное поле обещало бы обратное.
 */
function LabelRow({
  decl,
  value,
  placeholder,
  readOnly,
  onChange,
}: {
  decl: LabelDeclaration;
  value: LabelValue | undefined;
  placeholder: string;
  readOnly: boolean;
  onChange: (next: LabelValue | null) => void;
}) {
  const on = value?.on !== false;
  const text = value?.text ?? "";
  return (
    <FormField
      label={decl.label}
      // Подсказка поля — текст, который напечатается без вмешательства автора. Пустой
      // означает, что надписи на этом экране нет вовсе.
      hint={placeholder ? undefined : "Эта надпись не печатается на экране итогов."}
      data-testid={`results-label-row-${decl.key}`}
    >
      <Stack gap={2}>
        <Switch
          label="Показывать"
          aria-label={`Показывать надпись «${decl.label}»`}
          checked={on}
          disabled={readOnly}
          onChange={(e) => {
            if (!e.target.checked) {
              // Формулировка автора сохраняется: он вернёт надпись, ничего не набирая
              // заново.
              onChange(text.trim() ? { on: false, text } : { on: false });
              return;
            }
            onChange(text.trim() ? { on: true, text } : null);
          }}
          data-testid={`results-label-switch-${decl.key}`}
        />
        <Input
          size="m"
          fullWidth
          aria-label={decl.label}
          placeholder={placeholder}
          value={text}
          disabled={readOnly || !on}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next.trim() ? { on: true, text: next } : null);
          }}
          data-testid={`results-label-input-${decl.key}`}
        />
      </Stack>
    </FormField>
  );
}

/**
 * Порядок подблоков итогов. Кнопки «выше»/«ниже», а не перетаскивание: элементов четыре,
 * список правится раз в жизни теста, и клавиатура здесь работает без отдельного режима.
 *
 * Состав списка — дело ШАБЛОНА (`manifest.resultsBlockOrder`), поэтому сохранённый порядок
 * прогоняется через `resolveBlockOrder`: ключ, которого шаблон не знает, исчезает, а
 * подблок, о котором автор ещё не слышал, дописывается в конец.
 */
function BlockOrderList({
  order,
  templateOrder,
  labels,
  declarations,
  readOnly,
  onChange,
}: {
  order: readonly ResultsBlockKey[] | undefined;
  templateOrder: readonly ResultsBlockKey[] | undefined;
  labels: LabelValues;
  declarations: readonly LabelDeclaration[];
  readOnly: boolean;
  onChange: (next: ResultsBlockKey[]) => void;
}) {
  const declByKey = useMemo(
    () => new Map(declarations.map((d) => [d.key, d] as const)),
    [declarations],
  );
  const resolved = useMemo(
    () => resolveBlockOrder(order, templateOrder ?? DEFAULT_BLOCK_ORDER),
    [order, templateOrder],
  );

  /** Как подблок называется для автора: его формулировка, иначе текст шаблона. */
  const nameOf = (key: ResultsBlockKey): string => {
    const labelKey = BLOCK_LABEL_KEY[key];
    const own = labels[labelKey]?.text?.trim();
    if (own) return own;
    return declByKey.get(labelKey)?.default || BLOCK_FALLBACK_NAMES[key];
  };

  const move = (index: number, delta: number) => {
    const next = [...resolved];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <FormSection
      stacked
      title="Порядок подблоков"
      subtitle="Блоки печатаются под общим заголовком итогов в этом порядке. Выключенный заголовок блок не убирает — за видимость отвечают настройки самих блоков."
    >
      <Stack gap={2} data-testid="results-block-order">
        {resolved.map((key, index) => (
          <Stack
            key={key}
            direction="row"
            gap={2}
            align="center"
            justify="between"
            data-testid={`results-block-order-${key}`}
          >
            <Text>{nameOf(key)}</Text>
            <Cluster gap={1}>
              <IconButton
                icon={<ArrowUp width={14} height={14} aria-hidden="true" />}
                aria-label={`Переместить «${nameOf(key)}» выше`}
                variant="ghost"
                size="s"
                disabled={readOnly || index === 0}
                onClick={() => move(index, -1)}
                data-testid={`results-block-up-${key}`}
              />
              <IconButton
                icon={<ArrowDown width={14} height={14} aria-hidden="true" />}
                aria-label={`Переместить «${nameOf(key)}» ниже`}
                variant="ghost"
                size="s"
                disabled={readOnly || index === resolved.length - 1}
                onClick={() => move(index, 1)}
                data-testid={`results-block-down-${key}`}
              />
            </Cluster>
          </Stack>
        ))}
      </Stack>
    </FormSection>
  );
}
