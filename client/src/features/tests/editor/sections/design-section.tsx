/**
 * @module features/tests/editor/sections/design-section
 * @description Editor section for the «Оформление» tab (PRD-7 wireframe
 * `prd7-design-tab.html`).
 *
 * MVP scope:
 *   - Шаблон pane: shows the current template card (name + version + builtin
 *     tag + description) loaded from `/api/templates/:id`. «Заменить шаблон»
 *     is left as a placeholder (full gallery deferred to FR-30/31). «Сбросить
 *     до умолчаний» clears all params in the draft and persists empty params
 *     on save.
 *   - Брендирование pane: renders params with `section === "branding"` (or
 *     without explicit section — fallback to branding). Supports `text`,
 *     `color`, `boolean`, `select`. Other types render a read-only placeholder
 *     row — full media-library + colorpicker integration is deferred.
 *   - Макет pane: renders params with `section === "layout"`.
 *   - Прогресс и шапка pane: renders params with `section === "progress"`.
 *   - Each section shows an informational Banner when the template declares no
 *     params for that section.
 *
 * Save flow:
 *   - Design has its own endpoint (`PUT /api/tests/:id/design`), separate from the
 *     test-settings PUT, but NOT its own button: the Drawer footer's «Сохранить»
 *     drives both (and the content-page commit) in one action, so the author never
 *     has to save the same drawer twice. The pane only surfaces the save ERROR of
 *     that endpoint (`DesignSaveError`), since a failing design PUT must not be
 *     masked by the settings one having succeeded.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  Paperclip,
  RotateCcw,
  SquareOff,
  Upload,
  X,
} from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  ColorPicker,
  Combobox,
  IconButton,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  Switch,
  Table,
  Tag,
  type TableColumn,
} from "@skillum/ui-kit";
import type { TestTheme } from "@shared/template/themes";
import {
  useDesignSettings,
  type MediaParamValue,
  type TemplateParam,
  type UseDesignSettingsResult,
} from "../use-design-settings";
import { fromHex, manifestColorFormat, toHex, type ColorFormat } from "./color-format";
import { extractThemeTokens } from "@shared/template/theme-tokens";
import { useTemplateBundle } from "./use-template-bundle";
import { DEFAULT_PARAM_CSS_VARS } from "@shared/template/params-css";
import { resolveLabels, type LabelDeclaration, type LabelValues } from "@shared/template/labels";
import { ResultsLabelsPane } from "./results-labels-pane";
import { TemplatePreviewModal } from "./template-preview-modal";
import { TemplateGalleryModal } from "./template-gallery-modal";
import { TemplateThumb, templateAssetUrl } from "./template-thumb";
import { ReportSettingsCard } from "./report-settings-card";
import type { TestEditorModel } from "../test-editor.types";

// ─── Public API ───────────────────────────────────────────────────────────────

export type DesignSectionProps = {
  /**
   * Тест, чьё оформление грузить самостоятельно; `undefined` в режиме создания.
   * Раздел о режиме НЕ знает: у нового теста черновик приходит готовым в `design`,
   * и панели работают одинаково до первого сохранения и после.
   */
  testId: string | undefined;
  /**
   * Optional pre-hoisted design hook instance. When provided, the section
   * does NOT call `useDesignSettings` internally — caller owns the lifecycle.
   * This lets the editor's drawer footer drive design save as part of the
   * unified «Сохранить» flow (per wireframe prd7-design-tab.html — single
   * footer save, no per-pane save button).
   */
  design?: UseDesignSettingsResult;
  /**
   * PRD-47 §6.2: модель теста нужна пункту «Отчёт о результатах» — карточка правит
   * `model.report`. Хранение осталось своей колонкой (PRD-27 §4.2), переехал только
   * элемент интерфейса, поэтому поля отчёта по-прежнему часть модели теста.
   *
   * Необязательные: раздел собирают и в компонентных тестах, где модели нет, и там
   * пункт просто не показывает карточку.
   */
  model?: TestEditorModel;
  updateModel?: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

type DesignRailKey =
  | "template"
  | "layout"
  | "branding"
  | "colors"
  | "charts"
  | "report";

const RAIL_ITEMS: { key: DesignRailKey; label: string }[] = [
  { key: "template", label: "Шаблон" },
  { key: "layout", label: "Макет" },
  { key: "branding", label: "Брендирование" },
  // PRD-23: у цветов есть логика, которой нет у прочих параметров — наследование от
  // палитры шаблона, формат хранения, значение на тему, — поэтому у них свой пункт.
  { key: "colors", label: "Цвета" },
  // Э3.7: вид диаграмм шкал и показателей — тоже облик, но разговор отдельный: автор
  // выбирает ФОРМУ печати измерения, а не цвет и не шрифт. Пункт собирается по ТИПУ
  // параметра, как и цвета: иначе пришлось бы перевыпускать каждый уже залитый шаблон.
  { key: "charts", label: "Вид диаграмм" },
  // PRD-47 §6.2: отчёт — часть шаблона, его поля объявляет манифест ровно как параметры
  // оформления. Здесь только ОБЛИК документа: что в нём печатать, автор задаёт во вкладке
  // «Обратная связь и итоги» (решение 18).
  { key: "report", label: "Облик отчёта" },
];

/**
 * Что может нарисовать {@link SectionPane}: пункт рейла «Оформления» либо секция
 * «Прогресс и шапка» — её параметры объявляет тот же манифест, но рисует их вкладка
 * «Правила прохождения»: это не облик, а то, что участник видит по ходу (решение 18).
 */
