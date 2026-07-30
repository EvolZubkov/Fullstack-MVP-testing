/**
 * @module features/tests/editor/sections/report-preview-modal
 *
 * PRD-27 Фаза 4 — модальное окно «Предпросмотр отчёта» из блока обратной связи.
 * Эскиз: `docs/wireframes/approved/prd27-report-template.html`, состояния `s-preview`
 * и `s-preview-ok`.
 *
 * Страница рисуется ТЕМ ЖЕ рендерером и ТЕМ ЖЕ макетом, что уйдёт обучающемуся
 * ({@link TemplateScreen} -> `renderScreenInto`, FR-17): второго движка предпросмотра нет.
 * Данные — на структуре редактируемого теста с демонстрационными числами
 * ({@link buildReportPreviewInput}, FR-18); переключатель показывает оба исхода (FR-19);
 * значения полей приходят из НЕсохранённого черновика (FR-20). Это страница, а не PDF:
 * ни растеризации, ни скачивания (FR-21).
 */

import { useMemo, useState } from "react";
import { Banner, Button, ModalDialog, SegmentedControl, Tag } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { buildAdaptiveReportContext, buildReportContext } from "@shared/report/report-context";
import {
  buildAdaptiveReportPreviewInput,
  buildReportPreviewInput,
  type ReportPreviewOutcome,
  type ReportPreviewSection,
} from "@shared/report/report-preview";
import { reportKindForMode } from "@shared/report/report-variants";
import { useTemplateBundle } from "./use-template-bundle";
import type { ReportVariantOption } from "../use-report-variants";

/** Что окно знает о редактируемом тесте (FR-18: структура реальная). */
export interface ReportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  mode: "standard" | "adaptive";
  /** Черновой шаблон вкладки «Оформление» — предпросмотр идёт против него (§4.2). */
  templateId: string | undefined;
  /** Черновые параметры оформления (брендинг), применяются CSS-переменными. */
  params: Record<string, unknown>;
  /** Выбранный вид отчёта; `null` — шаблон видов не предлагает, показываем деградацию. */
  variant: ReportVariantOption | null;
  /** Значения полей вида ИЗ ЧЕРНОВИКА — предпросмотр отражает несохранённые правки (FR-20). */
  values: Record<string, unknown>;
  testName: string;
  sections: ReportPreviewSection[];
  /** Лестница уровней адаптивного теста. */
  levelNames?: string[];
}

export function ReportPreviewModal({
  open,
  onClose,
  mode,
  templateId,
  params,
  variant,
  values,
  testName,
  sections,
  levelNames,
}: ReportPreviewModalProps) {
  const [outcome, setOutcome] = useState<ReportPreviewOutcome>("failed");
  const bundleQuery = useTemplateBundle(templateId, open);
  const bundle = bundleQuery.data;

  const adaptive = mode === "adaptive";

  // Макет: сначала файл, объявленный ВЫБРАННЫМ вариантом, иначе канонический вид режима —
  // ровно та же деградация, что и при выдаче (FR-10/FR-15).
  const layout = useMemo(() => {
    if (!bundle) return undefined;
    const byFile = variant?.layoutFile ? bundle.layouts[variant.layoutFile] : undefined;
    return byFile ?? bundle.layouts[reportKindForMode(mode)];
  }, [bundle, variant, mode]);

  const context = useMemo(() => {
    const test = { testName, sections, levelNames };
    const design = params as Record<string, unknown>;
    // `isPreview` — тот же флаг, что и у выдачи: макет вправе пометить страницу образцом.
    const opts = { values, design, isPreview: true };
    return adaptive
      ? buildAdaptiveReportContext(buildAdaptiveReportPreviewInput(test, outcome), opts)
      : buildReportContext(buildReportPreviewInput(test, outcome), opts);
  }, [adaptive, testName, sections, levelNames, outcome, values, params]);

  const cssVars = useMemo(
    () => buildTemplateCssVars(params, bundle?.manifest.params),
    [params, bundle],
  );

  if (!open) return null;

  const variantLabel = variant?.label || variant?.key || "вид шаблона «Стандартный»";

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tb-report-preview-modal"
      title={
        <>
          Предпросмотр отчёта{" "}
          <Tag tone="neutral" variant="outline" size="s">
            Образец
          </Tag>
        </>
      }
      description={`${variantLabel} · темы этого теста, показатели демонстрационные`}
      footer={
        <Button variant="ghost" size="m" onClick={onClose} data-testid="report-preview-close">
          Закрыть
        </Button>
      }
    >
      <div data-testid="report-preview-modal">
        <SegmentedControl<ReportPreviewOutcome>
          aria-label="Исход попытки"
          value={outcome}
          onChange={setOutcome}
          items={[
            { value: "failed", label: "Не пройден" },
            { value: "passed", label: "Пройден" },
          ]}
        />

        {bundleQuery.isLoading && <p className="ou-formfield__desc">Загружаем шаблон…</p>}
        {bundleQuery.error && (
          <Banner
            tone="error"
            title="Не удалось загрузить файлы шаблона"
            description={(bundleQuery.error as Error).message}
          />
        )}
        {bundle &&
          (layout != null ? (
            <div className="tb-report-preview__stage">
              {/* `fill={false}`: отчёт — документ формата A4 со СВОЕЙ высотой, а не экран,
                  который тянут до низа плеера. С растяжением `min-height: 842px` страницы
                  гасится, и автор оценивает не те пропорции, что уйдут в PDF. */}
              <TemplateScreen
                layout={layout}
                context={context}
                css={bundle.css}
                cssVars={cssVars}
                fill={false}
              />
            </div>
          ) : (
            <Banner
              tone="warning"
              title="Шаблон не содержит макета отчёта"
              description="Отчёт обучающемуся соберётся по макету «Стандартного» — предпросмотр показать нечем, потому что выбранный шаблон этот макет не отдаёт."
            />
          ))}
      </div>
    </ModalDialog>
  );
}
