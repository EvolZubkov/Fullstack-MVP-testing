/**
 * @module features/tests/editor/sections/band-feedback-section
 * @description «По уровням шкал» и «По уровням показателей» — подразделы вкладки
 * «Обратная связь и итоги» (эскиз `editor-settings-target.html`, состояние `s-texts`).
 *
 * Своего хранения у раздела нет: он правит те же `bands[].feedback`, что и строка
 * «Рекомендации» в конструкторе уровней («Оценка результата» → «Шкалы» / «Показатели»).
 * Разница в способе работы, а не в данных. В конструкторе автор задаёт СТРУКТУРУ — границы,
 * коды, трактовку, — и текст там пишется по одному, между порогами. Здесь тексты собраны в
 * одну колонку рядом с текстами тем: автор пишет их подряд, видя все сразу.
 *
 * Показатели берутся только ЧИСЛОВЫЕ: уровни есть у них одних. Строковый и логический
 * толкуются перечнем исходов (`outcomes`), а исход — не уровень, и звать его так в списке
 * уровней значило бы обещать шкалу там, где её нет.
 */
import { useState } from "react";
import type * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, FormSection, Tag } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import type { ScaleBandModel, TestEditorModel } from "../test-editor.types";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackPreview } from "./feedback-preview";
import { levelDisplayName } from "./levels-model";
import { emptyFeedbackValue } from "./outcomes-editor";
import { FoldAllButtons, useSectionFold } from "./section-fold";

