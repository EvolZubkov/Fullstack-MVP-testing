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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, ModalDialog, SegmentedControl, Tag } from "@skillum/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildTemplateCssVars, buildTemplateDataAttrs, withParamDefaults } from "@shared/template/params-css";
import { barFillFromParams } from "@shared/template/bar-fill";
import { buildAdaptiveReportContext, buildReportContext } from "@shared/report/report-context";
import { buildReportMeasures } from "@shared/report/report-measures";
import {
  buildAdaptiveReportPreviewInput,
  buildReportPreviewInput,
  type ReportPreviewOutcome,
  type ReportPreviewSection,
  type ReportPreviewTest,
} from "@shared/report/report-preview";
import { reportKindForMode } from "@shared/report/report-variants";
import { resolveReportDocument } from "@shared/report/report-document";
import type { ReportBlockToRender } from "@shared/report/render-report";
import { buildReportPages, PAGE_WIDTH_PX } from "@shared/report/paginate-dom";
import { reportImageKeys, resolveReportImageValues } from "@shared/report/report-assets";
import { useTemplateBundle } from "./use-template-bundle";
import type { ReportVariantOption } from "../use-report-variants";
import { toRowInputs, type DraftBlock } from "../use-report-document";

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
  /** Заголовки итога теста — свойства узла «Итоги теста» (см. `ReportPreviewTest`). */
  headings?: ReportPreviewTest["headings"];
  /** Настройка показа подытогов теста — оттуда же, откуда её берёт выдача. */
  breakdownDisplay?: ReportPreviewTest["breakdownDisplay"];
  /** Вводные блоки теста (PRD-61 FR-23): окно печатает их, как печатает выдача. */
  intro?: ReportPreviewTest["intro"];
  /** Группы тем теста — блок со счётчиком в предпросмотре. */
  sectionGroups?: ReportPreviewTest["sectionGroups"];
  /** Лестница уровней адаптивного теста. */
  levelNames?: string[];
  /**
   * PRD-51 FR-18: ДОКУМЕНТ, собранный автором, — черновик, а не сохранённое. Отсутствует
   * (или пуст) — показывается документ по умолчанию шаблона: ровно его сегодня и получит
   * слушатель у теста, документа не собиравшего.
   */
  document?: DraftBlock[];
}

