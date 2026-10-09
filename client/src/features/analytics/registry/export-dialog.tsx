/**
 * @module features/analytics/registry/export-dialog
 * @description PRD-56 FR-04: выгрузка отдаёт ТО, ЧТО ОТФИЛЬТРОВАНО.
 *
 * Окно живёт там же, где фильтр, и это его главная мысль: состав строк книги задают условия
 * реестра, а не второй набор галочек, который может разойтись с тем, что человек видит на
 * экране. Выбор листов книги остаётся — он про СОДЕРЖАНИЕ выгрузки, а не про её состав.
 *
 * Эскиз: docs/wireframes/prd56-analytics-section.html, состояние `reg-export`.
 */
import { useEffect, useState } from "react";

import { Banner, Button, Checkbox, ModalDialog, Select, Stack, Text } from "@skillum/ui-kit";

import {
  countConditions,
  describeConditions,
  filterToSearch,
  type RegistryFilter,
} from "./filter-state";
import { useRegistryDictionaries } from "./use-dictionaries";

/** Листы книги — те, что собирает `/api/export/excel`, названные как в продукте. */
const SHEETS: Array<{ key: string; label: string; description: string }> = [
  { key: "attempts", label: "Прохождения", description: "Участник, тест, дата, результат, исход, источник, группа" },
  { key: "answers", label: "Ответы по вопросам", description: "По одной строке на ответ, включая время на ответ там, где оно измерено" },
  { key: "summary", label: "Сводка", description: "Итоги выборки одним листом" },
  { key: "questionStats", label: "Статистика вопросов", description: "Доля верных и объём выборки по каждому вопросу" },
  { key: "levelStats", label: "Статистика уровней", description: "Только для адаптивных тестов в выборке" },
  { key: "recommendations", label: "Рекомендации", description: "Обратная связь по темам, как её видит участник" },
];

/** По какому признаку попытка считается лучшей — те же критерии, что умеет `/api/export/excel`. */
type BestAttemptCriteria = "percent" | "level_sum" | "level_count";

const BEST_CRITERIA: Array<{ value: BestAttemptCriteria; label: string }> = [
  { value: "percent", label: "Проценту результата" },
  { value: "level_sum", label: "Сумме уровней" },
  { value: "level_count", label: "Числу уровней" },
];

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Условия реестра: они и задают состав строк книги. */
  filter: RegistryFilter;
}

export function ExportDialog({ open, onClose, filter }: ExportDialogProps) {
  const dictionaries = useRegistryDictionaries(open);
  const [sheets, setSheets] = useState<Record<string, boolean>>({
    attempts: true, answers: true, summary: true,
    questionStats: false, levelStats: false, recommendations: false,
  });
  /**
   * «Только лучшая попытка участника» — правило ОТБОРА строк книги (решение владельца 2026-09-25):
   * переехало сюда из снятой вкладки «Экспорт», иначе отчёт «по лучшему результату каждого»
   * собрать было бы нечем.
   */
  const [bestOnly, setBestOnly] = useState(false);
  const [bestCriteria, setBestCriteria] = useState<BestAttemptCriteria>("percent");
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Объём выборки спрашивается тем же отбором, что у реестра: окно обязано называть число,
  // которое человек увидел на экране, иначе «выгружается текущая выборка» — необеспеченное
  // обещание. Строк не берём вовсе: нужен только знаменатель.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const search = filterToSearch(filter);
    const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    query.set("limit", "1");

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/registry?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { total: number };
        if (alive) setTotal(data.total);
      } catch {
        if (alive) setTotal(null);
      }
    })();

    return () => { alive = false; };
  }, [open, filter]);

  const conditions = describeConditions(filter, dictionaries);

  const download = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const response = await fetch("/api/export/excel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Состав строк — условия реестра, слово в слово (FR-04).
          testIds: filter.testIds,
          groupIds: filter.groupIds,
          sources: filter.sources,
          outcomes: filter.outcomes,
          formIds: filter.formIds,
          snapshotIds: filter.snapshotIds,
          organizations: filter.organizations,
          units: filter.units,
          positions: filter.positions,
          // «Ошиблись на вопросе» — тоже условие отбора: без него книга шире названного числа.
          wrongQuestionIds: filter.wrongQuestionIds ?? [],
          dateFrom: filter.from ?? "",
          dateTo: filter.to ?? "",
          includeSheets: sheets,
          bestAttemptOnly: bestOnly,
          bestAttemptCriteria: bestCriteria,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Не удалось собрать книгу");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "passages.xlsx";
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (error) {
      setFailed((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title="Экспорт прохождений"
      description="Выгружается текущая выборка, а не весь журнал"
      footer={
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            size="m"
            disabled={busy || total === 0 || !Object.values(sheets).some(Boolean)}
            onClick={() => void download()}
          >
            {busy ? "Собираем книгу…" : "Скачать книгу"}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Banner
          tone={total === 0 ? "warning" : "info"}
          size="sm"
          title={total === null
            ? "Считаем объём выборки…"
            : `${total} ${total === 1 ? "прохождение" : "прохождений"} в выборке`}
          description={countConditions(filter) === 0
            ? "Условий не задано — выгрузятся все прохождения, доступные вам."
            : conditions.map(condition => condition.label).join(" · ")}
        />

        {/* Листы книги — их содержание. Родственные пункты — 1x сетки (4 px). */}
        <Stack gap={1}>
          {SHEETS.map(sheet => (
            <Checkbox
              key={sheet.key}
              size="s"
              checked={sheets[sheet.key] ?? false}
              onChange={event => setSheets(prev => ({ ...prev, [sheet.key]: event.target.checked }))}
              label={sheet.label}
              description={sheet.description}
            />
          ))}
        </Stack>

        {/* Отдельной группой после листов: это не лист, а правило отбора строк. */}
        <Stack gap={1}>
          <Checkbox
            size="s"
            checked={bestOnly}
            onChange={event => setBestOnly(event.target.checked)}
            label="Только лучшая попытка участника"
            description="Из нескольких попыток одного человека по тесту в книгу идёт одна — лучшая"
          />
          {bestOnly ? (
            <Select<BestAttemptCriteria>
              size="s"
              label="Лучшая — по"
              hint="Сумма и число уровней — для адаптивных тестов"
              value={bestCriteria}
              onChange={setBestCriteria}
              options={BEST_CRITERIA}
            />
          ) : null}
        </Stack>

        {failed && <Text tone="error">{failed}</Text>}
      </Stack>
    </ModalDialog>
  );
}
