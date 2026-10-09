/**
 * @module features/tests/editor/sections/report-settings-card
 *
 * PRD-27 Фаза 3 — карточка «Отчёт о результатах» в блоке обратной связи вкладки
 * «Настройки». Эскиз: `docs/wireframes/approved/prd27-report-template.html`.
 *
 * Состав ровно как в эскизе: селектор вида, поля `settings[]` выбранного вида и
 * предупреждение о теряемых значениях при смене. Виды предлагает АКТИВНЫЙ шаблон, причём
 * считается ЧЕРНОВОЙ `templateId` вкладки «Оформление» — иначе автор выбирает из списка,
 * которого после сохранения не будет (§4.2, риск R-5).
 */

import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormSection,
  Input,
  NumberInput,
  Select,
  Switch,
  Tag,
} from "@skillum/ui-kit";
import type { ReportSettings } from "@shared/schema";
import type { ReportPreviewSection, ReportPreviewTest } from "@shared/report/report-preview";
import {
  useReportVariants,
  reportVariantSwitch,
  type ReportSettingDecl,
  type ReportVariantOption,
} from "../use-report-variants";
import { resolveReportValues } from "@shared/report/report-variants";
import { fieldsOfScope, type ReportFieldScope } from "@shared/report/report-field-scope";
import { ReportPreviewModal } from "./report-preview-modal";
import { ReportDocumentList } from "./report-document-list";
import { ReportVariantModal } from "./report-variant-modal";
import { ReportBlockPalette } from "./report-block-palette";
import { ReportBlockFields } from "./report-block-fields";
import { insertBlock, initialReportDraft, type DraftBlock } from "../use-report-document";
import { reportKindForMode } from "@shared/report/report-variants";
import type { ContentTemplatePlaceholder } from "../use-content-pages";

