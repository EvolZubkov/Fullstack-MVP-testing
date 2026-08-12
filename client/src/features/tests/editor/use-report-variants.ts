/**
 * @module features/tests/editor/use-report-variants
 *
 * PRD-27 Фаза 3 — каталог вариантов ОТЧЁТА для блока обратной связи.
 *
 * Считается на ЧЕРНОВОМ `templateId` вкладки «Оформление», а не на сохранённом: смена
 * шаблона там меняет набор доступных видов отчёта НЕМЕДЛЕННО, до сохранения, иначе автор
 * выбирает из списка, которого после сохранения не будет (§4.2, риск R-5). Та же схема,
 * что у каталога вариантов страниц (`use-content-pages`).
 *
 * Ключ запроса — СВОЙ (`"record"`), не общий с `use-content-pages` (`"content-templates"`):
 * тому нужен голый массив вариантов, а подсказке под селектором — ещё и название шаблона,
 * то есть запись целиком. Общий ключ на две разные формы означал бы, что содержимое кэша
 * определяет тот из хуков, кто сходил первым, — и один из них молча читал бы пустоту.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  reportKindForMode,
  carriedOverSettingKeys,
  resolveReportValues,
  type ReportVariantDecl,
} from "@shared/report/report-variants";

/** Поле варианта, как его объявляет манифест (подмножество `settings[]`). */
export interface ReportSettingDecl {
  key: string;
  type: string;
  label?: string;
  description?: string;
  default?: unknown;
  options?: Array<{ value: string; label?: string } | string>;
}

/** Вариант отчёта с полями — то, чем оперирует блок настроек. */
export interface ReportVariantOption extends ReportVariantDecl {
  settings?: ReportSettingDecl[];
}

/** Шаблон, каким его отдаёт реестр: имя для подсказки и объявленные варианты. */
interface TemplateCatalogue {
  name: string | undefined;
  variants: ReportVariantOption[];
}

async function fetchTemplateVariants(templateId: string): Promise<TemplateCatalogue> {
  const res = await fetch(`/api/templates/${templateId}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load template ${templateId}: ${res.status}`);
  const data = (await res.json()) as {
    name?: string;
    manifest?: { contentTemplates?: ReportVariantOption[] };
  };
  return { name: data.name, variants: data.manifest?.contentTemplates ?? [] };
}

/** Что блок настроек получает от хука. */
export interface UseReportVariantsResult {
  /** Варианты вида, соответствующего режиму теста, в порядке объявления. */
  variants: ReportVariantOption[];
  /** Шаблон вида не объявил: отчёт соберётся по макету «Стандартного» (FR-15). */
  none: boolean;
  /** Каталог ещё грузится — селектор показывать рано. */
  loading: boolean;
  /** Идентификатор шаблона-источника (ключ запроса, в UI не показывается). */
  templateId: string | undefined;
  /**
   * НАЗВАНИЕ шаблона-источника для подсказки под селектором. Автору показываем именно
   * его: `default` — служебный идентификатор, ни о чём ему не говорящий. Пока каталог не
   * пришёл, названия нет — подсказка ждёт, а не показывает ключ.
   */
  templateName: string | undefined;
  /** Поля выбранного варианта; пусто, когда выбор недоступен. */
  fields: ReportSettingDecl[];
  /** Выбранный вариант (авторский выбор, иначе `isDefault`, иначе первый). */
  selected: ReportVariantOption | null;
}

/**
 * Каталог вариантов отчёта для режима теста.
 *
 * @param draftTemplateId Черновой шаблон вкладки «Оформление» (приоритет).
 * @param savedTemplateId Сохранённый шаблон теста.
 * @param mode Режим теста: определяет ВИД отчёта (D-5).
 * @param selectedKey Ключ, выбранный автором.
 */
export function useReportVariants(
  draftTemplateId: string | undefined,
  savedTemplateId: string | undefined,
  mode: "standard" | "adaptive",
  selectedKey?: string | null,
): UseReportVariantsResult {
  const templateId = draftTemplateId || savedTemplateId || "default";
  const query = useQuery({
    queryKey: ["templates", templateId, "record"],
    queryFn: () => fetchTemplateVariants(templateId),
    enabled: Boolean(templateId),
  });

  const kind = reportKindForMode(mode);
  const variants = useMemo(
    () =>
      (query.data?.variants ?? []).filter(
        (v) => v.kind === kind && typeof v.key === "string" && v.key.length > 0,
      ),
    [query.data, kind],
  );

  const selected = useMemo(() => {
    if (variants.length === 0) return null;
    return (
      (selectedKey ? variants.find((v) => v.key === selectedKey) : undefined) ??
      variants.find((v) => v.isDefault === true) ??
      variants[0]
    );
  }, [variants, selectedKey]);

  return {
    variants,
    none: !query.isLoading && variants.length === 0,
    loading: query.isLoading,
    templateId,
    templateName: query.data?.name,
    fields: (selected?.settings ?? []) as ReportSettingDecl[],
    selected,
  };
}

/**
 * Что произойдёт при переходе на другой вариант: какие значения переживут смену, а какие
 * автор потеряет (FR-14). Потери называются по ИМЕНАМ полей — ключ автору ни о чём не
 * говорит.
 *
 * @param from Текущий вариант.
 * @param to Вариант, на который переходят.
 * @param values Текущие значения полей.
 */
export function reportVariantSwitch(
  from: ReportVariantOption | null,
  to: ReportVariantOption | null,
  values: Record<string, unknown>,
): { nextValues: Record<string, unknown>; droppedLabels: string[] } {
  const carried = new Set(carriedOverSettingKeys(from, to));
  const kept: Record<string, unknown> = {};
  for (const key of carried) {
    if (values[key] !== undefined) kept[key] = values[key];
  }
  const droppedLabels = (from?.settings ?? [])
    .filter((f) => !carried.has(f.key))
    .map((f) => f.label || f.key);
  return { nextValues: resolveReportValues(to, kept), droppedLabels };
}
