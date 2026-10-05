/**
 * @module features/questions/question-editor-drawer
 * @description Reusable question editor mounted in a Skillum design-system
 * Drawer, used by both the question bank and the `/author/content` section.
 * The field layout follows the approved wireframe
 * (docs/wireframes/approved/content-bank-explorer.html, state s-q-drawer):
 * Тема (Select with `searchable` + a reset button — the bank holds hundreds of
 * topics) -> Тип (Select) -> Текст -> Варианты (per-type builder with
 * drag-reorder handles) -> «Случайный порядок вариантов» -> Сложность
 * (nullable, PRD-16) -> Медиа -> Теги, with the additive (non-wireframe)
 * blocks — conditional feedback and the PRD-15 price-moved hint — appended
 * after the tags. Holds all editor-local state: the react-hook-form bridge,
 * the active question type, the per-type answer builders
 * (single/multiple/matching/ranking), media attachment + upload, conditional
 * feedback, sub-topic tags (PRD-11), difficulty and per-question shuffle.
 * Create vs. edit is driven by the `question` prop. Edits run through the
 * PRD-15 content guard (T-12) and render the {@link ContentImpactDialog}
 * locally; creates go straight through the create mutation.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isAllocationFeasible } from "@shared/questions/allocation";
import { isTextEntry } from "@shared/questions/question-type";
import { AnswerRulesBlock } from "./answer-rules/answer-rules-block";
import { BlanksBlock } from "./answer-rules/blanks-block";
import type { BlankRuleSet } from "@shared/questions/blanks-render";
import {
  createDraft as createAnswerRulesDraft,
  isDirty as answerRulesDirty,
  toCorrectJson as answerRulesToCorrectJson,
  type AnswerRulesDraft,
} from "./answer-rules/answer-rules-model";
import type { AnswerRuleSet } from "@shared/answer-check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BarChart3, Braces, Code, Plus, Sigma, Trash2, GripVertical } from "lucide-react";
import { useLocation } from "wouter";
import { bankQuestionHref } from "@/features/analytics/levels/analytics-routes";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Banner,
  Box,
  Button,
  Checkbox,
  Cluster,
  Drawer,
  FileUploader,
  FormGroup,
  IconButton,
  Input,
  Label,
  MenuItem,
  MenuTrigger,
  ModalDialog,
  NumberInput,
  Radio,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Tag,
  Text,
  Textarea,
  useToast,
} from "@skillum/ui-kit";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { t } from "@/lib/i18n";
import { handleMarkdownPaste } from "./paste-markdown";
import { insertMarkup, CODE_LANGUAGES, type MarkupKind } from "./insert-markup";
import { promptFormatOf, type PromptFormat } from "@shared/questions/prompt-format";
import { describeModeSwitch, convertPrompt, type ModeSwitchReport } from "@shared/text/mode-switch";
import { QuestionPreviewModal } from "./question-preview-modal";
import { removalPhrases } from "./sanitize-report";
import type { SanitizeRemoval } from "@shared/security/html-sanitize";
import { RichPromptEditor } from "./rich-prompt-editor";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import type { Question, Topic } from "@shared/schema";
import { TagsInput } from "@/pages/author/tags-input";
import { useOptionalAuth } from "@/lib/auth";

/** PRD-70 FR-13: ориентир сложности «По ответам» — свод наблюдаемой сложности по тестам. */
interface DifficultyLandmark {
  hardness: number;
  tests: number;
  observations: number;
}

/** Русская форма числительного: формы для 1, 2–4 и 5+. */
function pluralForm(n: number, [one, few, many]: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const questionTypes = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
  { value: "scale", label: t.questions.scaleChoice },
  { value: "allocation", label: t.questions.allocation },
  { value: "short", label: t.questions.shortAnswer },
  { value: "blanks", label: t.questions.blanks },
  { value: "long", label: t.questions.longAnswer },
] as const;

type QuestionType = typeof questionTypes[number]["value"];

// PRD-15 block D (FR-35): the question card carries CONTENT only — the price
// and the graded config are configured per test («Оценка» tab of the editor).
const baseQuestionSchema = z.object({
  topicId: z.string().min(1, t.questions.topicRequired),
  type: z.enum(["single", "multiple", "matching", "ranking", "scale", "allocation", "short", "blanks", "long"]),
  prompt: z.string().min(1, t.questions.textRequired),
});

export interface QuestionEditorDrawerProps {
  /** Whether the Drawer is open. */
  open: boolean;
  /** The question to edit, or `null` to create a new one. */
  question: Question | null;
  /** Pre-selected topic for a new question (create mode only). */
  defaultTopicId?: string;
  /** Topic options for the topic select. */
  topics: Topic[];
  /** Tag autocomplete suggestions (distinct tags across the bank). */
  tagSuggestions?: string[];
  /** Close the Drawer (cancel or after a successful save). */
  onClose: () => void;
  /** Called after a successful create/update (e.g. to invalidate + toast). */
  onSaved?: () => void;
}

/**
 * The reusable question editor. Initializes its draft from `question` (edit) or
 * an empty draft seeded with `defaultTopicId` (create) every time it opens.
 */
