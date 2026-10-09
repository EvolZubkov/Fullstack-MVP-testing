/**
 * @module features/tests/editor/sections/levels-editor
 * @description PRD-45. The numeric interpretation editor: a coverage ribbon over a
 * list of level cards separated by single threshold fields. Replaces the six-column
 * `tb-bands-table`, whose header — the only carrier of field labels — scrolled away,
 * whose columns clipped their content, and whose min/max pairs allowed silent gaps.
 *
 * Stateless by design: the draft is derived from `bands` on every render and folded
 * back on every edit (see `levels-model`). Shared with the «Показатели» tab's
 * numeric indicator, exactly as its predecessor was — one notion, one editor.
 */

import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Input,
  Textarea,
} from "@skillum/ui-kit";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";

import { deriveLevelTone } from "@shared/template/measure-view";
import type { LevelTone, Valence } from "@shared/scales/interpretation";

import { pluralize } from "@/lib/i18n";

import { hasFeedbackContent } from "../scales-api";
import type { ScaleBandModel } from "../test-editor.types";
import { FeedbackEditorModal } from "./feedback-editor-modal";
import { emptyFeedbackValue } from "./outcomes-editor";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import { ToneChips, toneColour, toneRibbon } from "./tone-chips";
import {
  addLevel,
  bandsToDraft,
  coverageSegments,
  draftErrors,
  draftToBands,
  hasStoredGap,
  levelBounds,
  levelDisplayName,
  removeLevel,
  type LevelDraft,
  type LevelsDraft,
} from "./levels-model";

export type LevelsEditorProps = {
  bands: ScaleBandModel[];
  /** Index of the owning card — only used to build stable test ids. */
  index: number;
  readOnly: boolean;
  onChange: (bands: ScaleBandModel[]) => void;
  /** Distinguishes the scale card's editor from the indicator card's one. */
  testIdPrefix?: string;
  /**
   * Подпись ленты покрытия. Редактор общий у шкал и показателей, и «Покрытие шкалы»
   * у показателя было бы неправдой: шкалы там нет.
   */
  coverLabel?: string;
  /** Effective scale domain for the ribbon; null when nothing declares one. */
  domain?: { min: number; max: number } | null;
  /**
   * The owning scale's / indicator's favourable direction. Needed because a level
   * whose tone is «Авто» has no colour of its own — it inherits one from the ramp,
   * and the ramp runs the way the valence points.
   */
  valence: Valence;
};

/**
 * Как уровень назван ОБУЧАЮЩЕМУСЯ: подпись полосы покрытия и её подсказка. Подсказка
 * существует ради обрезанной подписи, поэтому обе берут одно и то же. Правило общее с
 * разделом текстов уровней («Обратная связь»), поэтому живёт в модели.
 */
const levelTitle = levelDisplayName;

/**
 * Как уровень назван в МАШИНЕ: код, которым он назван в формулах показателей. Им
 * подписаны заголовок карточки, кнопка удаления и порог — там уровень надо опознать,
 * а не прочитать вслух.
 */
function levelCode(level: LevelDraft, i: number): string {
  return level.level.trim() || level.label.trim() || `Уровень ${i + 1}`;
}

/**
 * The computed «from … to» caption in a card header — text, never a field.
 *
 * Первый уровень занимает отрезок целиком: «Начало … первый порог». Каждый следующий
 * начинается ВЫШЕ своего порога, потому что порог достаётся соседу снизу, — ровно это
 * говорит подпись между карточками («N и ниже — предыдущий, выше — этот»). Печатать
 * «1 … 2» у уровня, который начинается выше 1, значит спорить с ней: у показателя с
 * пятнадцатью уровнями по одному целому автор задал 1…1, 2…2, 3…3, а карточки читались
 * как 1…1, 1…2, 2…3.
 *
 * В ХРАНИЛИЩЕ нижняя граница по-прежнему равна порогу, и это не потеря: сомкнутые
 * границы (`bands[i].max === bands[i + 1].min`) — каноническая форма редактора, её знает
 * проверка (`band_overlap` ругается только на настоящий заход друг на друга), а поиск
 * полосы везде берёт ПЕРВУЮ подходящую, поэтому значение порога достаётся нижнему
 * уровню. Меняется только то, как диапазон прочитан вслух.
 */
