/**
 * @module features/tests/run-inspector/panels
 * @description Общие панели инспектора прогона: «Результаты» и «Протокол».
 *
 * Их видят двое — автор в отладчике (PRD-18) и рецензент в окне рецензирования
 * (PRD-52). Панели вынесены сюда именно поэтому: расхождение в подсчёте или в
 * подписи вердикта превратило бы разговор о содержании теста в разговор о том, у
 * кого что показано. Вкладки, которые есть ТОЛЬКО у автора («Выдача», «Шкалы»,
 * «Показатели», «Состояние», «LMS»), остаются в его странице.
 *
 * Стили общие — слой `dbg__*` из отладчика; он импортируется здесь, чтобы обе
 * страницы получали его вместе с панелями.
 */
import { Box, Button, ProgressBar, Stack, Table, Tag, Text, type TableColumn } from "@skillum/ui-kit";
import {
  CircleDot, CheckSquare, Unplug, ListOrdered, ThermometerSun, SlidersHorizontal, Download,
} from "lucide-react";
import {
  protocolToCsv,
  type InspectorSnapshot, type ProtocolRow, type ScoreVM, type AdaptiveBar,
} from "../debug-player/inspector-snapshot";
import "../debug-player/debug-player.css";

function qTypeIcon(type: string) {
  const p = { size: 14, className: "dbg__qico" };
  if (type === "single") return <CircleDot {...p} />;
  if (type === "multiple") return <CheckSquare {...p} />;
  if (type === "matching") return <Unplug {...p} />;
  if (type === "scale") return <ThermometerSun {...p} />;
  // PRD-44: у распределения своя пиктограмма — без неё тип получал бы иконку
  // ранжирования по остаточному принципу, и в списке вопросов они бы слились.
  if (type === "allocation") return <SlidersHorizontal {...p} />;
  return <ListOrdered {...p} />;
}

// Question-type icon + prompt on ONE line (icon top-aligned, prompt wraps) — N8.
// Icons match the canonical content-tree set (single/multiple/matching=Unplug/ranking).

// Question-type icon + prompt on ONE line (icon top-aligned, prompt wraps) — N8.
// Icons match the canonical content-tree set (single/multiple/matching=Unplug/ranking).
export function QuestionLabel({ type, prompt, topic }: { type: string; prompt: string; topic?: string }) {
  return (
    <span className="dbg__q-label">
      {qTypeIcon(type)}
      <span>{prompt || "(без текста)"}{topic ? <span className="dbg__q-topic"> · {topic}</span> : null}</span>
    </span>
  );
}

function verdictTag(r: ProtocolRow) {
  // Измерительный вопрос не проверяется — вердикта у него нет и быть не может
  // (PRD-26 FR-08). Красное «неверно» здесь читалось бы как ошибка ученика.
  if (r.verdict === "measure") return <Tag size="s" variant="outline">не оценивается</Tag>;
  if (r.verdict === "none") return <Tag size="s" variant="soft">нет ответа</Tag>;
  if (r.verdict === "correct") return <Tag size="s" tone="success">верно</Tag>;
  if (r.verdict === "partial") return <Tag size="s" tone="warning">{`частично ${r.ratioPct}%`}</Tag>;
  return <Tag size="s" tone="error">неверно</Tag>;
}

// PRD-19 (FR-24): the per-question skip/return commit status, surfaced so the
// methodologist sees пропущен vs отвечен distinctly from the verdict (a skipped
// question may still carry a draft answer).

// PRD-19 (FR-24): the per-question skip/return commit status, surfaced so the
// methodologist sees пропущен vs отвечен distinctly from the verdict (a skipped
// question may still carry a draft answer).
function statusTag(r: ProtocolRow) {
  if (r.status === "answered") return <Tag size="s" tone="success" variant="soft">отвечен</Tag>;
  if (r.status === "skipped") return <Tag size="s" tone="warning" variant="soft">пропущен</Tag>;
  return <Tag size="s" variant="soft">не отвечен</Tag>;
}