export function QuestionEditorDrawer({
  open,
  question,
  defaultTopicId,
  topics,
  tagSuggestions = [],
  onClose,
  onSaved,
}: QuestionEditorDrawerProps) {
  const { push: toast } = useToast();
  const contentGuard = useContentGuard();
  // PRD-70 FR-31: ориентир «По ответам» над шкалой сложности — у сохранённого вопроса и только
  // с правом на аналитику: он из неё.
  const auth = useOptionalAuth();
  const canAnalytics = Boolean(question?.id) && (auth?.can("analytics.read") ?? false);
  const { data: landmarkData } = useQuery<{ landmark: DifficultyLandmark | null }>({
    queryKey: [`/api/analytics/questions/${question?.id}/difficulty-landmark`],
    enabled: open && canAnalytics,
  });
  const landmark = landmarkData?.landmark ?? null;
  const [, navigate] = useLocation();

  const [selectedType, setSelectedType] = useState<QuestionType>("single");
  // PRD-57 §6.1: черновик набора правил держит ОБА вида ответа, поэтому он живёт
  // здесь, а не внутри блока — иначе переключение вида пересоздавало бы состояние.
  const [answerRules, setAnswerRules] = useState<AnswerRulesDraft>(() => createAnswerRulesDraft(null));
  // PRD-57 FR-28v: предел длины — свойство ВОПРОСА, поэтому он рядом с черновиком правил,
  // а не внутри него. `undefined` означает «системный предел».
  const [shortMaxLength, setShortMaxLength] = useState<number | undefined>(undefined);
  // PRD-57 FR-24: наборы правил ПО ПРОПУСКАМ. Список строится из текста задания, поэтому
  // здесь лежат только правила — имена приходят из `prompt`.
  const [blanks, setBlanks] = useState<BlankRuleSet[]>([]);
  // PRD-57 FR-12: автор задаёт подсказку-заполнитель, предел длины и обязательность.
  const [longPlaceholder, setLongPlaceholder] = useState<string>("");
  const [longMaxLength, setLongMaxLength] = useState<number | undefined>(undefined);
  const [longRequired, setLongRequired] = useState<boolean>(false);
  /** Поле текста задания: вставка разметки идёт В ПОЗИЦИЮ КУРСОРА. */
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  /** FR-24g: предпросмотр — окно по кнопке подвала, а не постоянный блок в ящике. */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** PRD-57 §4.3: режим, в котором автор набирает текст задания. */
  const [promptFormat, setPromptFormat] = useState<PromptFormat>("markdown");
  /**
   * Ключ перепривязки визуального поля: растёт, когда текст заменили НЕ набором —
   * переключением режима, вставкой кнопкой или открытием другого задания.
   */
  const [promptSyncKey, setPromptSyncKey] = useState(0);
  /** Переход, о котором спрашивают автора: отчёт считается ДО перевода (FR-09c). */
  const [modeSwitch, setModeSwitch] = useState<{ to: PromptFormat; report: ModeSwitchReport } | null>(null);
  /**
   * PRD-57, согласованный эскиз `prd57-question-text.html` (состояние `s-diag`): что
   * санитайзер вырезал из текста при последнем сохранении, и каким текст после этого стал.
   *
   * Пока находки есть, ящик НЕ закрывается: сохранение уже состоялось, но закрытие
   * оставило бы автора с единственным наблюдением — «текст изменился сам». Текст держится
   * рядом, чтобы баннер погас, как только автор начнёт править: он говорит о ТОМ
   * сохранении, а не о том, что в поле сейчас.
   */
  const [sanitizeReport, setSanitizeReport] = useState<{ removed: SanitizeRemoval[]; prompt: string } | null>(null);
  /**
   * Вопрос, СОЗДАННЫЙ этим ящиком и оставленный открытым ради диагностики. Следующее
   * сохранение обязано быть правкой его: иначе одно нажатие «Создать» завело бы в банке
   * два задания с одним текстом.
   */
  const [createdQuestion, setCreatedQuestion] = useState<Question | null>(null);
  /**
   * Сохранение состоялось, а список ещё не обновляли: ящик задержан баннером. Два из трёх
   * мест монтирования закрывают ящик прямо в `onSaved`, поэтому обновление откладывается
   * до закрытия, а не зовётся сразу.
   */
  const [savedPending, setSavedPending] = useState(false);
  /**
   * Баннер диагностики стоит первым в теле ящика, а тело к моменту сохранения прокручено
   * туда, где автор работал: в приёмке 2026-09-20 находки оказались на 145 пикселей выше
   * видимого. Ссылка нужна, чтобы подвести их к глазам, — иначе показ ничем не отличается
   * от молчания, ради снятия которого всё и делалось.
   */
  const sanitizeBannerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Вставить разметку кнопкой панели — листинг, формулу или пропуск (FR-09a, FR-24b).
   *
   * Что именно вставляется и где остаётся курсор, решает {@link insertMarkup}: здесь
   * только чтение положения курсора и запись результата в форму. Курсор ставится
   * СЛЕДУЮЩИМ тиком: React вернёт значение из формы, и позиция, выставленная до
   * перерисовки, потерялась бы.
   */
  const insertAt = (kind: MarkupKind, language?: string) => {
    const field = promptRef.current;
    const value = form.getValues("prompt") ?? "";
    const from = field?.selectionStart ?? value.length;
    const to = field?.selectionEnd ?? from;
    const result = insertMarkup({ kind, language, value, from, to });
    form.setValue("prompt", result.value, { shouldDirty: true });
    setPromptSyncKey((key) => key + 1);
    window.setTimeout(() => {
      field?.focus();
      field?.setSelectionRange(result.caret, result.caret);
    }, 0);
  };

  const [singleOptions, setSingleOptions] = useState<string[]>(["", "", "", ""]);
  const [singleCorrect, setSingleCorrect] = useState<number>(0);

  // PRD-26: шкала переиспользует состояние одиночного выбора (dataJson у них
  // идентичен), поэтому смена типа single <-> scale сохраняет и подписи, и отметку.
  // Своё у шкалы только одно — есть ли вообще правильная градация (FR-03).
  const [scaleHasCorrect, setScaleHasCorrect] = useState<boolean>(false);
  // PRD-44: бюджет и домен варианта. Пустая строка означает «не задано» и на
  // сохранении превращается в умолчание (минимум 0, максимум — весь бюджет).
  const [allocBudget, setAllocBudget] = useState<string>("7");
  const [allocMin, setAllocMin] = useState<string>("");
  const [allocMax, setAllocMax] = useState<string>("");

  const [multipleOptions, setMultipleOptions] = useState<string[]>(["", "", "", ""]);
  const [multipleCorrect, setMultipleCorrect] = useState<number[]>([]);

  const [matchingLeft, setMatchingLeft] = useState<string[]>(["", "", ""]);
  const [matchingRight, setMatchingRight] = useState<string[]>(["", "", ""]);
  const [matchingPairs, setMatchingPairs] = useState<{ left: number; right: number }[]>([]);

  const [rankingItems, setRankingItems] = useState<string[]>(["", "", "", ""]);

  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"image" | "audio" | "video" | "">("");
  const [mediaFileName, setMediaFileName] = useState<string>("");
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [shuffleAnswers, setShuffleAnswers] = useState<boolean>(true);
  // PRD-16: difficulty is unset («Не задано») by default for a new question.
  const [difficulty, setDifficulty] = useState<number | null>(null);
  // PRD-30 FR-01: «Индекс в теме» — empty means «не задано» (delivered last).
  const [orderIndex, setOrderIndex] = useState<number | null>(null);
  const [feedbackMode, setFeedbackMode] = useState<"general" | "conditional">("general");
  const [feedback, setFeedback] = useState<string>("");
  const [feedbackCorrect, setFeedbackCorrect] = useState<string>("");
  const [feedbackIncorrect, setFeedbackIncorrect] = useState<string>("");
  // PRD-11 §3a: sub-topic tags (chip input). By these tags the author sets draw quotas.
  const [tags, setTags] = useState<string[]>([]);


  const form = useForm({
    resolver: zodResolver(baseQuestionSchema),
    defaultValues: {
      topicId: "",
      type: "single" as QuestionType,
      prompt: "",
    },
  });

  /**
   * Разобрать ответ состоявшегося сохранения (PRD-57, эскиз `prd57-question-text.html`).
   *
   * Обычный исход прежний: обновить списки, сказать об успехе и закрыть ящик. Но если
   * санитайзер что-то вырезал, ящик ОСТАЁТСЯ открытым с баннером и сохранённым текстом в
   * поле — только так автор увидит, что именно исчезло и что его текст теперь другой.
   * Обновление списка при этом откладывается до закрытия: часть хозяев ящика закрывает его
   * прямо в `onSaved`, и вызвать его здесь значило бы погасить баннер, не показав.
   *
   * @param payload Тело успешного ответа маршрута.
   * @param created Сохранение было созданием, а не правкой.
   */
  const settleSave = (payload: unknown, created: boolean) => {
    const saved = (payload ?? {}) as Question & { promptSanitizeRemoved?: SanitizeRemoval[] };
    const removed = Array.isArray(saved.promptSanitizeRemoved) ? saved.promptSanitizeRemoved : [];
    queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
    toast(
      created
        ? { tone: "success", title: t.questions.questionCreated, description: t.questions.questionCreatedDescription }
        : { tone: "success", title: t.questions.questionUpdated, description: t.questions.questionUpdatedDescription },
    );
    if (removed.length === 0) {
      onSaved?.();
      onClose();
      return;
    }
    const storedPrompt = typeof saved.prompt === "string" ? saved.prompt : (form.getValues("prompt") ?? "");
    form.setValue("prompt", storedPrompt);
    setPromptSyncKey((key) => key + 1);
    setSanitizeReport({ removed, prompt: storedPrompt });
    if (created && saved.id) setCreatedQuestion(saved);
    setSavedPending(true);
  };

  /**
   * Закрыть ящик, не потеряв обновление списка, отложенное баннером диагностики.
   */
  const closeDrawer = () => {
    if (savedPending) onSaved?.();
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/questions", data),
    onSuccess: async (res: Response) => {
      settleSave(await res.json().catch(() => undefined), true);
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.questions.failedToCreate });
    },
  });

  const resetQuestionData = () => {
    setSingleOptions(["", "", "", ""]);
    setSingleCorrect(0);
    setScaleHasCorrect(false);
    setMultipleOptions(["", "", "", ""]);
    setMultipleCorrect([]);
    setMatchingLeft(["", "", ""]);
    setMatchingRight(["", "", ""]);
    setMatchingPairs([]);
    setRankingItems(["", "", "", ""]);
    setMediaUrl("");
    setMediaType("");
    setShuffleAnswers(true);
    setDifficulty(null);
    setOrderIndex(null);
    setFeedbackMode("general");
    setFeedback("");
    setFeedbackCorrect("");
    setFeedbackIncorrect("");
    setTags([]);
    setMediaFileName("");
    setAnswerRules(createAnswerRulesDraft(null));
    setBlanks([]);
    setLongPlaceholder("");
    setLongMaxLength(undefined);
    setLongRequired(false);
    setShortMaxLength(undefined);
  };

  // Находки показываются там, где автор смотрит: тело ящика подводится к баннеру.
  // `scrollIntoView` вызывается через `?.` — в jsdom метода нет, и прямой вызов уронил бы
  // набор, ничего не проверив.
  useEffect(() => {
    if (!sanitizeReport) return;
    sanitizeBannerRef.current?.scrollIntoView?.({ block: "start" });
  }, [sanitizeReport]);

  // Initialize the draft when the Drawer opens: from `question` (edit) or as an
  // empty draft seeded with `defaultTopicId` (create). Mirrors the old
  // handleOpenCreate / handleOpenEdit handlers exactly.
  useEffect(() => {
    if (!open) return;
    // Диагностика прошлого сохранения принадлежит прошлому заданию: открытие ящика
    // начинает всё заново, иначе баннер пережил бы вопрос, о котором говорил.
    setSanitizeReport(null);
    setCreatedQuestion(null);
    setSavedPending(false);
    if (question) {
      form.reset({
        topicId: question.topicId,
        type: question.type as QuestionType,
        prompt: question.prompt,
      });
      setSelectedType(question.type as QuestionType);
      setPromptFormat(promptFormatOf(question as { promptFormat?: unknown }));
      setPromptSyncKey((key) => key + 1);

      const data = question.dataJson as any;
      const correct = question.correctJson as any;

      if (question.type === "single") {
        setSingleOptions(data.options || ["", "", "", ""]);
        setSingleCorrect(correct.correctIndex || 0);
      } else if (question.type === "multiple") {
        setMultipleOptions(data.options || ["", "", "", ""]);
        setMultipleCorrect(correct.correctIndices || []);
      } else if (question.type === "matching") {
        setMatchingLeft(data.left || ["", "", ""]);
        setMatchingRight(data.right || ["", "", ""]);
        setMatchingPairs(correct.pairs || []);
      } else if (question.type === "ranking") {
        setRankingItems(data.items || ["", "", "", ""]);
      } else if (question.type === "allocation") {
        setSingleOptions(data.options || ["", "", "", ""]);
        setAllocBudget(String(data.budget ?? 7));
        setAllocMin(data.minPerOption === undefined || data.minPerOption === null ? "" : String(data.minPerOption));
        setAllocMax(data.maxPerOption === undefined || data.maxPerOption === null ? "" : String(data.maxPerOption));
      } else if (question.type === "long") {
        const data = (question.dataJson ?? {}) as { placeholder?: string; maxLength?: number; required?: boolean };
        setLongPlaceholder(typeof data.placeholder === "string" ? data.placeholder : "");
        setLongMaxLength(typeof data.maxLength === "number" ? data.maxLength : undefined);
        setLongRequired(data.required === true);
      } else if (question.type === "blanks") {
        const key = (question.correctJson ?? {}) as { blanks?: BlankRuleSet[] };
        setBlanks(Array.isArray(key.blanks) ? key.blanks : []);
      } else if (question.type === "short") {
        setAnswerRules(createAnswerRulesDraft(correct as AnswerRuleSet));
        setShortMaxLength(typeof data?.maxLength === "number" ? data.maxLength : undefined);
      } else if (question.type === "scale") {
        setSingleOptions(data.options || ["", "", "", ""]);
        // Наличие correctIndex И ЕСТЬ положение переключателя (FR-03).
        setScaleHasCorrect(typeof correct?.correctIndex === "number");
        setSingleCorrect(typeof correct?.correctIndex === "number" ? correct.correctIndex : 0);
      }

      setMediaUrl(question.mediaUrl || "");
      setMediaType((question.mediaType as "image" | "audio" | "video" | "") || "");
      setShuffleAnswers(question.shuffleAnswers !== false);
      setDifficulty(question.difficulty);
      setOrderIndex(question.orderIndex ?? null);
      setFeedbackMode((question.feedbackMode as "general" | "conditional") || "general");
      setFeedback(question.feedback || "");
      setFeedbackCorrect(question.feedbackCorrect || "");
      setFeedbackIncorrect(question.feedbackIncorrect || "");
      setTags(Array.isArray(question.tags) ? question.tags : []);
    } else {
      form.reset({ topicId: defaultTopicId ?? "", type: "single", prompt: "" });
      setSelectedType("single");
      setPromptFormat("markdown");
      setPromptSyncKey((key) => key + 1);
      resetQuestionData();
    }
    // Re-init only when (re)opening or switching the target question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, question]);

  const guessMediaType = (mime: string): "image" | "audio" | "video" | "" => {
    if (!mime) return "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    return "";
  };
  const isDataUrl = (v: string) => v.trim().startsWith("data:");
  const clearMedia = () => {
    setMediaUrl("");
    setMediaType("");
    setMediaFileName("");
  };

  // PRD-16 FR-20/21: media is upload-only (no free URL); type is derived from MIME.
  const uploadMediaFile = async (file: File) => {
    const MAX_MB = 200;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ tone: "error", title: t.common.error, description: `Файл слишком большой (>${MAX_MB}MB).` });
      return;
    }
    const mt = guessMediaType(file.type);
    if (!mt) {
      toast({ tone: "error", title: t.common.error, description: "Поддерживаются только image/audio/video." });
      return;
    }
    setIsUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/media/upload", { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      const payload: { url: string; mime?: string } = await response.json();
      setMediaUrl(payload.url);
      setMediaType(guessMediaType(payload.mime || file.type) || mt);
      setMediaFileName(file.name);
    } catch (err) {
      console.error(err);
      toast({ tone: "error", title: t.common.error, description: "Не удалось загрузить файл. Проверь права (author) и размер." });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const buildQuestionData = () => {
    let dataJson: any;
    let correctJson: any;

    switch (selectedType) {
      case "single":
        dataJson = { options: singleOptions.filter((o) => o.trim()) };
        correctJson = { correctIndex: singleCorrect };
        break;
      case "multiple":
        dataJson = { options: multipleOptions.filter((o) => o.trim()) };
        correctJson = { correctIndices: multipleCorrect };
        break;
      case "matching":
        dataJson = {
          left: matchingLeft.filter((l) => l.trim()),
          right: matchingRight.filter((r) => r.trim()),
        };
        correctJson = { pairs: matchingPairs };
        break;
      case "ranking":
        dataJson = { items: rankingItems.filter((i) => i.trim()) };
        correctJson = { correctOrder: rankingItems.map((_, i) => i) };
        break;
      case "allocation": {
        // Правильного распределения не существует, поэтому correctJson ПУСТОЙ объект,
        // а не null: колонка correct_json объявлена NOT NULL (FR-03).
        const options = singleOptions.filter((o) => o.trim());
        const budget = Number(allocBudget) || 0;
        dataJson = {
          options,
          budget,
          minPerOption: allocMin.trim() === "" ? 0 : Number(allocMin),
          maxPerOption: allocMax.trim() === "" ? budget : Number(allocMax),
        };
        correctJson = {};
        break;
      }
      case "short":
        // У текстового ввода нет вариантов: всё содержимое задания — предел длины ответа
        // (FR-28v), а эталон — набор правил сравнения (§6.1).
        dataJson = shortMaxLength === undefined ? {} : { maxLength: shortMaxLength };
        correctJson = answerRulesToCorrectJson(answerRules);
        break;
      case "long":
        // PRD-57 §5: содержимое — подсказка, предел длины и обязательность; эталона у
        // типа нет ВООБЩЕ, поэтому `correct_json` пуст (FR-13).
        dataJson = {
          ...(longPlaceholder.trim() ? { placeholder: longPlaceholder.trim() } : {}),
          ...(longMaxLength === undefined ? {} : { maxLength: longMaxLength }),
          ...(longRequired ? { required: true } : {}),
        };
        correctJson = {};
        break;
      case "blanks":
        // Содержимого у задания нет: текст с пропусками ЕСТЬ содержимое, а эталон —
        // наборы правил по пропускам (FR-24c).
        dataJson = {};
        correctJson = { blanks };
        break;
      case "scale":
        dataJson = { options: singleOptions.filter((o) => o.trim()) };
        // Переключатель выключен — измерительный режим: ПУСТОЙ объект, а не null
        // (колонка correct_json объявлена NOT NULL).
        correctJson = scaleHasCorrect ? { correctIndex: singleCorrect } : {};
        break;
    }

    return { dataJson, correctJson };
  };

  /**
   * Сменить режим ввода (FR-09c).
   *
   * Молча не переводит: сначала считается отчёт, и если ему есть что сказать — автор
   * решает сам. Перевод и отчёт делает ОДИН модуль, поэтому обещанное и случившееся
   * совпадают по построению.
   */
  const requestModeSwitch = (next: PromptFormat) => {
    if (next === promptFormat) return;
    const report = describeModeSwitch(promptFormat, next, form.getValues("prompt") ?? "");
    if (report.losses.length === 0 && report.notes.length === 0) {
      applyModeSwitch(next);
      return;
    }
    setModeSwitch({ to: next, report });
  };

  const applyModeSwitch = (next: PromptFormat) => {
    const converted = convertPrompt(promptFormat, next, form.getValues("prompt") ?? "");
    form.setValue("prompt", converted, { shouldDirty: true });
    setPromptSyncKey((key) => key + 1);
    setPromptFormat(next);
    setModeSwitch(null);
  };

  const onSubmit = (formData: any) => {
    const { dataJson, correctJson } = buildQuestionData();
    if (isUploadingMedia) {
      toast({
        tone: "error",
        title: t.common.error,
        description: "Дождись окончания загрузки медиа.",
      });
      return;
    }

    if (mediaUrl && isDataUrl(mediaUrl)) {
      toast({
        tone: "error",
        title: t.common.error,
        description: "Нельзя сохранять медиа как base64 в JSON. Используй кнопку \"Загрузить файл\".",
      });
      return;
    }
    const data = {
      ...formData,
      // PRD-57 §4.3: формат едет вместе с текстом — иначе набранное тегами прочитается
      // как разметка, и участник увидит теги.
      promptFormat,
      dataJson,
      correctJson,
      mediaUrl: mediaUrl.trim() || null,
      mediaType: mediaType || null,
      shuffleAnswers,
      difficulty,
      // PRD-30 FR-01: null CLEARS the index — «не задано» is a value.
      orderIndex,
      feedbackMode,
      feedback: feedbackMode === "general" ? (feedback.trim() || null) : null,
      feedbackCorrect: feedbackMode === "conditional" ? (feedbackCorrect.trim() || null) : null,
      feedbackIncorrect: feedbackMode === "conditional" ? (feedbackIncorrect.trim() || null) : null,
      tags,
    };

    // Вопрос, созданный этим же ящиком и оставленный открытым ради диагностики, дальше
    // ПРАВИТСЯ: второе «Создать» завело бы в банке дубль с тем же текстом.
    const target = question ?? createdQuestion;
    if (target) {
      // PRD-15 T-12: edits that affect delivery/grading of published tests are
      // gated by the content guard (dry-run first). A clean edit saves directly;
      // a warning-only edit asks for confirmation; a blocking one shows the 409.
      contentGuard.guard({
        url: `/api/questions/${target.id}`,
        method: "PUT",
        body: data,
        blockTitle: "Вопрос нельзя изменить: правка ломает опубликованные тесты",
        blockDescription:
          "Изменение состава, баллов или тегов нарушит выдачу или оценивание опубликованных тестов.",
        warnTitle: "Сохранить изменения? Это затронет другие тесты",
        warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
        confirmLabel: "Сохранить изменения",
        confirmVariant: "primary",
        onDone: (result) => settleSave(result, false),
      });
    } else {
      createMutation.mutate(data);
    }
  };

  // PRD-16 FR-31: live validation — errors shown as a banner, save blocked.
  const watchedTopicId = form.watch("topicId");
  const watchedPrompt = form.watch("prompt");
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!watchedTopicId) errs.push(t.questions.topicRequired);
    if (!watchedPrompt || !watchedPrompt.trim()) errs.push(t.questions.textRequired);
    if (selectedType === "single") {
      if (singleOptions.filter((o) => o.trim()).length < 2) errs.push("Добавьте не менее двух вариантов ответа");
      else if (!singleOptions[singleCorrect]?.trim()) errs.push("Отметьте правильный вариант");
    } else if (selectedType === "multiple") {
      if (multipleOptions.filter((o) => o.trim()).length < 2) errs.push("Добавьте не менее двух вариантов ответа");
      else if (multipleCorrect.length === 0) errs.push("Отметьте хотя бы один правильный вариант");
    } else if (selectedType === "matching") {
      const left = matchingLeft.filter((l) => l.trim()).length;
      const right = matchingRight.filter((r) => r.trim()).length;
      if (left < 1 || right < 1) errs.push("Заполните левую и правую колонки");
      else if (matchingPairs.length < left) errs.push("Сопоставьте все пары");
    } else if (selectedType === "ranking") {
      if (rankingItems.filter((i) => i.trim()).length < 2) errs.push("Добавьте не менее двух элементов");
    } else if (selectedType === "allocation") {
      const options = singleOptions.filter((o) => o.trim());
      const budget = Number(allocBudget);
      if (options.length < 2) errs.push("Добавьте не менее двух утверждений");
      else if (options.length > 10) errs.push("Утверждений должно быть не больше десяти");
      if (!Number.isInteger(budget) || budget < 1 || budget > 1000) {
        errs.push("Бюджет — целое число от 1 до 1000");
      } else {
        const min = allocMin.trim() === "" ? 0 : Number(allocMin);
        const max = allocMax.trim() === "" ? budget : Number(allocMax);
        if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 0) {
          errs.push("Минимум и максимум на вариант — целые неотрицательные числа");
        } else if (min > max) {
          errs.push("Минимум на вариант не может превышать максимум");
        } else if (max > budget) {
          errs.push("Максимум на вариант не может превышать бюджет");
        } else if (options.length >= 2) {
          // Сообщение называет ЧИСЛА: «невыполнимо» само по себе оставляет автора
          // гадать, какое из трёх полей менять (FR-05).
          const feasibility = isAllocationFeasible({ options, budget, minPerOption: min, maxPerOption: max });
          if (!feasibility.ok) {
            errs.push(
              feasibility.kind === "min"
                ? `Распределение невыполнимо: минимумы требуют ${feasibility.required} баллов, а бюджет — ${feasibility.available}`
                : `Распределение невыполнимо: нужно распределить ${feasibility.required} баллов, а максимумы дают только ${feasibility.available}`,
            );
          }
        }
      }
    } else if (selectedType === "scale") {
      // Правильная градация обязательна ТОЛЬКО когда включён переключатель:
      // измерительный опросник валиден и без неё.
      if (singleOptions.filter((o) => o.trim()).length < 2) errs.push(t.questions.scaleErrorTooFewGraduations);
      else if (scaleHasCorrect && !singleOptions[singleCorrect]?.trim()) errs.push(t.questions.scaleErrorNoCorrect);
    }
    return errs;
  }, [watchedTopicId, watchedPrompt, selectedType, singleOptions, singleCorrect, scaleHasCorrect, allocBudget, allocMin, allocMax, multipleOptions, multipleCorrect, matchingLeft, matchingRight, matchingPairs, rankingItems]);

  /** Option/item texts of the active type — the list carried across type changes. */
  const currentOptionTexts = (): string[] => {
    switch (selectedType) {
      case "single": return singleOptions;
      // Шкала делит состояние с одиночным выбором — тот же список подписей.
      case "scale": return singleOptions;
      // Распределение делит список подписей с одиночным выбором — как и шкала.
      case "allocation": return singleOptions;
      case "multiple": return multipleOptions;
      case "ranking": return rankingItems;
      case "matching": return matchingLeft;
      default: return [];
    }
  };

  // PRD-16 FR-32: switching the question type KEEPS the entered options — only
  // the answer structure (single correct / multiple correct / pairs / order) is
  // re-derived. Per-type state arrays are left intact, so toggling back restores
  // that type's specifics (e.g. the matching right column). The shared text list
  // is the current type's options (the matching LEFT column when coming from it).
  const applyTypeChange = (next: QuestionType) => {
    if (next === selectedType) return;
    const prev = selectedType;
    const texts = currentOptionTexts();

    if (next === "single") {
      const opts = padTexts(texts, 2);
      setSingleOptions(opts);
      const carried = prev === "multiple" ? (multipleCorrect[0] ?? 0) : (prev === "single" || prev === "scale") ? singleCorrect : 0;
      setSingleCorrect(Math.max(0, Math.min(carried, opts.length - 1)));
    } else if (next === "multiple") {
      const opts = padTexts(texts, 2);
      setMultipleOptions(opts);
      const carried = (prev === "single" || prev === "scale") ? [singleCorrect] : prev === "multiple" ? multipleCorrect : [];
      setMultipleCorrect(carried.filter((i) => i >= 0 && i < opts.length));
    } else if (next === "ranking") {
      setRankingItems(padTexts(texts, 2));
    } else if (next === "scale") {
      const opts = padTexts(texts, 2);
      setSingleOptions(opts);
      const carried = prev === "multiple" ? (multipleCorrect[0] ?? 0) : singleCorrect;
      setSingleCorrect(Math.max(0, Math.min(carried, opts.length - 1)));
      // FR-30: переход НА шкалу сам по себе переключатель правильного ответа не
      // включает — опросник без верных ответов должен быть умолчанием.
      setScaleHasCorrect(false);
    } else if (next === "allocation") {
      // FR-49: подписи переезжают, бюджет и домен при уходе с типа забываются —
      // поэтому вход на тип всегда начинается с умолчаний, а не с чужих чисел.
      setSingleOptions(padTexts(texts, 2));
      setAllocBudget("7");
      setAllocMin("");
      setAllocMax("");
    } else if (next === "matching") {
      const left = padTexts(texts, 2);
      setMatchingLeft(left);
      setMatchingRight((r) => padTexts(r, left.length));
      setMatchingPairs([]);
    }

    form.setValue("type", next);
    setSelectedType(next);
  };

  return (
    <>
      {/* Question editor — ui-kit Drawer + react-hook-form bridge
          (Controller on the Selects, register on the prompt Textarea). */}
      <Drawer
        open={open}
        onClose={closeDrawer}
        side="right"
        size="xl"
        title={question || createdQuestion ? t.questions.editQuestion : t.questions.createQuestion}
        footer={
          <Cluster justify="end" gap={2} wrap={false}>
            {/* PRD-57 FR-28d: обещание «переключение вида не теряет работу» автору нечем
                проверить, пока ящик молчит. Группа показывает, что набранное цело и
                отличается от сохранённого, и даёт вернуть его одним действием. */}
            {isTextEntry(selectedType) && answerRulesDirty(answerRules) ? (
              <div className="tb-dirty" data-testid="answer-rules-dirty">
                <Tag tone="warning" size="s">Изменения не сохранены</Tag>
                <Button
                  variant="ghost"
                  size="s"
                  onClick={() => setAnswerRules(createAnswerRulesDraft(answerRules.initial))}
                  data-testid="answer-rules-revert"
                >
                  Вернуть изменения
                </Button>
              </div>
            ) : null}
            {/*
              FR-24g: предпросмотр смотрят в момент проверки, а не всё время правки,
              поэтому он окно по кнопке. Кнопка стоит слева от «Отмены» — тем же приёмом,
              что у предпросмотра страницы: действие над содержимым, а не над формой.
            */}
            {/* PRD-70 FR-30: «Статистика» — у сохранённого вопроса; ведёт на страницу вопроса банка.
                Слева от «Предпросмотр» — та же группа «действие над содержимым». */}
            {canAnalytics && question && (
              <Button
                variant="ghost"
                leadingIcon={<BarChart3 size={16} aria-hidden="true" />}
                onClick={() => navigate(bankQuestionHref(question.id))}
                data-testid="button-question-statistics"
              >
                Статистика
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setPreviewOpen(true)}
              data-testid="button-preview-question"
            >
              Предпросмотр
            </Button>
            <Button variant="secondary" onClick={closeDrawer}>{t.common.cancel}</Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={isUploadingMedia || validationErrors.length > 0}
              loading={createMutation.isPending}
              data-testid="button-submit-question"
            >
              {question || createdQuestion ? t.common.update : t.common.create}
            </Button>
          </Cluster>
        }
      >
        <Stack gap={6}>
          {/*
            PRD-57, согласованный эскиз `prd57-question-text.html` (`s-diag`): что санитайзер
            вырезал из текста при сохранении. Баннер стоит первым в теле ящика — он говорит
            о тексте, который автор сейчас увидит в поле изменившимся, и объясняет, почему.
            Гаснет сам, как только текст правят: находки принадлежат ТОМУ сохранению.
          */}
          {sanitizeReport && sanitizeReport.prompt === watchedPrompt && (
            <Banner
              ref={sanitizeBannerRef}
              tone="warning"
              variant="subtle"
              title="Часть разметки удалена при сохранении"
              data-testid="banner-prompt-sanitized"
              description={
                <>
                  Удалено:{" "}
                  {removalPhrases(sanitizeReport.removed).map((phrase, i) => (
                    <span key={`${phrase.prefix}-${phrase.code}`}>
                      {i > 0 ? ", " : ""}
                      {phrase.prefix ? `${phrase.prefix} ` : ""}
                      <code>{phrase.code}</code> — {phrase.count}
                    </span>
                  ))}
                  . Остальная разметка сохранена без изменений.
                </>
              }
            />
          )}
          {validationErrors.length > 0 && (
            <Banner tone="error" variant="subtle" title="Проверьте форму" data-testid="banner-question-validation">
              {validationErrors.map((e, i) => (
                <Text key={i} variant="body-s">{e}</Text>
              ))}
            </Banner>
          )}
          {/*
            The topic is a searchable Select: the bank holds hundreds of topics, and
            finding one by eye in a flat list is the slow path. The control stays a
            plain single-value picker — no chips, no checkbox-looking marks — and the
            menu simply grows a search row that filters by a substring of the name.
            The reset button hands the form an empty string, which is what «no topic»
            means to the schema (and what the validation banner reports).
          */}
          <Controller
            control={form.control}
            name="topicId"
            render={({ field, fieldState }) => (
              <Select
                label={t.questions.topic}
                value={field.value}
                onChange={field.onChange}
                onClear={() => field.onChange("")}
                clearLabel={t.questions.clearTopic}
                placeholder={t.questions.selectTopic}
                error={fieldState.error?.message}
                fullWidth
                searchable
                searchPlaceholder={t.questions.topicSearchPlaceholder}
                emptyMessage={t.questions.topicSearchEmpty}
                data-testid="select-question-topic"
                options={topics?.map((topic) => ({ value: topic.id, label: topic.name })) ?? []}
              />
            )}
          />

          {/*
            The type is a Select — the approved wireframe (content-bank-explorer.html,
            state s-q-drawer) and PRD-26 FR-28 / PRD-44 FR-44 («выпадающий список типов»).
            It used to be a SegmentedControl back when the model had four types; with nine
            the strip overflowed the drawer and cut the trailing types off.
          */}
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select<QuestionType>
                label={t.questions.questionType}
                value={field.value as QuestionType}
                onChange={(next) => applyTypeChange(next)}
                fullWidth
                data-testid="select-question-type"
                options={questionTypes.map((type) => ({ value: type.value, label: type.label }))}
              />
            )}
          />

          {/*
            FR-09a: панель вставки — обязательная часть редактора, а не удобство. Без неё
            автор обязан помнить три обратные кавычки с языком и два доллара, а это ровно
            тот барьер, из-за которого механикой не пользуются. Состав и порядок кнопок —
            согласованный эскиз `prd57-question-text.html`.
          */}
          {/*
            PRD-57 §4.3: режим ввода переключается НАД полем — согласованный эскиз
            `prd57-question-text.html`. Режим меняет способ набора, а не набор
            возможностей: листинг, формула и пропуск работают во всех (FR-09a).
          */}
          <Cluster gap={3} wrap align="center">
            <SegmentedControl<PromptFormat>
              value={promptFormat}
              onChange={(next) => requestModeSwitch(next)}
              items={[
                { value: "markdown", label: "Разметка" },
                { value: "richText", label: "Форматированный" },
                { value: "html", label: "HTML" },
              ]}
              data-testid="seg-prompt-format"
            />
            {promptFormat === "html" && (
              <Text variant="body-s" tone="muted">
                Текст сохраняется тегами. Небезопасное снимается при сохранении.
              </Text>
            )}
          </Cluster>

          <Cluster gap={2} wrap data-testid="prompt-insert-bar">
            <MenuTrigger
              size="sm"
              placement="bottom-start"
              trigger={
                <Button
                  variant="ghost"
                  size="xs"
                  leadingIcon={<Code width={16} height={16} aria-hidden="true" />}
                  data-testid="insert-code"
                >
                  Листинг
                </Button>
              }
            >
              {/* Язык спрашивается ПРИ вставке: он часть открывающей строки, и дописывать
                  его потом руками — тот же барьер, ради снятия которого кнопка заведена. */}
              {CODE_LANGUAGES.map((language) => (
                <MenuItem
                  key={language.value || "plain"}
                  onClick={() => insertAt("code", language.value)}
                  data-testid={`insert-code-${language.value || "plain"}`}
                >
                  {language.label}
                </MenuItem>
              ))}
            </MenuTrigger>
            <Button
              variant="ghost"
              size="xs"
              leadingIcon={<Sigma width={16} height={16} aria-hidden="true" />}
              onClick={() => insertAt("formula")}
              data-testid="insert-formula"
            >
              Формула
            </Button>
            {/*
              Пропуск предлагается ТОЛЬКО своему типу: в остальных двойные скобки полем не
              станут, и кнопка обещала бы механику, которой там нет. Имя за автора НЕ
              придумывается: придуманное по соседнему слову всё равно приходится читать и
              чаще всего менять (FR-24b).
            */}
            {selectedType === "blanks" && (
              <Button
                variant="ghost"
                size="xs"
                leadingIcon={<Braces width={16} height={16} aria-hidden="true" />}
                onClick={() => insertAt("blank")}
                data-testid="insert-blank"
              >
                Пропуск
              </Button>
            )}
            <Text variant="body-s" tone="muted">
              {selectedType === "blanks"
                ? "Ставится в позицию курсора; у пропуска курсор остаётся внутри скобок — введите имя пропуска."
                : "Ставится в позицию курсора; выделенный текст оборачивается."}
            </Text>
          </Cluster>

          {promptFormat === "richText" ? (
            <RichPromptEditor
              label={t.questions.questionText}
              value={form.watch("prompt") ?? ""}
              onChange={(next) => form.setValue("prompt", next, { shouldDirty: true })}
              // Перепривязка только на внешнюю замену текста: набор в поле её не трогает,
              // иначе курсор уезжал бы в начало на каждом символе.
              syncKey={promptSyncKey}
            />
          ) : (
          <Textarea
            label={t.questions.questionText}
            placeholder={t.questions.questionTextPlaceholder}
            hint={promptFormat === "html"
              ? "Теги пишутся как есть. Листинг — <pre><code class=\"language-sql\">, формула — двумя долларами, пропуск — двойными фигурными скобками."
              : t.questions.markdownHint}
            rows={promptFormat === "html" ? 8 : 2}
            fullWidth
            error={form.formState.errors.prompt?.message}
            data-testid="input-question-prompt"
            {...form.register("prompt")}
            ref={(node: HTMLTextAreaElement | null) => {
              promptRef.current = node;
              form.register("prompt").ref(node);
            }}
            onPaste={(e) =>
              handleMarkdownPaste(e, (v) => form.setValue("prompt", v, { shouldDirty: true }))
            }
          />
          )}

          {selectedType === "long" && (
            <Stack gap={4} data-testid="long-answer-block">
              <Input
                label="Подсказка в поле"
                value={longPlaceholder}
                onChange={(e) => setLongPlaceholder(e.target.value)}
                fullWidth
                hint="Что участник увидит в пустом поле. Например: «Ответьте своими словами»."
                data-testid="input-long-placeholder"
              />
              <Input
                label="Предел длины ответа"
                value={longMaxLength === undefined ? "" : String(longMaxLength)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") return setLongMaxLength(undefined);
                  const parsed = Number(raw);
                  setLongMaxLength(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
                }}
                hint="До скольких символов участник может ответить. Пусто — системный предел."
                data-testid="input-long-maxlength"
              />
              <Switch
                checked={longRequired}
                onChange={(e) => setLongRequired(e.target.checked)}
                label="Ответ обязателен"
                description="Без ответа участник не сможет пойти дальше"
                data-testid="switch-long-required"
              />
              <Text variant="body-s" tone="muted">
                Автоматической проверки у этого типа нет: ответ собирается и уезжает в отчёт,
                баллов не приносит и на вердикт не влияет.
              </Text>
            </Stack>
          )}

          {selectedType === "blanks" && (
            <BlanksBlock
              prompt={form.watch("prompt") ?? ""}
              blanks={blanks}
              onChange={setBlanks}
              onRestorePrompt={(value) => form.setValue("prompt", value, { shouldDirty: true })}
            />
          )}

          {selectedType === "single" && (
            <SingleChoiceBuilder
              options={singleOptions}
              setOptions={setSingleOptions}
              correctIndex={singleCorrect}
              setCorrectIndex={setSingleCorrect}
            />
          )}

          {selectedType === "multiple" && (
            <MultipleChoiceBuilder
              options={multipleOptions}
              setOptions={setMultipleOptions}
              correctIndices={multipleCorrect}
              setCorrectIndices={setMultipleCorrect}
            />
          )}

          {selectedType === "matching" && (
            <MatchingBuilder
              left={matchingLeft}
              setLeft={setMatchingLeft}
              right={matchingRight}
              setRight={setMatchingRight}
              pairs={matchingPairs}
              setPairs={setMatchingPairs}
            />
          )}

          {selectedType === "ranking" && (
            <RankingBuilder
              items={rankingItems}
              setItems={setRankingItems}
            />
          )}

          {/* PRD-26: шкала — тот же список подписей, что у одиночного выбора, плюс
             переключатель наличия правильной градации. Отдельного компонента нет:
             редактор один, иначе разметка двух списков разойдётся. */}
          {selectedType === "scale" && (
            <Stack gap={4}>
              <Switch
                label={t.questions.scaleHasCorrectAnswer}
                description={t.questions.scaleHasCorrectAnswerHint}
                checked={scaleHasCorrect}
                onChange={(e) => setScaleHasCorrect(e.target.checked)}
                data-testid="switch-scale-has-correct"
              />
              <SingleChoiceBuilder
                options={singleOptions}
                setOptions={setSingleOptions}
                correctIndex={singleCorrect}
                setCorrectIndex={setSingleCorrect}
                label={scaleHasCorrect ? t.questions.scaleGraduationsWithCorrect : t.questions.scaleGraduations}
                itemPlaceholder={t.questions.scaleGraduationPlaceholder}
                showCorrect={scaleHasCorrect}
              />
            </Stack>
          )}

          {/* PRD-57 §6.5: у текстового ввода вариантов нет — вместо их списка стоит
             набор правил сравнения. Ветка по ПРИЗНАКУ типа, а не по литералу: пропуски
             (Э8) войдут сюда же, объявив тот же признак. */}
          {isTextEntry(selectedType) && (
            <AnswerRulesBlock
              draft={answerRules}
              onChange={setAnswerRules}
              maxLength={shortMaxLength}
              onMaxLength={setShortMaxLength}
            />
          )}

          {/* PRD-44: распределение баллов. Список утверждений — тот же редактор, что у
             одиночного выбора, но БЕЗ отметки верного варианта: правильного
             распределения не существует, поэтому блока верного ответа здесь нет.
             Привязка утверждений к шкалам живёт во вкладке «Вклады вопросов»
             редактора теста, а не тут: вопрос несёт только утверждения. */}
          {selectedType === "allocation" && (
            <Stack gap={4}>
              <SingleChoiceBuilder
                options={singleOptions}
                setOptions={setSingleOptions}
                correctIndex={0}
                setCorrectIndex={() => {}}
                label={t.questions.allocationStatements}
                itemPlaceholder={t.questions.allocationStatementPlaceholder}
                showCorrect={false}
              />
              <Cluster gap={4} align="start">
                <NumberInput
                  label={t.questions.allocationBudget}
                  hint={t.questions.allocationBudgetHint}
                  value={Number(allocBudget) || 0}
                  min={1}
                  max={1000}
                  onChange={(v) => setAllocBudget(String(v))}
                  data-testid="input-alloc-budget"
                />
                <NumberInput
                  label={t.questions.allocationMin}
                  hint={t.questions.allocationMinHint}
                  value={allocMin.trim() === "" ? 0 : Number(allocMin)}
                  min={0}
                  max={Number(allocBudget) || 0}
                  onChange={(v) => setAllocMin(String(v))}
                  data-testid="input-alloc-min"
                />
                <NumberInput
                  label={t.questions.allocationMax}
                  hint={t.questions.allocationMaxHint}
                  value={allocMax.trim() === "" ? (Number(allocBudget) || 0) : Number(allocMax)}
                  min={0}
                  max={Number(allocBudget) || 0}
                  onChange={(v) => setAllocMax(String(v))}
                  data-testid="input-alloc-max"
                />
              </Cluster>
            </Stack>
          )}

          {/* PRD-16 FR-41/42: per-question shuffle (ranking is always shuffled — no toggle).
             Rendered as a Switch to match the approved wireframe (state s-q-drawer).
             PRD-26: a scale has no toggle either — its graduation order is content. */}
          {selectedType !== "ranking" && selectedType !== "scale" && (
            <Switch
              label={t.questions.shuffleAnswers}
              checked={shuffleAnswers}
              onChange={(e) => setShuffleAnswers(e.target.checked)}
              data-testid="switch-shuffle-answers"
            />
          )}

          <Stack gap={2}>
            <Label>{t.questions.difficulty}</Label>
            {/* PRD-70 FR-32 (эскиз e7-question-bank): переключатель, шкала и поле — одной строкой по
                средней линии шкалы, от шкалы — 6x; над шкалой — ориентир «По ответам» (FR-31). */}
            <div className="tb-qdiff-row">
              <Switch
                label={t.questions.difficultyUnset}
                checked={difficulty === null}
                onChange={(e) => setDifficulty(e.target.checked ? null : 50)}
                data-testid="switch-question-difficulty-unset"
              />
              {difficulty !== null && (
                <>
                  <Slider
                    className="tb-qdiff-row__slider"
                    value={difficulty}
                    onChange={(v) => setDifficulty(v as number)}
                    min={0}
                    max={100}
                    step={1}
                    marks={[0, 50, 100]}
                    landmarks={landmark ? [{
                      value: landmark.hardness,
                      label: `Сложность по ответам: ${landmark.hardness}`,
                      title: `По ответам: ${landmark.hardness}`,
                      hint: `Какой сложность оказалась у участников — сводно по ${landmark.tests} ${pluralForm(landmark.tests, ["тесту", "тестам", "тестам"])}, ${landmark.observations} ${pluralForm(landmark.observations, ["прохождение", "прохождения", "прохождений"])}. Ориентир для заданной сложности; по каждому тесту — в «Статистике».`,
                    }] : undefined}
                    ariaLabel={t.questions.difficulty}
                    data-testid="slider-question-difficulty"
                  />
                  <Input
                    className="tb-qdiff-row__num"
                    type="number"
                    min={0}
                    max={100}
                    value={difficulty}
                    aria-label={`${t.questions.difficulty} (число)`}
                    onChange={(e) => setDifficulty(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                    data-testid="input-question-difficulty"
                  />
                </>
              )}
            </div>
            {difficulty !== null && (
              <Text as="p" variant="body-xs" tone="muted">{t.questions.difficultyHint}</Text>
            )}
          </Stack>

          {/* PRD-30 FR-01: «Индекс в теме». No slider (unlike difficulty): the
              range is unbounded, and «не задано» is expressed by an empty field,
              so no separate switch is needed either. */}
          <Stack gap={2}>
            <Label>{t.questions.orderIndex}</Label>
            <Cluster gap={4} wrap={false}>
              {/* `Input type=number`, not the DS stepper: NumberInput takes a
                  REQUIRED number, and this field must be able to be empty
                  («не задано»). Same control the difficulty number uses above. */}
              <Input
                type="number"
                value={orderIndex ?? ""}
                aria-label={t.questions.orderIndex}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  // Empty clears the index; parseInt keeps 0 and negatives.
                  const parsed = Number.parseInt(raw, 10);
                  setOrderIndex(raw === "" || Number.isNaN(parsed) ? null : parsed);
                }}
                data-testid="input-question-order-index"
              />
            </Cluster>
            <Text as="p" variant="body-xs" tone="muted">{t.questions.orderIndexHint}</Text>
          </Stack>

          <Stack gap={4}>
            <Label>{t.questions.mediaOptional}</Label>
            <FileUploader
              compact
              accept="image/*,audio/*,video/*"
              maxSizeMb={200}
              disabled={isUploadingMedia}
              title={isUploadingMedia ? "Загрузка…" : mediaUrl ? "Заменить файл" : "Перетащите файл сюда"}
              description={mediaUrl ? undefined : "или нажмите, чтобы выбрать · изображение, аудио, видео"}
              cta={mediaUrl ? "Выбрать другой" : "Выбрать файл"}
              onFiles={(files) => { if (files[0]) void uploadMediaFile(files[0]); }}
              data-testid="uploader-question-media"
            />
            {mediaUrl && mediaType && (
              <Box border radius="m" pad={4}>
                {mediaType === "image" && (
                  <Stack align="center">
                    <img
                      src={mediaUrl}
                      alt="Превью медиа вопроса"
                      style={{ maxHeight: "12rem", objectFit: "contain" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </Stack>
                )}
                {mediaType === "audio" && (
                  <audio controls style={{ width: "100%" }}>
                    <source src={mediaUrl} />
                    {t.questions.browserNotSupported}
                  </audio>
                )}
                {mediaType === "video" && (
                  <video controls style={{ maxHeight: "12rem", width: "100%" }}>
                    <source src={mediaUrl} />
                    {t.questions.browserNotSupported}
                  </video>
                )}
              </Box>
            )}
          </Stack>

          <TagsInput value={tags} onChange={setTags} suggestions={tagSuggestions} />

          <Stack gap={3}>
            <Cluster justify="between">
              <Label>{t.questions.feedback}</Label>
              <Cluster gap={2}>
                <Text variant="body-xs" tone="muted">{t.questions.feedbackModeGeneral}</Text>
                <Switch
                  checked={feedbackMode === "conditional"}
                  onChange={(e) => setFeedbackMode(e.target.checked ? "conditional" : "general")}
                  data-testid="switch-feedback-mode"
                />
                <Text variant="body-xs" tone="muted">{t.questions.feedbackModeConditional}</Text>
              </Cluster>
            </Cluster>

            {feedbackMode === "general" ? (
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t.questions.feedbackPlaceholder}
                rows={2}
                fullWidth
                hint={t.questions.feedbackHint}
                data-testid="input-question-feedback"
              />
            ) : (
              <Stack gap={3}>
                <Textarea
                  label={<Text variant="body-s" weight="medium" tone="success">{t.questions.feedbackCorrect}</Text>}
                  value={feedbackCorrect}
                  onChange={(e) => setFeedbackCorrect(e.target.value)}
                  placeholder={t.questions.feedbackCorrectPlaceholder}
                  rows={2}
                  fullWidth
                  data-testid="input-question-feedback-correct"
                />
                <Textarea
                  label={<Text variant="body-s" weight="medium" tone="error">{t.questions.feedbackIncorrect}</Text>}
                  value={feedbackIncorrect}
                  onChange={(e) => setFeedbackIncorrect(e.target.value)}
                  placeholder={t.questions.feedbackIncorrectPlaceholder}
                  rows={2}
                  fullWidth
                  hint={t.questions.feedbackConditionalHint}
                  data-testid="input-question-feedback-incorrect"
                />
              </Stack>
            )}
          </Stack>

          {/* PRD-15 block D (FR-35): балл и цена ответа переехали в тест. */}
          <Box border radius="m" pad={3} data-testid="question-scoring-moved-hint">
            <Text as="p" variant="body-s" tone="muted">
              Балл и цена ответа настраиваются в каждом тесте отдельно — вкладка «Оценка»
              редактора теста. В банке вопрос хранит только содержание.
            </Text>
          </Box>
        </Stack>
      </Drawer>

      {/*
        FR-09c: переключение режима не переводит текст молча. Окно называет находки
        числами и отдаёт решение автору: соглашаться ли терять таблицу — не наш выбор.
      */}
      <ModalDialog
        open={modeSwitch !== null}
        onClose={() => setModeSwitch(null)}
        size="m"
        title={modeSwitch?.to === "html" ? "Перевести текст в HTML?" : "Перевести текст в разметку?"}
        description="Перевод меняет сам текст задания. Отменить его можно только вручную."
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setModeSwitch(null)}>Отмена</Button>
            <Button
              variant="primary"
              size="m"
              onClick={() => modeSwitch && applyModeSwitch(modeSwitch.to)}
              data-testid="confirm-mode-switch"
            >
              Перевести
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          {(modeSwitch?.report.losses.length ?? 0) > 0 && (
            <Stack gap={1} data-testid="mode-switch-losses">
              <Text variant="body-s" weight="medium">Найдено в тексте</Text>
              {modeSwitch?.report.losses.map((loss) => (
                <Text key={loss.what} variant="body-s">
                  {loss.what} — {loss.count} — {loss.becomes}
                </Text>
              ))}
            </Stack>
          )}
          {modeSwitch?.report.notes.map((note) => (
            <Text key={note} variant="body-s" tone="muted">{note}</Text>
          ))}
        </Stack>
      </ModalDialog>

      {/*
        FR-24g: предпросмотр собирается из ТЕКУЩЕГО черновика, а не из сохранённого
        вопроса — смотреть на вчерашнее состояние незачем. Содержимое и эталон берутся
        тем же сборщиком, что и сохранение, поэтому окно показывает ровно то, что уедет.
      */}
      <QuestionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        topicName={topics.find((topic) => topic.id === form.watch("topicId"))?.name}
        question={{
          ...(question ?? {}),
          type: selectedType,
          prompt: form.watch("prompt") ?? "",
          promptFormat,
          ...buildQuestionData(),
        }}
      />

      {/* PRD-15 T-12: content-impact dialog for edits affecting other tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />
    </>
  );
}

/** Pad a text list up to `min` entries with empty strings (PRD-16 FR-32 type migration). */
function padTexts(arr: string[], min: number): string[] {
  const next = [...arr];
  while (next.length < min) next.push("");
  return next;
}

/** Move an array item from one index to another (immutable). PRD-16 FR-40. */
function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Remap a stored answer index after an option moved from→to (keeps the correct key on its option). */
function remapIndexAfterMove(idx: number, from: number, to: number): number {
  if (idx === from) return to;
  if (from < idx && idx <= to) return idx - 1;
  if (to <= idx && idx < from) return idx + 1;
  return idx;
}

/**
 * Ordered list of answer texts with ONE of them marked correct — the editor for both
 * single choice and the PRD-26 scale. The scale reuses it rather than getting a copy,
 * so the two cannot drift apart in markup; it only overrides the wording and, in
 * measurement mode, hides the correct-answer radio column (`showCorrect={false}`).
 */
function SingleChoiceBuilder({
  options,
  setOptions,
  correctIndex,
  setCorrectIndex,
  label = t.questions.answerOptionsSingle,
  itemPlaceholder = t.questions.optionPlaceholder,
  showCorrect = true,
}: {
  options: string[];
  setOptions: (opts: string[]) => void;
  correctIndex: number;
  setCorrectIndex: (idx: number) => void;
  label?: string;
  itemPlaceholder?: string;
  showCorrect?: boolean;
}) {
  const groupName = useId();
  const dragIndex = useRef<number | null>(null);
  const moveOption = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    setOptions(moveInArray(options, from, to));
    setCorrectIndex(remapIndexAfterMove(correctIndex, from, to));
  };
  const updateOption = (idx: number, value: string) => {
    const newOpts = [...options];
    newOpts[idx] = value;
    setOptions(newOpts);
  };

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    const newOpts = options.filter((_, i) => i !== idx);
    setOptions(newOpts);
    if (correctIndex >= newOpts.length) setCorrectIndex(newOpts.length - 1);
    else if (correctIndex > idx) setCorrectIndex(correctIndex - 1);
  };

  return (
    <Stack gap={4}>
      <Label>{label}</Label>
      <Stack gap={2}>
        {options.map((opt, i) => (
          <div key={i} onDragOver={(e) => e.preventDefault()} onDrop={() => moveOption(i)}>
            <Cluster gap={2} wrap={false}>
              <span className="tb-drag-handle" draggable onDragStart={() => { dragIndex.current = i; }} aria-label="Перетащить вариант">
                <GripVertical size={16} color="var(--ou-fg-muted)" />
              </span>
              {showCorrect && (
                <Radio
                  name={groupName}
                  checked={correctIndex === i}
                  onChange={() => setCorrectIndex(i)}
                  aria-label={`${t.questions.correctAnswer} ${i + 1}`}
                />
              )}
              <Box grow>
                <Input
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  onPaste={(e) => handleMarkdownPaste(e, (v) => updateOption(i, v))}
                  placeholder={`${itemPlaceholder} ${i + 1}`}
                  fullWidth
                  data-testid={`input-option-${i}`}
                />
              </Box>
              {options.length > 2 && (
                <IconButton
                  variant="ghost"
                  size="s"
                  aria-label="Удалить вариант"
                  icon={<Trash2 size={16} />}
                  onClick={() => removeOption(i)}
                />
              )}
            </Cluster>
          </div>
        ))}
      </Stack>
      <Button type="button" variant="secondary" size="s" leadingIcon={<Plus size={16} />} onClick={addOption}>
        {t.questions.addOption}
      </Button>
    </Stack>
  );
}

