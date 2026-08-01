/**
 * @module server/services/questions-import
 *
 * Per-row import of the «Вопросы» sheet (the question bank), shared by the
 * standalone question import (`POST /api/questions/import`) and the multi-sheet
 * workbook import (PRD-14 FR-15, `POST /api/tests/:id/workbook/import`).
 *
 * Implements PRD-14 Ф0-2 row semantics: round-trippable `matching`/`ranking`,
 * preserved `Балл`/`Сложность = 0`, tags / conditional feedback / «Цена ответа»,
 * and the FR-11 "empty cell vs absent column" update rule. For the workbook it
 * additionally records the local `Ключ строки` alias → resolved question, so the
 * «Измерения» sheet can reference questions created in the same book (FR-15.6/8).
 */

import { createHash } from "crypto";
import { storage } from "../storage";
import { logger } from "../logger";
import { normalizeTags } from "@shared/tags";
import { hasOptionList, hasFixedOptionOrder, isMeasurementOnly } from "@shared/questions/question-type";
import { normalizeIncomingText, normalizeQuestionData } from "./question-text";
import type { Question } from "@shared/schema";
import type { Role } from "@shared/access";
import {
  assessQuestionChange,
  assessQuestionsRemoval,
  type FeasibilityAssessment,
} from "./draw-feasibility";
import { visibleTopicScope, canManageTopicContent, isAdminOrSuper } from "./topic-access";

/** Маппинг типов: Excel -> внутренний. */
const typeFromExcel: Record<string, string> = {
  multiple_choice: "single",
  multiple_response: "multiple",
  matching: "matching",
  ranking: "ranking",
  single: "single",
  multiple: "multiple",
  // PRD-26: the scale is declared by its own name. Its rule for the correct-answer
  // column differs from single choice — an empty cell means measurement mode (FR-23).
  scale: "scale",
};

type QuestionType = "single" | "multiple" | "matching" | "ranking" | "scale";