export type BandFeedbackSectionProps = {
  /** Что перечисляем: шкалы теста или его числовые показатели. */
  kind: "scales" | "metrics";
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Одна свёртка списка: шкала или показатель со своими уровнями. */
type BandGroup = {
  /** Индекс в ИСХОДНОМ массиве модели — по нему уходит правка. */
  index: number;
  id: string;
  title: string;
  bands: ScaleBandModel[];
};

const TEXTS = {
  scales: {
    title: "По уровням шкал",
    testId: "scale-levels",
    modalDescription: "Текст и материалы, которые увидит обучающийся с этим уровнем шкалы.",
  },
  metrics: {
    title: "По уровням показателей",
    testId: "metric-levels",
    modalDescription: "Текст и материалы, которые увидит обучающийся с этим уровнем показателя.",
  },
} as const;

/** Шкалы и числовые показатели теста как список свёрток. */
export function bandGroups(model: TestEditorModel, kind: BandFeedbackSectionProps["kind"]): BandGroup[] {
  if (kind === "scales") {
    return model.scales.map((s, index) => ({
      index,
      id: s.clientKey ?? s.key ?? `scale-${index}`,
      title: `${s.key ? s.key.toUpperCase() : "новая шкала"}${s.label ? ` — ${s.label}` : ""}`,
      bands: s.bands,
    }));
  }
  return model.resultVariables
    .map((v, index) => ({ v, index }))
    .filter(({ v }) => v.type === "number")
    .map(({ v, index }) => ({
      index,
      id: v.clientKey ?? v.name ?? `metric-${index}`,
      title: `${v.name}${v.label ? ` — ${v.label}` : ""}`,
      bands: v.bands,
    }));
}

/**
 * Есть ли о чём говорить в разделе: хоть у одного объекта задан хоть один уровень.
 * Пункт рейла без этого не показывается вовсе — раздел из одних тегов «уровни не заданы»
 * сообщал бы о настройке, которой автор ещё не делал.
 *
 * @public
 */
export function hasAnyBands(model: TestEditorModel, kind: BandFeedbackSectionProps["kind"]): boolean {
  return bandGroups(model, kind).some((g) => g.bands.length > 0);
}

export function BandFeedbackSection({
  kind,
  model,
  updateModel,
}: BandFeedbackSectionProps): React.JSX.Element {
  const texts = TEXTS[kind];
  const groups = bandGroups(model, kind);
  const fold = useSectionFold(groups.map((g) => g.id));
  // Какой уровень правится: свёртка и номер уровня в ней. Модалка одна на раздел —
  // открытых одновременно не бывает, и держать по состоянию на строку незачем.
  const [editing, setEditing] = useState<{ group: number; band: number } | null>(null);

  const patchBand = (groupIndex: number, bandIndex: number, feedback: FeedbackEditorValue) =>
    updateModel((m) => {
      const patchBands = (bands: ScaleBandModel[]) =>
        bands.map((b, j) => (j === bandIndex ? { ...b, feedback } : b));
      if (kind === "scales") {
        return {
          ...m,
          scales: m.scales.map((s, i) => (i === groupIndex ? { ...s, bands: patchBands(s.bands) } : s)),
        };
      }
      return {
        ...m,
        resultVariables: m.resultVariables.map((v, i) =>
          i === groupIndex ? { ...v, bands: patchBands(v.bands) } : v,
        ),
      };
    });

  const openGroup = editing ? groups.find((g) => g.index === editing.group) : undefined;
  const openBand = openGroup?.bands[editing?.band ?? -1];

  return (
    <FormSection
      stacked
      title={texts.title}
      // Действия списка — в строке заголовка, справа: один приём во всех разделах ящика.
      headClassName="tb-section-head"
      meta={groups.length > 0 ? <FoldAllButtons fold={fold} testIdPrefix={texts.testId} /> : undefined}
      data-testid={`${texts.testId}-section`}
    >

      {groups.map((group) => {
        const open = fold.isOpen(group.id) && group.bands.length > 0;
        return (
          <div className="tb-fold-sec" key={group.id} data-testid={`${texts.testId}-sec-${group.id}`}>
            <Collapsible open={open} onOpenChange={() => fold.toggle(group.id)}>
              <div className="tb-fold-sec-head">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="tb-fold-trigger"
                    disabled={group.bands.length === 0}
                    aria-label={open ? `Свернуть ${group.title}` : `Развернуть ${group.title}`}
                    data-testid={`${texts.testId}-toggle-${group.id}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-fold-sec-name">{group.title}</span>
                  </button>
                </CollapsibleTrigger>
                {/* Тег говорит, есть ли о чём писать. «Уровни не заданы» — не ошибка:
                    уровни задают в «Оценке результата», и раздел текстов о них только
                    сообщает, а не требует. */}
                <Tag tone="neutral" variant="outline">
                  {group.bands.length === 0
                    ? "уровни не заданы"
                    : `${group.bands.length} ${pluralize(group.bands.length, "уровень", "уровня", "уровней")}`}
                </Tag>
              </div>
              <CollapsibleContent>
                <div className="tb-fold-sec__body">
                  {group.bands.map((band, bandIndex) => {
                    const name = levelDisplayName(band, bandIndex);
                    const value = band.feedback;
                    return (
                      <div className="ou-formfield" key={band.clientKey ?? `${group.id}-${bandIndex}`}>
                        <label className="ou-formfield__lbl">{`Уровень «${name}»`}</label>
                        <FeedbackPreview
                          format={value?.format ?? "plain"}
                          text={value?.text ?? ""}
                          links={value?.links ?? []}
                          assets={value?.assets ?? []}
                          events={value?.events ?? []}
                          onEdit={() => setEditing({ group: group.index, band: bandIndex })}
                          editAriaLabel={`Редактировать рекомендации уровня «${name}»`}
                          testId={`${texts.testId}-${group.id}-${bandIndex}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}

      {openGroup && openBand && editing && (
        <FeedbackEditorModal
          open
          title={`Рекомендации для уровня «${levelDisplayName(openBand, editing.band)}»`}
          description={texts.modalDescription}
          value={openBand.feedback ?? emptyFeedbackValue()}
          hideAssets={false}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            patchBand(editing.group, editing.band, next);
            setEditing(null);
          }}
          testId={`${texts.testId}-modal`}
        />
      )}
    </FormSection>
  );
}