export function ScorePanel({ snap }: { snap: InspectorSnapshot }) {
  const sc = snap.score;
  if (!sc.available) return <PanelEmpty text="Запустите пакет и начните отвечать — здесь появится агрегат результата." />;
  if (sc.adaptive) return <ScoreAdaptivePanel bar={sc.bar} />;
  const threshold = sc.rule && sc.rule.type === "percent" ? sc.rule.value : null;
  const completed = snap.status.completed;
  const columns: TableColumn<NonNullable<ScoreVM["sections"]>[number]>[] = [
    { key: "topic", header: "Раздел", render: (s) => s.topicName },
    { key: "pts", header: "Балл", width: "92px", render: (s) => `${s.earnedPoints} / ${s.possiblePoints}` },
    { key: "pct", header: "%", width: "56px", render: (s) => String(s.percent) },
    {
      // PRD-24: which threshold gated this topic — and, for a per-variant rule, the
      // variant this run was given (otherwise the verdict cannot be reasoned about).
      key: "rule", header: "Порог", width: "168px",
      render: (s) => (
        <>
          {s.ruleLabel ?? "—"}
          {s.variantLabel ? <div className="dbg__ins-sub">{s.variantLabel}</div> : null}
        </>
      ),
    },
    {
      // A section's pass/fail shows once IT is completed OR the run finished; else «в процессе» (N9).
      key: "verdict", header: "Итог", width: "104px",
      render: (s) => ((!s.completed && !completed) || s.passed == null
        ? <Tag size="s" tone="accent" variant="outline">в процессе</Tag>
        : <Tag size="s" tone={s.passed ? "success" : "error"}>{s.passed ? "пройден" : "не пройден"}</Tag>),
    },
  ];
  return (
    <Stack gap={3}>
      <div className="dbg__kpi-grid">
        <div className="ou-kpi"><div className="ou-kpi__head">Баллы</div><div className="ou-kpi__value">{`${sc.earnedPoints} из ${sc.possiblePoints}`}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Процент</div><div className="ou-kpi__value">{`${sc.percent}%`}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Порог</div><div className="ou-kpi__value">{threshold != null ? `${threshold}%` : "—"}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Результат</div><div className="ou-kpi__value">{completed
          ? <Tag tone={sc.passed ? "success" : "error"} size="s">{sc.passed ? "Пройден" : "Не пройден"}</Tag>
          : <Tag tone="accent" variant="outline" size="s">в процессе</Tag>}</div></div>
      </div>
      {threshold != null ? (
        <ProgressBar
          value={sc.percent ?? 0}
          size="m"
          tone={completed ? (sc.passed ? "success" : "error") : "accent"}
          label="Итог против порога"
          valueLabel={<><strong>{sc.percent}</strong>% / {threshold}%</>}
        />
      ) : null}
      {sc.sections && sc.sections.length ? (
        <>
          <div className="dbg__ins-h">Результаты по разделам</div>
          <Table columns={columns} rows={sc.sections} rowKey={(s) => s.topicName} />
        </>
      ) : null}
      <div className="dbg__sum">
        <span>прохождение: <strong>{completed ? "завершено" : "в процессе"}</strong>{completed ? <> · итог: <strong>{sc.passed ? "пройден" : "не пройден"}</strong></> : null}</span>
      </div>
    </Stack>
  );
}

