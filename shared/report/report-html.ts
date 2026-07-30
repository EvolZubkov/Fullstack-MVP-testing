/**
 * @module shared/report/report-html
 *
 * The attempt REPORT's markup — one source for both hosts.
 *
 * The report is a standalone A4 page rasterized into a PDF (see
 * {@link module:shared/report/export-pdf}); it is NOT a screenshot of the results
 * screen, so it carries its own self-contained inline-styled layout rather than the
 * design template's scene. That layout used to live only inside the SCORM package
 * (`app/utils/pdfExport.js`), which is why the web host had no report at all. The
 * markup here is that same page, unchanged — moving it, not redesigning it.
 *
 * Pure — no DOM, no Node, no PDF library — so it is unit-testable and safe to bundle
 * for either host.
 */

import { attemptsCountLabel, reportGridColumns } from "./report-context";
import {
  NO_LEVEL_CONFIRMED_LABEL,
  type ResultInput,
  type TopicInput,
  type AdaptiveResultInput,
  type AdaptiveTopicInput,
} from "../template/result-context";

/** Background + logo of the report page, already resolved to data URLs. */
export interface ReportAssets {
  /** Page background (one of the `pdf-bg-*.png` plates); absent = gradient fallback. */
  backgroundDataUrl?: string | null;
  /** Brand logo printed above the headline; absent = no logo row. */
  logoDataUrl?: string | null;
}

/** What the report prints besides the result itself. */
export interface ReportMeta {
  /**
   * Which page to build — set by the host that knows the test's mode, so a consumer
   * never has to guess from the shape of `topicResults`.
   */
  adaptive?: boolean;
  /** Test title (the card headline). */
  testName: string;
  /** Learner's full name — LMS `cmi.learner_name` in SCORM, session user on the web. */
  learnerName?: string | null;
  /** ISO timestamp of the attempt being reported. */
  timestamp?: string | null;
  /** How many attempts the «Лучший результат за N попыток» line counts. */
  attemptsCount?: number;
}

/** Standard-mode report input — the SAME normalized result the results screen takes. */
export interface ReportInput extends ReportMeta {
  result: ResultInput;
}

/** Adaptive-mode per-topic extras the report prints (counts have no level analogue). */
export interface AdaptiveReportTopic extends AdaptiveTopicInput {
  totalQuestionsAnswered?: number;
  totalCorrect?: number;
}

/** Adaptive-mode report input. */
export interface AdaptiveReportInput extends ReportMeta {
  result: Omit<AdaptiveResultInput, "topicResults"> & { topicResults: AdaptiveReportTopic[] };
}

