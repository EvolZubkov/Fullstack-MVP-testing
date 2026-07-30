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

import { useState } from "react";
import {
  Banner,
  Card,
  CardBody,
  CardHeader,
  Input,
  NumberInput,
  Select,
  Switch,
} from "@universityrt/ui-kit";
import type { ReportSettings } from "@shared/schema";
import {
  useReportVariants,
  reportVariantSwitch,
  type ReportSettingDecl,
  type ReportVariantOption,
} from "../use-report-variants";

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
  // предпросмотром, а до него автор вправе указать уже загруженный файл.
  return (
    <div className="ou-formfield">
      <Input
        id={id}
        size="m"
        fullWidth
        label={label}
        hint={field.description}
        value={String(value ?? "")}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Карточка настроек отчёта.
 *
 * @param mode Режим теста: определяет ВИД отчёта, виды другого режима не предлагаются (D-5).
 * @param draftTemplateId Черновой шаблон вкладки «Оформление».
 * @param value Текущий срез `report` черновика редактора.
 * @param onChange Обновление среза (одна кнопка «Сохранить» на весь ящик).
 * @param readOnly Опубликованный тест не редактируется.
 */
export function ReportSettingsCard(props: {
  mode: "standard" | "adaptive";
  draftTemplateId?: string;
  value: ReportSettings;
  onChange: (next: ReportSettings) => void;
  readOnly?: boolean;
}) {
  const branchKey = props.mode === "adaptive" ? "adaptive" : "standard";
  const branch = props.value?.[branchKey] ?? null;
  const catalogue = useReportVariants(props.draftTemplateId, undefined, props.mode, branch?.variantKey);
  const [dropped, setDropped] = useState<string[]>([]);

  const values = branch?.values ?? {};

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

  const onFieldChange = (key: string, value: unknown) => {
    const variantKey = catalogue.selected?.key;
    if (!variantKey) return;
    setBranch(variantKey, { ...values, [key]: value });
  };

  return (
    <Card variant="outlined" size="sm" data-testid="report-settings-card">
      <CardHeader title="Отчёт о результатах" />
      <CardBody>
        <div className="tb-feedback-block">
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
              <div className="ou-formfield">
                <Select<string>
                  id="report-variant"
                  size="m"
                  fullWidth
                  label="Вид отчёта"
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

              {dropped.length > 0 && (
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

              {catalogue.fields.length > 0 && (
                <div className="ou-formfield">
                  <label className="ou-formfield__lbl">Параметры вида</label>
                  <div className="tb-report-fields">
                    {catalogue.fields.map((f) => (
                      <ReportField
                        key={f.key}
                        field={f}
                        value={values[f.key]}
                        disabled={props.readOnly}
                        onChange={(v) => onFieldChange(f.key, v)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
