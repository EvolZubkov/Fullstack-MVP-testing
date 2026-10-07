/**
 * @module features/analytics/test/test-export-dialog
 * @description Э5.2: окно «Экспорт» уровня теста (эскиз docs/wireframes/approved/e5-export.html,
 * состояние «Экспорт: тест»).
 *
 * Выгрузка отдаёт ТО, ЧТО ОТФИЛЬТРОВАНО (PRD-56 FR-04): условия фильтра страницы подставлены и
 * названы, число прохождений под них — тоже. Кнопка «Экспорт Excel» раньше выгружала все
 * прохождения теста мимо фильтра, а психометрический отчёт и матрица ответов жили ссылками в
 * подвале таблицы вопросов — теперь все три выгрузки в одном окне.
 *
 * Книга результатов собирается той же ручкой, что выгрузка реестра (`POST /api/export/excel`),
 * с этим тестом в условиях: одна сборка — одни числа на обоих уровнях. Отчёт и матрица — ручки
 * психометрики с тем же фильтром и тем же правилом попыток, что у страницы.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Banner, Button, Checkbox, ChoiceCard, ChoiceCardGroup, ModalDialog, Stack, Text } from "@skillum/ui-kit";

import { fileNameOf } from "@/features/tests/export/save-as-dialog";
import { filterToSearch, type RegistryFilter } from "../registry/filter-state";

/** Что выгружается. */
export type TestExportKind = "book" | "report" | "matrix";

/** Листы книги результатов — те, что собирает `/api/export/excel`. */
const BOOK_SHEETS: Array<{ key: string; label: string; on: boolean }> = [
  { key: "summary", label: "Сводка", on: true },
  { key: "attempts", label: "Прохождения", on: true },
  { key: "answers", label: "Ответы", on: true },
  { key: "questionStats", label: "Статистика вопросов", on: false },
];

const KINDS: Array<{ value: TestExportKind; label: string; description: string }> = [
  { value: "book", label: "Книга результатов (.xlsx)", description: "Отобранные прохождения и ответы на них" },
  { value: "report", label: "Психометрический отчёт (.xlsx)", description: "Показатели вопросов и теста по тем же прохождениям" },
  { value: "matrix", label: "Матрица ответов (.xlsx)", description: "Участник × вопрос: 1, 0 или пусто — для своей обработки" },
];

/** Свойства окна. */
export interface TestExportDialogProps {
  open: boolean;
  onClose: () => void;
  testId: string;
  testTitle: string;
  /** Условия фильтра страницы — без теста: тест задан страницей. */
  filter: RegistryFilter;
  /** Подписи условий для чипов — те же, что в полосе фильтра. */
  conditionLabels: string[];
  /** Адрес ручки психометрики с фильтром и правилом попыток страницы. */
  psychometricsUrl: (path: string) => string;
}

/**
 * Скачать ответ сервера файлом; ошибка — текстом из ответа.
 *
 * @param response ответ сервера
 * @param fallbackName имя, если сервер его не назвал
 */
async function saveResponse(response: Response, fallbackName: string): Promise<void> {
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Не удалось собрать файл");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameOf(response.headers.get("Content-Disposition"), fallbackName);
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Окно «Экспорт» уровня теста.
 *
 * @param props тест, фильтр страницы и адрес психометрики
 */
export function TestExportDialog({
  open, onClose, testId, testTitle, filter, conditionLabels, psychometricsUrl,
}: TestExportDialogProps) {
  const [kind, setKind] = useState<TestExportKind>("book");
  const [sheets, setSheets] = useState<Record<string, boolean>>(
    () => Object.fromEntries(BOOK_SHEETS.map((sheet) => [sheet.key, sheet.on])),
  );
  /**
   * «Только лучшая попытка участника» — правило отбора строк книги: перенесено из окна выгрузки
   * реестра, которое вкладка «Прохождения» открывала до Э5.2, чтобы возможность не пропала.
   */
  const [bestOnly, setBestOnly] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Число прохождений — тем же отбором, что у реестра с этим тестом: окно обязано назвать то
  // число, которое уйдёт в книгу.
  useEffect(() => {
    if (!open) return;
    setFailed(null);
    let alive = true;
    const query = new URLSearchParams(filterToSearch({ ...filter, testIds: [testId] }).replace(/^\?/, ""));
    query.set("limit", "1");
    void (async () => {
      try {
        const response = await fetch(`/api/analytics/registry?${query.toString()}`, { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { total: number };
        if (alive) setTotal(data.total);
      } catch {
        if (alive) setTotal(null);
      }
    })();
    return () => { alive = false; };
  }, [open, filter, testId]);

  const download = async () => {
    setBusy(true);
    setFailed(null);
    try {
      if (kind === "book") {
        const response = await fetch("/api/export/excel", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testIds: [testId],
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
            bestAttemptCriteria: "percent",
          }),
        });
        await saveResponse(response, `${testTitle}.xlsx`);
      } else {
        const path = kind === "report"
          ? `/api/analytics/psychometrics/${encodeURIComponent(testId)}/export`
          : `/api/analytics/psychometrics/${encodeURIComponent(testId)}/matrix`;
        const response = await fetch(psychometricsUrl(path), { credentials: "include" });
        await saveResponse(response, `${testTitle}.xlsx`);
      }
      onClose();
    } catch (error) {
      setFailed((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noSheets = kind === "book" && !Object.values(sheets).some(Boolean);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title="Экспорт"
      description={`${testTitle} — по текущему фильтру страницы`}
      footer={(
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            size="m"
            leadingIcon={<Download size={16} />}
            disabled={busy || total === 0 || noSheets}
            onClick={() => void download()}
          >
            {busy ? "Собираем…" : "Выгрузить"}
          </Button>
        </>
      )}
    >
      <Stack gap={4}>
        <Banner
          tone={total === 0 ? "warning" : "info"}
          size="sm"
          title={total === null
            ? "Считаем прохождения…"
            : `Под условия подходит ${total} ${total === 1 ? "прохождение" : "прохождений"}`}
          description={conditionLabels.length > 0
            ? conditionLabels.join(" · ")
            : "Условий не задано — выгрузятся все прохождения теста"}
        />

        <ChoiceCardGroup legend="Что выгрузить" value={kind} onChange={(next) => setKind(next as TestExportKind)}>
          {KINDS.map((option) => (
            <ChoiceCard key={option.value} value={option.value} title={option.label} description={option.description} showRadio />
          ))}
        </ChoiceCardGroup>

        {kind === "book" && (
          // Листы книги — их содержание; родственные пункты — 1x сетки.
          <Stack gap={1}>
            <Text variant="body-s" tone="muted">Листы книги</Text>
            {BOOK_SHEETS.map((sheet) => (
              <Checkbox
                key={sheet.key}
                size="s"
                label={sheet.label}
                checked={sheets[sheet.key] ?? false}
                onChange={(event) => setSheets((prev) => ({ ...prev, [sheet.key]: event.target.checked }))}
              />
            ))}
          </Stack>
        )}

        {kind === "book" && (
          // Отдельной группой после листов: это не лист, а правило отбора строк.
          <Checkbox
            size="s"
            label="Только лучшая попытка участника"
            description="Из нескольких попыток одного человека в книгу идёт одна — с лучшим результатом"
            checked={bestOnly}
            onChange={(event) => setBestOnly(event.target.checked)}
          />
        )}

        {failed && <Banner tone="error" size="sm" title="Файл не собран" description={failed} />}
      </Stack>
    </ModalDialog>
  );
}
