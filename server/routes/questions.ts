import { Router, Request, Response } from "express";
import { logger } from "../logger";
import ExcelJS from "exceljs";
import {
  addAoaSheet,
  addJsonSheet,
  readWorkbookFromBuffer,
  sheetHeaders,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { rejectBase64MediaUrl, respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import { syncEntityUsages, canonicalizeEntityMedia, clearCascadedUsages } from "../services/media/usage-index";
import { normalizeTags } from "@shared/tags";
import { normalizeAuthorText, renderInlineMarkdown } from "@shared/text";
import { normalizeOptionalText, normalizeQuestionData, normalizePromptByFormat } from "../services/question-text";
import { promptFormatOf } from "@shared/questions/prompt-format";
import { normalizeOptionFeedback, optionCountOf } from "@shared/questions/option-feedback";
import type { SanitizeRemoval } from "@shared/security/html-sanitize";
import { formulasFor, promptHtmlOf } from "../services/prompt-html";
import { importQuestionRows } from "../services/questions-import";
import { serializeQuestionRow, QUESTION_HEADERS, QUESTION_WIDTHS } from "../services/questions-export";
import { assessQuestionsRemoval, assessQuestionChange } from "../services/draw-feasibility";
import {
  respondForbiddenContent,
  respondIfBlocked,
  mergeAssessments,
  isDryRun,
  respondDryRun,
} from "../services/content-guard";
import {
  visibleTopicScope,
  canManageTopicContent,
  isAdminOrSuper,
} from "../services/topic-access";
import { allocationDataSchema } from "@shared/schema";
import { distributesBudget } from "@shared/questions/question-type";
import type { Question } from "@shared/schema";
import { shortAnswerDataSchema } from "@shared/schema";
import { isSimulation, isTextEntry } from "@shared/questions/question-type";
import {
  MAX_ARCHIVE_BYTES,
  ScenarioArchiveError,
  archiveFileName,
  buildScenarioArchive,
  importScenarioArchive,
  storedScenarioErrors,
} from "../services/sim/scenario-archive";
import type { Scenario } from "@shared/sim/contract";
import multer from "multer";
import { config } from "../config";

/**
 * PRD-44 FR-46: границы полей и ВЫПОЛНИМОСТЬ распределения проверяются на сервере,
 * а не только в редакторе. Без этого сохраняется вопрос, который нельзя заполнить ни
 * одним способом, — и узнает об этом первым учащийся, а не автор. Возвращает текст
 * ошибки или `null`.
 *
 * Остальные типы здесь не трогаются намеренно: их конфигурация не может стать
 * невыполнимой, и вводить общую проверку «на всякий случай» значит менять поведение,
 * о котором PRD-44 не просил.
 */
/**
 * Положить в содержимое задания готовые формулы (PRD-57 FR-07).
 *
 * Пустой словарь НЕ кладётся: задание без формул обязано остаться байт в байт таким же,
 * каким было, иначе хеш содержимого дрогнет у каждого вопроса в базе.
 */
function withFormulas(dataJson: unknown, prompt: string): unknown {
  const formulas = formulasFor(prompt);
  if (Object.keys(formulas).length === 0) return dataJson;
  const base = (dataJson ?? {}) as Record<string, unknown>;
  return { ...base, formulas };
}

/**
 * Приложить к ответу то, что санитайзер вырезал из текста задания (согласованный эскиз
 * `prd57-question-text.html`, состояние `s-diag`).
 *
 * Поле-спутник, а не колонка: оно описывает ЭТО сохранение, а не сам вопрос, и живёт ровно
 * до следующей правки — тем же приёмом, каким страница содержимого отдаёт свою диагностику
 * (`sanitizeDiagnostics` в `content-pages`). Пустой список не кладётся: ящик решает по
 * НАЛИЧИЮ поля, и «вырезано ничего» не должно выглядеть как находка.
 */
function withSanitizeReport<T extends object>(question: T, removed: SanitizeRemoval[]): T {
  if (removed.length === 0) return question;
  return { ...question, promptSanitizeRemoved: removed };
}

function allocationConfigError(type: string | undefined, dataJson: unknown): string | null {
  if (!distributesBudget(type ?? "")) return null;
  const parsed = allocationDataSchema.safeParse(dataJson);
  if (parsed.success) return null;
  return parsed.error.issues.map((i) => i.message).join("; ");
}

/**
 * PRD-57 FR-28v: авторский предел длины короткого ответа — в рамках системного потолка.
 *
 * Проверка живёт ЗДЕСЬ, а не в редакторе, потому что настройку инстанса знает только
 * сервер: канала серверных настроек к браузеру в продукте нет. Без неё автор поставил бы
 * предел 4000, а участник упёрся бы в 250 и не понял почему.
 *
 * Потолок назван в тексте ошибки числом: «слишком большой предел» заставляет автора
 * подбирать значение наугад.
 *
 * Возвращает текст ошибки или `null`.
 */
function shortAnswerConfigError(type: string | undefined, dataJson: unknown): string | null {
  if (!isTextEntry(type ?? "")) return null;
  const parsed = shortAnswerDataSchema.safeParse(dataJson ?? {});
  if (!parsed.success) {
    return "Предел длины ответа — целое число больше нуля";
  }
  const ceiling = config.limits.shortAnswerMaxLength;
  const own = parsed.data.maxLength;
  if (own !== undefined && own > ceiling) {
    return `Предел длины ответа не может превышать ${ceiling} символов`;
  }
  return null;
}

/**
 * «Сценарий в ИС»: содержимое — сценарий контракта с изображениями из медиатеки.
 *
 * Те же проверки, что при загрузке архива (`shared/sim/validate`), в режиме хранимого
 * сценария: ЗАПРОС может прийти и не из ящика, а принятый архив и сохранённый вопрос не
 * имеют права расходиться в том, что считать годным сценарием.
 *
 * Возвращает текст ошибки или `null`.
 */
function scenarioConfigError(type: string | undefined, dataJson: unknown): string | null {
  if (!isSimulation(type ?? "")) return null;
  const errors = storedScenarioErrors(dataJson);
  return errors.length ? errors.join("; ") : null;
}

// PRD-15 FR-02: fields whose change affects delivery or grading of dependent
// tests; such edits are restricted to the creator/administrator and, for
// tags/difficulty/topic moves, run the draw-feasibility check (E-3/E-4).
function gradingOrDrawFieldsChanged(existing: Question, body: UpdateQuestionBody): boolean {
  const changed = (next: unknown, current: unknown) =>
    next !== undefined && JSON.stringify(next) !== JSON.stringify(current);
  return (
    changed(body.type, existing.type) ||
    changed(body.dataJson, existing.dataJson) ||
    changed(body.correctJson, existing.correctJson) ||
    changed(body.difficulty, existing.difficulty) ||
    changed(body.topicId, existing.topicId) ||
    (Array.isArray(body.tags) &&
      JSON.stringify(normalizeTags(body.tags)) !== JSON.stringify(existing.tags ?? []))
  );
}

/**
 * PRD-15 block C (FR-22): a question is governed by its topic. CRUD on it
 * requires `manage` on that topic (owner, manage grant, or admin). This
 * replaces the block-A creator gate (`created_by`). A dangling question whose
 * topic was deleted is administrator-only.
 *
 * @param req - the authenticated request (roles and current user).
 * @param topicId - the question's topic id (or null for a dangling row).
 * @returns whether the actor may create/update/delete this question.
 */
async function canManageQuestion(
  req: Request,
  topicId: string | null | undefined,
): Promise<boolean> {
  const roles = req.effectiveRoles ?? [];
  if (isAdminOrSuper(roles)) return true;
  if (!topicId) return false;
  const topic = await storage.getTopic(topicId);
  return topic ? canManageTopicContent(roles, req.currentUser?.id ?? "", topic) : false;
}

const router = Router();

// ============================================
// Типы
// ============================================

interface IdParams {
  id: string;
}

interface TopicIdParams {
  topicId: string;
}

interface CreateQuestionBody {
  topicId: string;
  type: "single" | "multiple" | "matching" | "ranking";
  prompt: string;
  /** PRD-57 §4.3: в каком режиме автор набрал текст. Отсутствие = разметка. */
  promptFormat?: "markdown" | "richText" | "html";
  dataJson: unknown;
  correctJson: unknown;
  difficulty?: number;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | null;
  shuffleAnswers?: boolean;
  feedback?: string;
  feedbackMode?: "general" | "conditional";
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
  /**
   * Feedback texts of individual options (single choice only), aligned by position with
   * `dataJson.options`; `null` = no override. Stored as NULL for every other type.
   */
  optionFeedbackJson?: Array<string | null> | null;
  /** PRD-11 §3a: sub-topic tags; normalized on save (trim/collapse, dedup, cap). */
  tags?: string[];
  /**
   * PRD-30 FR-01: author-defined index inside the topic («Индекс в теме»).
   * `null` clears it («не задано»); an absent field leaves the stored value
   * alone. Values need not be dense or unique.
   */
  orderIndex?: number | null;
}

interface UpdateQuestionBody extends Partial<CreateQuestionBody> {}

interface BulkDeleteBody {
  ids: string[];
}

interface ExportQuery {
  topicIds?: string;
  testId?: string;
}

// Сериализация строки вопроса (экспорт) — server/services/questions-export.ts;
// разбор (импорт) — server/services/questions-import.ts.

// ============================================
// GET /api/questions - Список вопросов
// ============================================
router.get("/", requirePermission("questions.read"), async (req: Request, res: Response) => {
  try {
    const questions = await storage.getQuestions();
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    // PRD-15 block C (FR-22): questions inherit their topic's visibility — only
    // those in topics the actor may see are returned.
    const scope = await visibleTopicScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
    const visible = scope.all ? questions : questions.filter((q) => scope.ids.has(q.topicId));

    const questionsWithTopics = visible.map((q) => ({
      ...q,
      topicName: topicMap.get(q.topicId) || "Unknown",
    }));

    res.json(questionsWithTopics);
  } catch (error) {
    logger.error("Get questions error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get questions" });
  }
});

// ============================================
// POST /api/questions/preview - Разметка задания для предпросмотра (PRD-57 FR-24g)
// ============================================
//
// Предпросмотр обязан показать то, что увидит участник, а увидит он подсвеченный листинг и
// формулу картинкой. И подсветка (`highlight.js`), и MathJax живут ТОЛЬКО на сервере,
// поэтому разметку для окна считает он же — тем самым `promptHtmlOf`, которым разметка
// уходит на выдаче. Второй путь означал бы, что однажды предпросмотр покажет не то.
//
// Задание приходит НЕСОХРАНЁННЫМ: предпросмотр нужен до сохранения, ради этого он и есть.
// Маршрут ничего не пишет и ничего не читает — чистое преобразование текста.
router.post("/preview", requirePermission("questions.read"), async (req: Request, res: Response) => {
  try {
    const { prompt, dataJson, promptFormat } = req.body ?? {};
    if (prompt !== undefined && typeof prompt !== "string") {
      return res.status(400).json({ error: "Текст задания должен быть строкой" });
    }
    const text = typeof prompt === "string" ? prompt : "";
    // Формулы считаются на месте: у несохранённого задания запаса картинок ещё нет, а
    // показать формулу автору важнее, чем сэкономить на рендере одного окна.
    // PRD-57 §4.3: предпросмотр обязан считать текст по ТОМУ ЖЕ формату, в каком автор его
    // сейчас набирает, — иначе окно покажет HTML сырыми тегами, а разметку тегами не покажет.
    const rendered = promptHtmlOf({ prompt: text, dataJson, promptFormat });
    // Разметки нет — текст печатается тем же инлайновым рендером, каким его печатает
    // хост, когда сервер не считал разметку заранее (см. `template-question-screen`).
    res.json({ promptHtml: rendered.promptHtml ?? (text === "" ? "" : renderInlineMarkdown(text)) });
  } catch (error) {
    logger.error("Question preview error: " + (error as Error).message);
    res.status(500).json({ error: "Не удалось собрать предпросмотр" });
  }
});

// ============================================
// POST /api/questions - Создать вопрос
// ============================================
router.post(
  "/",
  requirePermission("questions.manage"),
  async (req: Request<{}, {}, CreateQuestionBody>, res: Response) => {
    try {
      const {
        topicId,
        type,
        prompt,
        promptFormat,
        dataJson,
        correctJson,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        optionFeedbackJson,
        tags,
        orderIndex,
      } = req.body;

      if (rejectBase64MediaUrl(mediaUrl, res)) return;

      // Canonical form BEFORE the required-field check: a prompt of nothing but
      // spaces is an empty prompt, not a filled one. Приводится ПО ФОРМАТУ (PRD-57 §4.3):
      // у разметки — проход по строке, у размеченного текста — санитайзер и типографика
      // по текстовым узлам.
      const format = promptFormatOf({ promptFormat });
      const canonical = normalizePromptByFormat(prompt ?? "", format);
      const canonicalPrompt = canonical.prompt;

      if (!topicId || !type || !canonicalPrompt) {
        return res.status(400).json({ error: "TopicId, type and prompt required" });
      }

      // PRD-15 block C: adding a question requires manage on the target topic.
      if (!(await canManageQuestion(req, topicId))) {
        respondForbiddenContent(res);
        return;
      }

      const allocationError = allocationConfigError(type, dataJson);
      if (allocationError) {
        return res.status(422).json({ error: allocationError, field: "dataJson" });
      }

      const shortAnswerError = shortAnswerConfigError(type, dataJson);
      if (shortAnswerError) {
        return res.status(422).json({ error: shortAnswerError, field: "dataJson" });
      }

      const scenarioError = scenarioConfigError(type, dataJson);
      if (scenarioError) {
        return res.status(422).json({ error: scenarioError, field: "dataJson" });
      }

      const questionInput = {
        topicId,
        type,
        prompt: canonicalPrompt,
        promptFormat: format,
        // PRD-57 FR-07: готовые SVG формул кладутся В ЗАДАНИЕ. Требование прямое: при
        // переносе теста между установками картинка едет вместе с вопросом, а не
        // пересчитывается на приёмнике — иначе её вид зависит от версии библиотеки там.
        dataJson: withFormulas(normalizeQuestionData(dataJson), canonicalPrompt),
        correctJson,
        // PRD-16 FR-10: `null` — «Не задано», а не 50; ноль — сложность, а не пустота. Умолчание 50
        // только для запроса, где поля нет вовсе. `||` подменял и то и другое.
        difficulty: difficulty === undefined ? 50 : difficulty,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        shuffleAnswers: shuffleAnswers ?? true,
        feedback: normalizeAuthorText(feedback) || null,
        feedbackMode: feedbackMode || "general",
        feedbackCorrect: normalizeAuthorText(feedbackCorrect) || null,
        feedbackIncorrect: normalizeAuthorText(feedbackIncorrect) || null,
        optionFeedbackJson: normalizeOptionFeedback(
          optionFeedbackJson,
          type,
          optionCountOf(dataJson),
          normalizeAuthorText,
        ),
        tags: normalizeTags(Array.isArray(tags) ? tags : []),
        // PRD-30 FR-01: `??` and not `||` — 0 is a legitimate index; absent
        // means «не задано» and stores NULL.
        orderIndex: orderIndex ?? null,
        createdBy: req.currentUser?.id ?? null,
      };

      // Медиатека §5: пре-реестровый адрес приводится к каноническому в момент правки —
      // так наследие вымывается редактированием, а не миграцией по чужим JSON.
      const payload = await canonicalizeEntityMedia(questionInput);

      const question = await storage.createQuestion(payload as any);

      // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
      // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
      // чинится пересборкой; потерянное сохранение вопроса не чинится ничем.
      try {
        await syncEntityUsages("question", question.id, question);
      } catch (error) {
        logger.error(`Media usage sync failed for question ${question.id}: ${(error as Error).message}`);
      }

      res.status(201).json(withSanitizeReport(question, canonical.removed));
    } catch (error) {
      logger.error("Create question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to create question" });
    }
  }
);

