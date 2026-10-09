/**
 * @module features/tests/editor/sections/profile-feedback-card
 * @description PRD-53 §5.4 (FR-29 — FR-31): карточка «По профилям» вкладки «Обратная связь
 * и итоги» — рекомендации на каждый исход показателя-профиля.
 *
 * У исхода ДВА текста, и они живут порознь не ради деления. Толкование («что этот профиль
 * означает») — часть определения исхода и правится там же, где код набора и метка, в
 * карточке показателя. Рекомендации («что участнику с этим делать») — обратная связь, и
 * место у них общее со всей остальной обратной связью теста: тексты теста, тем, подтем и
 * уровней уже собраны на одном экране, и автор, севший писать тексты, не должен ходить за
 * ними по вкладкам.
 *
 * Устройство повторяет `BreakdownFeedbackCard` (PRD-50) намеренно: это тот же жанр — список
 * сущностей, у каждой предпросмотр обратной связи с карандашом, — и вторая его редакция
 * разошлась бы с первой на первой же правке.
 */
import { useState } from "react";
import type * as React from "react";
import { Banner, FormSection } from "@skillum/ui-kit";
import { resolveScaleGroup } from "@shared/formula/outcome-literals";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackPreview } from "./feedback-preview";
import { FoldAllButtons, FoldSection, useSectionFold } from "./section-fold";
import type { OutcomeModel, ResultVariableModel, TestEditorModel } from "../test-editor.types";

export type ProfileFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Пустая рекомендация: так выглядит исход, о котором автор ещё не писал. */
const EMPTY: FeedbackEditorValue = { format: "plain", text: "", links: [], assets: [], events: [] };

const CARD_TITLE = "По профилям";
// Подзаголовок из согласованного эскиза `prd53-profile-indicator.html`: он отвечает на тот
// же вопрос, что и у соседей по рейлу, — КОГДА текст выдаётся, а не что это за поле.
const CARD_SUBTITLE =
  "Текст выдаётся, когда профиль участника совпал с этим набором ведущих шкал. Набор определяет показатель профиля.";

/**
 * Показатели, НЕСУЩИЕ профиль, — свой или взятый по `var()` у соседа.
 *
 * Считающий и пишущий тексты — разные показатели, и это не редкость, а рабочая
 * расстановка: у переведённого ЧИЛ набор считает `profile_summary`, а все пятнадцать
 * рекомендаций лежат у `lead_style`, который читает готовый код. Отбирай перечень по
 * тому, кто СЧИТАЕТ, — и карточка показала бы показатель без единой рекомендации, спрятав
 * тот, где они все (проверено на данных 2026-09-07). Поэтому отбор идёт по значению, как и
 * у блока «вне профиля» (находка F6).
 */
export function profileVariables(model: TestEditorModel): ResultVariableModel[] {
  const formulaOf = (name: string) => model.resultVariables.find((v) => v.name === name)?.formula;
  return model.resultVariables.filter(
    // Показатель без исходов в перечень не идёт: писать рекомендации не к чему, а пустая
    // секция сообщала бы о настройке, которой нет. Такой в переведённом ЧИЛ ровно один —
    // погашенный `other_styles`: код набора он несёт, но своих исходов у него не осталось.
    (v) => v.outcomes.length > 0 && resolveScaleGroup(v.formula, formulaOf) !== null,
  );
}