/** Escape text for injection into the report markup. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Russian plural form for a count (попытку / попытки / попыток). */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** `дд.мм.гггг чч:мм` of an ISO timestamp (or now, when the host has none). */
export function formatTimestamp(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Strip characters a file name cannot carry, and cap the length. */
export function sanitizeFileName(name?: string | null): string {
  if (!name) return "test";
  return String(name)
    .replace(/[^a-zA-Zа-яА-Я0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 50);
}

/** `Результаты_<Тест>_дд_мм_гггг.pdf` — the download name both hosts use. */
export function reportFileName(testName?: string | null, date: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p2(date.getDate())}_${p2(date.getMonth() + 1)}_${date.getFullYear()}`;
  return `Результаты_${sanitizeFileName(testName)}_${stamp}.pdf`;
}

/** Page frame: fixed A4-proportioned width, background plate or the gradient fallback. */
function pageOpen(assets: ReportAssets): string {
  const bg = assets.backgroundDataUrl
    ? `background-image: url(${assets.backgroundDataUrl}); background-size: cover; background-position: center;`
    : "background: linear-gradient(180deg, #1c1c2b 0%, #7700ff 100%);";
  return (
    `<div style="${bg} width: 595px; min-height: 842px; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; color: #ffffff; position: relative;">` +
    '<div style="padding: 20px 25px;">'
  );
}

/** Logo row (omitted when the host resolved no logo). */
function logoRow(assets: ReportAssets): string {
  if (!assets.logoDataUrl) return "";
  return (
    '<div style="margin-bottom: 15px;">' +
    `<img src="${assets.logoDataUrl}" style="height: 32px;" />` +
    "</div>"
  );
}

/** «Слушатель» + «Дата прохождения» lines. */
function whoAndWhen(meta: ReportMeta): string {
  let html = "";
  if (meta.learnerName) {
    html += `<div style="font-size: 13px; color: #ffffff; margin-bottom: 4px;">Слушатель: ${esc(meta.learnerName)}</div>`;
  }
  html += `<div style="font-size: 12px; color: #aca9a9; margin-bottom: 15px;">Дата прохождения: ${esc(formatTimestamp(meta.timestamp))}</div>`;
  return html;
}

/** One big number + its caption. */
function metric(value: string | number, label: string): string {
  return (
    '<div style="text-align: center;">' +
    `<div style="font-size: 28px; font-weight: 900;">${esc(value)}</div>` +
    `<div style="font-size: 12px; font-weight: 300; color: #aca9a9;">${esc(label)}</div>` +
    "</div>"
  );
}

/** A translucent section card. */
function cardOpen(): string {
  return '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
}

/** Deduped recommendations across FAILED topics (guidance is per failure, not per row). */
function failedRecommendations(topics: TopicInput[]): {
  courses: Array<{ title: string; url?: string }>;
  events: Array<{ title: string }>;
} {
  const seenC: Record<string, true> = {};
  const seenE: Record<string, true> = {};
  const courses: Array<{ title: string; url?: string }> = [];
  const events: Array<{ title: string }> = [];
  for (const t of topics) {
    if (t.passed !== false) continue;
    for (const c of t.recommendedCourses ?? []) {
      if (!c || seenC[c.title]) continue;
      seenC[c.title] = true;
      courses.push({ title: c.title, ...(c.url ? { url: c.url } : {}) });
    }
    for (const e of t.recommendedEvents ?? []) {
      if (!e || seenE[e.title]) continue;
      seenE[e.title] = true;
      events.push({ title: e.title });
    }
  }
  return { courses, events };
}

/**
 * A recommended-course row. The chip carries `data-url`, which
 * {@link module:shared/report/export-pdf} turns into a real clickable PDF link.
 */
function courseRow(title: string, url: string | undefined, index: number): string {
  return (
    '<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">' +
    `<div class="pdf-link-btn" data-url="${esc(url)}" data-index="${index}" style="background: #59209b; border-radius: 8px; padding: 10px 25px; font-size: 12px; font-weight: 300; color: #fafafa;">${esc(title)}</div>` +
    "</div>"
  );
}

/**
 * Build the STANDARD-mode report page.
 *
 * @param input Normalized result + who/when metadata.
 * @param assets Background/logo data URLs the host resolved.
 * @returns Self-contained HTML for one report page.
 */
export function buildReportHtml(input: ReportInput, assets: ReportAssets = {}): string {
  const r = input.result;
  const percent = Math.round(Number(r.percent) || 0);
  const passed = !!r.passed;
  const topics = r.topicResults ?? [];

  const statusColor = passed ? "#22c55e" : "#ef4444";
  const statusText = passed ? "Тест пройден" : "Тест не пройден";
  const statusBadge = passed ? "пройден" : "не пройден";
  const statusBadgeBg = passed ? "rgba(34, 197, 94, 0.2)" : "#432027";
  const statusBadgeBorder = passed ? "#22c55e" : "#eb1e1e";
  const statusBadgeColor = passed ? "#22c55e" : "#ff3131";

  let html = pageOpen(assets);
  html += logoRow(assets);

  html += `<div style="font-size: 42px; font-weight: 900; margin-bottom: 4px; line-height: 1; color: ${passed ? "#22c55e" : "#ffffff"};">${esc(statusText)}</div>`;
  html += `<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 8px;">${esc(attemptsCountLabel(input.attemptsCount))}</div>`;
  html += whoAndWhen(input);

  // Score card: metrics, the percent ring and the verdict badge.
  html += cardOpen();
  html += `<div style="font-size: 22px; font-weight: 400; margin-bottom: 4px;">${esc(input.testName || "Результаты теста")}</div>`;
  html += '<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 20px;">Результат теста</div>';
  html += '<div style="display: flex; align-items: center; gap: 20px;">';
  html += '<div style="display: flex; gap: 30px;">';
  html += metric(r.totalQuestions, "вопросов");
  html += metric(`${r.correct}/${r.totalQuestions}`, "верно");
  html += metric((Number(r.earnedPoints) || 0).toFixed(1), "баллов");
  html += "</div>";

  const circumference = 2 * Math.PI * 44;
  const offset = circumference - (circumference * percent) / 100;
  html += '<div style="width: 100px; height: 100px; position: relative; display: flex; align-items: center; justify-content: center;">';
  html += '<svg viewBox="0 0 100 100" style="position: absolute; width: 100%; height: 100%; transform: rotate(-90deg);">';
  html += '<circle cx="50" cy="50" r="44" fill="none" stroke="#2f2f2f" stroke-width="12"/>';
  html += `<circle cx="50" cy="50" r="44" fill="none" stroke="${statusColor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>`;
  html += "</svg>";
  html += `<div style="font-size: 28px; font-weight: 900; z-index: 1;">${percent}%</div>`;
  html += "</div>";

  html += `<div style="margin-left: auto; padding: 10px 20px; border-radius: 50px; font-size: 12px; font-weight: 500; background: ${statusBadgeBg}; border: 2px solid ${statusBadgeBorder}; color: ${statusBadgeColor};">${statusBadge}</div>`;
  html += "</div>"; // score row
  html += "</div>"; // score card

  // Per-topic cards.
  if (topics.length > 0) {
    html += cardOpen();
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 15px;">Результаты по темам</div>';
    html += `<div style="display: grid; grid-template-columns: repeat(${reportGridColumns(topics.length)}, 1fr); gap: 10px;">`;
    for (const t of topics) {
      const tPercent = Math.round(Number(t.percent) || 0);
      const tPassed = !!t.passed;
      const color = tPassed ? "#22c55e" : "#ef4444";
      const badgeBg = tPassed ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)";

      html += '<div style="background: linear-gradient(135deg, #2a2a3d 0%, #1f1f2e 100%); border-radius: 10px; padding: 10px; position: relative; overflow: hidden;">';
      html += `<div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ${color};"></div>`;
      // Name above, verdict below. Side by side (the original row) the nowrap pill did
      // not fit a three-column card next to a long Russian topic name: it was clipped by
      // the card's `overflow: hidden`, and once it stopped shrinking it overlapped the
      // name. Stacking keeps both readable at any column count.
      html += '<div style="margin-bottom: 6px;">';
      html += `<div style="font-size: 12px; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere;">${esc(t.topicName || "Тема")}</div>`;
      html += `<div style="display: inline-block; margin-top: 4px; font-size: 6px; font-weight: 500; padding: 2px 6px; border-radius: 3px; white-space: nowrap; background: ${badgeBg}; color: ${color};">${tPassed ? "Пройден" : "Не пройден"}</div>`;
      html += "</div>";
      html += '<div style="display: flex; justify-content: space-between; font-size: 7px; color: #aca9a9; margin-bottom: 5px;">';
      html += `<span>${t.correct} из ${t.total} (${tPercent}%)</span>`;
      html += `<span>${(Number(t.earnedPoints) || 0).toFixed(1)}/${(Number(t.possiblePoints) || 0).toFixed(1)}</span>`;
      html += "</div>";
      html += '<div style="height: 3px; background: #2f2f2f; border-radius: 2px; overflow: hidden; margin-bottom: 6px;">';
      html += `<div style="height: 100%; width: ${tPercent}%; background: ${color}; border-radius: 2px;"></div>`;
      html += "</div>";
      const fb = String(t.feedback ?? "").trim();
      if (!tPassed && fb) {
        html += `<div style="font-size: 10px; font-weight: 300; color: rgba(255, 255, 255, 0.7); line-height: 1.3; margin-top: 4px;">${esc(fb)}</div>`;
      }
      html += "</div>"; // topic card
    }
    html += "</div>"; // grid
    html += "</div>"; // card
  }

  // Guidance for the failed topics.
  const rec = failedRecommendations(topics);
  if (rec.courses.length > 0) {
    html += cardOpen();
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендации по курсам</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Изучите эти материалы для улучшения знаний по темам, которые требуют внимания.</div>';
    rec.courses.forEach((c, i) => {
      html += courseRow(c.title, c.url, i);
    });
    html += "</div>";
  }
  if (rec.events.length > 0) {
    html += cardOpen();
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендуемые мероприятия</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Посетите очные мероприятия для углублённого изучения материала.</div>';
    for (const e of rec.events) {
      html += '<div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
      html += `<div style="font-size: 14px; font-weight: 300; color: #fafafa;">${esc(e.title)}</div>`;
      html += "</div>";
    }
    html += "</div>";
  }

  html += "</div></div>"; // padding, page
  return html;
}

