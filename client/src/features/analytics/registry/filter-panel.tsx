/**
 * @module features/analytics/registry/filter-panel
 * @description PRD-56 FR-02: условия отбора реестра — панелью под кнопкой «Фильтр» (PRD-70
 * FR-70 - FR-78: единая форма фильтра продукта, ui-kit `FilterPanel`; окно «Условия отбора» снято).
 *
 * Условия набираются целиком и применяются разом. Пять полей, меняемых по одному прямо в
 * списке, означали бы перезапрос выборки на каждый щелчок — и мигающий список под руками.
 * Поэтому панель держит СВОЙ черновик и отдаёт его наверх только по «Применить»; закрыть её
 * иначе — и есть отмена.
 *
 * Справочники тестов и групп читаются при открытии: список тестов меняется чаще, чем живёт
 * открытая вкладка аналитики.
 */
import { useEffect, useState, type RefObject } from "react";

import {
  Checkbox, Combobox, FilterPanel, FilterPanelGroup, FormField, Grid, Input, Radio,
} from "@skillum/ui-kit";

import {
  EMPTY_FILTER,
  type RegistryFilter,
  type RegistryOutcome,
  type RegistrySource,
} from "./filter-state";
import { NO_GROUP_ID, NO_GROUP_LABEL } from "@shared/analytics/no-group";
import {
  ATTEMPT_PICKS,
  ATTEMPT_PICK_OPTION_LABEL,
  DEFAULT_ATTEMPT_PICK,
  type AttemptPick,
} from "@shared/analytics/attempt-pick";
import { useRegistryDictionaries, useTestDictionary } from "./use-dictionaries";
import type { OrgField, OrgValueCount } from "@shared/org-fields";

export interface RegistryFilterPanelProps {
  open: boolean;
  /** Кнопка, под которой открывается панель: «Фильтр» полосы или «Изменить условия» среза. */
  anchorRef: RefObject<HTMLElement | null>;
  filter: RegistryFilter;
  onApply: (filter: RegistryFilter) => void;
  onClose: () => void;
  /**
   * Скрыть условие «Тест» (FR-13): на аналитике теста он задан страницей и в условия не
   * входит. Форма отбора при этом та же самая — второй формы условий в продукте нет.
   */
  hideTest?: boolean;
  /**
   * Тест, внутри которого набираются условия, когда его не выбирают в самом окне.
   *
   * Нужен аналитике теста: там тест задан страницей, а вариант и версия — условия ВНУТРИ
   * теста, и без него их не из чего предложить.
   */
  scopeTestId?: string | null;
  /**
   * PRD-66 FR-51: правило попыток — условие психометрики уровня теста. Живёт не в общем фильтре
   * (на «Обзоре» считаются все попытки), но в окне стоит рядом с остальными условиями: снятое
   * чипом, оно иначе не возвращалось (замечание владельца 2026-10-04). Нет — раздела нет.
   *
   * Одно правило из четырёх, а не флажки (дельта 2026-10-07): каждое оставляет участнику одну
   * попытку, и по «И» они противоречили бы друг другу. `bestUnavailable` — у теста нет общего
   * балла (измерительный), и «лучшую» выбрать не по чему.
   */
  attempts?: { value: AttemptPick; onApply: (value: AttemptPick) => void; bestUnavailable?: boolean };
}

const SOURCES: Array<{ value: RegistrySource; label: string }> = [
  { value: "web", label: "Веб" },
  { value: "telemetry", label: "Телеметрия LMS" },
  { value: "import", label: "Импорт" },
];

const OUTCOMES: Array<{ value: RegistryOutcome; label: string }> = [
  { value: "passed", label: "Сдал" },
  { value: "failed", label: "Не сдал" },
  { value: "completed", label: "Завершено без оценки" },
  { value: "incomplete", label: "Не завершено" },
];

/** Добавить или убрать значение из списка условий. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

/** Оргполя окна: поле фильтра, поле справочника, подпись и заглушка — в порядке показа. */
const ORG_FIELDS_OF_DIALOG: ReadonlyArray<{
  key: "organizations" | "units" | "positions";
  field: OrgField;
  label: string;
  placeholder: string;
}> = [
  { key: "organizations", field: "organization", label: "Организация", placeholder: "Все организации" },
  { key: "units", field: "unit", label: "Подразделение", placeholder: "Все подразделения" },
  { key: "positions", field: "position", label: "Должность", placeholder: "Все должности" },
];