// ============================================
// POST /api/questions/scenario-archive — принять архив сценария («Сценарий в ИС»)
// ============================================
//
// Ящик вопроса присылает `.scenario.zip`; сервер проверяет контракт и, если ошибок нет,
// кладёт изображения в медиатеку автора и возвращает готовое содержимое вопроса. Сам вопрос
// здесь НЕ пишется: его сохраняет обычное «Создать»/«Обновить», и сценарий проходит ту же
// проверку ещё раз — уже как хранимый.
//
// Ошибки сценария — не сбой запроса: ответ `200` с `ok: false` и перечнем, его показывает
// ящик. `422` — только когда сам файл не прочитать (не ZIP, нет `scenario.json`).
const scenarioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ARCHIVE_BYTES } });

router.post(
  "/scenario-archive",
  requirePermission("questions.manage"),
  (req: Request, res: Response, next) =>
    scenarioUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `Архив больше ${MAX_ARCHIVE_BYTES / 1024 / 1024} МБ`, maxBytes: MAX_ARCHIVE_BYTES });
      }
      next(err);
    }),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Файл не передан" });
      const result = await importScenarioArchive(req.file.buffer, req.currentUser?.id ?? "");
      res.json(result);
    } catch (error) {
      if (error instanceof ScenarioArchiveError) {
        return res.status(422).json({ error: error.message, ok: false, errors: [error.message], warnings: [] });
      }
      logger.error("Scenario archive import error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось принять архив сценария" });
    }
  },
);