/**
 * Build the ADAPTIVE-mode report page — levels instead of a score, so no ring and a
 * neutral headline.
 *
 * @param input Normalized adaptive result + who/when metadata.
 * @param assets Background/logo data URLs the host resolved.
 * @returns Self-contained HTML for one report page.
 */
export function buildAdaptiveReportHtml(input: AdaptiveReportInput, assets: ReportAssets = {}): string {
  const topics = input.result.topicResults ?? [];

  let html = pageOpen(assets);
  html += logoRow(assets);

  html += '<div style="font-size: 42px; font-weight: 900; margin-bottom: 4px; line-height: 1; color: #ffffff;">Результаты теста</div>';
  html += '<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 8px;">Адаптивное тестирование</div>';
  html += whoAndWhen(input);

  html += cardOpen();
  html += `<div style="font-size: 22px; font-weight: 500;">${esc(input.testName || "Тест")}</div>`;
  html += "</div>";

  if (topics.length > 0) {
    html += cardOpen();
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 15px;">Результаты по темам</div>';
    html += `<div style="display: grid; grid-template-columns: repeat(${reportGridColumns(topics.length)}, 1fr); gap: 10px;">`;
    for (const t of topics) {
      const achieved = t.achievedLevelIndex !== null && t.achievedLevelIndex !== undefined;
      // The verdict comes from the results SCREEN's own label (one constant, not a
      // second copy): the learner downloads this report FROM that screen, so the two
      // cannot disagree about what the topic's outcome was.
      const levelName = achieved ? String(t.achievedLevelName ?? "") : NO_LEVEL_CONFIRMED_LABEL;
      const levelColor = achieved ? "#3b82f6" : "#6b7280";
      const levelBg = achieved ? "rgba(59, 130, 246, 0.2)" : "rgba(107, 114, 128, 0.2)";

      html += '<div style="background: linear-gradient(135deg, #2a2a3d 0%, #1f1f2e 100%); border-radius: 10px; padding: 12px; position: relative; overflow: hidden;">';
      html += `<div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ${levelColor};"></div>`;
      // Name above, level below — see the standard report's topic header.
      html += '<div style="margin-bottom: 8px;">';
      html += `<div style="font-size: 13px; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere;">${esc(t.topicName || "Тема")}</div>`;
      // The level label WRAPS, unlike the standard report's short verdict: it is either
      // an author-defined level name or the full «минимально требуемый уровень не
      // подтверждён» verdict. With `white-space: nowrap` such a label runs straight out
      // of a three-column card and the card clips it (`overflow: hidden`).
      html += `<div style="display: inline-block; max-width: 100%; margin-top: 5px; font-size: 9px; font-weight: 500; line-height: 1.35; padding: 3px 8px; border-radius: 4px; background: ${levelBg}; color: ${levelColor};">${esc(levelName)}</div>`;
      html += "</div>";
      if (t.totalQuestionsAnswered != null || t.totalCorrect != null) {
        // Two rows rather than one «A | B» line: in a three-column grid that line wraps
        // and leaves the separator dangling at the end of the first row.
        html += '<div style="font-size: 11px; color: #aca9a9; margin-bottom: 6px;">';
        html += `<div>Вопросов: ${t.totalQuestionsAnswered ?? 0}</div>`;
        html += `<div>Правильных: ${t.totalCorrect ?? 0}</div>`;
        html += "</div>";
      }
      const fb = String(t.feedback ?? "").trim();
      if (fb) {
        html += `<div style="font-size: 10px; font-weight: 300; color: rgba(255, 255, 255, 0.8); line-height: 1.4; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">${esc(fb)}</div>`;
      }
      html += "</div>";
    }
    html += "</div></div>";
  }

  // Adaptive guidance is per topic, not per failure — every recommended link shows.
  const links: Array<{ topicName: string; title: string; url?: string }> = [];
  for (const t of topics) {
    for (const c of t.recommendedCourses ?? []) {
      if (c) links.push({ topicName: t.topicName || "", title: c.title, ...(c.url ? { url: c.url } : {}) });
    }
  }
  if (links.length > 0) {
    html += cardOpen();
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендуемые материалы</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Изучите эти материалы для улучшения знаний.</div>';
    links.forEach((l, i) => {
      html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
      html += `<div style="font-size: 14px; font-weight: 700;">${esc(l.topicName)}</div>`;
      html += `<div class="pdf-link-btn" data-url="${esc(l.url)}" data-index="${i}" style="background: #1e40af; border-radius: 8px; padding: 10px 25px; font-size: 12px; font-weight: 300; color: #fafafa;">${esc(l.title)}</div>`;
      html += "</div>";
    });
    html += "</div>";
  }

  html += "</div></div>";
  return html;
}