export type ParamPaneKey = Exclude<DesignRailKey, "template"> | "progress";

/**
 * Params a rail section shows. Colours are picked by TYPE, not by the `section`
 * the manifest declares: routing them by declaration would mean re-issuing every
 * template already uploaded. What is left of «Брендирование» is therefore its
 * params MINUS the colours.
 */
function paramsForRail(
  params: TemplateParam[] | undefined,
  key: ParamPaneKey,
): TemplateParam[] {
  const all = params ?? [];
  if (key === "colors") return all.filter((p) => p.type === "color");
  if (key === "charts") return all.filter(isChartParam);
  return all.filter(
    (p) =>
      (p.section ?? "branding") === key &&
      !(key === "branding" && (p.type === "color" || isChartParam(p))),
  );
}

/**
 * Параметр вида диаграмм: тот, что шаблон объявил группой «Итоги». Пункт рейла собирается
 * по ОБЪЯВЛЕНИЮ манифеста, а не по перечню ключей: у другого шаблона диаграммы свои, и
 * список ключей в редакторе устарел бы с первым же новым шаблоном (решение 19).
 */
function isChartParam(p: TemplateParam): boolean {
  return p.group === "Итоги";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DesignSection({ testId, design: designProp, model, updateModel }: DesignSectionProps) {
  const [active, setActive] = useState<DesignRailKey>("template");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Fallback hook usage kept so the section still works as a standalone unit
  // (e.g., in component tests) when the parent hasn't hoisted the hook.
  const fallback = useDesignSettings(designProp ? undefined : testId);
  const design = designProp ?? fallback;

  // PRD-7 S12-G6: when the persisted templateId is unresolvable (404), force
  // the rail back to «Шаблон» (where the incompatible banner lives) and
  // disable branding / layout / progress — those panes have nothing to bind
  // to without a template manifest.
  // PRD-23: a section the template puts nothing in is not shown. Before, it was
  // shown and opened on a banner saying the template declares no params — a rail
  // item that does nothing. «Шаблон» always stays: it is the card, not params.
  // While the template is unresolved every section is listed, so the rail does not
  // collapse to one item during loading or on a 404.
  const visibleRail = useMemo(() => {
    const params = design.template?.manifest.params;
    if (!design.template) return RAIL_ITEMS;
    return RAIL_ITEMS.filter(
      (item) =>
        item.key === "template" ||
        // PRD-47 §6.2: отчёт есть у любого теста. Даже когда шаблон не объявил видов,
        // карточка объясняет, что отчёт соберётся видом «Стандартный», — спрятать пункт
        // значит спрятать это объяснение. Остальные пункты без параметров бессмысленны.
        item.key === "report" ||
        paramsForRail(params, item.key).length > 0,
    );
  }, [design.template]);

  // PRD-49: строки панели «Заголовки и подписи отчёта». Документ печатает НЕ все
  // объявленные надписи — структура у него своя и фиксированная, — поэтому перечень
  // приходит с сервера, посчитанный по макетам отчёта (`reportLabelKeys`). Поля нет
  // (старый сервер, шаблон не прочитался) — показываются все объявления, как раньше.
  const reportLabelDeclarations = useMemo(() => {
    const declared = design.template?.manifest.labels ?? [];
    const printed = design.template?.reportLabelKeys;
    if (!printed) return declared;
    const allowed = new Set(printed);
    return declared.filter((d) => allowed.has(d.key));
  }, [design.template]);

  const effectiveActive: DesignRailKey = design.templateMissing
    ? "template"
    : visibleRail.some((i) => i.key === active)
      ? active
      : "template";
  const isRailDisabled = (key: DesignRailKey): boolean =>
    design.templateMissing && key !== "template";

  return (
    <>
      <div className="ou-drawer__split" data-testid="design-split">
        <nav className="ou-drawer__rail" aria-label="Подразделы оформления">
          {visibleRail.map((item) => {
            const disabled = isRailDisabled(item.key);
            const showError = item.key === "template" && design.templateMissing;
            return (
              <button
                key={item.key}
                type="button"
                className={
                  "ou-drawer__rail-item" +
                  (effectiveActive === item.key ? " is-active" : "")
                }
                aria-current={effectiveActive === item.key ? "page" : undefined}
                aria-disabled={disabled ? "true" : undefined}
                disabled={disabled}
                onClick={disabled ? undefined : () => setActive(item.key)}
                data-testid={`design-rail-${item.key}`}
              >
                {item.label}
                {showError && (
                  <span
                    className="tb-status-dot tb-status-dot--err"
                    aria-label="Шаблон недоступен"
                    data-testid="design-rail-template-error-dot"
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="tb-settings-content" data-testid={`design-pane-${effectiveActive}`}>
          {design.isLoading ? (
            <LoadingNotice />
          ) : design.templateMissing ? (
            <TemplateIncompatibleBanner
              missingId={design.draft.templateId}
              onApplyDefault={design.applyDefaultTemplate}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          ) : design.error ? (
            <ErrorNotice message={design.error.message} />
          ) : effectiveActive === "template" ? (
            <TemplatePane
              design={design}
              onPreview={() => setPreviewOpen(true)}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          ) : effectiveActive === "branding" ? (
            <SectionPane
              design={design}
              section="branding"
              emptyTitle="В шаблоне нет настраиваемых параметров оформления"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» в секции «Брендирование» не объявлено ни одного параметра.`}
              testId="design-branding-pane"
            />
          ) : effectiveActive === "colors" ? (
            <ColorsPane design={design} onPreview={() => setPreviewOpen(true)} />
          ) : effectiveActive === "report" ? (
            // PRD-47 §6.2: переезд, а не переработка — состав карточки тот же, что стоял
            // в «Настройки → Основное». Черновые шаблон и брендинг теперь СВОИ, этой же
            // вкладки, а не пришедшие из соседней.
            model && updateModel ? (
              <>
              <ReportSettingsCard
                // Здесь только облик документа: что в нём показывать, автор задаёт в
                // «Настройках», рядом с обратной связью (PRD-27 §7.1).
                scope="appearance"
                mode={model.mode === "adaptive" ? "adaptive" : "standard"}
                draftTemplateId={design.draft.templateId}
                designParams={design.draft.params}
                value={model.report ?? {}}
                onChange={(next) => updateModel((m) => ({ ...m, report: next }))}
                // PRD-51: список блоков здесь не рисуется (это облик, а не содержание), но
                // ПРЕДПРОСМОТР обязан показать тот же документ, что и в «Настройках»: два
                // окна с одной кнопкой, показывающие разное, — это не выбор, а ошибка.
                savedDocument={
                  model.reportDocument?.saved?.[model.mode === "adaptive" ? "adaptive" : "standard"]
                }
                document={
                  model.reportDocument?.draft?.[model.mode === "adaptive" ? "adaptive" : "standard"]
                }
                // FR-18: предпросмотр строится на РЕАЛЬНОЙ структуре редактируемого теста —
                // его названии и разделах; демонстрационные только числа и вердикты.
                testName={model.basic.title}
                sections={model.sections.map((s) => ({
                  topicId: s.topicId,
                  topicName: s.topicName,
                  questionCount: s.drawCount,
                }))}
                levelNames={
                  model.mode === "adaptive"
                    ? (model.adaptive.topics.find((t) => t.enabled)?.levels ?? []).map(
                        (l) => l.levelName,
                      )
                    : undefined
                }
              />
              {/* PRD-49 §7: слой ПЕРЕОПРЕДЕЛЕНИЙ надписей для документа. Он здесь, а не
                  в «Обратной связи»: там задают, ЧТО показывать в отчёте, а формулировка
                  заголовка — это КАК он выглядит. Перечень — только те надписи, которые
                  печатает документ (`reportLabelKeys`): структура у него своя, и строка
                  про заголовок, которого в нём нет, включалась бы вхолостую. */}
              {reportLabelDeclarations.length > 0 && (
                <ReportLabelsCard
                  declarations={reportLabelDeclarations}
                  sharedLabels={design.draft.labels ?? {}}
                  report={model.report ?? {}}
                  onChange={(next) => updateModel((m) => ({ ...m, report: next }))}
                />
              )}
              </>
            ) : null
          ) : effectiveActive === "layout" ? (
            <SectionPane
              design={design}
              section="layout"
              emptyTitle="В шаблоне нет настроек макета"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» в секции «Макет» не объявлено ни одного параметра. Шаблон поддерживает только встроенный макет.`}
              testId="design-layout-pane"
            />
          ) : (
            <SectionPane
              design={design}
              section="charts"
              emptyTitle="В шаблоне нет настроек вида диаграмм"
              emptyDesc={`Шаблон «${design.template?.manifest.name ?? ""}» не объявил, чем рисовать шкалы и показатели, — он печатает их своим встроенным видом.`}
              testId="design-charts-pane"
            />
          )}
        </div>
      </div>
      <TemplatePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        template={design.template}
        params={design.draft.params ?? {}}
        theme={design.draft.theme}
        paramsByTheme={design.draft.paramsByTheme}
      />
      <TemplateGalleryModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        currentTemplateId={design.draft.templateId}
        hasDirtyParams={
          design.draft.params !== undefined &&
          Object.keys(design.draft.params).length > 0
        }
        onApply={(id) => design.setTemplate(id)}
      />
    </>
  );
}

// ─── Sub-panes ────────────────────────────────────────────────────────────────

function LoadingNotice() {
  return (
    <Banner
      tone="info"
      title="Загружаем настройки оформления…"
      data-testid="design-loading"
    />
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Banner
      tone="error"
      title="Не удалось загрузить оформление"
      description={message}
      data-testid="design-error"
    />
  );
}

/**
 * PRD-7 S12-G6 / wf-template-incompatible: the persisted templateId no longer
 * resolves to an active template (deleted, renamed, API-version bumped).
 * Replaces the template card with an error Banner offering two recovery
 * actions: open the gallery (deferred until S12-G3 lands) or apply «default».
 */
function TemplateIncompatibleBanner(props: {
  missingId: string;
  onOpenGallery: () => void;
  onApplyDefault: () => void;
}) {
  return (
    <Banner
      tone="error"
      icon={<AlertTriangle width={16} height={16} aria-hidden="true" />}
      title="Шаблон недоступен"
      description={
        <>
          Сохранённый шаблон «<strong>{props.missingId}</strong>» больше не
          поддерживается. Выберите другой шаблон или примените шаблон по
          умолчанию, чтобы продолжить редактирование оформления.
        </>
      }
      actions={[
        {
          label: "Выбрать шаблон",
          onClick: props.onOpenGallery,
        },
        {
          label: "Применить «Стандартный»",
          onClick: props.onApplyDefault,
        },
      ]}
      data-testid="design-template-incompatible"
    />
  );
}

function TemplatePane({
  design,
  onPreview,
  onOpenGallery,
}: {
  design: UseDesignSettingsResult;
  onPreview: () => void;
  /** PRD-7 S12-G3 / FR-33: opens the TemplateGalleryModal. */
  onOpenGallery: () => void;
}) {
  const tpl = design.template;
  if (!tpl) return null;
  return (
    // Баннер — ПРЯМОЙ ребёнок колонки настроек, а не карточки панели: полноширинным и
    // липким его делает правило `.tb-settings-content > .ou-banner`, и внутри обёртки
    // оно не срабатывало — сообщение об устаревшем шаблоне уезжало вверх при прокрутке.
    <>
      {design.templateOutdated && (
        <Banner
          tone="warning"
          icon={<AlertTriangle width={16} height={16} aria-hidden="true" />}
          title="Шаблон обновлён"
          description={
            <>
              Шаблон «<strong>{tpl.manifest.name ?? tpl.name}</strong>» был
              перезагружен (версия v{tpl.manifest.version ?? tpl.version}).
              Сохранённое оформление могло устареть. Обновите его, чтобы
              применить актуальные параметры шаблона.
            </>
          }
          actions={[
            {
              label: "Обновить оформление",
              onClick: design.refreshTemplateVersion,
            },
          ]}
          data-testid="design-template-outdated"
        />
      )}
      <div data-testid="design-template-pane">
      <div className="tpl-block" data-testid="design-template-card">
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s tpl-preview-btn"
          aria-label="Предпросмотр шаблона"
          disabled={design.template === null}
          onClick={onPreview}
          data-testid="design-template-preview"
        >
          <Eye size={16} aria-hidden="true" />
        </button>
        <div className="tpl-thumb">
          <TemplateThumb template={tpl} name={tpl.manifest.name ?? tpl.name}>
            <div className="preview-sketch">
              <div className="ps-header">
                <div className="ps-logo" />
                <div className="ps-title">
                  {(tpl.manifest.name ?? tpl.name).slice(0, 3).toUpperCase()}
                </div>
              </div>
              <div className="ps-progress">
                <div className="ps-progress-bar" />
              </div>
              <div className="ps-body">
                <div className="ps-sidebar">
                  <div className="ps-nav-item active" />
                  <div className="ps-nav-item" />
                  <div className="ps-nav-item" />
                </div>
                <div className="ps-content">
                  <div className="ps-q">Вопрос…</div>
                  <div className="ps-opt sel" />
                  <div className="ps-opt" />
                  <div className="ps-opt" />
                </div>
              </div>
            </div>
          </TemplateThumb>
        </div>
        <div className="tpl-info">
          <div className="tpl-info__head">
            <div className="tpl-name" data-testid="design-template-name">
              {tpl.manifest.name ?? tpl.name}
            </div>
            {tpl.isBuiltin && (
              <Tag
                tone="neutral"
                variant="outline"
                data-testid="design-template-builtin"
              >
                Встроенный
              </Tag>
            )}
            <Tag
              tone="info"
              variant="outline"
              data-testid="design-template-version"
            >
              v{tpl.manifest.version ?? tpl.version}
            </Tag>
          </div>
          <div className="tpl-desc" data-testid="design-template-desc">
            {tpl.manifest.description ?? tpl.description ?? "Описание не указано."}
          </div>
          <div className="tpl-actions">
            <Button
              variant="secondary"
              size="s"
              data-testid="design-template-replace"
              onClick={onOpenGallery}
            >
              Заменить шаблон
            </Button>
            <Button
              variant="ghost"
              size="s"
              data-testid="design-template-reset"
              onClick={design.resetToDefaults}
            >
              Сбросить до умолчаний
            </Button>
          </div>
        </div>
      </div>
      <DesignSaveError design={design} />
      </div>
    </>
  );
}


/**
 * PRD-49 §7: слой переопределений надписей для ОТЧЁТА.
 *
 * Отдельная карточка рядом с «Оформлением отчёта», а не поля внутри неё: у надписей своя
 * природа — их объявляет `manifest.labels[]`, а не `settings[]` выбранного вида, и живут
 * они на всех экранах сразу. Значения кладутся в `report_settings_json.labels`.
 */
export function ReportLabelsCard({
  declarations,
  sharedLabels,
  report,
  onChange,
}: {
  declarations: LabelDeclaration[];
  /** Общие значения теста: относительно них автор задаёт отступление для отчёта. */
  sharedLabels: LabelValues;
  report: TestEditorModel["report"] & object;
  onChange: (next: NonNullable<TestEditorModel["report"]>) => void;
}) {
  // Что напечатает отчёт БЕЗ переопределения: умолчание экрана `report` под значениями
  // теста. Это и есть состояние «как на экране итогов», в котором строка открывается.
  const base = useMemo(
    () => resolveLabels({ declarations, values: sharedLabels, screen: "report" }),
    [declarations, sharedLabels],
  );
  const overrides = (report as { labels?: LabelValues }).labels ?? {};
  return (
    <div data-testid="design-report-labels">
      {/* Карточка, а не `FormSection`: пане внутри сама разложена секциями, а секция в
          секции — это две колонки заголовков подряд (280px + 280px), от которых полю
          формулировки остаётся полоска, а вкладке достаётся горизонтальная прокрутка.
          Карточка ещё и ставит надписи рядом с «Оформлением отчёта» — соседом по экрану. */}
      <Card variant="outlined" size="sm">
        <CardHeader
          title="Заголовки и подписи отчёта"
          subtitle="По умолчанию отчёт говорит теми же словами, что экран итогов. Здесь задаётся отступление — только для документа."
        />
        <CardBody>
          <ResultsLabelsPane
            declarations={declarations}
            labels={overrides}
            screen="report"
            baseLabels={base}
            onChange={(next) =>
              onChange({ ...report, labels: next } as NonNullable<TestEditorModel["report"]>)
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Generic pane that renders template params for a given `ParamSection`.
 * When no params are declared for the section an informational Banner is shown.
 */
export function SectionPane({
  design,
  section,
  emptyTitle,
  emptyDesc,
  testId,
}: {
  design: UseDesignSettingsResult;
  /**
   * Пункт рейла, чьи параметры рисуются. Не `ParamSection`: «Цвета» и «Вид диаграмм»
   * собираются по типу и по объявленной группе, а не по секции манифеста.
   */
  section: ParamPaneKey;
  emptyTitle: string;
  emptyDesc: string;
  testId: string;
}) {
  const tpl = design.template;
  const params = useMemo(
    () => paramsForRail(tpl?.manifest.params, section),
    [tpl?.manifest.params, section],
  );
  // The template's stylesheet is the only place a `default: null` colour actually
  // lives, so colour rows resolve their inherited value from it. Fetched ONLY for
  // a section that has colours — «Макет» and «Прогресс» need no palette — and
  // under the same react-query key as the previews, so opening one afterwards
  // costs nothing.
  const hasColorParams = useMemo(() => params.some((p) => p.type === "color"), [params]);
  const bundle = useTemplateBundle(tpl?.id, !!tpl && hasColorParams);
  const tokens = useMemo(
    () => extractThemeTokens(bundle.data?.css ?? ""),
    [bundle.data?.css],
  );
  const colorFormat = useMemo(
    () => manifestColorFormat(tpl?.manifest.params),
    [tpl?.manifest.params],
  );
  if (!tpl) return null;
  if (params.length === 0) {
    return (
      <div data-testid={testId}>
        <Banner
          tone="info"
          title={emptyTitle}
          description={emptyDesc}
          data-testid={`${testId}-empty`}
        />
        <DesignSaveError design={design} />
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      {params.map((p) => (
        <ParamRow
          key={p.key}
          param={p}
          value={design.draft.params?.[p.key]}
          onChange={(v) => design.setParam(p.key, v)}
          onClear={() => design.clearParam(p.key)}
          inheritedColor={tokens.light[cssVarOf(p)] ?? null}
          colorFormat={colorFormat}
          templateId={tpl.id}
        />
      ))}
      <DesignSaveError design={design} />
    </div>
  );
}

/**
 * PRD-23 «Цвета». Two shapes, decided by the TEMPLATE, not by the author's choice:
 *
 *   - the template ships one palette — a flat list of colours, as before;
 *   - it ships several — the theme switch plus a table «параметр × тема», so both
 *     palettes are visible at once and a colour missing from one of them is
 *     noticeable without hunting. The table does NOT follow the switch: pinning a
 *     theme must not hide (or lose) the palette the author already picked for the
 *     other one.
 */
function ColorsPane({
  design,
  onPreview,
}: {
  design: UseDesignSettingsResult;
  onPreview: () => void;
}) {
  const tpl = design.template;
  const params = useMemo(
    () => paramsForRail(tpl?.manifest.params, "colors"),
    [tpl?.manifest.params],
  );
  // The stylesheet is the only place a `default: null` colour actually lives, so
  // every «из шаблона» value is read from there.
  const bundle = useTemplateBundle(tpl?.id, !!tpl && params.length > 0);
  const tokens = useMemo(() => extractThemeTokens(bundle.data?.css ?? ""), [bundle.data?.css]);
  const colorFormat = useMemo(
    () => manifestColorFormat(tpl?.manifest.params),
    [tpl?.manifest.params],
  );
  if (!tpl) return null;
  const themed = design.themes.length >= 2;

  if (!themed) {
    return (
      <div data-testid="design-colors-pane">
        {params.map((p) => (
          <ParamRow
            key={p.key}
            param={p}
            value={design.draft.params?.[p.key]}
            onChange={(v) => design.setParam(p.key, v)}
            onClear={() => design.clearParam(p.key)}
            inheritedColor={tokens.light[cssVarOf(p)] ?? null}
            colorFormat={colorFormat}
          />
        ))}
        <DesignSaveError design={design} />
      </div>
    );
  }

  const themeItems = [
    ...design.themes.map((t) => ({ value: t.id as TestTheme, label: t.label })),
    { value: "auto" as TestTheme, label: "Авто" },
  ];
  const pinned = design.themes.find((t) => t.id === design.theme);
  const columns: TableColumn<TemplateParam>[] = [
    {
      key: "param",
      header: "Параметр",
      rowHeader: true,
      width: "46%",
      render: (p) => (
        <>
          <span className="design-colors-table__param">{p.label}</span>
          {p.description ? (
            <div className="design-colors-table__hint">{p.description}</div>
          ) : null}
        </>
      ),
    },
    ...design.themes.map((t) => ({
      key: t.id,
      header: t.label,
      render: (p: TemplateParam) => (
        <ThemeColorCell
          param={p}
          themeId={t.id}
          themeLabel={t.label}
          value={design.themeParams[t.id]?.[p.key]}
          inheritedColor={tokens[t.id][cssVarOf(p)] ?? null}
          colorFormat={colorFormat}
          onChange={(v) => design.setThemeParam(t.id, p.key, v)}
          onClear={() => design.clearThemeParam(t.id, p.key)}
        />
      ),
    })),
  ];

  return (
    <div data-testid="design-colors-pane">
      <div className="ou-formfield">
        <label className="ou-formfield__lbl" id="design-theme-label">
          Тема теста
        </label>
        <div className="design-theme-head">
          <SegmentedControl<TestTheme>
            size="s"
            items={themeItems}
            value={design.theme}
            onChange={(v) => design.setTheme(v)}
            aria-labelledby="design-theme-label"
            data-testid="design-theme-switch"
          />
          <Button
            variant="ghost"
            size="s"
            leadingIcon={<Eye size={13} aria-hidden="true" />}
            onClick={onPreview}
            data-testid="design-theme-preview"
          >
            Предпросмотр
          </Button>
        </div>
        <div className="ou-formfield__desc" data-testid="design-theme-desc">
          {pinned
            ? `Тест открывается в теме «${pinned.label}» у всех участников независимо от их системных настроек.`
            : "Тест открывается в теме, выбранной у участника. Задайте цвета для обеих — иначе часть участников увидит не то, что вы задумали."}
        </div>
      </div>
      <Table<TemplateParam>
        columns={columns}
        rows={params}
        rowKey={(p) => p.key}
        density="compact"
        className="design-colors-table"
        data-testid="design-colors-table"
      />
      <DesignSaveError design={design} />
    </div>
  );
}

/** One colour of one palette: the picker plus, for an override, the way back. */
function ThemeColorCell({
  param,
  themeId,
  themeLabel,
  value,
  inheritedColor,
  colorFormat,
  onChange,
  onClear,
}: {
  param: TemplateParam;
  themeId: string;
  themeLabel: string;
  value: unknown;
  inheritedColor: string | null;
  colorFormat: ColorFormat;
  onChange: (v: unknown) => void;
  onClear: () => void;
}) {
  const override = typeof value === "string" && value ? value : null;
  const inherited = ((param.default as string | undefined) ?? "") || inheritedColor || "";
  const effective = override ?? inherited;
  return (
    <div className="design-color-field">
      <ColorPicker
        value={toHex(effective, "#000000")}
        aria-label={`${param.label}, тема «${themeLabel}»`}
        onChange={(hex) => onChange(fromHex(hex, effective, colorFormat))}
        data-testid={`design-theme-color-${themeId}-${param.key}`}
      />
      {override !== null && (
        // Present ONLY on an override — its presence is also what marks the cell
        // as changed, so the table needs no separate «изменено» badge.
        <IconButton
          icon={<RotateCcw width={14} height={14} aria-hidden="true" />}
          aria-label={`Вернуть цвет шаблона: ${param.label}, тема «${themeLabel}»`}
          title="Вернуть цвет шаблона"
          variant="ghost"
          size="s"
          onClick={onClear}
          data-testid={`design-theme-reset-${themeId}-${param.key}`}
        />
      )}
    </div>
  );
}

/**
 * One design parameter: its control plus, when the manifest supplies one, the
 * explanation of what the parameter actually paints. A colour named «Акцентный»
 * says nothing about where it shows up; the description is where the template
 * author tells the test author that (PRD-22, plan Э8).
 */
function ParamRow(props: {
  param: TemplateParam;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Drop the override, handing the param back to the template. */
  onClear?: () => void;
  /** Template whose own files back a param's option previews. */
  templateId?: string;
  /** Template's own value for this colour, read from its stylesheet. */
  inheritedColor?: string | null;
  /** Storage format this template's colours use. */
  colorFormat?: ColorFormat;
}) {
  return (
    <div className="ou-formfield" data-testid={`design-param-row-${props.param.key}`}>
      <ParamControl {...props} />
      {props.param.description ? (
        <p className="ou-formfield__desc" data-testid={`design-param-desc-${props.param.key}`}>
          {props.param.description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Which picture of an option preview to show: a template may ship one path or a pair
 * per interface theme (spec §6). A lockup drawn for a light ground is unreadable on
 * the dark editor, so the card follows the theme the AUTHOR is looking at — not the
 * theme of the test being edited.
 */
function previewForTheme(
  spec: string | { light?: string; dark?: string } | undefined,
  dark: boolean,
): string | undefined {
  if (!spec) return undefined;
  if (typeof spec === "string") return spec;
  return (dark ? spec.dark ?? spec.light : spec.light ?? spec.dark) ?? undefined;
}

/**
 * Is the INTERFACE dark right now? Read from the body class the theme provider paints
 * (`.ou--dark`), not from its context: this control is rendered in component tests
 * without the provider, and `useTheme` throws there. The observer keeps the cards in
 * step when the author flips the theme with the drawer open.
 */
function useDarkInterface(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.body.classList.contains("ou--dark"),
  );
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const read = () => setDark(document.body.classList.contains("ou--dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** CSS custom property a param feeds, via its own `cssVar` or the shared map. */
function cssVarOf(param: TemplateParam): string {
  return (param as { cssVar?: string }).cssVar ?? DEFAULT_PARAM_CSS_VARS[param.key] ?? "";
}

function ParamControl({
  param,
  value,
  onChange,
  onClear,
  inheritedColor,
  colorFormat = "hsl",
  templateId,
}: {
  param: TemplateParam;
  value: unknown;
  onChange: (v: unknown) => void;
  onClear?: () => void;
  inheritedColor?: string | null;
  colorFormat?: ColorFormat;
  /** Whose files the option previews belong to; absent ⇒ the plain dropdown. */
  templateId?: string;
}) {
  const fieldId = `design-param-${param.key}`;
  const dark = useDarkInterface();
  if (param.type === "text") {
    const v = typeof value === "string" ? value : "";
    return (
        <Input
          id={fieldId}
          size="m"
          fullWidth
          label={param.label}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`design-param-input-${param.key}`}
        />
    );
  }
  if (param.type === "color") {
    // What the author has explicitly set — the only thing that gets saved.
    const override = typeof value === "string" && value ? value : null;
    // What the template paints with when the author sets nothing: its manifest
    // default, else the token from its stylesheet. Showing this (rather than a
    // black placeholder) is what makes the field agree with the rendered test.
    const inherited =
      ((param.default as string | undefined) ?? "") || inheritedColor || "";
    const effective = override ?? inherited;
    const hexValue = toHex(effective, "#000000");
    return (
      <>
        <label
          className="ou-formfield__lbl"
          htmlFor={fieldId}
          id={`${fieldId}-label`}
        >
          {param.label}
        </label>
        <div className="design-color-field">
          <ColorPicker
            id={fieldId}
            value={hexValue}
            aria-labelledby={`${fieldId}-label`}
            // Round-trip through the format THIS template stores: `effective`
            // carries it when the template ships a palette, `colorFormat` (from
            // the manifest) decides when there is nothing to infer from.
            onChange={(hex) => onChange(fromHex(hex, effective, colorFormat))}
            data-testid={`design-param-input-${param.key}`}
          />
          {override === null ? (
            <span
              className="design-color-field__origin"
              data-testid={`design-param-inherited-${param.key}`}
            >
              из шаблона
            </span>
          ) : (
            // Without this an override is a one-way door: the author can repaint
            // the colour but never hand it back to the template's own palette.
            <Button
              variant="ghost"
              size="s"
              onClick={() => onClear?.()}
              data-testid={`design-param-reset-${param.key}`}
            >
              Вернуть из шаблона
            </Button>
          )}
        </div>
      </>
    );
  }
  if (param.type === "boolean") {
    const v = typeof value === "boolean" ? value : Boolean(param.default ?? false);
    return (
        <Switch
          id={fieldId}
          label={param.label}
          checked={v}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`design-param-input-${param.key}`}
        />
    );
  }
  if (param.type === "select") {
    const opts = param.options ?? [];
    const v = typeof value === "string" ? value : (param.default as string) ?? opts[0] ?? "";
    // A template may ship a picture per option (`optionPreviews`). Then the choice is
    // between LOOKS, and a dropdown of words cannot show it — the author would pick
    // «B2O» blind and check the result in a preview. Cards instead, styled like the
    // template gallery so one visual choice reads the same across the tab.
    const previews = param.optionPreviews;
    if (previews && templateId && opts.some((o) => previews[o])) {
      return (
        <fieldset className="tpl-choice" data-testid={`design-param-input-${param.key}`}>
          <legend className="tpl-choice__legend">{param.label}</legend>
          <div className="tpl-choice__grid">
            {opts.map((o) => {
              const url = templateAssetUrl(templateId, previewForTheme(previews[o], dark));
              const label = param.optionLabels?.[o] ?? o;
              return (
                <label
                  key={o}
                  className={`tpl-gallery-card tpl-choice__card${v === o ? " is-selected" : ""}`}
                  data-testid={`design-param-option-${param.key}-${o}`}
                >
                  <input
                    type="radio"
                    className="tpl-choice__input"
                    name={fieldId}
                    value={o}
                    checked={v === o}
                    onChange={() => onChange(o)}
                  />
                  <span className="tpl-choice__thumb">
                    {url ? (
                      <img className="tpl-choice__img" src={url} alt="" loading="lazy" />
                    ) : (
                      // Вариант без картинки — «ничего не показывать» и есть его смысл
                      // («Без логотипа»). Пустая плитка читалась бы как незагрузившееся
                      // изображение, поэтому в ней стоит перечёркнутый квадрат.
                      <SquareOff className="tpl-choice__empty" size={28} aria-hidden="true" />
                    )}
                  </span>
                  <span className="tpl-gallery-card__body">
                    <span className="tpl-gallery-card__name">{label}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }
    return (
        <Select<string>
          id={fieldId}
          size="m"
          fullWidth
          label={param.label}
          value={v}
          options={opts.map((o) => ({ value: o, label: param.optionLabels?.[o] ?? o }))}
          onChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
    );
  }
  if (param.type === "number") {
    const v =
      typeof value === "number"
        ? value
        : typeof param.default === "number"
          ? param.default
          : 0;
    return (
        <NumberInput
          id={fieldId}
          size="m"
          label={param.label}
          value={v}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
    );
  }
  if (param.type === "url") {
    const v = typeof value === "string" ? value : (param.default as string) ?? "";
    return (
        <Input
          id={fieldId}
          type="url"
          size="m"
          fullWidth
          label={param.label}
          placeholder="https://…"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`design-param-input-${param.key}`}
          suffix={
            v && /^https?:\/\//i.test(v) ? (
              <IconButton
                icon={<ExternalLink width={14} height={14} aria-hidden="true" />}
                aria-label={`Открыть ${v} в новой вкладке`}
                variant="ghost"
                size="s"
                onClick={() => window.open(v, "_blank", "noopener,noreferrer")}
                data-testid={`design-param-input-${param.key}-open`}
              />
            ) : undefined
          }
        />
    );
  }
  if (param.type === "multiselect") {
    const opts = param.options ?? [];
    const arr = Array.isArray(value)
      ? (value as string[])
      : Array.isArray(param.default)
        ? ((param.default as unknown[]).filter((x) => typeof x === "string") as string[])
        : [];
    return (
        <Combobox<string>
          id={fieldId}
          size="m"
          fullWidth
          multiple
          label={param.label}
          values={arr}
          options={opts.map((o) => ({ value: o, label: param.optionLabels?.[o] ?? o }))}
          onValuesChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
    );
  }
  if (
    param.type === "image" ||
    param.type === "asset" ||
    param.type === "file" ||
    param.type === "downloadLink"
  ) {
    return (
      <MediaParamRow
        param={param}
        value={value}
        onChange={onChange}
        fieldId={fieldId}
      />
    );
  }
  return (
    <>
      <label className="ou-formfield__lbl">{param.label}</label>
      <Banner
        tone="info"
        size="sm"
        description={`Тип «${param.type}» не поддерживается этой версией редактора.`}
        data-testid={`design-param-unsupported-${param.key}`}
      />
    </>
  );
}

/**
 * PRD-7 S12-G4: shared row for media-typed params (image / asset / file /
 * downloadLink). Reads/writes the {@link MediaParamValue} envelope. Upload
 * goes through `POST /api/media/upload` (multer disk storage) which returns
 * `{ url, mime, originalName, size }`. The hidden file input is triggered by
 * a DS Button; the chosen file's name is shown as a chip with a remove (×)
 * action.
 */
function MediaParamRow({
  param,
  value,
  onChange,
  fieldId,
}: {
  param: TemplateParam;
  value: unknown;
  onChange: (v: unknown) => void;
  fieldId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored: MediaParamValue | null =
    value && typeof value === "object" && (value as MediaParamValue).url
      ? (value as MediaParamValue)
      : null;

  const acceptDefault =
    param.type === "image"
      ? "image/png,image/jpeg,image/svg+xml,image/webp"
      : undefined;
  const accept = param.accept ?? acceptDefault;
  const maxSizeKb = param.maxSizeKb ?? (param.type === "image" ? 512 : 5 * 1024);

  const buttonLabel: Record<typeof param.type, string> = {
    image: stored ? "Заменить изображение" : "Загрузить изображение",
    asset: stored ? "Заменить файл" : "Выбрать из медиатеки",
    file: stored ? "Заменить файл" : "Загрузить файл",
    downloadLink: stored ? "Заменить файл" : "Добавить файл",
    // The four-key record covers the only types this component handles.
    text: "",
    color: "",
    boolean: "",
    select: "",
    multiselect: "",
    number: "",
    url: "",
  };

  const Icon =
    param.type === "image"
      ? ImageIcon
      : param.type === "downloadLink"
        ? Download
        : Paperclip;

  async function handleFile(file: File) {
    setError(null);
    if (file.size > maxSizeKb * 1024) {
      setError(
        `Файл превышает ${maxSizeKb < 1024 ? `${maxSizeKb} КБ` : `${Math.round(maxSizeKb / 1024)} МБ`}.`,
      );
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        url: string;
        mime: string;
        originalName: string;
        size: number;
      };
      const next: MediaParamValue = {
        url: body.url,
        name: body.originalName,
        mime: body.mime,
        size: body.size,
      };
      onChange(next);
    } catch (err) {
      setError((err as Error)?.message ?? "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <label className="ou-formfield__lbl" htmlFor={fieldId}>
        {param.label}
      </label>
      <div className="design-media-row">
        <Button
          id={fieldId}
          variant="secondary"
          size="s"
          leadingIcon={<Upload width={12} height={12} aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
          data-testid={`design-param-input-${param.key}`}
        >
          {uploading ? "Загрузка…" : buttonLabel[param.type]}
        </Button>
        {stored && (
          <span
            className="design-media-chip"
            data-testid={`design-param-chip-${param.key}`}
          >
            <Icon className="design-media-chip__ico" width={14} height={14} aria-hidden="true" />
            <span className="design-media-chip__name">{stored.name}</span>
            <IconButton
              icon={<X width={12} height={12} aria-hidden="true" />}
              aria-label={`Удалить файл ${stored.name}`}
              variant="ghost"
              size="s"
              onClick={() => onChange(null)}
              data-testid={`design-param-chip-${param.key}-remove`}
            />
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
          data-testid={`design-param-input-${param.key}-file`}
        />
      </div>
      {param.type === "image" && (
        <div className="ou-formfield__desc">
          PNG, JPEG, SVG или WebP; до {maxSizeKb < 1024 ? `${maxSizeKb} КБ` : `${Math.round(maxSizeKb / 1024)} МБ`}.
        </div>
      )}
      {param.type === "downloadLink" && (
        <div className="ou-formfield__desc">
          Файл будет доступен обучающемуся по ссылке после прохождения.
        </div>
      )}
      {error && (
        <Banner
          tone="error"
          size="sm"
          description={error}
          data-testid={`design-param-error-${param.key}`}
        />
      )}
    </>
  );
}

/**
 * Inline-only error display for design save failures. The action controls
 * (Save / Revert) live in the shared drawer footer per wireframe — there
 * is no per-pane save button. We only surface the error so the user can
 * see why the unified save failed.
 */
function DesignSaveError({ design }: { design: UseDesignSettingsResult }) {
  if (!design.saveError) return null;
  return (
    <Banner
      tone="error"
      description={design.saveError.message}
      data-testid="design-save-error"
    />
  );
}
