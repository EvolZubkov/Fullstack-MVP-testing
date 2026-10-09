/**
 * @module features/tests/editor/sections/item-unlock-fields
 * @description «Открывается» и «Каких пунктов» в свойствах пункта роутера — темы и сценария
 * одинаково («Сценарий в ИС», техдолг №8; согласованный эскиз
 * `docs/wireframes/sim-scenario-test-editor.html`, состояния «роутер: открывается (тема)»,
 * «условия открытия», «после успешного прохождения», «кольцо не предлагается»).
 *
 * Правило хранится в `flowPolicyJson.router.sectionUnlockRules[<ключ пункта>]`. «Сразу» — это
 * ОТСУТСТВИЕ правила, а не правило `always_available`: так пункт без условия выглядит в данных так
 * же, как пункт теста, сохранённого до появления поля.
 *
 * В «Каких пунктов» не предлагаются сам пункт и пункты, которые уже (прямо или через цепочку) ждут
 * его: выбор такого пункта замкнул бы кольцо, и ни один пункт кольца не открылся бы. Почему их нет
 * в списке — говорит подсказка в подвале.
 */
import { useMemo } from "react";
import { Combobox, Select } from "@skillum/ui-kit";
import { unlockDependents, type UnlockRuleMap } from "@shared/flow/unlock-rules";
import type { RouterUnlockRule } from "../test-editor.types";

/** Пункт состава, каким его видит список «Каких пунктов». */
export interface UnlockItemOption {
  /** Ключ правила: голый `topicId` у темы, `scenario:<id>` у сценария. */
  key: string;
  /** Номер в составе. */
  number: number;
  name: string;
}

type UnlockMode = "always" | "after_sections_completed" | "after_sections_passed";

const MODE_OPTIONS: Array<{ value: UnlockMode; label: string }> = [
  { value: "always", label: "Сразу" },
  { value: "after_sections_completed", label: "После завершения пунктов" },
  { value: "after_sections_passed", label: "После успешного прохождения пунктов" },
];

export interface ItemUnlockFieldsProps {
  /** Ключ этого пункта. */
  itemKey: string;
  /** Вид пункта — для слов подсказки («этой темы» / «этого сценария»). */
  kind: "topic" | "scenario";
  /** Все пункты состава по порядку. */
  items: UnlockItemOption[];
  rules: Readonly<Record<string, RouterUnlockRule>>;
  /** Новое правило пункта; `null` — «Сразу», правила нет. */
  onChange: (next: RouterUnlockRule | null) => void;
  /** Адрес ошибок поля (`sections[i].unlock` / `scenarioItems[i].unlock`). */
  field: string;
  error?: string;
}

/** Подпись пункта в списке и в подсказке — номер и название, как в составе. */
function itemLabel(item: UnlockItemOption): string {
  return `${item.number}. ${item.name}`;
}

/** Поля правила открытия пункта роутера. */
export function ItemUnlockFields(props: ItemUnlockFieldsProps) {
  const rule = props.rules[props.itemKey];
  const mode: UnlockMode =
    rule && (rule.mode === "after_sections_completed" || rule.mode === "after_sections_passed") ? rule.mode : "always";
  const selected = rule && "sectionIds" in rule ? rule.sectionIds : [];

  const { options, blocked } = useMemo(() => {
    const dependents = unlockDependents(props.rules as UnlockRuleMap, props.itemKey);
    const others = props.items.filter((item) => item.key !== props.itemKey);
    // Уже выбранный пункт, ставший недопустимым (его правило поменяли позже), из выбора молча
    // не выпадает и остаётся читаемым чипом: кольцо поймает проверка и назовёт его.
    const chosen = new Set(selected);
    return {
      options: others
        .filter((item) => !dependents.has(item.key) || chosen.has(item.key))
        .map((item) => ({ value: item.key, label: itemLabel(item) })),
      blocked: others.filter((item) => dependents.has(item.key) && !chosen.has(item.key)),
    };
  }, [props.rules, props.items, props.itemKey, selected]);

  const own = props.kind === "scenario" ? "этого сценария" : "этой темы";
  const footerHint =
    blocked.length === 0
      ? undefined
      : blocked.length === 1
        ? `Не предлагается «${itemLabel(blocked[0])}»: он сам открывается после ${own}.`
        : `Не предлагаются ${blocked.map((item) => `«${itemLabel(item)}»`).join(", ")}: они сами открываются после ${own}.`;

  return (
    <>
      <div className="ou-formfield" data-field={props.field}>
        <Select
          size="m"
          fullWidth
          label="Открывается"
          value={mode}
          options={MODE_OPTIONS}
          onChange={(next) => {
            if (next === "always") props.onChange(null);
            else props.onChange({ mode: next as Exclude<UnlockMode, "always">, sectionIds: selected });
          }}
          data-testid={`unlock-mode-${props.itemKey}`}
        />
      </div>
      {mode !== "always" && (
        <div className="ou-formfield">
          <Combobox
            size="m"
            fullWidth
            multiple
            label="Каких пунктов"
            placeholder="Выберите пункты"
            options={options}
            values={selected}
            onValuesChange={(values) => props.onChange({ mode, sectionIds: values })}
            footerHint={footerHint}
            // Пусто бывает и без запроса — когда каждый пункт замкнул бы кольцо; почему — в подвале.
            emptyTitle={options.length === 0 ? "Выбрать не из чего" : undefined}
            emptyMessage={options.length === 0 ? "Другие пункты состава сами открываются после этого." : undefined}
            error={props.error}
            data-testid={`unlock-items-${props.itemKey}`}
          />
        </div>
      )}
    </>
  );
}