function MultipleChoiceBuilder({
  options,
  setOptions,
  correctIndices,
  setCorrectIndices,
}: {
  options: string[];
  setOptions: (opts: string[]) => void;
  correctIndices: number[];
  setCorrectIndices: (indices: number[]) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const moveOption = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    setOptions(moveInArray(options, from, to));
    setCorrectIndices(correctIndices.map((idx) => remapIndexAfterMove(idx, from, to)));
  };
  const updateOption = (idx: number, value: string) => {
    const newOpts = [...options];
    newOpts[idx] = value;
    setOptions(newOpts);
  };

  const toggleCorrect = (idx: number) => {
    if (correctIndices.includes(idx)) {
      setCorrectIndices(correctIndices.filter((i) => i !== idx));
    } else {
      setCorrectIndices([...correctIndices, idx]);
    }
  };

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    const newOpts = options.filter((_, i) => i !== idx);
    setOptions(newOpts);
    setCorrectIndices(correctIndices.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i)));
  };

  return (
    <Stack gap={4}>
      <Label>{t.questions.answerOptionsMultiple}</Label>
      <Stack gap={2}>
        {options.map((opt, i) => (
          <div key={i} onDragOver={(e) => e.preventDefault()} onDrop={() => moveOption(i)}>
            <Cluster gap={2} wrap={false}>
              <span className="tb-drag-handle" draggable onDragStart={() => { dragIndex.current = i; }} aria-label="Перетащить вариант">
                <GripVertical size={16} color="var(--ou-fg-muted)" />
              </span>
              <Checkbox
                checked={correctIndices.includes(i)}
                onChange={() => toggleCorrect(i)}
                aria-label={`${t.questions.optionPlaceholder} ${i + 1}`}
              />
              <Box grow>
                <Input
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  onPaste={(e) => handleMarkdownPaste(e, (v) => updateOption(i, v))}
                  placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
                  fullWidth
                  data-testid={`input-multi-option-${i}`}
                />
              </Box>
              {options.length > 2 && (
                <IconButton
                  variant="ghost"
                  size="s"
                  aria-label="Удалить вариант"
                  icon={<Trash2 size={16} />}
                  onClick={() => removeOption(i)}
                />
              )}
            </Cluster>
          </div>
        ))}
      </Stack>
      <Button type="button" variant="secondary" size="s" leadingIcon={<Plus size={16} />} onClick={addOption}>
        {t.questions.addOption}
      </Button>
    </Stack>
  );
}