/** Одно поле варианта: тип решает, каким компонентом дизайн-системы его показать. */
function ReportField(props: {
  field: ReportSettingDecl;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const { field, value } = props;
  const id = `report-field-${field.key}`;
  const label = field.label || field.key;

  if (field.type === "boolean") {
    return (
      <div className="ou-formfield">
        <Switch
          id={id}
          label={label}
          description={field.description}
          checked={!!value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked)}
        />
      </div>
    );
  }

  if (field.type === "select") {
    const options = (field.options ?? []).map((o) =>
      typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label || o.value },
    );
    return (
      <div className="ou-formfield">
        <Select<string>
          id={id}
          size="m"
          fullWidth
          label={label}
          hint={field.description}
          value={String(value ?? "")}
          options={options}
          disabled={props.disabled}
          onChange={(next) => props.onChange(next)}
        />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="ou-formfield">
        <NumberInput
          id={id}
          size="m"
          label={label}
          hint={field.description}
          // Контролируемое поле требует числа: незаполненное значение — 0, а не null.
          value={typeof value === "number" ? value : 0}
          disabled={props.disabled}
          onChange={(next) => props.onChange(next)}
        />
      </div>
    );
  }

  // `image` показывается адресом файла: загрузчик медиа приходит в Фазе 4 вместе с
  // предпросмотром, а до него автор вправе указать уже загруженный файл. Пустое поле —
  // это НЕ «картинки нет»: отчёт возьмёт файл шаблона (FR-05), поэтому дефолт варианта
  // показывается заполнителем, а в черновик не пишется — иначе значение застыло бы и
  // перестало следовать за шаблоном.
  const templateDefault = typeof field.default === "string" ? field.default : "";
  return (
    <div className="ou-formfield">
      <Input
        id={id}
        size="m"
        fullWidth
        label={label}
        hint={field.description}
        placeholder={templateDefault ? `Из шаблона: ${templateDefault}` : undefined}
        value={String(value ?? "")}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Карточка настроек отчёта — ОДНА СТОРОНА за раз.
 *
 * Настройки отчёта разложены по двум экранам редактора, потому что отвечают на разные
 * вопросы: «что получит слушатель» автор ищет в «Настройках», рядом с обратной связью, а
 * «как это выглядит» — в «Оформлении», рядом с шаблоном и брендингом. Компонент один:
 * каталог видов, перенос значений при смене вида и предпросмотр у обеих сторон общие, и
 * разводить их по двум копиям значило бы чинить каждую правку дважды.
 *
 * Поля вида делит САМ ШАБЛОН признаком `scope` ({@link module:shared/report/report-field-scope}).
 *
 * @param scope Какую сторону показывает этот экземпляр: содержание или оформление.
 * @param mode Режим теста: определяет ВИД отчёта, виды другого режима не предлагаются (D-5).
 * @param draftTemplateId Черновой шаблон вкладки «Оформление».
 * @param value Текущий срез `report` черновика редактора.
 * @param onChange Обновление среза (одна кнопка «Сохранить» на весь ящик).
 * @param readOnly Опубликованный тест не редактируется.
 * @param designParams Черновые параметры оформления — брендинг предпросмотра.
 * @param testName Название редактируемого теста (реальное, FR-18).
 * @param sections Разделы редактируемого теста (реальные, FR-18).
 * @param levelNames Лестница уровней адаптивного теста.
 */
export function ReportSettingsCard(props: {
  scope?: ReportFieldScope;
  mode: "standard" | "adaptive";
  draftTemplateId?: string;
  value: ReportSettings;
  onChange: (next: ReportSettings) => void;
  readOnly?: boolean;
  designParams?: Record<string, unknown>;
  testName?: string;
  /** Заголовки итога теста — свойства узла «Итоги теста»; уходят в предпросмотр. */
  headings?: ReportPreviewTest["headings"];
  /** Настройка показа подытогов теста; уходит в предпросмотр. */
  breakdownDisplay?: ReportPreviewTest["breakdownDisplay"];
  /** Группы тем теста; уходят в предпросмотр. */
  sectionGroups?: ReportPreviewTest["sectionGroups"];
  /** Вводные блоки теста (PRD-61 FR-23); уходят в предпросмотр. */
  intro?: ReportPreviewTest["intro"];
  sections?: ReportPreviewSection[];
  levelNames?: string[];
  /**
   * PRD-51: строки документа, ПРИШЕДШИЕ ИЗ БАЗЫ, для этой ветви режима. Пусто — тест
   * документа не собирал, и показывается документ по умолчанию шаблона.
   */
  savedDocument?: DraftBlock[];
  /** Черновик автора; `undefined` — документ ещё не правился в этой сессии. */
  document?: DraftBlock[];
  onDocumentChange?: (next: DraftBlock[]) => void;
}) {
  const scope: ReportFieldScope = props.scope ?? "appearance";
  const isContent = scope === "content";
  const branchKey = props.mode === "adaptive" ? "adaptive" : "standard";
  const branch = props.value?.[branchKey] ?? null;
  const kind = reportKindForMode(props.mode);
  const catalogue = useReportVariants(props.draftTemplateId, undefined, props.mode, branch?.variantKey);
  const [dropped, setDropped] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Позиция, с которой открыли палитру: блок встаёт ИМЕННО туда, откуда его добавляли.
  const [addAt, setAddAt] = useState<number | null>(null);
  /** Строка, у которой меняют вариант блока; `null` — окно закрыто. */
  const [variantAt, setVariantAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const values = branch?.values ?? {};
  // Поля этой стороны — в порядке объявления шаблоном. Сторона без единого поля вовсе не
  // рисует список: пустая подпись «Параметры вида» ничего не сообщает.
  const fields = fieldsOfScope(catalogue.fields, scope);
  // Отсутствие признака = выдавать: до этой настройки отчёт получал каждый (см.
  // `isReportEnabled`), и переключатель обязан открываться в том же положении.
  const enabled = props.value?.enabled !== false;

  const setBranch = (variantKey: string, nextValues: Record<string, unknown>) => {
    props.onChange({ ...props.value, [branchKey]: { variantKey, values: nextValues } });
  };

  const onPickVariant = (key: string) => {
    const next = catalogue.variants.find((v) => v.key === key) ?? null;
    const { nextValues, droppedLabels } = reportVariantSwitch(
      catalogue.selected as ReportVariantOption | null,
      next,
      values,
    );
    setDropped(droppedLabels);
    if (next) setBranch(next.key, nextValues);
  };

  // Документ показывается один раз разрешённым из СОХРАНЁННЫХ строк, а дальше принадлежит
  // автору: правила §5.1 дописывают и пропускают блоки, и применять их к каждой правке
  // значило бы спорить с автором на каждом нажатии.
  const initialDoc = useMemo(
    () => (catalogue.manifest ? initialReportDraft(catalogue.manifest, kind, props.savedDocument) : null),
    [catalogue.manifest, kind, props.savedDocument],
  );
  const doc = props.document ?? initialDoc;
  const setDoc = props.onDocumentChange ?? (() => {});
  // Манифест объявляет поля как `unknown` (его читает и сервер, и рантайм); редактору
  // нужен разобранный список, и сужение делается ровно здесь, на границе.
  const blockOptions = catalogue.blocks.map((v) => ({
    ...v,
    placeholders: Array.isArray(v.placeholders)
      ? (v.placeholders as ContentTemplatePlaceholder[])
      : undefined,
  }));
  /** Поля варианта, выбранного строкой; у блока без варианта их нет. */
  const placeholdersOf = (block: DraftBlock): ContentTemplatePlaceholder[] => {
    const forBlock = catalogue.blocks.filter((v) => v.block === block.block);
    const variant = forBlock.find((v) => v.key === block.templateKey) ?? forBlock.find((v) => v.isDefault);
    return Array.isArray(variant?.placeholders) ? (variant.placeholders as ContentTemplatePlaceholder[]) : [];
  };

  const onFieldChange = (key: string, value: unknown) => {
    const variantKey = catalogue.selected?.key;
    if (!variantKey) return;
    setBranch(variantKey, { ...values, [key]: value });
  };

  return (
    // Эскиз рисует блок разделом, а не обведённой карточкой: рамка вокруг раздела была
    // второй границей на том же месте (находка E-25).
    <FormSection
      stacked
      title={isContent ? "Отчёт о результатах" : "Оформление отчёта"}
      data-testid={isContent ? "report-content-card" : "report-settings-card"}
    >
        <div className="tb-feedback-block">
          {/* Выдавать ли документ вообще — вопрос содержания, а не облика, поэтому
              переключатель стоит рядом с обратной связью и только там. Выключенный отчёт
              оставляет свои настройки нетронутыми: автор вернёт кнопку, ничего не
              перенастраивая. */}
          {isContent && (
            <div className="ou-formfield">
              <Switch
                id="report-enabled"
                label="Выдавать отчёт обучающемуся"
                checked={enabled}
                disabled={props.readOnly}
                onChange={(e) => props.onChange({ ...props.value, enabled: e.target.checked })}
                data-testid="report-enabled-switch"
              />
            </div>
          )}

          {/* Пока каталог грузится, пустой отключённый селектор показывать нельзя: автор
              видит мигающий контрол без вариантов и не понимает, есть ли выбор вообще. */}
          {catalogue.loading ? (
            <div className="ou-formfield__desc">Загружаем виды отчёта…</div>
          ) : catalogue.none ? (
            <Banner
              tone="info"
              title="Шаблон не предлагает видов отчёта"
              description="Отчёт будет собран по виду шаблона «Стандартный», с цветами и логотипом этого теста. Настраиваемых параметров у него нет."
            />
          ) : (
            <>
              {/* Вид отчёта отвечает на вопрос «ЧТО в нём будет» — итоги, разбор по
                  темам, сертификат, — поэтому живёт он рядом с содержанием. «Оформление»
                  отвечает за шаблон и за то, КАК это показано, и лишь называет
                  выбранный вид, чтобы автор знал, к чему относятся его параметры. */}
              {isContent && (
                <div className="ou-formfield">
                  <Select<string>
                    id="report-variant"
                    size="m"
                    fullWidth
                    label="Что показывать в отчёте"
                    hint={
                      catalogue.templateName
                        ? `Виды предлагает шаблон оформления «${catalogue.templateName}»`
                        : "Виды предлагает шаблон оформления теста"
                    }
                    value={catalogue.selected?.key ?? ""}
                    options={catalogue.variants.map((v) => ({ value: v.key, label: v.label || v.key }))}
                    disabled={props.readOnly}
                    onChange={onPickVariant}
                  />
                </div>
              )}
              {!isContent && catalogue.selected && (
                <div className="ou-formfield">
                  <span className="ou-formfield__lbl">Вид отчёта</span>
                  <div data-testid="report-variant-readonly">
                    <Tag variant="outline">{catalogue.selected.label || catalogue.selected.key}</Tag>
                  </div>
                  <span className="ou-formfield__desc">
                    Выбирается во вкладке «Обратная связь и итоги», раздел «Отчёт».
                  </span>
                </div>
              )}

              {/* Предупреждение идёт за ВЫБОРОМ вида, а не за полями: теряет значения тот,
                  кто меняет вид, и узнать об этом он должен там, где меняет. Среди
                  потерянных бывают и поля оформления — тем более важно сказать здесь. */}
              {dropped.length > 0 && isContent && (
                <div data-testid="report-drop-warning">
                  <Banner
                    tone="warning"
                    title="Часть параметров не переносится"
                    description={`Выбранный вид не имеет полей ${dropped
                      .map((d) => `«${d}»`)
                      .join(", ")} — их значения будут отброшены.`}
                  />
                </div>
              )}

              {/* Карточка с шапкой, а не `ou-formfield__lbl`: «Параметры вида» — заголовок
                  ГРУППЫ полей, а подпись поля рисуется ровно так же, как подписи полей
                  внутри неё, и два уровня иерархии сливались в один. Карточка взята у
                  соседа по экрану — «Заголовки и подписи отчёта» (см. `design-section`),
                  чтобы обе группы этой вкладки выглядели одинаково. */}
              {fields.length > 0 && (
                <Card variant="outlined" size="sm">
                  <CardHeader title="Параметры вида" />
                  <CardBody>
                    <div className="tb-report-fields">
                      {fields.map((f) => (
                        <ReportField
                          key={f.key}
                          field={f}
                          value={values[f.key]}
                          disabled={props.readOnly}
                          onChange={(v) => onFieldChange(f.key, v)}
                        />
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}
            </>
          )}

          {/* PRD-51: ДОКУМЕНТ — состав и порядок блоков отчёта. Живёт на стороне
              содержания: что напечатать и в каком порядке — вопрос смысла, а не облика.
              Шаблон, блоков не объявивший, документа не показывает вовсе: печатать он
              будет цельную раскладку, и двигать в нём нечего (§5.4). */}
          {isContent && doc !== null && (
            <>
              <ReportDocumentList
                blocks={doc}
                variants={blockOptions}
                onChange={setDoc}
                onAdd={setAddAt}
                readOnly={props.readOnly}
                onReplaceVariant={(i) => setVariantAt(i)}
                expandedIndex={expanded}
                onToggleExpand={(i) => setExpanded(expanded === i ? null : i)}
                renderExpanded={(i) => (
                  <ReportBlockFields
                    index={i}
                    block={doc[i]}
                    placeholders={placeholdersOf(doc[i])}
                    readOnly={props.readOnly}
                    onChange={(next) => setDoc(doc.map((b, j) => (j === i ? next : b)))}
                  />
                )}
              />
              {/* Смена варианта БЛОКА: состав документа при этом не меняется, поэтому
                  своё окно, а не палитра добавления. */}
              <ReportVariantModal
                open={variantAt !== null}
                block={variantAt !== null ? doc[variantAt].block : ""}
                current={variantAt !== null ? doc[variantAt].templateKey : null}
                variants={blockOptions}
                onClose={() => setVariantAt(null)}
                onPick={(templateKey) =>
                  setDoc(doc.map((b, j) => (j === variantAt ? { ...b, templateKey } : b)))
                }
              />
              <ReportBlockPalette
                open={addAt !== null}
                onClose={() => setAddAt(null)}
                variants={blockOptions}
                documentBlocks={doc.map((b) => b.block)}
                onPick={(block) => {
                  setDoc(insertBlock(doc, addAt ?? doc.length, block));
                  setAddAt(null);
                }}
              />
            </>
          )}

          {/* Предпросмотр доступен и когда шаблон видов не предлагает: автору важно увидеть
              ИМЕННО то, что уйдёт обучающемуся, — в том числе деградацию к «Стандартному»
              (эскиз, состояние `s-none`). Пока каталог грузится, вида ещё нет.
              Э3.8: кнопка ОДНА, у содержания документа. Второй такой же в «Оформлении» не
              стало: две кнопки с одним окном — это не выбор, а вопрос «какая из них та». */}
          {isContent && !catalogue.loading && (
            <div className="ou-formfield">
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<Eye size={16} aria-hidden="true" />}
                onClick={() => setPreviewOpen(true)}
                data-testid="report-preview-open"
              >
                Предпросмотр отчёта
              </Button>
            </div>
          )}
        </div>

      <ReportPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        mode={props.mode}
        templateId={catalogue.templateId}
        params={props.designParams ?? {}}
        variant={catalogue.selected}
        // FR-20: в предпросмотр уходят значения ЧЕРНОВИКА, а не сохранённые. Поверх
        // умолчаний варианта (FR-04): незаполненное поле показывается ровно так же, как
        // придёт обучающемуся, иначе автор смотрел бы отчёт без подложки и логотипа.
        values={resolveReportValues(catalogue.selected, values)}
        testName={props.testName ?? ""}
        headings={props.headings}
        breakdownDisplay={props.breakdownDisplay}
        sectionGroups={props.sectionGroups}
        intro={props.intro}
        sections={props.sections ?? []}
        levelNames={props.levelNames}
        // PRD-51 FR-18: документ ЧЕРНОВИКА, включая ещё не сохранённый текст страниц.
        // Предпросмотр, показывающий сохранённое, отвечал бы не на тот вопрос, ради
        // которого его открывают.
        document={doc ?? undefined}
      />
    </FormSection>
  );
}