function rangeOf(draft: LevelsDraft, i: number): string {
  const { from, to } = levelBounds(draft, i);
  const lo = from || "?";
  const hi = to || "?";
  return i === 0 ? `${lo} … ${hi}` : `выше ${lo} … ${hi}`;
}

/**
 * What the recommendations fold reports without being opened: the author needs to
 * know whether there is a text, attachments, or both, not merely «заданы». Courses,
 * files and events all count as one kind of «материал» — the fold is a summary, and
 * splitting three counters across a badge would say less, not more.
 */
function feedbackBadge(value: LevelDraft["feedback"]): string {
  if (!hasFeedbackContent(value)) return "не заданы";
  const hasText = (value?.text ?? "").trim() !== "";
  const items = (value?.links.length ?? 0) + (value?.assets.length ?? 0) + (value?.events?.length ?? 0);
  const materials = items > 0 ? `${items} ${pluralize(items, "материал", "материала", "материалов")}` : "";
  return [hasText ? "текст" : "", materials].filter(Boolean).join(", ");
}

/**
 * Наименьшая ширина полосы, при которой подпись ещё что-то сообщает. Подпись набрана
 * `--ou-text-body-xs` и отбита `--ou-space-1` с боков: до этого предела в неё влезает
 * от силы три буквы с многоточием, то есть ничего.
 */
const MIN_SEG_LABEL_PX = 56;