// ============================================
// GET /api/questions/:id/scenario-archive — архив сценария, собранный из сохранённого
// ============================================
//
// Исходный файл не хранится: архив собирается заново — сценарий и его изображения из
// медиатеки, — поэтому загружается обратно сюда же или в другую установку.
router.get(
  "/:id/scenario-archive",
  requirePermission("questions.read"),
  async (req: Request, res: Response) => {
    try {
      const question = await storage.getQuestion(req.params.id);
      if (!question || !isSimulation(question.type)) {
        return res.status(404).json({ error: "Question not found" });
      }
      const scope = await visibleTopicScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
      if (!scope.all && !scope.ids.has(question.topicId)) {
        return res.status(404).json({ error: "Question not found" });
      }
      const scenario = (question.dataJson as { scenario: Scenario }).scenario;
      const archive = await buildScenarioArchive(scenario);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="scenario.zip"; filename*=UTF-8''${encodeURIComponent(archiveFileName(scenario.meta.title))}`,
      );
      res.send(archive);
    } catch (error) {
      logger.error("Scenario archive export error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось собрать архив сценария" });
    }
  },
);

// ============================================
// PUT /api/questions/:id - Обновить вопрос
// ============================================
router.put(
  "/:id",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const {
        topicId,
        type,
        prompt,
        promptFormat,
        dataJson,
        correctJson,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        optionFeedbackJson,
        tags,
        orderIndex,
      } = req.body as UpdateQuestionBody;

      if (rejectBase64MediaUrl(mediaUrl, res)) return;

      // PRD-15 FR-05: tag/difficulty/move edits additionally pass the
      // draw-feasibility check against dependent tests (E-3/E-4).
      const existing = await storage.getQuestion(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Question not found" });
      }
      // PRD-15 block C: editing any question requires manage on its topic; a
      // move additionally requires manage on the destination topic.
      if (!(await canManageQuestion(req, existing.topicId))) {
        respondForbiddenContent(res);
        return;
      }
      const movesTopic = topicId !== undefined && topicId !== existing.topicId;
      if (movesTopic && !(await canManageQuestion(req, topicId))) {
        respondForbiddenContent(res);
        return;
      }

      // Правка может СДЕЛАТЬ конфигурацию невыполнимой (поднять минимум, урезать
      // бюджет), поэтому проверка нужна и здесь, а не только на создании. Тип берётся
      // из тела, а при его отсутствии — из сохранённого вопроса.
      if (dataJson !== undefined) {
        const allocationError = allocationConfigError(type ?? existing.type, dataJson);
        if (allocationError) {
          return res.status(422).json({ error: allocationError, field: "dataJson" });
        }
        // PRD-57 FR-28v: по той же причине — предел мог быть поднят правкой, а потолок
        // инстанса мог быть понижен после заведения вопроса.
        const shortAnswerError = shortAnswerConfigError(type ?? existing.type, dataJson);
        if (shortAnswerError) {
          return res.status(422).json({ error: shortAnswerError, field: "dataJson" });
        }
      }
      // Смена типа НА сценарий без нового содержимого оставила бы под типом чужие данные.
      if (dataJson !== undefined || (type !== undefined && type !== existing.type)) {
        const scenarioError = scenarioConfigError(type ?? existing.type, dataJson ?? existing.dataJson);
        if (scenarioError) {
          return res.status(422).json({ error: scenarioError, field: "dataJson" });
        }
      }
      let feasibilityWarnings: unknown[] = [];
      const affectsDelivery = gradingOrDrawFieldsChanged(existing, req.body as UpdateQuestionBody);
      if (affectsDelivery) {
        const nextTags = Array.isArray(tags) ? normalizeTags(tags) : undefined;
        const assessments = [];
        if (nextTags !== undefined || difficulty !== undefined) {
          assessments.push(await assessQuestionChange(req.params.id, { tags: nextTags, difficulty }));
        }
        if (movesTopic) {
          // Leaving the old topic shrinks its pool exactly like a removal.
          assessments.push(await assessQuestionsRemoval([req.params.id]));
        }
        const assessment =
          assessments.length > 0 ? mergeAssessments(assessments) : { blocking: [], warnings: [] };
        if (isDryRun(req)) return respondDryRun(req, res, assessment);
        if (respondIfBlocked(req, res, assessment)) return;
        feasibilityWarnings = assessment.warnings;
      } else if (isDryRun(req)) {
        // Nothing delivery-affecting changes -> the edit is always safe.
        return respondDryRun(req, res, { blocking: [], warnings: [] });
      }

      // PRD-57 §4.3: правка приходит В СВОЁМ формате. Формат, которого клиент не прислал,
      // берётся у самого задания — иначе текст, набранный разметкой, прошёл бы очистку по
      // правилам HTML (или наоборот), и автор получил бы чужую канонизацию своего текста.
      const editFormat = promptFormatOf({ promptFormat: promptFormat ?? existing.promptFormat });
      const canonical = typeof prompt === "string"
        ? normalizePromptByFormat(prompt, editFormat)
        : null;
      const canonicalEdit = canonical?.prompt;

      const questionUpdate = {
        topicId,
        type,
        // A field the client did not send stays `undefined` — the storage layer
        // reads that as «leave unchanged», so normalisation must not turn it
        // into an empty string.
        prompt: canonicalEdit,
        // Формат сохраняется только вместе с присланным текстом: переключение режима без
        // перевода текста означало бы, что то же содержимое читается по другим правилам.
        promptFormat: typeof prompt === "string" ? editFormat : undefined,
        // PRD-57 FR-07: готовые SVG формул кладутся В ЗАДАНИЕ. Требование прямое: при
        // переносе теста между установками картинка едет вместе с вопросом, а не
        // пересчитывается на приёмнике — иначе её вид зависит от версии библиотеки там.
        dataJson: withFormulas(normalizeQuestionData(dataJson), canonicalEdit ?? ""),
        correctJson,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback: normalizeOptionalText(feedback),
        feedbackMode,
        feedbackCorrect: normalizeOptionalText(feedbackCorrect),
        feedbackIncorrect: normalizeOptionalText(feedbackIncorrect),
        // Option texts are re-derived whenever anything they depend on is sent — the
        // texts, the type or the options: switching away from single choice or dropping
        // options must not leave texts behind. Untouched otherwise (`undefined`).
        optionFeedbackJson:
          optionFeedbackJson !== undefined || type !== undefined || dataJson !== undefined
            ? normalizeOptionFeedback(
                optionFeedbackJson !== undefined ? optionFeedbackJson : existing.optionFeedbackJson,
                type ?? existing.type,
                optionCountOf(dataJson ?? existing.dataJson),
                normalizeAuthorText,
              )
            : undefined,
        // Only touch tags when the client sent them; otherwise leave unchanged.
        tags: Array.isArray(tags) ? normalizeTags(tags) : undefined,
        // PRD-30 FR-01: `null` CLEARS the index, `undefined` leaves it alone —
        // the storage layer reads undefined as «unchanged».
        orderIndex,
      };

      // Медиатека §5: пре-реестровый адрес приводится к каноническому в момент правки —
      // так наследие вымывается редактированием, а не миграцией по чужим JSON.
      const payload = await canonicalizeEntityMedia(questionUpdate);

      const updated = await storage.updateQuestion(req.params.id, payload as any);

      if (!updated) {
        return res.status(404).json({ error: "Question not found" });
      }

      // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
      // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
      // чинится пересборкой; потерянное сохранение вопроса не чинится ничем.
      try {
        await syncEntityUsages("question", updated.id, updated);
      } catch (error) {
        logger.error(`Media usage sync failed for question ${updated.id}: ${(error as Error).message}`);
      }

      res.json(
        withSanitizeReport(
          feasibilityWarnings.length > 0 ? { ...updated, warnings: feasibilityWarnings } : updated,
          canonical?.removed ?? [],
        ),
      );
    } catch (error) {
      logger.error("Update question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to update question" });
    }
  }
);

// ============================================
// DELETE /api/questions/:id - Удалить вопрос
// ============================================
// PRD-15 FR-02/FR-05 (E-1/E-3/E-4/E-5): creator/admin only; blocked while
// published tests depend on the question (409 with the dependents list).
router.delete(
  "/:id",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const question = await storage.getQuestion(req.params.id);
      if (!question) {
        return res.status(404).json({ error: "Question not found" });
      }
      if (!(await canManageQuestion(req, question.topicId))) {
        respondForbiddenContent(res);
        return;
      }
      const assessment = await assessQuestionsRemoval([req.params.id]);
      if (isDryRun(req)) return respondDryRun(req, res, assessment);
      if (respondIfBlocked(req, res, assessment)) return;
      const success = await storage.deleteQuestion(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Question not found" });
      }

      // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
      // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
      // чинится пересборкой; потерянное сохранение вопроса не чинится ничем.
      try {
        await syncEntityUsages("question", req.params.id, null);
      } catch (error) {
        logger.error(`Media usage sync failed for question ${req.params.id}: ${(error as Error).message}`);
      }

      res.json({ success: true, warnings: assessment.warnings });
    } catch (error) {
      logger.error("Delete question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to delete question" });
    }
  }
);

// ============================================
// POST /api/questions/bulk-delete - Массовое удаление
// ============================================
// PRD-15 FR-05 (E-10): bulk paths run the same guards as single deletes.
router.post(
  "/bulk-delete",
  requirePermission("questions.manage"),
  async (req: Request<{}, {}, BulkDeleteBody>, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs array required" });
      }
      for (const id of ids) {
        const question = await storage.getQuestion(id);
        if (question && !(await canManageQuestion(req, question.topicId))) {
          respondForbiddenContent(res);
          return;
        }
      }
      const assessment = await assessQuestionsRemoval(ids);
      if (isDryRun(req)) return respondDryRun(req, res, assessment);
      if (respondIfBlocked(req, res, assessment)) return;
      const deletedCount = await storage.deleteQuestionsBulk(ids);
      // Медиатека: сбой чистки индекса не должен стоить автору его удаления (см.
      // тот же выбор в одиночном DELETE /:id выше). `ids` — запрошенные к удалению,
      // не только реально удалённые: очистка несуществующей записи индекса — no-op.
      await clearCascadedUsages(ids.map((id) => ({ entityType: "question" as const, entityId: id })));
      res.json({ success: true, deletedCount, warnings: assessment.warnings });
    } catch (error) {
      logger.error("Bulk delete questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to delete questions" });
    }
  }
);

// ============================================
// POST /api/questions/:id/duplicate - Дублировать вопрос
// ============================================
router.post(
  "/:id/duplicate",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const result = await storage.duplicateQuestion(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Question not found" });
      }

      // Медиатека: дубликат — НОВАЯ сущность со своим id; индексируется под
      // ним, а не под id оригинала. Сбой индексации не должен стоить автору
      // его правки — недостающая строка чинится пересборкой.
      try {
        await syncEntityUsages("question", result.id, result);
      } catch (error) {
        logger.error(`Media usage sync failed for question ${result.id}: ${(error as Error).message}`);
      }

      res.status(201).json(result);
    } catch (error) {
      logger.error("Duplicate question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to duplicate question" });
    }
  }
);

// ============================================
// GET /api/questions/export - Экспорт в Excel
// ============================================
router.get(
  "/export",
  requirePermission("questions.importExport"),
  async (req: Request<{}, {}, {}, ExportQuery>, res: Response) => {
    try {
      let questions = await storage.getQuestions();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      // Собираем ID тем для фильтрации
      let filterTopicIds: string[] = [];

      // Фильтр по testId
      const { testId, topicIds: topicIdsParam } = req.query;
      if (testId) {
        const sections = await storage.getTestSections(testId);
        filterTopicIds = sections.map((s) => s.topicId);
      }

      // Фильтр по topicIds
      if (topicIdsParam) {
        const topicIds = topicIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
        if (topicIds.length > 0) {
          if (filterTopicIds.length > 0) {
            filterTopicIds = [...new Set([...filterTopicIds, ...topicIds])];
          } else {
            filterTopicIds = topicIds;
          }
        }
      }

      // Применяем фильтр
      if (filterTopicIds.length > 0) {
        questions = questions.filter((q) => filterTopicIds.includes(q.topicId));
      }

      // PRD-15 block C (FR-22): never export answer keys from topics the actor
      // cannot see — restrict to the visible scope (admins see everything).
      const scope = await visibleTopicScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
      if (!scope.all) {
        questions = questions.filter((q) => scope.ids.has(q.topicId));
      }

      // Сортировка по теме
      questions.sort((a, b) => {
        const topicA = topicMap.get(a.topicId) || "";
        const topicB = topicMap.get(b.topicId) || "";
        return topicA.localeCompare(topicB, "ru");
      });

      // Формируем строки (общая сериализация — server/services/questions-export.ts)
      // Сценарии в книгу не идут: строка без их содержимого при обратном импорте была бы
      // пропущена, а книга обещает перенос без потерь. Сценарий переносится своим архивом.
      const rows = questions
        .filter((q) => !isSimulation(q.type))
        .map((q) => serializeQuestionRow(q, topicMap.get(q.topicId) || ""));

      const wb = new ExcelJS.Workbook();
      addJsonSheet(wb, "Вопросы", rows, QUESTION_WIDTHS);

      const buffer = await workbookToBuffer(wb);

      const timestamp = new Date().toISOString().slice(0, 10);
      let filename = `questions_${timestamp}.xlsx`;
      if (testId) {
        const test = await storage.getTest(testId);
        if (test) {
          const safeName = test.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_").slice(0, 30);
          filename = `questions_${safeName}_${timestamp}.xlsx`;
        }
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Export questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to export questions" });
    }
  }
);

// ============================================
// GET /api/questions/template - Шаблон Excel для импорта (PRD-14 Ф2, FR-12)
// ============================================
// Canonical column order (must match the export — see спецификация формата §3).
// T-40: «Балл» / «Цена ответа» left the bank sheet — scoring is a property of
// the test (the test-scoped «Оценка» sheet of the workbook), not the question.
// The template's columns ARE the export's columns — a hand-kept copy of the list
// is how a template silently lags behind the format it is supposed to seed.
const TEMPLATE_HEADERS = QUESTION_HEADERS;

router.get(
  "/template",
  requirePermission("questions.importExport"),
  async (_req: Request, res: Response) => {
    try {
      const wb = new ExcelJS.Workbook();
      // Sheet 1 — headers only (the author fills rows below).
      addAoaSheet(wb, "Вопросы", [TEMPLATE_HEADERS],
        [36, 25, 18, 50, 12, 60, 25, 15, 40, 25, 12, 30, 30]);

      // Sheet 2 — format reference per column / question type.
      const help: string[][] = [
        ["Колонка", "Описание / формат"],
        ["ID", "Пусто — создать вопрос; заполнен и найден — обновить (см. экспорт)"],
        ["Тема", "Обязательно. Имя темы; если её нет — будет создана"],
        ["Тип вопроса", "Обязательно. multiple_choice | multiple_response | matching | ranking | scale"],
        ["Текст вопроса", "Обязательно. Формулировка"],
        ["Сложность", "Целое 0..100; по умолчанию 50"],
        ["Тексты вариантов ответа", "Разделитель вариантов — #. Для matching: «лево # ... || право # ...». Для scale — градации по порядку, от полюса к полюсу"],
        ["Номера правильных ответов", "1-based. multiple_choice: «2». multiple_response: «1,3». matching: «1-1, 2-2». ranking: порядок «3,1,2». scale: один номер ЛИБО пусто — пустая ячейка означает вопрос без правильного ответа"],
        ["Следование вариантов ответов", "Random (по умолчанию) | Fixed. К типу scale не применяется: градации не перемешиваются"],
        ["Обратная связь", "Общая обратная связь (режим «общая»)"],
        ["Теги", "Список; разделители «;» и «,». Напр.: финансы; учёт"],
        ["Режим ОС", "общая (по умолчанию) | условная"],
        ["ОС при верном", "Текст; только при режиме «условная»"],
        ["ОС при неверном", "Текст; только при режиме «условная»"],
        ["ОС по вариантам", "Только multiple_choice: тексты через «#» в порядке вариантов; пустой слот — у варианта свой текст не задан и показывается обратная связь вопроса. Напр.: « # Почему не B # »"],
        ["", ""],
        ["Балл и «Цена ответа»", "Здесь их нет: сколько стоит вопрос — свойство ТЕСТА, а не вопроса (один вопрос может стоить по-разному в разных тестах). Задаются на листе «Оценка» книги теста: раздел «Импорт» → «Скачать шаблон»"],
        ["Пример (multiple_choice)", "Варианты «A # B # C», правильный «2»"],
        ["Пример (multiple_response)", "Варианты «A # B # C», правильные «1,3»"],
        ["Пример (matching)", "«Кошка # Собака || Мяу # Гав # Буль», пары «1-1, 2-2» (третий вариант справа — ловушка)"],
        ["Пример (ranking)", "Элементы «Шаг А # Шаг Б # Шаг В», порядок «3,1,2» — сначала 3-й элемент, затем 1-й, затем 2-й"],
        ["Пример (scale)", "Градации «Никогда # Редко # Иногда # Часто # Постоянно», правильный ответ ПУСТО — опросник без верных и неверных ответов"],
      ];
      addAoaSheet(wb, "Справка", help, [32, 90]);

      const buffer = await workbookToBuffer(wb);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("questions_template.xlsx")}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Questions template error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to build template" });
    }
  }
);

// ============================================
// POST /api/questions/import - Импорт из Excel
// ============================================
// `?dryRun=true` (FR-13): валидирует и считает план без записи в БД.
router.post(
  "/import",
  requirePermission("questions.importExport"),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "File required" });
      }

      const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";

      const workbook = await readWorkbookFromBuffer(req.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: "File is empty" });

      const result = await importQuestionRows(
        sheetToObjects(sheet),
        sheetHeaders(sheet),
        {
          dryRun,
          // PRD-15 FR-02/FR-05: import respects the same creator and
          // feasibility guards as the editor path.
          actor: req.currentUser
            ? { id: req.currentUser.id, roles: req.effectiveRoles ?? [] }
            : undefined,
        },
      );

      res.json({
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        dryRun,
      });
    } catch (error) {
      logger.error("Import questions error: " + (error as Error).message);
      if (respondWorkbookReadError(res, error)) return;
      res.status(500).json({ error: "Failed to import questions" });
    }
  }
);

export default router;