/** «1 профиль» / «3 профиля» / «15 профилей» — счётчик в теге шапки свёртки. */
function pluralProfiles(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} профилей`;
  if (last === 1) return `${count} профиль`;
  if (last >= 2 && last <= 4) return `${count} профиля`;
  return `${count} профилей`;
}

/** Карточка правки рекомендаций: показатель-профиль -> его исходы -> предпросмотр. */
export function ProfileFeedbackCard({
  model,
  updateModel,
}: ProfileFeedbackCardProps): React.JSX.Element {
  const profiles = profileVariables(model);
  const fold = useSectionFold(profiles.map((v) => v.name));

  const setOutcomeFeedback = (varName: string, code: string, next: FeedbackEditorValue | null) =>
    updateModel((m) => ({
      ...m,
      resultVariables: m.resultVariables.map((v) => {
        if (v.name !== varName) return v;
        return {
          ...v,
          outcomes: v.outcomes.map((o) =>
            o.code === code ? { ...o, feedback: next ?? undefined } : o,
          ),
        };
      }),
    }));

  return (
    <FormSection
      stacked
      title={CARD_TITLE}
      subtitle={CARD_SUBTITLE}
      headClassName="tb-section-head"
      meta={profiles.length > 0 ? <FoldAllButtons fold={fold} testIdPrefix="profile-feedback" /> : undefined}
      data-testid="profile-feedback-card"
    >
      {profiles.length === 0 ? (
        <Banner
          tone="info"
          title="В тесте нет профилей"
          description="Профиль задаётся показателем с шаблоном «Профиль по группе шкал» во вкладке «Оценка результата». Заведите его, и здесь появятся рекомендации на каждый набор."
          data-testid="profile-feedback-empty"
        />
      ) : (
        profiles.map((v) => (
          <FoldSection
            key={v.name}
            open={fold.isOpen(v.name)}
            onToggle={() => fold.toggle(v.name)}
            name={v.label.trim() || v.name}
            tag={pluralProfiles(v.outcomes.length)}
            testId={`profile-feedback-sec-${v.name}`}
          >
            {v.outcomes.length === 0 ? (
              <div className="tb-card-desc">
                У показателя нет исходов — соберите их кнопкой «Собрать наборы» в самом показателе.
              </div>
            ) : (
              // Порядок строк — порядок исходов, то есть тот, в котором их завёл генератор:
              // сначала наборы из одной шкалы, затем из двух и так далее. Запасные `count:N`
              // стоят наравне с точными: у них тоже своя рекомендация (FR-30).
              v.outcomes.map((o) => (
                <OutcomeFeedbackRow
                  key={o.code}
                  varName={v.name}
                  outcome={o}
                  onSave={(next) => setOutcomeFeedback(v.name, o.code, next)}
                />
              ))
            )}
          </FoldSection>
        ))
      )}
    </FormSection>
  );
}

/** Один исход: предпросмотр написанного и модалка правки — та же, что у тем и подтем. */
function OutcomeFeedbackRow(props: {
  varName: string;
  outcome: OutcomeModel;
  onSave: (next: FeedbackEditorValue | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { outcome } = props;
  const value = outcome.feedback ?? EMPTY;
  // Подпись строки — метка исхода: её пишет генератор («Двухвекторный: Целеустремленный и
  // Вдохновляющий»), и по ней автор узнаёт профиль. Код — запасная подпись безымянного.
  const name = outcome.label.trim() || outcome.code;
  const testId = `profile-feedback-${props.varName}-${outcome.code}`;
  return (
    <div className="ou-formfield">
      {/* Метка и КОД набора вместе. Одной метки мало: она не обязана быть уникальной и
          сплошь и рядом не уникальна — у сводного показателя ЧИЛ четыре исхода зовутся
          «Сфокусированный», и без кода четыре строки списка неразличимы. Код же уникален
          по определению: это и есть набор шкал. */}
      <label className="ou-formfield__lbl">
        {name}
        {outcome.label.trim() !== "" && (
          <>
            {" "}
            <span className="tb-levels__badge">{outcome.code}</span>
          </>
        )}
      </label>
      <FeedbackPreview
        format={value.format}
        text={value.text}
        links={value.links ?? []}
        assets={value.assets ?? []}
        events={value.events ?? []}
        onEdit={() => setOpen(true)}
        editAriaLabel={`Редактировать рекомендации профиля «${name}»`}
        testId={testId}
      />
      <FeedbackEditorModal
        open={open}
        title={`Рекомендации профиля «${name}»`}
        description="Что участнику делать с этим профилем. Печатается на экране итогов и в отчёте под толкованием."
        value={{
          format: value.format,
          text: value.text,
          links: value.links ?? [],
          assets: value.assets ?? [],
          events: value.events ?? [],
        }}
        onCancel={() => setOpen(false)}
        onSave={(next: FeedbackEditorValue) => {
          // Пустое без вложений — «автор передумал»: рекомендация снимается, а не остаётся
          // пустой записью. Исход без `feedback` блока рекомендаций не печатает (FR-31).
          const empty =
            next.text.trim() === "" &&
            next.links.length === 0 &&
            next.assets.length === 0 &&
            (next.events ?? []).length === 0;
          props.onSave(empty ? null : next);
          setOpen(false);
        }}
        testId={`${testId}-modal`}
      />
    </div>
  );
}