export function LevelsEditor({
  bands,
  index,
  readOnly,
  onChange,
  testIdPrefix = "scales",
  coverLabel = "Покрытие шкалы",
  domain = null,
  valence,
}: LevelsEditorProps) {
  // Which level's recommendations modal is open (level index, not the level).
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);

  /**
   * Измеренная ширина ленты. Нужна одному: решить, влезает ли в полосу подпись.
   * У показателя бывает полтора десятка уровней, и тогда на полосу приходится
   * ~30px — от названия остаётся огрызок «Св…», «Дв…», и лента из носителя
   * пропорций превращается в частокол многоточий. Ноль означает «ещё не мерили»
   * (первый кадр, jsdom без ResizeObserver) — в этом случае подписи показываются:
   * скрывать их вслепую хуже, чем показать и убрать после замера.
   */
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const [ribbonWidth, setRibbonWidth] = useState(0);
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setRibbonWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draft = bandsToDraft(bands);
  const errors = draftErrors(draft);
  const segments = coverageSegments(draft, domain);
  const total = draft.levels.length;

  /**
   * Свёртка карточек уровня. Эскиз рисует их всегда раскрытыми — и на трёх уровнях
   * демо-шкалы это незаметно; у показателя их пятнадцать, и панель превращается в
   * бесконечную ленту, по которой нельзя ни окинуть взглядом разбор, ни добраться до
   * нижнего уровня. Механика взята готовой: тот же `useSectionFold`, что у «Вкладов
   * вопросов» и «Адаптивности по темам», и та же пара кнопок — своей копии не заводим.
   * Уровни ключуются `clientKey`, а не индексом: индекс сдвигается при удалении, и
   * свёрнутым оказался бы сосед.
   */
  const fold = useSectionFold(draft.levels.map((l) => l.clientKey));

  /**
   * Доля полосы — та же величина, которой полоса растягивается (`flexGrow` ниже),
   * поэтому расчётная ширина совпадает с нарисованной. Подпись показывается, только
   * если полоса дотягивает до `MIN_SEG_LABEL_PX`: полное название всё равно остаётся
   * в `title`, а под лентой стоят карточки уровней, где оно написано целиком.
   */
  const spanOf = (s: { from: number; to: number }) => Math.max(s.to - s.from, 0.001);
  const totalSpan = (segments ?? []).reduce((sum, s) => sum + spanOf(s), 0);
  const fitsLabel = (s: { from: number; to: number }) =>
    ribbonWidth === 0 || totalSpan === 0 || (spanOf(s) / totalSpan) * ribbonWidth >= MIN_SEG_LABEL_PX;

  /**
   * The colour a level is actually drawn in — its explicit tone, else the one the
   * results screen would derive for it. The ribbon is a preview of the split the
   * LEARNER sees, so painting an untouched level grey would preview a screen that
   * does not exist: `deriveLevelTone` is the very function that colours the result.
   */
  const effectiveTone = (level: LevelDraft, i: number): LevelTone | "" =>
    level.tone || deriveLevelTone(valence, i, total);

  const emit = (next: LevelsDraft) => onChange(draftToBands(next));
  const setBound = (patch: Partial<Pick<LevelsDraft, "start" | "end">>) => emit({ ...draft, ...patch });
  const setCut = (i: number, raw: string) =>
    emit({ ...draft, cuts: draft.cuts.map((c, j) => (j === i ? raw : c)) });
  const setLevel = (i: number, patch: Partial<LevelsDraft["levels"][number]>) =>
    emit({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const open = feedbackFor !== null ? draft.levels[feedbackFor] : undefined;

  if (total === 0) {
    return (
      <div className="tb-levels" data-testid={`${testIdPrefix}-levels-${index}`}>
        <div className="tb-levels__empty" data-testid={`${testIdPrefix}-levels-empty-${index}`}>
          Уровни не заданы — обучающийся увидит только числовой балл
          {!readOnly && (
            <div className="tb-levels__empty-act">
              <Button
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => emit(addLevel(draft, domain))}
                data-testid={`${testIdPrefix}-level-add-${index}`}
              >
                Добавить уровень
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tb-levels" data-testid={`${testIdPrefix}-levels-${index}`}>
      <div className="tb-levels__cover">
        <span className="tb-levels__caplbl">Начало</span>
        <span className="tb-levels__caplbl">{coverLabel}</span>
        <span className="tb-levels__caplbl tb-levels__caplbl--end">Конец</span>

        <Input
          size="s"
          fullWidth
          // «Покрытия», а не «шкалы»: редактор общий у шкал и показателей, у показателя
          // шкалы нет (см. `coverLabel`). Подпись ленты рядом называется так же.
          aria-label="Начало покрытия"
          value={draft.start}
          disabled={readOnly}
          error={errors.start ?? undefined}
          onChange={(e) => setBound({ start: e.target.value })}
          data-testid={`${testIdPrefix}-levels-start-${index}`}
        />
        <div className="tb-levels__ribbon" ref={ribbonRef}>
          {segments === null ? (
            // Two different faults hide behind one `null`, and the author fixes
            // them differently. `errors.kind` names the one that actually fired
            // (see `LevelsErrors.kind`); «не полностью» over four filled fields
            // sent the author hunting for an empty one that does not exist.
            <div className="tb-levels__seg tb-levels__seg--unknown" data-testid={`${testIdPrefix}-levels-noribbon-${index}`}>
              <span className="tb-levels__seglbl">
                {errors.kind === "order" ? "Порядок границ нарушен" : "Границы заданы не полностью"}
              </span>
            </div>
          ) : (
            segments.map((s, i) =>
              s.kind === "gap" ? (
                <div
                  key={`gap-${i}`}
                  className="tb-levels__seg tb-levels__seg--gap"
                  style={{ flexGrow: spanOf(s) }}
                  title="не разобрано"
                >
                  {fitsLabel(s) && <span className="tb-levels__seglbl">не разобрано</span>}
                </div>
              ) : (
                <div
                  key={`seg-${s.index}`}
                  className="tb-levels__seg"
                  style={{
                    flexGrow: spanOf(s),
                    background: toneRibbon(effectiveTone(draft.levels[s.index], s.index)).bg,
                    color: toneRibbon(effectiveTone(draft.levels[s.index], s.index)).fg,
                  }}
                  // A narrow stripe now ellipses its caption (see `tb-levels__seglbl`),
                  // so the full name has to stay reachable — hovering is the only
                  // affordance a stripe has.
                  title={levelTitle(draft.levels[s.index], s.index)}
                  data-testid={`${testIdPrefix}-level-seg-${index}-${s.index}`}
                >
                  {fitsLabel(s) && (
                    <span className="tb-levels__seglbl">{levelTitle(draft.levels[s.index], s.index)}</span>
                  )}
                </div>
              ),
            )
          )}
        </div>
        <Input
          size="s"
          fullWidth
          aria-label="Конец покрытия"
          value={draft.end}
          disabled={readOnly}
          error={errors.end ?? undefined}
          onChange={(e) => setBound({ end: e.target.value })}
          data-testid={`${testIdPrefix}-levels-end-${index}`}
        />

        {/* The ribbon's own caption. It replaces the numbers that used to be
            repeated under both ends — a scale reads as covered or not, and that
            verdict is what the author is looking for, not the digits again. */}
        {segments !== null && (
          <div className="tb-levels__coverstat">
            {/* Без слова «шкала»: у показателя её нет, а редактор здесь общий. Обе
                формулировки одинаково верны и для шкалы, и для показателя. */}
            {segments.some((s) => s.kind === "gap") && domain !== null
              ? `Границы ${domain.min} … ${domain.max}, уровнями закрыто ${draft.start} … ${draft.end}`
              : `Разобрано целиком, ${total} ${pluralize(total, "уровень", "уровня", "уровней")}`}
          </div>
        )}
      </div>

      {/* Пара «Развернуть все / Свернуть все» — та же, что у остальных списков ящика.
          Стоит над карточками, потому что относится к ним, а не к ленте покрытия. */}
      {total > 1 && (
        <div className="tb-fold-toolbar">
          <FoldAllButtons fold={fold} testIdPrefix={`${testIdPrefix}-levels-${index}`} />
        </div>
      )}

      {draft.levels.map((l, i) => (
        <div key={l.clientKey}>
          {i > 0 && (
            <div className="tb-levels__cut">
              <div className="tb-levels__cutfield">
                <Input
                  size="s"
                  fullWidth
                  aria-label={`Порог между уровнями «${levelCode(draft.levels[i - 1], i - 1)}» и «${levelCode(l, i)}»`}
                  value={draft.cuts[i - 1]}
                  disabled={readOnly}
                  error={errors.cuts[i - 1] ?? undefined}
                  onChange={(e) => setCut(i - 1, e.target.value)}
                  data-testid={`${testIdPrefix}-level-cut-${index}-${i - 1}`}
                />
              </div>
              <div className="tb-levels__cutrule">
                <span className="tb-levels__cutline" />
                {/* Уровни названы КОДАМИ, как в заголовках карточек сверху и снизу и как
                    в `aria-label` поля порога. Именем для обучающегося подпись быть не
                    может: имя не обязано быть уникальным и сплошь и рядом не уникально —
                    у показателя-битовой маски четыре уровня зовутся «Сфокусированный»,
                    шесть — «Двойственный», и подпись выходила «порог: 1 и ниже —
                    «Сфокусированный», выше — «Сфокусированный»», то есть не опознавала
                    ни один из двух. В эскизе имена демо-уровней уникальны, и этот случай
                    там не встречается. */}
                <span className="tb-levels__cutlbl">
                  {`порог: ${draft.cuts[i - 1] || "?"} и ниже — «${levelCode(draft.levels[i - 1], i - 1)}», выше — «${levelCode(l, i)}»`}
                </span>
                <span className="tb-levels__cutline" />
              </div>
            </div>
          )}

          <section className="tb-levels__card" style={{ borderLeftColor: toneColour(effectiveTone(l, i)) }}>
            {/* No drag handle: reordering level content is deferred to technical
                debt (decision of 2026-08-07), and a grip that grabs nothing is a
                promise the card cannot keep. `moveLevel` in `levels-model` stays
                ready for the day the debt is picked up. */}
            <header className="tb-levels__head">
              <span className="tb-levels__title">{levelCode(l, i)}</span>
              <span className="tb-levels__spacer" />
              <span className="tb-levels__range" data-testid={`${testIdPrefix}-level-range-${index}-${i}`}>
                {rangeOf(draft, i)}
              </span>
              {!readOnly && (
                <IconButton
                  icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                  aria-label={`Удалить уровень «${levelCode(l, i)}»`}
                  variant="ghost"
                  size="s"
                  onClick={() => emit(removeLevel(draft, i))}
                />
              )}
              {/* Шеврон той же формы, какой эскиз рисует все свёртки ящика — квоты,
                  адаптивные уровни, шкалы, вопросы, показатели: `IconButton` с классом
                  `tb-level-card__chev`, а не голая кнопка. */}
              <IconButton
                className="tb-level-card__chev"
                icon={<ChevronDown width={14} height={14} aria-hidden="true" />}
                variant="ghost"
                size="s"
                aria-expanded={fold.isOpen(l.clientKey)}
                aria-label={
                  fold.isOpen(l.clientKey)
                    ? `Свернуть уровень «${levelCode(l, i)}»`
                    : `Развернуть уровень «${levelCode(l, i)}»`
                }
                onClick={() => fold.toggle(l.clientKey)}
                data-testid={`${testIdPrefix}-level-toggle-${index}-${i}`}
              />
            </header>

            {fold.isOpen(l.clientKey) && (
              <>
            {/* Поля карточки — размера m, как в эскизе: это основной ввод уровня, а не
                служебная мелочь вроде порога между карточками. Что такое «Код уровня»,
                сказано подписью всего блока уровней — здесь подсказка повторяла бы её
                под каждой карточкой. */}
            <div className="tb-levels__grid">
              <Input
                size="m"
                fullWidth
                label="Название для обучающегося"
                aria-label={`Название уровня ${i + 1}`}
                value={l.label}
                disabled={readOnly}
                onChange={(e) => setLevel(i, { label: e.target.value })}
              />
              <Input
                size="m"
                fullWidth
                label="Код уровня"
                aria-label={`Код уровня ${i + 1}`}
                value={l.level}
                disabled={readOnly}
                error={errors.levels[i] ?? undefined}
                onChange={(e) => setLevel(i, { level: e.target.value })}
              />
            </div>

            <div className="tb-levels__tone">
              <span className="tb-levels__tonelbl">Как трактовать</span>
              <ToneChips
                value={l.tone}
                disabled={readOnly}
                ariaLabel="Трактовка уровня"
                onChange={(tone) => setLevel(i, { tone })}
                testId={`${testIdPrefix}-level-tone-${index}-${i}`}
              />
              {/* `ToneChips` shortens «По направлению шкалы» to «Авто» so the row
                  cannot wrap; its full meaning is spelled out here (PRD-45 FR-06). */}
            </div>

            {/* A level that already has an interpretation opens with it visible: a
                card showing only the «задано» badge hides the very text the author
                came to check. Uncontrolled — the author's own toggling wins after. */}
            <Collapsible defaultOpen={l.text.trim() !== ""}>
              <CollapsibleTrigger className="tb-levels__fold">
                <ChevronRight className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                Толкование для обучающегося
                <span className="tb-levels__spacer" />
                <span className="tb-levels__badge">{l.text.trim() === "" ? "не задано" : "задано"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Textarea
                  size="s"
                  fullWidth
                  rows={3}
                  value={l.text}
                  disabled={readOnly}
                  placeholder="Что означает этот уровень — текст для обучающегося"
                  aria-label={`Толкование уровня ${i + 1}`}
                  onChange={(e) => setLevel(i, { text: e.target.value })}
                />
              </CollapsibleContent>
            </Collapsible>

            {/* Keeps the fold row's geometry so the two rows line up, but NOT its
                promise: recommendations open in a modal, so the leading icon is the
                pencil every other modal editor in the editor uses (see
                `feedback-preview`, `scoring-section`), not a chevron that would
                announce an expansion that never happens. The chevron rotation is
                keyed to `[data-state]`, which only a Collapsible trigger carries,
                so nothing here can spin.

                Stays visible while reading, like the interpretation fold above it:
                whether recommendations exist is part of what the author came to
                see, so the row is disabled rather than removed. */}
            <button
              type="button"
              className="tb-levels__fold"
              disabled={readOnly}
              onClick={() => setFeedbackFor(i)}
            >
              <Pencil className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
              Рекомендации
              <span className="tb-levels__spacer" />
              <span className="tb-levels__badge">{feedbackBadge(l.feedback)}</span>
            </button>
              </>
            )}
          </section>
        </div>
      ))}

      {!readOnly && (
        <div className="tb-levels__add">
          <Button
            variant="ghost"
            size="m"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            onClick={() => emit(addLevel(draft, domain))}
            data-testid={`${testIdPrefix}-level-add-${index}`}
          >
            Добавить уровень
          </Button>
        </div>
      )}

      {errors.blocking && (
        <Banner
          tone="error"
          size="sm"
          description={errors.blocking}
          data-testid={`${testIdPrefix}-levels-error-${index}`}
        />
      )}
      {!errors.blocking && segments !== null && segments.some((s) => s.kind === "gap") && (
        <Banner
          tone="warning"
          size="sm"
          // Вместо «до границ шкалы» — сами числа: у показателя шкалы нет, а числа
          // одинаково понятны в обоих случаях и прямо говорят, куда тянуть.
          description={
            `Баллы вне ${draft.start} … ${draft.end} останутся без уровня. Растяните крайние поля` +
            (domain !== null ? ` до ${domain.min} … ${domain.max}` : " до крайних значений") +
            " или сузьте границы."
          }
          data-testid={`${testIdPrefix}-levels-uncovered-${index}`}
        />
      )}
      {hasStoredGap(bands) && (
        <Banner
          tone="info"
          size="sm"
          description={
            "Границы уровней сомкнуты в редакторе — баллы, прежде не попадавшие ни в один " +
            "уровень, показаны в нижнем из соседних. Чтобы смыкание сохранилось, измените " +
            "любое поле уровней перед сохранением теста."
          }
          data-testid={`${testIdPrefix}-levels-closed-gap-${index}`}
        />
      )}
      {/* Постоянного пояснительного баннера здесь нет: у шкалы про код уровня сказано
          подписью блока («Уровни шкалы»), где заодно назван и адрес публикации, —
          баннер повторял бы её и оттеснял вниз те два, что говорят о РЕАЛЬНОЙ беде:
          разрыве покрытия и сомкнутых границах. */}

      {open && feedbackFor !== null && (
        <FeedbackEditorModal
          open
          title={`Рекомендации для уровня «${levelTitle(open, feedbackFor)}»`}
          description="Текст и подборка материалов, которые увидит обучающийся с этим уровнем"
          value={open.feedback ?? emptyFeedbackValue()}
          hideAssets={false}
          onCancel={() => setFeedbackFor(null)}
          onSave={(value) => {
            setLevel(feedbackFor, { feedback: value });
            setFeedbackFor(null);
          }}
          testId={`${testIdPrefix}-level-feedback-${index}`}
        />
      )}
    </div>
  );
}