function MatchingBuilder({
  left,
  setLeft,
  right,
  setRight,
  pairs,
  setPairs,
}: {
  left: string[];
  setLeft: (items: string[]) => void;
  right: string[];
  setRight: (items: string[]) => void;
  pairs: { left: number; right: number }[];
  setPairs: (pairs: { left: number; right: number }[]) => void;
}) {
  const updateLeft = (idx: number, value: string) => {
    const newLeft = [...left];
    newLeft[idx] = value;
    setLeft(newLeft);
    if (idx < right.length && !pairs.some((p) => p.left === idx)) {
      setPairs([...pairs, { left: idx, right: idx }]);
    }
  };

  const updateRight = (idx: number, value: string) => {
    const newRight = [...right];
    newRight[idx] = value;
    setRight(newRight);
  };

  const addPair = () => {
    setLeft([...left, ""]);
    setRight([...right, ""]);
  };

  return (
    <Stack gap={4}>
      <FormGroup columns="two">
        <Stack gap={2}>
          <Label>{t.questions.leftItems}</Label>
          {left.map((item, i) => (
            <Cluster key={i} gap={2} wrap={false}>
              <Text variant="body-s" weight="medium">{i + 1}.</Text>
              <Box grow>
                <Input
                  value={item}
                  onChange={(e) => updateLeft(i, e.target.value)}
                  onPaste={(e) => handleMarkdownPaste(e, (v) => updateLeft(i, v))}
                  placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
                  fullWidth
                  data-testid={`input-matching-left-${i}`}
                />
              </Box>
            </Cluster>
          ))}
        </Stack>
        <Stack gap={2}>
          <Label>{t.questions.rightItems}</Label>
          {right.map((item, i) => (
            <Cluster key={i} gap={2} wrap={false}>
              <Text variant="body-s" weight="medium">{String.fromCharCode(65 + i)}.</Text>
              <Box grow>
                <Input
                  value={item}
                  onChange={(e) => updateRight(i, e.target.value)}
                  onPaste={(e) => handleMarkdownPaste(e, (v) => updateRight(i, v))}
                  placeholder={`${t.questions.optionPlaceholder} ${String.fromCharCode(65 + i)}`}
                  fullWidth
                  data-testid={`input-matching-right-${i}`}
                />
              </Box>
            </Cluster>
          ))}
        </Stack>
      </FormGroup>
      <Button type="button" variant="secondary" size="s" leadingIcon={<Plus size={16} />} onClick={addPair}>
        {t.questions.addPair}
      </Button>
    </Stack>
  );
}