/** SHA-256 от type + prompt + нормализованные варианты ответов. */
export function computeQuestionHash(type: string, prompt: string, dataJson: unknown): string {
  const normalized = JSON.stringify({ type, prompt: prompt.trim(), data: dataJson });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * PRD-14 Ф0 (FR-04): parse an integer cell preserving an explicit 0; falls back
 * only when the cell is empty or non-numeric.
 */
export function parseIntCell(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** A question resolved during the «Вопросы» pass (for measurement resolution). */
export interface ResolvedQuestion {
  id: string;
  type: QuestionType;
  /** Options / pairs / items count — used to validate measurement source keys. */
  unitCount: number;
  /** Content hash — pins «Оценка» overrides to the question state (FR-30). */
  contentHash: string | null;
  /**
   * PRD-26: the question is a measurement-only scale (no correct graduation), so the
   * «Оценка» sheet has nothing to price on it. Carried here so the workbook passes do
   * not have to re-read the question just to learn this.
   */
  measurementOnly: boolean;
}

export interface QuestionImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  /**
   * Non-blocking notices: the row imports, but something in it is likely not what the
   * author meant. Same channel the workbook import already exposes; forwarded there
   * prefixed with the sheet name.
   */
  warnings: string[];
  /** Local `Ключ строки` alias → resolved question (FR-15.6). */
  aliasToQuestion: Map<string, ResolvedQuestion>;
}

/**
 * Read one text cell the way the import must store it: markup converted to the
 * markdown subset, whitespace canonical. An empty cell reads as an empty string.
 */
function cellText(raw: unknown): string {
  return normalizeIncomingText(String(raw ?? ""), { convertHtml: true });
}

/** Derive the option/pair/item count from a parsed dataJson. */
function unitCountOf(type: QuestionType, dataJson: any): number {
  if (hasOptionList(type)) return dataJson.options?.length ?? 0;
  if (type === "matching") return dataJson.left?.length ?? 0;
  return dataJson.items?.length ?? 0;
}

/**
 * Import question rows. Uses {@link storage} directly; writes are skipped when
 * `dryRun` is set (counts are still computed). Errors are aggregated per row as
 * `Строка N: причина` (N is the 1-based sheet row, header = row 1).
 */
export async function importQuestionRows(
  rows: Record<string, unknown>[],
  headerSet: Set<string>,
  opts: { dryRun: boolean; actor?: { id: string; roles: readonly Role[] } },
): Promise<QuestionImportResult> {
  const { dryRun, actor } = opts;
  const hasCol = (name: string) => headerSet.has(name);

  const topics = await storage.getTopics();
  const normalizeName = (s: string) => s.replace(/[\s ​﻿]+/g, " ").trim().toLowerCase();
  // PRD-15 FR-28: match topic names only within the importer's visible area;
  // an unmatched name creates a NEW topic owned by the importer (below). Admins
  // (scope.all) and actorless calls match against the whole bank.
  let matchTopics = topics;
  if (actor) {
    const scope = await visibleTopicScope(actor.roles, actor.id);
    if (!scope.all) matchTopics = topics.filter((t) => scope.ids.has(t.id));
  }
  const topicByName = new Map(matchTopics.map((t) => [normalizeName(t.name), t]));

  const hashCache = new Map<string, Set<string>>();
  const getTopicHashes = async (topicId: string): Promise<Set<string>> => {
    if (!hashCache.has(topicId)) {
      hashCache.set(topicId, await storage.getContentHashesByTopic(topicId));
    }
    return hashCache.get(topicId)!;
  };

  // Lazy per-topic question list — used only to resolve a deduplicated question's
  // id when it carries a «Ключ строки» (so the alias can still be recorded, FR-15.6).
  const questionsCache = new Map<string, Question[]>();
  const getTopicQuestions = async (topicId: string): Promise<Question[]> => {
    if (!questionsCache.has(topicId)) {
      questionsCache.set(topicId, await storage.getQuestionsByTopic(topicId));
    }
    return questionsCache.get(topicId)!;
  };

  const result: QuestionImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    aliasToQuestion: new Map(),
  };

  /** Record the local row alias → resolved question (FR-15.6), if present. */
  const recordAlias = (row: Record<string, unknown>, q: ResolvedQuestion) => {
    const alias = String(row["Ключ строки"] ?? "").trim();
    if (alias) result.aliasToQuestion.set(alias, q);
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      // Тема — создаём если не существует.
      const topicNameRaw = String(row["Тема"] || "").replace(/[\s ​﻿]+/g, " ").trim();
      const topicNameKey = normalizeName(topicNameRaw);
      if (!topicNameKey) {
        result.errors.push(`Строка ${rowNum}: не указана тема`);
        continue;
      }
      let topic = topicByName.get(topicNameKey);
      if (!topic) {
        if (dryRun) {
          topic = { id: `__new__:${topicNameKey}`, name: topicNameRaw } as unknown as (typeof topics)[number];
          hashCache.set(topic.id, new Set());
        } else {
          logger.warn(`Import строка ${rowNum}: тема "${topicNameRaw}" не найдена, создаём новую`, "questions");
          // FR-28: a topic created by import is owned by the importer.
          topic = await storage.createTopic({ name: topicNameRaw, createdBy: actor?.id ?? null });
        }
        topicByName.set(topicNameKey, topic);
      }

      // Тип вопроса.
      const rawType = String(row["Тип вопроса"] || row["Тип"] || "").trim().toLowerCase();
      const type = typeFromExcel[rawType] as QuestionType | undefined;
      if (!type) {
        result.errors.push(`Строка ${rowNum}: неизвестный тип "${row["Тип вопроса"] || row["Тип"]}"`);
        continue;
      }

      // Текст вопроса — в канонической форме: ячейка приходит из Word, из чужой
      // системы или из ручной правки, а храниться должна так же, как из редактора.
      // Разметку в ячейке переводим в markdown: автор её не набирал, а хранить
      // теги как видимые символы — значит показать ученику «<b>».
      const prompt = cellText(row["Текст вопроса"] || row["Вопрос"]);
      if (!prompt) {
        result.errors.push(`Строка ${rowNum}: пустой вопрос`);
        continue;
      }

      // Варианты и правильные ответы. «Варианты» is the ancient name of the
      // options column, but on a workbook sheet that name belongs to the variant
      // membership («Варианты теста» since the rename) — so the alias applies only
      // when the canonical options column is ABSENT, i.e. on a truly old file.
      const optionsStr = String(
        row["Тексты вариантов ответа"] ||
          (hasCol("Тексты вариантов ответа") ? "" : row["Варианты"]) ||
          "",
      ).trim();
      const correctStr = String(row["Номера правильных ответов"] || row["Правильный ответ"] || "").trim();

      let dataJson: unknown = {};
      let correctJson: unknown = {};

      if (hasOptionList(type)) {
        const separator = optionsStr.includes("#") ? "#" : "|";
        const options = optionsStr.split(separator).map((s) => s.trim()).filter(Boolean);

        if (options.length < 2) {
          result.errors.push(
            type === "scale"
              ? `Строка ${rowNum}: нужно минимум 2 градации шкалы`
              : `Строка ${rowNum}: нужно минимум 2 варианта ответа`,
          );
          continue;
        }
        dataJson = { options };

        if (type === "scale") {
          // PRD-26 FR-23: the correct-answer column IS the author's switch. Empty →
          // measurement mode: `{}`, never `null` (the column is NOT NULL). One number
          // → a checked scale. Several numbers make no sense: a scale answer is one
          // graduation, and silently taking the first would hide the author's mistake.
          if (correctStr === "") {
            correctJson = {};
          } else {
            const nums = correctStr.split(/[,;.\s]+/).filter(Boolean);
            if (nums.length > 1) {
              result.errors.push(
                `Строка ${rowNum}: у шкалы правильная градация одна или её нет вовсе; ` +
                  `указано несколько номеров "${correctStr}"`,
              );
              continue;
            }
            const idx = parseInt(nums[0], 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= options.length) {
              result.errors.push(`Строка ${rowNum}: некорректный номер правильной градации "${correctStr}"`);
              continue;
            }
            correctJson = { correctIndex: idx };
          }
        } else if (type === "single") {
          const idx = parseInt(correctStr, 10) - 1;
          if (isNaN(idx) || idx < 0 || idx >= options.length) {
            result.errors.push(`Строка ${rowNum}: некорректный номер правильного ответа "${correctStr}"`);
            continue;
          }
          correctJson = { correctIndex: idx };
        } else {
          const indices = correctStr
            .split(/[,.\s]+/)
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((n) => !isNaN(n));

          if (indices.length === 0) {
            result.errors.push(`Строка ${rowNum}: не указаны правильные ответы`);
            continue;
          }
          if (indices.some((n) => n < 0 || n >= options.length)) {
            result.errors.push(`Строка ${rowNum}: номера правильных ответов выходят за пределы`);
            continue;
          }
          correctJson = { correctIndices: indices };
        }
      } else if (type === "matching") {
        let left: string[] = [];
        let right: string[] = [];
        let pairs: Array<{ left: number; right: number }> = [];

        if (optionsStr.includes("||")) {
          // PRD-14 Ф0 (FR-01): "left list || right list" с дистракторами.
          const sideSep = (s: string) => {
            const sep = s.includes("#") ? "#" : "|";
            return s.split(sep).map((x) => x.trim()).filter(Boolean);
          };
          const [leftStr, rightStr] = optionsStr.split("||");
          left = sideSep(leftStr || "");
          right = sideSep(rightStr || "");

          if (left.length < 2 || right.length < 2) {
            result.errors.push(`Строка ${rowNum}: нужно минимум 2 пары для сопоставления`);
            continue;
          }

          const tokens = correctStr.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
          let pairError = false;
          for (const tok of tokens) {
            const [l, r] = tok.split("-").map((s) => parseInt(s.trim(), 10) - 1);
            if (isNaN(l) || isNaN(r) || l < 0 || l >= left.length || r < 0 || r >= right.length) {
              result.errors.push(`Строка ${rowNum}: некорректная пара сопоставления "${tok}"`);
              pairError = true;
              break;
            }
            pairs.push({ left: l, right: r });
          }
          if (pairError) continue;
          if (pairs.length === 0) {
            pairs = left.map((_, idx) => ({ left: idx, right: idx }));
          }
        } else {
          // FR-02: обратная совместимость — старый позиционный разбор без "||".
          if (optionsStr.includes("→")) {
            const rawPairs = optionsStr.split("|").map((s) => s.trim()).filter(Boolean);
            for (const pair of rawPairs) {
              const [l, r] = pair.split("→").map((s) => s.trim());
              if (l && r) {
                left.push(l);
                right.push(r);
              }
            }
          } else {
            const parts = optionsStr.split("#").map((s) => s.trim()).filter(Boolean);
            for (let j = 0; j < parts.length - 1; j += 2) {
              left.push(parts[j]);
              right.push(parts[j + 1] || "");
            }
          }

          if (left.length < 2) {
            result.errors.push(`Строка ${rowNum}: нужно минимум 2 пары для сопоставления`);
            continue;
          }

          pairs = left.map((_, idx) => ({ left: idx, right: idx }));
        }

        dataJson = { left, right };
        correctJson = { pairs };
      } else if (type === "ranking") {
        const separator = optionsStr.includes("#") ? "#" : "|";
        const items = optionsStr.split(separator).map((s) => s.trim()).filter(Boolean);

        if (items.length < 2) {
          result.errors.push(`Строка ${rowNum}: нужно минимум 2 элемента для ранжирования`);
          continue;
        }

        dataJson = { items };

        if (correctStr) {
          const order = correctStr
            .split(/[,.\s;]+/)
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((n) => !isNaN(n));
          const valid =
            order.length === items.length &&
            order.every((n) => n >= 0 && n < items.length) &&
            new Set(order).size === items.length;
          if (!valid) {
            result.errors.push(`Строка ${rowNum}: некорректный порядок ранжирования "${correctStr}"`);
            continue;
          }
          correctJson = { correctOrder: order };
        } else {
          correctJson = { correctOrder: items.map((_, idx) => idx) };
        }
      }

      // Следование вариантов.
      const shuffleStr = String(row["Следование вариантов ответов"] || "Random").trim().toLowerCase();
      const shuffleAnswers = shuffleStr !== "fixed";
      // PRD-26 FR-24: the column does not apply to a scale — the order of graduations
      // runs from one pole to the other and is never shuffled. An explicit `Random`
      // is not an error (the value is stored, both hosts ignore it), but it means the
      // author expected something that will not happen, so it is worth saying.
      if (hasFixedOptionOrder(type) && hasCol("Следование вариантов ответов") && shuffleAnswers && shuffleStr !== "") {
        result.warnings.push(
          `Строка ${rowNum}: у шкалы порядок градаций содержателен и не перемешивается — ` +
            `значение «${String(row["Следование вариантов ответов"]).trim()}» в колонке ` +
            `«Следование вариантов ответов» не применяется`,
        );
      }

      // PRD-14 Ф0 (FR-04): сложность сохраняет явный 0; диапазон 0..100. T-40:
      // «Балл» больше не свойство вопроса — цена задаётся листом «Оценка» теста.
      const difficulty = parseIntCell(row["Сложность"], 50);
      if (difficulty < 0 || difficulty > 100) {
        result.errors.push(`Строка ${rowNum}: сложность вне диапазона 0..100 ("${row["Сложность"]}")`);
        continue;
      }

      // PRD-30 FR-01/FR-15: «Индекс в теме». Пустая ячейка = «не задано» (NULL),
      // а не 0 — ноль здесь обычный индекс. Книга без колонки не трогает
      // сохранённое значение (см. hasCol ниже).
      const orderIndexRaw = String(row["Индекс в теме"] ?? "").trim();
      const parsedOrderIndex = orderIndexRaw === "" ? null : Number(orderIndexRaw);
      if (parsedOrderIndex !== null && !Number.isInteger(parsedOrderIndex)) {
        result.errors.push(`Строка ${rowNum}: «Индекс в теме» должен быть целым ("${row["Индекс в теме"]}")`);
        continue;
      }
      const orderIndex = parsedOrderIndex;

      // PRD-14 Ф1 (FR-06): теги — разделители `;`/`,`.
      const tags = normalizeTags(String(row["Теги"] ?? "").split(/[;,]/));

      // PRD-14 Ф1 (FR-07): обратная связь.
      const feedbackModeRaw = String(row["Режим ОС"] || "").trim().toLowerCase();
      const feedbackMode: "general" | "conditional" =
        feedbackModeRaw === "условная" || feedbackModeRaw === "conditional" ? "conditional" : "general";
      const feedback = cellText(row["Обратная связь"]) || null;
      const feedbackCorrect = cellText(row["ОС при верном"]) || null;
      const feedbackIncorrect = cellText(row["ОС при неверном"]) || null;

      // Canonical answer texts BEFORE the hash: the hash deduplicates imported
      // rows and pins published snapshots, so hashing a value the write path is
      // about to rewrite would produce a hash no stored row can ever match.
      // Per element, AFTER the separator split — otherwise markup spanning two
      // options would swallow the `#`/`|` between them.
      dataJson = normalizeQuestionData(dataJson, { convertHtml: true });

      // The unit count (options / pairs / items) backs the «Измерения» alias.
      const unitCount = unitCountOf(type, dataJson);

      const contentHash = computeQuestionHash(type, prompt, dataJson);

      // Обновление по ID если указан.
      const rowId = String(row["ID"] || "").trim();
      if (rowId) {
        const existing = await storage.getQuestion(rowId);
        if (existing) {
          // PRD-15 block C: import updates respect topic ownership — the
          // importer must manage the question's CURRENT topic (owner / manage
          // grant / admin); a dangling question is admin-only. Admins skip the
          // topic lookup entirely.
          if (actor && !isAdminOrSuper(actor.roles)) {
            const existingTopic = existing.topicId
              ? await storage.getTopic(existing.topicId)
              : undefined;
            const canManage = existingTopic
              ? await canManageTopicContent(actor.roles, actor.id, existingTopic)
              : false;
            if (!canManage) {
              result.errors.push(
                `Строка ${rowNum}: изменять вопрос можно только в управляемой вами теме`,
              );
              continue;
            }
          }
          // PRD-15 FR-05 (E-10): re-tagging, difficulty change or a topic move
          // through import passes the same draw-feasibility check as the
          // editor; a blocking conflict becomes a row error (also in dry-run,
          // so the preview surfaces it before anything is written).
          const nextTags = hasCol("Теги") ? tags : undefined;
          const nextDifficulty = hasCol("Сложность") ? difficulty : undefined;
          const movesTopic = existing.topicId !== topic.id;
          const tagsChanged =
            nextTags !== undefined &&
            JSON.stringify(nextTags) !== JSON.stringify(existing.tags ?? []);
          const difficultyChanged =
            nextDifficulty !== undefined && nextDifficulty !== existing.difficulty;
          if (tagsChanged || difficultyChanged || movesTopic) {
            const assessments: FeasibilityAssessment[] = [];
            if (tagsChanged || difficultyChanged) {
              assessments.push(
                await assessQuestionChange(rowId, {
                  tags: tagsChanged ? nextTags : undefined,
                  difficulty: difficultyChanged ? nextDifficulty : undefined,
                }),
              );
            }
            if (movesTopic) {
              assessments.push(await assessQuestionsRemoval([rowId]));
            }
            const blocked = assessments.flatMap((a) => a.blocking);
            if (blocked.length > 0) {
              const titles = blocked.map((b) => b.title ?? b.testId).join(", ");
              result.errors.push(
                `Строка ${rowNum}: изменение нарушает выдачу опубликованных тестов: ${titles}`,
              );
              continue;
            }
          }
          // PRD-14 Ф1 (FR-11): обязательные поля всегда; опциональные — по наличию колонки.
          const updatePayload: Record<string, unknown> = {
            topicId: topic.id,
            type,
            prompt,
            dataJson,
            correctJson,
            contentHash,
          };
          if (hasCol("Сложность")) updatePayload.difficulty = difficulty;
          if (hasCol("Индекс в теме")) updatePayload.orderIndex = orderIndex;
          if (hasCol("Следование вариантов ответов")) updatePayload.shuffleAnswers = shuffleAnswers;
          if (hasCol("Обратная связь")) updatePayload.feedback = feedback;
          if (hasCol("ОС при верном")) updatePayload.feedbackCorrect = feedbackCorrect;
          if (hasCol("ОС при неверном")) updatePayload.feedbackIncorrect = feedbackIncorrect;
          if (hasCol("Режим ОС")) {
            updatePayload.feedbackMode = feedbackMode;
          } else if (hasCol("Обратная связь") && feedback) {
            updatePayload.feedbackMode = "general";
          }
          if (hasCol("Теги")) updatePayload.tags = tags;
          if (!dryRun) await storage.updateQuestion(rowId, updatePayload as any);
          result.updated++;
          recordAlias(row, { id: rowId, type, unitCount, contentHash, measurementOnly: isMeasurementOnly({ type, correctJson }) });
          continue;
        }
      }

      // Дедупликация: проверяем хэш контента.
      const existingHashes = await getTopicHashes(topic.id);
      if (existingHashes.has(contentHash)) {
        result.skipped++;
        // FR-15.6: record the local alias even for a deduplicated question, so
        // the workbook's «Оценка»/«Вклады вопросов» sheets can still reference it
        // by «Ключ строки» on re-import (otherwise scoring/contributions for an
        // already-existing question would resolve to "вопрос не найден").
        const alias = String(row["Ключ строки"] ?? "").trim();
        if (alias) {
          const dup = (await getTopicQuestions(topic.id)).find((q) => q.contentHash === contentHash);
          if (dup) {
            recordAlias(row, {
              id: dup.id,
              type: dup.type as QuestionType,
              unitCount: unitCountOf(dup.type as QuestionType, dup.dataJson),
              measurementOnly: isMeasurementOnly(dup),
              contentHash: dup.contentHash ?? contentHash,
            });
          }
        }
        continue;
      }

      // Создаём вопрос.
      let newId = `__newq__:${i}`;
      if (!dryRun) {
        const created = await storage.createQuestion({
          topicId: topic.id,
          type,
          prompt,
          dataJson,
          correctJson,
          difficulty,
          shuffleAnswers,
          feedbackMode,
          feedback: feedbackMode === "general" ? feedback : null,
          feedbackCorrect: feedbackMode === "conditional" ? feedbackCorrect : null,
          feedbackIncorrect: feedbackMode === "conditional" ? feedbackIncorrect : null,
          tags,
          orderIndex,
          contentHash,
          createdBy: actor?.id ?? null,
        } as any);
        if (created?.id) newId = created.id;
      }

      existingHashes.add(contentHash);
      result.created++;
      recordAlias(row, { id: newId, type, unitCount, contentHash, measurementOnly: isMeasurementOnly({ type, correctJson }) });
    } catch (err) {
      result.errors.push(`Строка ${rowNum}: ${(err as Error).message}`);
    }
  }

  return result;
}
