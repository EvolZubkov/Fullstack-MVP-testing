/**
 * @module pages/author/analytics
 * @description Analytics for the author: the passage registry (web, LMS telemetry and
 * imported exports in one list), slices of those passages within a single test, the
 * «needs attention» cases, plus the attempt-details window every list opens into. The Excel
 * export is the registry button (FR-04); the separate «Export» tab was removed on 2026-09-25,
 * its only rule without a registry equivalent — best attempt per participant — moved into the
 * export dialog.
 *
 * PRD-56 FR-12 removed the «overview» tab: an average score or pass rate computed ACROSS
 * tests mixes different thresholds, scales and populations, so the number could not be
 * acted upon. What replaced it — slices and the queue — always names the population it
 * describes. Rendered entirely with the Skillum design system.
 */
import { useState } from "react";
import { ExportDialog } from "@/features/analytics/registry/export-dialog";
import { PassageRegistry, type RegistryRow } from "@/features/analytics/registry/passage-registry";

import {
  EMPTY_FILTER,
  type RegistryFilter,
} from "@/features/analytics/registry/filter-state";
import { useOpenTestLevel } from "@/features/analytics/levels/use-open-test-level";
import { generalHref } from "@/features/analytics/levels/analytics-routes";
import { useLocation } from "wouter";
import { TestsTab } from "@/features/analytics/tests/tests-tab";
import { useAnalyticsTab } from "@/features/analytics/levels/use-analytics-tab";
import { AnalyticsHeader } from "@/features/analytics/levels/analytics-header";

/** Вкладки общего уровня. Первая — по умолчанию. */
// Э3.0: «Тесты» — первая вкладка и вкладка по умолчанию: единая точка входа в аналитику теста.
// Э3.2: «Срезы» ушли на уровень теста — срез без теста существовать не может.
const GENERAL_ANALYTICS_TABS = ["tests", "attempts", "attention"] as const;
import { percent } from "@/features/analytics/format";
import { useRegistryFilter } from "@/features/analytics/registry/use-registry-filter";
import { AttentionQueue, type AttentionData, type AttentionRow } from "@/features/analytics/attention/attention-queue";
import { SuspiciousTests } from "@/features/analytics/attention/suspicious-tests";
import { BankReviewCard } from "@/features/analytics/attention/bank-review";
import { bankQuestionHref } from "@/features/analytics/levels/analytics-routes";
import { currentHref, stateForDive } from "@/features/analytics/levels/trail";
import { DEFAULT_ATTENTION_PERIOD, type AttentionPeriod } from "@shared/analytics/attention-period";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Stack, Tabs } from "@skillum/ui-kit";
import { ChevronRight, RefreshCw } from "lucide-react";
import {
  AttemptDetailsDialog,
  attemptOfRegistryRow,
  exportAttemptWorkbook,
  type CombinedAttempt,
} from "@/features/analytics/attempt/attempt-details-dialog";
import { invalidateAnalytics } from "@/features/analytics/invalidate-analytics";

// ============================================
// Главный компонент
// ============================================