/** Склонение слова «страница» для подписи «N страниц A4». */
function pageWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return "страниц";
  if (mod10 === 1) return "страница";
  if (mod10 >= 2 && mod10 <= 4) return "страницы";
  return "страниц";
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
  headings,
  breakdownDisplay,
  sectionGroups,
  intro,
  levelNames,
  document,
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

  /**
   * PRD-51: блоки ДОКУМЕНТА и их раскладки.
   *
   * Состав считает та же функция, что и обе выдачи, а раскладки берутся из бандла
   * шаблона по объявленному пути. Строки — ЧЕРНОВИК автора: предпросмотр обязан
   * показывать несохранённое, иначе он отвечает не на тот вопрос, ради которого его
   * открывают. Пустой черновик даёт документ по умолчанию шаблона — ровно его и получит
   * слушатель у теста, документа не собиравшего.
   *
   * Шаблон без блоков даёт пустой список, и окно рисует прежнюю цельную раскладку.
   */
  const blocks = useMemo<ReportBlockToRender[]>(() => {
    if (!bundle) return [];
    const doc = resolveReportDocument(
      bundle.manifest,
      reportKindForMode(mode),
      toRowInputs(document ?? []),
    );
    if (!doc || doc.monolithic) return [];
    return doc.blocks
      .map((b) => ({ ...b, layout: b.layoutFile ? (bundle.layouts[b.layoutFile] ?? "") : "" }))
      // Блок, чьей раскладки в бандле нет, молча пропускается: показать вместо него
      // пустоту честнее, чем уронить всё окно из-за одного отсутствующего файла.
      .filter((b) => b.nature === "page-break" || b.layout.length > 0);
  }, [bundle, mode, document]);

  // Картинки вида объявлены путями внутри шаблона (FR-05), а браузер видит файлы
  // шаблона только через роут ассетов. Без этого автор смотрел бы предпросмотр без
  // подложки и логотипа — а обучающийся получал бы их.
  const previewValues = useMemo(
    () =>
      templateId
        ? resolveReportImageValues(
            values,
            reportImageKeys(variant),
            `/api/templates/${encodeURIComponent(templateId)}/assets/`,
          )
        : values,
    [values, variant, templateId],
  );

  const context = useMemo(() => {
    // Окраска полос подтем — из НЕсохранённых параметров оформления с умолчаниями манифеста,
    // тем же правилом, что в выдаче: автор видит документ, который уйдёт слушателю.
    const barFill = barFillFromParams(
      withParamDefaults(params as Record<string, unknown>, bundle?.manifest.params),
    );
    const test = {
      testName,
      sections,
      levelNames,
      ...(headings ? { headings } : {}),
      ...(breakdownDisplay ? { breakdownDisplay } : {}),
      ...(barFill ? { barFill } : {}),
      ...(sectionGroups?.length ? { sectionGroups } : {}),
      // PRD-61 FR-23: вводный текст едет из РЕАЛЬНОГО теста — автор пишет его прямо перед
      // тем, как открыть это окно, и не увидеть его здесь значит проверять вёрстку вместо
      // содержания.
      ...(intro ? { intro } : {}),
    };
    const design = params as Record<string, unknown>;
    // `isPreview` — тот же флаг, что и у выдачи: макет вправе пометить страницу образцом.
    // PRD-47 §5.4: у предпросмотра нет прогона, поэтому измерения ему даёт демо-набор
    // ШАБЛОНА — тот же, из которого предпросмотр страниц берёт всё остальное. Вид
    // диаграммы при этом берётся из полей ОТЧЁТА: у него свой переключатель, и подмена
    // показала бы автору не тот документ, что уйдёт в PDF.
    const demoMeasures = bundle?.demo?.runtime?.measures;
    const opts = {
      values: previewValues,
      design,
      isPreview: true,
      ...(demoMeasures ? { measures: buildReportMeasures(demoMeasures, previewValues) } : {}),
    };
    return adaptive
      ? buildAdaptiveReportContext(buildAdaptiveReportPreviewInput(test, outcome), opts)
      : buildReportContext(buildReportPreviewInput(test, outcome), opts);
  }, [adaptive, testName, sections, levelNames, headings, breakdownDisplay, sectionGroups, intro, outcome, previewValues, params, bundle]);

  const cssVars = useMemo(
    () => buildTemplateCssVars(params, bundle?.manifest.params),
    [params, bundle],
  );
  // Той же парой едет выбор, объявленный атрибутом (`dataAttr`): предпросмотр должен
  // показывать выбранный вариант ДО сохранения, а по атрибуту шаблон выбирает правило.
  const dataAttrs = useMemo(
    () => buildTemplateDataAttrs(params, bundle?.manifest.params),
    [params, bundle],
  );

  // ПРЕДПРОСМОТР ПОКАЗЫВАЕТ ЛИСТЫ, а не ленту. Раскладку считает тот же
  // `buildReportSheets`, что режет PDF (FR-21/FR-23): пока она жила только в конвейере
  // экспорта, автор согласовывал документ одной длинной страницей и узнавал о разрывах
  // уже из скачанного файла.
  const shadowRef = useRef<ShadowRoot | null>(null);
  const [sheetCount, setSheetCount] = useState(0);
  const onShadowReady = useCallback((shadow: ShadowRoot) => {
    shadowRef.current = shadow;
  }, []);

  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    // Эффекты потомков выполняются раньше родительских, поэтому к этому моменту
    // `TemplateScreen` уже отрисовал страницу в теневой корень.
    const root = shadow.querySelector<HTMLElement>(".tb-report");
    const stage = root?.parentElement;
    if (!root || !stage) return;
    const doc = shadow.ownerDocument ?? document;

    // Клоны листов сначала уезжают в служебный контейнер: раскладке нужна ЖИВАЯ
    // раскладка браузера, поэтому мерить их приходится в дереве, а не в отрыве от него.
    const scratch = doc.createElement("div");
    stage.appendChild(scratch);
    // Страницы строит ОБЩАЯ функция — та же, которой снимает PDF. Своя копия этой сборки
    // жила здесь и разошлась с конвейером: предпросмотр показывал лист с фоном от своего
    // верха, а файл получал кусок общего снимка, где фон продолжался сквозь границу.
    const pages = buildReportPages(root, doc, scratch);

    const holder = doc.createElement("div");
    holder.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:20px;width:" + PAGE_WIDTH_PX + "px;";
    pages.forEach((page, i) => {
      // Оформление ЛИСТА в окне — скругление и тень: бумага на столе, а не в файле.
      page.style.borderRadius = "8px";
      page.style.boxShadow = "var(--ou-shadow-lg)";
      holder.appendChild(page);

      // Подпись — ПОД листом, а не поверх: на плотной странице она легла бы на текст,
      // которого в документе на этом месте нет.
      const caption = doc.createElement("div");
      caption.textContent = `Страница ${i + 1} из ${pages.length}`;
      caption.style.cssText =
        "align-self:flex-end;margin-top:-14px;font:11px/1 system-ui,sans-serif;opacity:.6;";
      holder.appendChild(caption);
    });

    // Служебные клоны и исходная лента убираются: в кадре остаются только листы, и
    // подгонка по ширине (она смотрит на первого ребёнка сцены) масштабирует именно их.
    scratch.remove();
    root.remove();
    stage.appendChild(holder);
    setSheetCount(pages.length);
    return () => {
      holder.remove();
    };
  }, [context, layout, bundle, cssVars]);

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
      description={
        sheetCount > 0
          ? `${variantLabel} · темы этого теста, показатели демонстрационные · ${sheetCount} ${pageWord(sheetCount)} A4`
          : `${variantLabel} · темы этого теста, показатели демонстрационные`
      }
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
                blocks={blocks}
                context={context}
                css={bundle.css}
                cssVars={cssVars}
              dataAttrs={dataAttrs}
                fill={false}
                onShadowReady={onShadowReady}
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