/**
 * Варианты оргполя: значения справочника плюс уже выбранные, которых в нём нет.
 *
 * Выбранное значение могло прийти ссылкой в другом написании («отдел продаж») или справочник
 * ещё не доехал. Без него в вариантах поле показалось бы пустым, и «Применить» молча сняло бы
 * условие, которое реестр прямо сейчас применяет.
 */
function orgOptions(values: readonly OrgValueCount[], selected: readonly string[]) {
  const options = values.map(entry => ({ value: entry.value, label: entry.value }));
  for (const value of selected) {
    if (!options.some(option => option.value === value)) options.push({ value, label: value });
  }
  return options;
}

export function RegistryFilterPanel({
  open, anchorRef, filter, onApply, onClose, hideTest, scopeTestId, attempts,
}: RegistryFilterPanelProps) {
  const [draft, setDraft] = useState<RegistryFilter>(filter);
  const [attemptsDraft, setAttemptsDraft] = useState<AttemptPick>(attempts?.value ?? DEFAULT_ATTEMPT_PICK);
  // Справочники спрашиваются только у открытого окна и тем же хуком, что зовут чипы: иначе
  // одно и то же условие называлось бы в двух местах по-разному.
  const { tests, groups, orgValues } = useRegistryDictionaries(open);
  /**
   * Тест, внутри которого осмысленны вариант и версия: заданный страницей либо единственный
   * выбранный. Несколько тестов сразу — условие теряет смысл, и поля не показываются.
   */
  const scopedTestId = scopeTestId ?? (draft.testIds.length === 1 ? draft.testIds[0] : null);
  const { forms, versions } = useTestDictionary(scopedTestId, open);

  // Открытие — момент, когда черновик берётся из применённых условий: панель, закрытая без
  // «Применить», не должна помнить набранное в прошлый раз.
  useEffect(() => {
    if (open) {
      setDraft(filter);
      setAttemptsDraft(attempts?.value ?? DEFAULT_ATTEMPT_PICK);
    }
  }, [open, filter, attempts?.value]);

  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      onReset={() => { setDraft(EMPTY_FILTER); setAttemptsDraft("all"); }}
      onApply={() => { onApply(draft); attempts?.onApply(attemptsDraft); onClose(); }}
    >
      <FilterPanelGroup title="Источник" inline>
        {SOURCES.map(source => (
          <Checkbox
            key={source.value}
            label={source.label}
            checked={draft.sources.includes(source.value)}
            onChange={() => setDraft(d => ({ ...d, sources: toggle(d.sources, source.value) }))}
          />
        ))}
      </FilterPanelGroup>

      {attempts ? (
        <FilterPanelGroup title="Попытки" inline>
          {ATTEMPT_PICKS.map(pick => (
            <Radio
              key={pick}
              name="registry-filter-attempts"
              label={ATTEMPT_PICK_OPTION_LABEL[pick]}
              checked={attemptsDraft === pick}
              disabled={pick === "best" && attempts.bestUnavailable}
              onChange={() => setAttemptsDraft(pick)}
            />
          ))}
        </FilterPanelGroup>
      ) : null}

      <FilterPanelGroup title="Исход" inline>
        {OUTCOMES.map(outcome => (
          <Checkbox
            key={outcome.value}
            label={outcome.label}
            checked={draft.outcomes.includes(outcome.value)}
            onChange={() => setDraft(d => ({ ...d, outcomes: toggle(d.outcomes, outcome.value) }))}
          />
        ))}
      </FilterPanelGroup>

      {/*
        Тесты и группы выбираются поиском, а не списком: тестов на инсталляции десятки, и
        двадцать чекбоксов подряд — это не выбор, а прокрутка. Подпись поля — заголовок группы
        панели (PRD-70 FR-73), у самого поля — имя для экранного диктора.
      */}
      {!hideTest && (
        <FilterPanelGroup title="Тест">
          <Combobox
            aria-label="Тест"
            multiple
            placeholder="Все тесты"
            options={tests.map(test => ({ value: test.id, label: test.title }))}
            values={draft.testIds}
            onValuesChange={values => setDraft(d => ({ ...d, testIds: values }))}
            fullWidth
          />
        </FilterPanelGroup>
      )}

      <FilterPanelGroup title="Группа">
        <Combobox
          aria-label="Группа"
          multiple
          placeholder="Все группы"
          // «Без группы» — первым: прохождения людей вне групп иначе не отобрать (замечание
          // владельца 2026-10-04). Выбирается вместе с группами, условия — через «или».
          options={[
            { value: NO_GROUP_ID, label: NO_GROUP_LABEL },
            ...groups.map(group => ({ value: group.id, label: group.name })),
          ]}
          values={draft.groupIds}
          onValuesChange={values => setDraft(d => ({ ...d, groupIds: values }))}
          fullWidth
        />
      </FilterPanelGroup>

      {/*
        Оргструктура (FR-06b) — сразу за группой: это тоже свойство ЧЕЛОВЕКА, а не попытки.
        Значения из справочника профилей и прохождений, разные написания уже свёрнуты.
      */}
      {ORG_FIELDS_OF_DIALOG.map(({ key, field, label, placeholder }) => (
        <FilterPanelGroup key={key} title={label}>
          <Combobox
            aria-label={label}
            multiple
            placeholder={placeholder}
            options={orgOptions(orgValues?.[field] ?? [], draft[key])}
            values={draft[key]}
            onValuesChange={values => setDraft(d => ({ ...d, [key]: values }))}
            fullWidth
          />
        </FilterPanelGroup>
      ))}

      {/*
        Вариант выдачи и версия публикации — условия ВНУТРИ одного теста: у разных тестов
        они свои, и общий список из них был бы перечнем несравнимого. Поэтому поля
        появляются, когда тест в условиях ровно один, и исчезают, когда их несколько или
        нет вовсе. На аналитике теста он задан страницей — там они есть всегда.
      */}
      {scopedTestId && forms.length > 0 && (
        <FilterPanelGroup title="Вариант выдачи">
          <Combobox
            aria-label="Вариант выдачи"
            multiple
            placeholder="Все варианты"
            options={forms.map(form => ({ value: form.id, label: form.label }))}
            values={draft.formIds}
            onValuesChange={values => setDraft(d => ({ ...d, formIds: values }))}
            fullWidth
          />
        </FilterPanelGroup>
      )}

      {scopedTestId && versions.length > 0 && (
        <FilterPanelGroup title="Версия публикации">
          <Combobox
            aria-label="Версия публикации"
            multiple
            placeholder="Все версии"
            options={versions.map(snapshot => ({
              value: snapshot.id,
              label: `Версия ${snapshot.version}`,
            }))}
            values={draft.snapshotIds}
            onValuesChange={values => setDraft(d => ({ ...d, snapshotIds: values }))}
            fullWidth
          />
        </FilterPanelGroup>
      )}

      {/* Период — один заголовок и две даты в строку: «Период» над каждым полем повторял одно
          и то же, а поля столбиком занимали две строки там, где хватает одной (замечание
          владельца 2026-10-04). Полное имя поля — для экранного диктора. */}
      <FilterPanelGroup title="Период">
        <Grid cols={2} gap={2}>
          {/* Каждое поле — в своей ячейке: у соседних полей формы верхний отступ на случай
              столбика, и второе поле в строке вставало ниже первого. */}
          <div>
            <FormField label="с" htmlFor="registry-from">
              <Input
                id="registry-from"
                type="date"
                fullWidth
                aria-label="Период с"
                value={draft.from ?? ""}
                onChange={event => setDraft(d => ({ ...d, from: event.target.value || undefined }))}
              />
            </FormField>
          </div>
          <div>
            <FormField label="по" htmlFor="registry-to">
              <Input
                id="registry-to"
                type="date"
                fullWidth
                aria-label="Период по"
                value={draft.to ?? ""}
                onChange={event => setDraft(d => ({ ...d, to: event.target.value || undefined }))}
              />
            </FormField>
          </div>
        </Grid>
      </FilterPanelGroup>
    </FilterPanel>
  );
}