export function ProtocolPanel({ snap }: { snap: InspectorSnapshot }) {
  const rows = snap.protocol.rows;
  if (!rows.length) {
    return <PanelEmpty text={snap.protocol.note || (snap.hasData ? "Пока нет выданных вопросов — начните отвечать." : "Запустите пакет и начните отвечать.")} />;
  }
  const earned = rows.reduce((a, r) => a + r.earned, 0);
  const possible = rows.reduce((a, r) => a + r.points, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : 0;
  const columns: TableColumn<ProtocolRow>[] = [
    {
      key: "q",
      header: "Вопрос",
      render: (r) => (
        <Stack gap={1}>
          <QuestionLabel type={r.type} prompt={r.prompt} topic={r.topicName} />
          {r.contribs.map((c, i) => (
            <span key={i} className="dbg__contrib">{`шкала ${c.scaleKey} ${c.delta >= 0 ? "+" : ""}${c.delta}`}</span>
          ))}
          {r.priceNote ? <span className="dbg__price">{r.priceNote}</span> : null}
        </Stack>
      ),
    },
    { key: "status", header: "Статус", width: "104px", render: statusTag },
    { key: "verdict", header: "Вердикт", width: "118px", render: verdictTag },
    { key: "score", header: "Балл", width: "78px", render: (r) => `${r.earned} / ${r.points}` },
  ];
  return (
    <Stack gap={3}>
      <div className="dbg__ins-toolbar">
        <span className="dbg__bar-spacer" />
        <Button variant="ghost" size="xs" leadingIcon={<Download size={13} />} onClick={() => downloadCsv(rows)}>
          Протокол в CSV
        </Button>
      </div>
      <Table columns={columns} rows={rows} rowKey={(r) => String(r.idx)} />
      <div className="dbg__sum">
        <span>{`итог: `}<strong>{`${Math.round(earned * 100) / 100} из ${possible}`}</strong>{` баллов · ${pct}%`}</span>
        {snap.score.available && !snap.score.adaptive
          ? (snap.status.completed
              ? <Tag size="s" tone={snap.score.passed ? "success" : "error"}>{snap.score.passed ? "Пройден" : "Не пройден"}</Tag>
              : <Tag size="s" tone="accent" variant="outline">в процессе</Tag>)
          : null}
      </div>
    </Stack>
  );
}

// «Результаты» (adaptive): confirmed-tem KPI + per-topic level/status table
// (Тема|Уровень|Статус) — the adaptive counterpart of the points aggregate.
export function ScoreAdaptivePanel({ bar }: { bar?: AdaptiveBar }) {
  const levels = bar?.topicLevels ?? [];
  if (!levels.length) return <PanelEmpty text="Адаптивный тест — подтверждённые уровни появятся по мере прохождения тем." />;
  const confirmedCount = levels.filter((l) => l.status === "confirmed").length;
  const reached = levels.filter((l) => l.status !== "pending");
  const columns: TableColumn<NonNullable<AdaptiveBar["topicLevels"]>[number]>[] = [
    { key: "topic", header: "Тема", render: (l) => l.topicName },
    { key: "level", header: "Уровень", render: (l) => l.levelName ?? "—" },
    {
      key: "status", header: "Статус", width: "150px",
      render: (l) =>
        l.status === "confirmed" ? <Tag size="s" tone="success">подтверждён ✓</Tag>
          : l.status === "running" ? <Tag size="s" tone="accent" variant="outline">идёт</Tag>
            : <Tag size="s" tone="error">не подтверждён</Tag>,
    },
  ];
  return (
    <Stack gap={3}>
      <div className="dbg__kpi-grid">
        <div className="ou-kpi"><div className="ou-kpi__head">Подтверждено тем</div><div className="ou-kpi__value">{`${confirmedCount} из ${levels.length}`}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Результат</div><div className="ou-kpi__value"><Tag size="s" tone={bar?.finished ? "success" : "warning"}>{bar?.finished ? "завершён" : "идёт"}</Tag></div></div>
      </div>
      <div className="dbg__ins-h">Подтверждённые уровни по темам</div>
      <Table columns={columns} rows={reached} rowKey={(l) => l.topicName} />
    </Stack>
  );
}

// «Выдача» (adaptive): per topic, the level path the run walked — Шаг|Уровень|
// Ответ|Переход — with the actual engine transition at each step (Вариант B) and
// the current on-screen question as the «идёт» tail row.

export function PanelEmpty({ text }: { text: string }) {
  return <Box className="dbg__panel-empty"><Text tone="muted" variant="body-s">{text}</Text></Box>;
}

// ─── CSV download ────────────────────────────────────────────────────────────────

function downloadCsv(rows: ProtocolRow[]) {
  const blob = new Blob(["﻿" + protocolToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "protocol.csv";
  a.click();
  URL.revokeObjectURL(url);
}