function RankingBuilder({
  items,
  setItems,
}: {
  items: string[];
  setItems: (items: string[]) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const moveItem = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    setItems(moveInArray(items, from, to));
  };
  const updateItem = (idx: number, value: string) => {
    const newItems = [...items];
    newItems[idx] = value;
    setItems(newItems);
  };

  const addItem = () => setItems([...items, ""]);
  const removeItem = (idx: number) => {
    if (items.length <= 2) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  return (
    <Stack gap={4}>
      <Label>{t.questions.itemsToRank}</Label>
      <Text as="p" variant="body-s" tone="muted">{t.questions.orderItems}</Text>
      <Stack gap={2}>
        {items.map((item, i) => (
          <div key={i} onDragOver={(e) => e.preventDefault()} onDrop={() => moveItem(i)}>
            <Cluster gap={2} wrap={false}>
              <span className="tb-drag-handle" draggable onDragStart={() => { dragIndex.current = i; }} aria-label="Перетащить элемент">
                <GripVertical size={16} color="var(--ou-fg-muted)" />
              </span>
              <Text variant="body-s" weight="medium">{i + 1}.</Text>
              <Box grow>
                <Input
                  value={item}
                  onChange={(e) => updateItem(i, e.target.value)}
                  onPaste={(e) => handleMarkdownPaste(e, (v) => updateItem(i, v))}
                  placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
                  fullWidth
                  data-testid={`input-ranking-${i}`}
                />
              </Box>
              {items.length > 2 && (
                <IconButton
                  variant="ghost"
                  size="s"
                  aria-label="Удалить элемент"
                  icon={<Trash2 size={16} />}
                  onClick={() => removeItem(i)}
                />
              )}
            </Cluster>
          </div>
        ))}
      </Stack>
      <Button type="button" variant="secondary" size="s" leadingIcon={<Plus size={16} />} onClick={addItem}>
        {t.questions.addOption}
      </Button>
    </Stack>
  );
}