export default function AnalyticsPage() {
  const [selectedAttempt, setSelectedAttempt] = useState<CombinedAttempt | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** PRD-54: окно загрузки выгрузки отчёта LMS. */
  /**
   * Очередь «требует внимания» — страницей, а не только вкладкой: число дел стоит на самой
   * вкладке (эскиз prd56-analytics-section), и видно его должно быть до того, как её открыли.
   * Вкладка получает те же данные и второй раз их не запрашивает.
   */
  // Период вкладки (решение владельца 2026-09-25): бейдж считает по нему же.
  const [attentionPeriod, setAttentionPeriod] = useState<AttentionPeriod>(DEFAULT_ATTENTION_PERIOD);
  const { data: attentionData } = useQuery<AttentionData>({
    queryKey: [`/api/analytics/attention?period=${attentionPeriod}`],
  });
  const attentionTotal = attentionData
    ? Object.values(attentionData.counts).reduce((sum, count) => sum + count, 0)
    : null;
  /** PRD-56 FR-03: условия отбора реестра живут в адресе страницы. */
  const [registryFilter, setRegistryFilter] = useRegistryFilter();
  /** PRD-56 FR-04: окно выгрузки отфильтрованного — открывается из панели фильтра реестра. */
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * Открытая вкладка. Держится состоянием, а не умолчанием, ради FR-08: переход из строки
   * среза открывает реестр и должен ПЕРЕКЛЮЧИТЬ экран, а не только подставить условия.
   */
  // Э2: вкладка — в адресе (`?tab=`): «Назад» возвращает на прежнюю, ссылка открывает ту же.
  const [tab, setTab] = useAnalyticsTab(GENERAL_ANALYTICS_TABS, "tests");
  // Э2: переход на уровень теста несёт условия и адрес возврата для крошки «Аналитика».
  const openTestLevel = useOpenTestLevel();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  /** Счётчик пересоздания вкладок для «Обновить». */
  const [refreshKey, setRefreshKey] = useState(0);
  /** «Обновить» (Э2): сброс запросов аналитики и перезапрос данных вкладок — без перезагрузки. */
  const refresh = () => {
    void invalidateAnalytics(queryClient);
    setRefreshKey((key) => key + 1);
  };

  // PRD-56 FR-12: combined-full и summary сняты вместе с «Обзором». Величины, которые они
  // считали — средний балл и pass rate ПО ВСЕМ тестам, тренды и проблемные темы вне контекста
  // теста, — неинтерпретируемы: смешивают разные пороги, шкалы и популяции. Их место заняли
  // срезы и очередь «требует внимания».

  const handleViewDetails = (attempt: CombinedAttempt) => {
    setSelectedAttempt(attempt);
    setDetailsOpen(true);
  };

  const handleOpenPassage = (row: RegistryRow) => handleViewDetails(attemptOfRegistryRow(row));

  /**
   * FR-08: открыть реестр по условиям среза.
   *
   * Условия приходят от вкладки срезов уже вместе с рамкой расчёта — тестом и периодом:
   * у самого среза их нет, они общие для всей вкладки (FR-07e).
   */
  const handleOpenSliceInRegistry = (conditions: Record<string, unknown>) => {
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const text = (value: unknown): string | undefined =>
      typeof value === "string" && value ? value : undefined;

    const next: RegistryFilter = {
      testIds: list(conditions.testIds),
      groupIds: list(conditions.groupIds),
      // Вариант и версия приезжают из срезов по этим осям: перевод условий больше не теряет
      // их, и реестр открывается ровно тем составом, что в строке среза (FR-08).
      formIds: list(conditions.formIds),
      snapshotIds: list(conditions.snapshotIds),
      // Оргсрезы (FR-06b) открываются в реестре тем же составом, что в строке.
      organizations: list(conditions.organizations),
      units: list(conditions.units),
      positions: list(conditions.positions),
      sources: list(conditions.sources) as RegistryFilter["sources"],
      outcomes: list(conditions.outcomes) as RegistryFilter["outcomes"],
      ...(text(conditions.from) ? { from: text(conditions.from) } : {}),
      ...(text(conditions.to) ? { to: text(conditions.to) } : {}),
    };
    // Э3.1: условия и вкладка — ОДНИМ переходом. Два шага по адресу (замена условий, затем
    // смена вкладки) перетирали друг друга: вкладка собирала адрес из строки запроса, снятой
    // до замены, и условия из адреса пропадали. Фильтр перечитывает адрес сам.
    navigate(generalHref(next, "attempts"), {
      state: typeof window === "undefined" ? null : window.history.state,
    });
  };

  /** FR-11: открыть разбор прохождения, из-за которого дело попало в очередь. */
  const handleOpenAttentionPassage = (row: AttentionRow) => {
    if (!row.observationId) return;
    handleViewDetails({
      id: row.observationId,
      testId: row.testId,
      testTitle: row.testTitle,
      userId: row.participantId ?? undefined,
      username: row.participant,
      startedAt: row.startedAt ?? "",
      finishedAt: null,
      duration: null,
      resultPercent: 0,
      resultPassed: false,
      totalPoints: 0,
      maxPoints: 0,
      source: row.source === "web" ? "web" : "lms",
    });
  };



  return (
    // Модульная сетка 4 px (эскиз prd56-analytics-section, дельта 6.2): шапка и вкладки —
    // разные блоки страницы, 4x; тот же шаг держит `ou-shell__main` эскиза.
    <Stack gap={4}>
      {/* Шапка уровня (Э2): общий уровень — корень, крошек нет. */}
      <AnalyticsHeader
        title="Аналитика"
        subtitle="Тесты, прохождения и дела, по которым нужно действие"
        actions={(
          <>
            {/* Э2: отбор ровно по одному тесту (так приводит значок списка тестов) — переход на
                уровень этого теста, пара к «Прохождения теста» на уровне теста. */}
            {registryFilter.testIds.length === 1 && (
              <Button
                variant="secondary"
                size="s"
                trailingIcon={<ChevronRight size={16} />}
                onClick={() => openTestLevel(registryFilter.testIds[0], registryFilter)}
              >
                Аналитика теста
              </Button>
            )}
            {/* Э2: без перезагрузки страницы — она теряла бы состояние истории (адреса возврата). */}
            <Button variant="secondary" size="s" leadingIcon={<RefreshCw size={16} />} onClick={refresh}>
              Обновить
            </Button>
          </>
        )}
      />

      {/* Табы. `key` — для «Обновить»: вкладки грузят данные сами, при монтировании, и пересоздание
          их перезапрашивает; вкладка живёт в адресе и не сбрасывается. */}
      <Tabs
        key={refreshKey}
        value={tab}
        onChange={setTab}
        items={[
          {
            // Э3.0: строка — тест с ключевыми числами; клик открывает уровень теста. Условия
            // реестра в переход не едут: вкладка их не показывает и не применяет.
            id: "tests",
            label: "Тесты",
            content: <TestsTab onOpenTest={(id) => openTestLevel(id, EMPTY_FILTER)} />,
          },
          {
            id: "attempts",
            label: "Прохождения",
            content: (
              /*
                PRD-56 FR-01 - FR-04: один список на все источники. Своя панель фильтров,
                постраничность и сортировка в памяти сняты: условия отбора живут в адресе,
                порции приходят с сервера, состав строк книги задаёт тот же фильтр. Карточку
                со счётом прохождений рисует сам реестр — число знает он.
              */
              <PassageRegistry
                filter={registryFilter}
                onFilterChange={setRegistryFilter}
                onOpenPassage={handleOpenPassage}
                onOpenTestAnalytics={(id) => openTestLevel(id, registryFilter)}
                // FR-04: выгрузка живёт там же, где фильтр, и берёт его условия. Отдельного
                // набора галочек для состава строк книги в продукте быть не должно — два
                // описания одной выборки однажды разойдутся, и книга перестанет отвечать
                // экрану (эскиз prd56-analytics-section.html, состояние reg-export).
                // Э3.2: «Сравнить со срезом» ушло на уровень теста вместе со срезами.
                actions={(
                  <Button variant="secondary" size="s" onClick={() => setExportOpen(true)}>
                    Экспорт
                  </Button>
                )}
              />
            ),
          },
          {
            id: "attention",
            label: "Требует внимания",
            badge: attentionTotal ? attentionTotal : undefined,
            content: (
              <Stack gap={4}>
              {/* Э3.4: где на уровне теста есть дела по качеству вопросов — указатель, а не разбор. */}
              <SuspiciousTests
                rows={attentionData?.suspiciousTests ?? []}
                onOpen={(id) => openTestLevel(id, EMPTY_FILTER, "questions", { questionsView: "suspicious", questionsSet: "psychometrics" })}
              />
              {/* PRD-70 FR-60: ось банка — вопросы тем читателя; переход несёт путь для крошки возврата. */}
              <BankReviewCard
                rows={attentionData?.bankReview ?? []}
                onOpen={(questionId) => {
                  const target = bankQuestionHref(questionId);
                  navigate(target, {
                    state: stateForDive(null, { label: "Аналитика", href: currentHref(), state: window.history.state }, target),
                  });
                }}
              />
              <AttentionQueue
                data={attentionData}
                period={attentionPeriod}
                onPeriodChange={setAttentionPeriod}
                onOpenPassage={handleOpenAttentionPassage}
                onOpenRegistry={handleOpenSliceInRegistry}
                // Очередь условий реестра не читает — и в тест уходит без них.
                onOpenTestAnalytics={(id) => openTestLevel(id, EMPTY_FILTER)}
              />
              </Stack>
            ),
          },
        ]}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filter={registryFilter}
      />

      {/* Модальное окно деталей */}
      <AttemptDetailsDialog
        attempt={selectedAttempt}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onExport={exportAttemptWorkbook}
      />
    </Stack>
  );
}
