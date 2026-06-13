/**
 * @module pages/author/questions
 * @description Author question bank: a filterable card list of questions plus
 * the question editor (ui-kit ModalDialog + react-hook-form), per-type answer
 * builders (single/multiple/matching/ranking), media attachment, conditional
 * feedback, sub-topic tags, and Excel import/export dialogs. Rendered entirely
 * with the UniversityRT design system — layout via Stack/Cluster/Grid/Box,
 * typography via Text, forms via FormGroup and the controls' built-in labels
 * (no raw utility classes).
 */
import { useState, useRef, useId, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, FileQuestion, GripVertical, Image, Music, Video, Copy, Upload, Download } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Cluster,
  EmptyState,
  FormGroup,
  Grid,
  IconButton,
  Input,
  Label,
  ModalDialog,
  Radio,
  RadioGroup,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Switch,
  Tag,
  Text,
  Textarea,
  type Tone,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import type { Question, Topic } from "@shared/schema";
import { TagsInput } from "./tags-input";

const questionTypes = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
] as const;

type QuestionType = typeof questionTypes[number]["value"];

/** Map a question type to a design-system Tag tone (replaces the bespoke
 *  Tailwind colour classes used with the old shadcn Badge). */
const typeTone = (type: string): Tone => {
  switch (type) {
    case "single": return "info";
    case "multiple": return "accent";
    case "matching": return "success";
    case "ranking": return "warning";
    default: return "neutral";
  }
};

/** Map a 0–100 difficulty to a Tag tone (easy / medium / hard). */
const difficultyTone = (difficulty: number): Tone =>
  difficulty <= 33 ? "success" : difficulty <= 66 ? "warning" : "error";

// PRD-15 block D (FR-35): the question card carries CONTENT only — the price
// and the graded config are configured per test («Оценка» tab of the editor).
const baseQuestionSchema = z.object({
  topicId: z.string().min(1, t.questions.topicRequired),
  type: z.enum(["single", "multiple", "matching", "ranking"]),
  prompt: z.string().min(1, t.questions.textRequired),
});

interface QuestionWithTopic extends Question {
  topicName: string;
}

export default function QuestionsPage() {
  const { toast } = useToast();
  const contentGuard = useContentGuard();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedType, setSelectedType] = useState<QuestionType>("single");
  const [filterTopicId, setFilterTopicId] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [singleOptions, setSingleOptions] = useState<string[]>(["", "", "", ""]);
  const [singleCorrect, setSingleCorrect] = useState<number>(0);

  const [multipleOptions, setMultipleOptions] = useState<string[]>(["", "", "", ""]);
  const [multipleCorrect, setMultipleCorrect] = useState<number[]>([]);

  const [matchingLeft, setMatchingLeft] = useState<string[]>(["", "", ""]);
  const [matchingRight, setMatchingRight] = useState<string[]>(["", "", ""]);
  const [matchingPairs, setMatchingPairs] = useState<{ left: number; right: number }[]>([]);

  const [rankingItems, setRankingItems] = useState<string[]>(["", "", "", ""]);

  // PRD-10: graded answer scoring (цена ответа) draft state.

  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"image" | "audio" | "video" | "">("");
  const [mediaFileName, setMediaFileName] = useState<string>("");
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [shuffleAnswers, setShuffleAnswers] = useState<boolean>(true);
  const [difficulty, setDifficulty] = useState<number>(50);
  const [feedbackMode, setFeedbackMode] = useState<"general" | "conditional">("general");
  const [feedback, setFeedback] = useState<string>("");
  const [feedbackCorrect, setFeedbackCorrect] = useState<string>("");
  const [feedbackIncorrect, setFeedbackIncorrect] = useState<string>("");
  // PRD-11 §3a: sub-topic tags (chip input). By these tags the author sets draw quotas.
  const [tags, setTags] = useState<string[]>([]);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  const [importFile, setImportFile] = useState<File | null>(null);
  // PRD-14 Ф2 (FR-13): результат предпросмотра (dry-run) до записи.
  const [importPreview, setImportPreview] = useState<
    { created: number; updated: number; skipped: number; errors: string[] } | null
  >(null);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "topics" | "test">("all");
  const [exportTopicIds, setExportTopicIds] = useState<string[]>([]);
  const [exportTestId, setExportTestId] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaFileInputRef = useRef<HTMLInputElement>(null);

  const { data: questions, isLoading: questionsLoading } = useQuery<QuestionWithTopic[]>({
    queryKey: ["/api/questions"],
  });

  // PRD-11 §3a: distinct tags across the bank, offered as autocomplete suggestions.
  const tagSuggestions = Array.from(
    new Set((questions ?? []).flatMap((q) => (Array.isArray(q.tags) ? q.tags : []))),
  );

  const { data: topics } = useQuery<Topic[]>({
    queryKey: ["/api/topics"],
  });

  const { data: tests } = useQuery<any[]>({
    queryKey: ["/api/tests"],
  });

  const form = useForm({
    resolver: zodResolver(baseQuestionSchema),
    defaultValues: {
      topicId: "",
      type: "single" as QuestionType,
      prompt: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/questions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.questions.questionCreated, description: t.questions.questionCreatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToCreate });
    },
  });

  // Question edits go through the content guard (see onSubmit, PRD-15 T-12).

  // Question deletion goes through the content guard (see handleDelete, PRD-15 T-12).

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/questions/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.questions.duplicated, description: t.questions.duplicatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToDuplicate });
    },
  });

  // Bulk delete goes through the content guard (see handleBulkDelete, PRD-15 T-12).

  const importMutation = useMutation({
    mutationFn: async ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/questions/import${dryRun ? "?dryRun=true" : ""}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (
      data: { created: number; updated?: number; skipped?: number; errors: string[]; dryRun?: boolean },
      variables,
    ) => {
      // PRD-14 Ф2 (FR-13): dry-run только показывает план — без записи и инвалидации.
      if (variables.dryRun) {
        setImportPreview({
          created: data.created,
          updated: data.updated ?? 0,
          skipped: data.skipped ?? 0,
          errors: data.errors,
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      let description = `Добавлено: ${data.created}`;
      if (data.updated && data.updated > 0) {
        description += `. Обновлено: ${data.updated}`;
      }
      if (data.skipped && data.skipped > 0) {
        description += `. Пропущено дублей: ${data.skipped}`;
      }
      if (data.errors.length > 0) {
        description += `. ${t.questions.importErrors} ${data.errors.length}`;
      }
      toast({ title: t.questions.importSuccess, description });
      setIsImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToImport });
    },
  });

  const handleExport = () => {
    let url = "/api/questions/export";
    const params: string[] = [];

    if (exportMode === "topics" && exportTopicIds.length > 0) {
      params.push(`topicIds=${exportTopicIds.join(",")}`);
    } else if (exportMode === "test" && exportTestId) {
      params.push(`testId=${exportTestId}`);
    }

    if (params.length > 0) {
      url += "?" + params.join("&");
    }

    window.location.href = url;
    setIsExportDialogOpen(false);
    setExportMode("all");
    setExportTopicIds([]);
    setExportTestId("");
  };

  const toggleExportTopic = (topicId: string) => {
    setExportTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : [...prev, topicId]
    );
  };

  const handleCheckImport = () => {
    if (importFile) {
      importMutation.mutate({ file: importFile, dryRun: true });
    }
  };

  const handleImport = () => {
    if (importFile) {
      importMutation.mutate({ file: importFile, dryRun: false });
    }
  };

  const handleImportFileChange = (file: File | null) => {
    setImportFile(file);
    setImportPreview(null); // новый файл — прежний предпросмотр недействителен
  };
  const guessMediaType = (mime: string): "image" | "audio" | "video" | "" => {
    if (!mime) return "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    return "";
  };
  const isDataUrl = (v: string) => v.trim().startsWith("data:");
  const handlePickMediaFile = () => {
    mediaFileInputRef.current?.click();
  };

  const clearMedia = () => {
    setMediaUrl("");
    setMediaType("");
    setMediaFileName("");
    if (mediaFileInputRef.current) {
      mediaFileInputRef.current.value = "";
    }
  };

  const handleMediaFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // защита от слишком больших файлов (можешь поменять лимит)
    const MAX_MB = 200;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: `Файл слишком большой (>${MAX_MB}MB).`,
      });
      return;
    }

    const mt = guessMediaType(file.type);
    if (!mt) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: "Поддерживаются только image/audio/video.",
      });
      return;
    }

    setIsUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const payload: { url: string; mime?: string } = await response.json();

      setMediaUrl(payload.url); // короткий URL (без base64)
      setMediaType(guessMediaType(payload.mime || file.type) || mt);
      setMediaFileName(file.name);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: t.common.error,
        description: "Не удалось загрузить файл. Проверь права (author) и размер.",
      });
    } finally {
      setIsUploadingMedia(false);
      // чтобы можно было выбрать тот же файл повторно
      if (mediaFileInputRef.current) mediaFileInputRef.current.value = "";
    }
  };


  const handleDuplicate = (id: string) => {
    duplicateMutation.mutate(id);
  };

  const resetQuestionData = () => {
    setSingleOptions(["", "", "", ""]);
    setSingleCorrect(0);
    setMultipleOptions(["", "", "", ""]);
    setMultipleCorrect([]);
    setMatchingLeft(["", "", ""]);
    setMatchingRight(["", "", ""]);
    setMatchingPairs([]);
    setRankingItems(["", "", "", ""]);
    setMediaUrl("");
    setMediaType("");
    setShuffleAnswers(true);
    setDifficulty(50);
    setFeedbackMode("general");
    setFeedback("");
    setFeedbackCorrect("");
    setFeedbackIncorrect("");
    setTags([]);
    setMediaFileName("");
    if (mediaFileInputRef.current) {
      mediaFileInputRef.current.value = "";
    }
  };

  const handleOpenCreate = () => {
    setEditingQuestion(null);
    form.reset({ topicId: "", type: "single", prompt: "" });
    setSelectedType("single");
    resetQuestionData();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (question: Question) => {
    setEditingQuestion(question);
    form.reset({
      topicId: question.topicId,
      type: question.type as QuestionType,
      prompt: question.prompt,
    });
    setSelectedType(question.type as QuestionType);

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
    }

    setMediaUrl(question.mediaUrl || "");
    setMediaType((question.mediaType as "image" | "audio" | "video" | "") || "");
    setShuffleAnswers(question.shuffleAnswers !== false);
    setDifficulty(question.difficulty ?? 50);
    setFeedbackMode((question.feedbackMode as "general" | "conditional") || "general");
    setFeedback(question.feedback || "");
    setFeedbackCorrect(question.feedbackCorrect || "");
    setFeedbackIncorrect(question.feedbackIncorrect || "");
    setTags(Array.isArray(question.tags) ? question.tags : []);

    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingQuestion(null);
    form.reset();
    resetQuestionData();
  };

  // PRD-15 T-12: dry-run first. Clean delete keeps the plain confirm; a delete
  // that affects published tests opens the content-impact dialog (block/warn).
  const handleDelete = (id: string) => {
    contentGuard.guard({
      url: `/api/questions/${id}`,
      method: "DELETE",
      blockTitle: "Вопрос нельзя удалить: его используют опубликованные тесты",
      blockDescription:
        "Вопрос входит в выдачу опубликованных тестов. Удаление нарушит их работу.",
      warnTitle: "Удалить вопрос? Это затронет другие тесты",
      warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
      confirmLabel: "Удалить вопрос",
      confirmClean: () => confirm(t.questions.confirmDelete),
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
        toast({
          title: t.questions.questionDeleted,
          description: t.questions.questionDeletedDescription,
        });
      },
    });
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
    }

    return { dataJson, correctJson };
  };

  const onSubmit = (formData: any) => {
    const { dataJson, correctJson } = buildQuestionData();
    if (isUploadingMedia) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: "Дождись окончания загрузки медиа.",
      });
      return;
    }

    if (mediaUrl && isDataUrl(mediaUrl)) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: "Нельзя сохранять медиа как base64 в JSON. Используй кнопку \"Загрузить файл\".",
      });
      return;
    }
    const data = {
      ...formData,
      dataJson,
      correctJson,
      mediaUrl: mediaUrl.trim() || null,
      mediaType: mediaType || null,
      shuffleAnswers,
      difficulty,
      feedbackMode,
      feedback: feedbackMode === "general" ? (feedback.trim() || null) : null,
      feedbackCorrect: feedbackMode === "conditional" ? (feedbackCorrect.trim() || null) : null,
      feedbackIncorrect: feedbackMode === "conditional" ? (feedbackIncorrect.trim() || null) : null,
      tags,
    };

    if (editingQuestion) {
      // PRD-15 T-12: edits that affect delivery/grading of published tests are
      // gated by the content guard (dry-run first). A clean edit saves directly;
      // a warning-only edit asks for confirmation; a blocking one shows the 409.
      contentGuard.guard({
        url: `/api/questions/${editingQuestion.id}`,
        method: "PUT",
        body: data,
        blockTitle: "Вопрос нельзя изменить: правка ломает опубликованные тесты",
        blockDescription:
          "Изменение состава, баллов или тегов нарушит выдачу или оценивание опубликованных тестов.",
        warnTitle: "Сохранить изменения? Это затронет другие тесты",
        warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
        confirmLabel: "Сохранить изменения",
        confirmVariant: "primary",
        onDone: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
          toast({
            title: t.questions.questionUpdated,
            description: t.questions.questionUpdatedDescription,
          });
          handleCloseDialog();
        },
      });
    } else {
      createMutation.mutate(data);
    }
  };

  // PRD-15 T-12: bulk delete runs the same guard (dry-run first); a clean
  // batch keeps the plain confirm, an impacting one opens the content dialog.
  const handleBulkDelete = () => {
    if (selectedQuestions.size === 0) return;
    const ids = Array.from(selectedQuestions);
    contentGuard.guard({
      url: "/api/questions/bulk-delete",
      method: "POST",
      body: { ids },
      blockTitle: "Вопросы нельзя удалить: их используют опубликованные тесты",
      blockDescription:
        "Часть выбранных вопросов входит в выдачу опубликованных тестов. Удаление нарушит их работу.",
      warnTitle: "Удалить выбранные вопросы? Это затронет другие тесты",
      warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
      confirmLabel: `Удалить (${ids.length})`,
      confirmClean: () => confirm(`${t.questions.confirmBulkDelete} ${ids.length}?`),
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
        toast({
          title: t.questions.questionsDeleted,
          description: `${t.questions.deletedCount} ${ids.length}`,
        });
        setSelectedQuestions(new Set());
      },
    });
  };

  const toggleQuestionSelection = (id: string) => {
    const newSelection = new Set(selectedQuestions);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedQuestions(newSelection);
  };

  const filteredQuestions = questions?.filter((q) => {
    if (filterTopicId !== "all" && q.topicId !== filterTopicId) return false;
    if (filterType !== "all" && q.type !== filterType) return false;
    if (searchQuery && !q.prompt.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterDifficulty !== "all") {
      const diff = q.difficulty ?? 50;
      if (filterDifficulty === "easy" && diff > 33) return false;
      if (filterDifficulty === "medium" && (diff <= 33 || diff > 66)) return false;
      if (filterDifficulty === "hard" && diff <= 66) return false;
    }
    return true;
  });

  const toggleAllQuestions = () => {
    if (!filteredQuestions) return;
    if (selectedQuestions.size === filteredQuestions.length) {
      setSelectedQuestions(new Set());
    } else {
      setSelectedQuestions(new Set(filteredQuestions.map(q => q.id)));
    }
  };

  if (questionsLoading) {
    return <LoadingState message={t.questions.loadingQuestions} />;
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title={t.questions.title}
        description={t.questions.description}
        actions={
          <Cluster gap={2}>
            <Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setIsImportDialogOpen(true)} data-testid="button-import-questions">
              {t.questions.import}
            </Button>
            <Button variant="secondary" leadingIcon={<Download size={16} />} onClick={() => setIsExportDialogOpen(true)} data-testid="button-export-questions">
              {t.questions.export}
            </Button>
            <Button leadingIcon={<Plus size={16} />} onClick={handleOpenCreate} data-testid="button-create-question">
              {t.questions.createQuestion}
            </Button>
          </Cluster>
        }
      />

      <Cluster gap={4}>
        <Cluster gap={2}>
          <Text variant="body-s" tone="muted">{t.questions.topic}:</Text>
          <Select
            value={filterTopicId}
            onChange={setFilterTopicId}
            placeholder={t.questions.allTopics}
            data-testid="select-filter-topic"
            options={[
              { value: "all", label: t.questions.allTopics },
              ...(topics?.map((topic) => ({ value: topic.id, label: topic.name })) ?? []),
            ]}
          />
        </Cluster>
        <Cluster gap={2}>
          <Text variant="body-s" tone="muted">{t.questions.type}:</Text>
          <Select
            value={filterType}
            onChange={setFilterType}
            placeholder={t.questions.allTypes}
            data-testid="select-filter-type"
            options={[
              { value: "all", label: t.questions.allTypes },
              ...questionTypes.map((type) => ({ value: type.value, label: type.label })),
            ]}
          />
        </Cluster>
        <Cluster gap={2}>
          <Text variant="body-s" tone="muted">{t.questions.difficulty}:</Text>
          <Select
            value={filterDifficulty}
            onChange={setFilterDifficulty}
            placeholder={t.questions.allDifficulties}
            data-testid="select-filter-difficulty"
            options={[
              { value: "all", label: t.questions.allDifficulties },
              { value: "easy", label: t.questions.difficultyEasy },
              { value: "medium", label: t.questions.difficultyMedium },
              { value: "hard", label: t.questions.difficultyHard },
            ]}
          />
        </Cluster>
        <Box grow>
          <Input
            iconLeft={<Search size={16} />}
            placeholder="Поиск по тексту вопроса..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
          />
        </Box>
      </Cluster>

      {!filteredQuestions || filteredQuestions.length === 0 ? (
        <EmptyState
          art={<FileQuestion size={48} color="var(--ou-fg-muted)" />}
          title={t.questions.noQuestions}
          description={t.questions.noQuestionsDescription}
          actions={
            <Button leadingIcon={<Plus size={16} />} onClick={handleOpenCreate}>
              {t.questions.createQuestion}
            </Button>
          }
        />
      ) : (
        <Stack gap={4}>
          <Box pad={3} surface="muted" radius="m">
            <Cluster gap={4}>
              <Checkbox
                label={selectedQuestions.size === filteredQuestions.length ? t.questions.deselectAll : t.questions.selectAll}
                checked={selectedQuestions.size === filteredQuestions.length && filteredQuestions.length > 0}
                onChange={toggleAllQuestions}
                data-testid="checkbox-select-all"
              />
              {selectedQuestions.size > 0 && (
                <Cluster gap={2}>
                  <Text variant="body-s" tone="muted">
                    {selectedQuestions.size} {t.questions.selected}
                  </Text>
                  <Button
                    variant="destructive"
                    size="s"
                    leadingIcon={<Trash2 size={16} />}
                    onClick={handleBulkDelete}
                    data-testid="button-bulk-delete"
                  >
                    {t.questions.deleteSelected}
                  </Button>
                </Cluster>
              )}
            </Cluster>
          </Box>
          {filteredQuestions.map((question) => (
            <Card key={question.id} data-testid={`card-question-${question.id}`}>
              <CardHeader
                lead={
                  <Checkbox
                    checked={selectedQuestions.has(question.id)}
                    onChange={() => toggleQuestionSelection(question.id)}
                    aria-label={`Выбрать вопрос`}
                    data-testid={`checkbox-question-${question.id}`}
                  />
                }
                trail={
                  <Cluster gap={1} wrap={false}>
                    <IconButton
                      variant="ghost"
                      size="s"
                      aria-label="Дублировать"
                      icon={<Copy size={16} />}
                      onClick={() => handleDuplicate(question.id)}
                      data-testid={`button-duplicate-question-${question.id}`}
                    />
                    <IconButton
                      variant="ghost"
                      size="s"
                      aria-label={t.common.edit}
                      icon={<Pencil size={16} />}
                      onClick={() => handleOpenEdit(question)}
                      data-testid={`button-edit-question-${question.id}`}
                    />
                    <IconButton
                      variant="ghost"
                      size="s"
                      aria-label={t.common.delete}
                      icon={<Trash2 size={16} />}
                      onClick={() => handleDelete(question.id)}
                      data-testid={`button-delete-question-${question.id}`}
                    />
                  </Cluster>
                }
              >
                <Stack gap={2}>
                  <Cluster gap={2}>
                    <Tag>{question.topicName}</Tag>
                    <Tag tone={typeTone(question.type)}>
                      {questionTypes.find((ty) => ty.value === question.type)?.label}
                    </Tag>
                    <Tag variant="outline" tone={difficultyTone(question.difficulty ?? 50)}>
                      {t.questions.difficulty}: {question.difficulty ?? 50}
                    </Tag>
                  </Cluster>
                  <Text as="p" variant="body-l" weight="medium">{question.prompt}</Text>
                </Stack>
              </CardHeader>
              <CardBody>
                <QuestionPreview question={question} />
              </CardBody>
            </Card>
          ))}
        </Stack>
      )}

      {/* Question editor — ui-kit ModalDialog + react-hook-form bridge
          (Controller on the Selects, register on the prompt Textarea). */}
      <ModalDialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        size="xl"
        title={editingQuestion ? t.questions.editQuestion : t.questions.createQuestion}
        footer={
          <>
            <Button variant="secondary" onClick={handleCloseDialog}>{t.common.cancel}</Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={isUploadingMedia}
              loading={createMutation.isPending}
              data-testid="button-submit-question"
            >
              {editingQuestion ? t.common.update : t.common.create}
            </Button>
          </>
        }
      >
        <Stack gap={6}>
          <FormGroup columns="two">
            <Controller
              control={form.control}
              name="topicId"
              render={({ field, fieldState }) => (
                <Select
                  label={t.questions.topic}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t.questions.selectTopic}
                  error={fieldState.error?.message}
                  fullWidth
                  data-testid="select-question-topic"
                  options={topics?.map((topic) => ({ value: topic.id, label: topic.name })) ?? []}
                />
              )}
            />
            <Controller
              control={form.control}
              name="type"
              render={({ field, fieldState }) => (
                <Select
                  label={t.questions.questionType}
                  value={field.value}
                  onChange={(val) => {
                    field.onChange(val);
                    setSelectedType(val as QuestionType);
                    resetQuestionData();
                  }}
                  placeholder={t.questions.selectType}
                  error={fieldState.error?.message}
                  fullWidth
                  data-testid="select-question-type"
                  options={questionTypes.map((type) => ({ value: type.value, label: type.label }))}
                />
              )}
            />
          </FormGroup>

          <Textarea
            label={t.questions.questionText}
            placeholder={t.questions.questionTextPlaceholder}
            rows={2}
            fullWidth
            error={form.formState.errors.prompt?.message}
            data-testid="input-question-prompt"
            {...form.register("prompt")}
          />

          <Stack gap={2}>
            <Label>{t.questions.difficulty}</Label>
            <Cluster gap={4} wrap={false}>
              <Box grow>
                <Slider
                  value={difficulty}
                  onChange={(v) => setDifficulty(v as number)}
                  min={0}
                  max={100}
                  step={1}
                  ariaLabel={t.questions.difficulty}
                  data-testid="slider-question-difficulty"
                />
              </Box>
              <Input
                type="number"
                min={0}
                max={100}
                value={difficulty}
                onChange={(e) => setDifficulty(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                data-testid="input-question-difficulty"
              />
            </Cluster>
            <Text as="p" variant="body-xs" tone="muted">{t.questions.difficultyHint}</Text>
          </Stack>

          <Stack gap={4}>
            <Label>{t.questions.mediaOptional}</Label>
            <FormGroup columns="two">
              <Input
                label={t.questions.mediaUrl}
                placeholder={t.questions.mediaUrlPlaceholder}
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                fullWidth
                data-testid="input-question-media-url"
              />
              <Select
                label={t.questions.mediaType}
                value={mediaType || "none"}
                onChange={(val) => setMediaType(val === "none" ? "" : val as "image" | "audio" | "video")}
                placeholder={t.questions.selectType}
                fullWidth
                data-testid="select-question-media-type"
                options={[
                  { value: "none", label: t.common.none },
                  { value: "image", label: t.questions.image },
                  { value: "audio", label: t.questions.audio },
                  { value: "video", label: t.questions.video },
                ]}
              />
            </FormGroup>
            <Cluster gap={2}>
              <Button
                type="button"
                variant="secondary"
                size="s"
                leadingIcon={isUploadingMedia ? undefined : <Upload size={16} />}
                loading={isUploadingMedia}
                onClick={handlePickMediaFile}
                disabled={isUploadingMedia}
                data-testid="button-upload-question-media"
              >
                {isUploadingMedia ? "Загрузка..." : "Загрузить файл"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="s"
                onClick={clearMedia}
                disabled={!mediaUrl || isUploadingMedia}
                data-testid="button-clear-question-media"
              >
                Очистить
              </Button>

              {mediaFileName && (
                <Text variant="body-xs" tone="muted">
                  {mediaFileName}
                </Text>
              )}
            </Cluster>

            <input
              ref={mediaFileInputRef}
              type="file"
              accept="image/*,audio/*,video/*"
              hidden
              onChange={handleMediaFileChange}
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

          <Checkbox
            label={t.questions.shuffleAnswers}
            description={t.questions.shuffleAnswersHint}
            checked={shuffleAnswers}
            onChange={(e) => setShuffleAnswers(e.target.checked)}
            data-testid="checkbox-shuffle-answers"
          />

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

          {/* PRD-15 block D (FR-35): балл и цена ответа переехали в тест. */}
          <Box border radius="m" pad={3} data-testid="question-scoring-moved-hint">
            <Text as="p" variant="body-s" tone="muted">
              Балл и цена ответа настраиваются в каждом тесте отдельно — вкладка «Оценка»
              редактора теста. В банке вопрос хранит только содержание.
            </Text>
          </Box>

          <TagsInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
        </Stack>
      </ModalDialog>

      <ModalDialog
        open={isImportDialogOpen}
        onClose={() => {
          setIsImportDialogOpen(false);
          setImportFile(null);
          setImportPreview(null);
        }}
        size="l"
        title={t.questions.importQuestions}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsImportDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="secondary"
              onClick={handleCheckImport}
              disabled={!importFile || importMutation.isPending}
              loading={importMutation.isPending}
              data-testid="button-check-import"
            >
              Проверить
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importFile || importMutation.isPending}
              loading={importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {t.questions.uploadFile}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Text as="p" variant="body-s" tone="muted">
            {t.questions.selectFile}
          </Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            aria-label={t.questions.selectFile}
            onChange={(e) => handleImportFileChange(e.target.files?.[0] || null)}
            data-testid="input-import-file"
          />

          {/* PRD-14 Ф2 (FR-12): шаблон с заголовками и листом-справкой. */}
          <a href="/api/questions/template" data-testid="link-download-template">
            <Cluster gap={1}>
              <Download size={16} color="var(--ou-accent-default)" />
              <Text variant="body-s" tone="accent">Скачать шаблон Excel</Text>
            </Cluster>
          </a>

          {/* PRD-14 Ф2 (FR-14): краткие подсказки по формату. */}
          <Box border radius="m" pad={3}>
            <Stack gap={1}>
              <Text as="p" variant="body-xs" tone="muted">Колонки берутся из шаблона. Обязательные: Тема, Тип вопроса, Текст вопроса, варианты и правильные ответы.</Text>
              <Text as="p" variant="body-xs" tone="muted">Тип: multiple_choice, multiple_response, matching, ranking. Разделитель вариантов — «#».</Text>
              <Text as="p" variant="body-xs" tone="muted">Заполненный «ID» обновляет вопрос; пустой — создаёт. Подробности — на листе «Справка».</Text>
            </Stack>
          </Box>

          {/* PRD-14 Ф2 (FR-13): результат предпросмотра (dry-run). */}
          {importPreview && (
            <Box border radius="m" pad={3} data-testid="import-preview">
              <Stack gap={2}>
                <Text as="p" variant="body-s" weight="medium">Предпросмотр (запись ещё не выполнена):</Text>
                <Text as="p" variant="body-s" tone="muted">
                  Будет создано: {importPreview.created}. Обновлено: {importPreview.updated}. Пропущено дублей:{" "}
                  {importPreview.skipped}. Ошибок: {importPreview.errors.length}.
                </Text>
                {importPreview.errors.length > 0 && (
                  <ScrollArea maxH="sm">
                    <Stack gap={1} as="ul">
                      {importPreview.errors.map((err, i) => (
                        <Text as="li" key={i} variant="body-s" tone="error">{err}</Text>
                      ))}
                    </Stack>
                  </ScrollArea>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      </ModalDialog>

      {/* Export Dialog */}
      <ModalDialog
        open={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        size="m"
        title="Экспорт вопросов"
        description="Выберите какие вопросы экспортировать в Excel"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsExportDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              leadingIcon={<Download size={16} />}
              onClick={handleExport}
              disabled={
                (exportMode === "topics" && exportTopicIds.length === 0) ||
                (exportMode === "test" && !exportTestId)
              }
              data-testid="button-confirm-export"
            >
              {t.questions.export}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Stack gap={3}>
            <Label>Режим экспорта</Label>
            <RadioGroup
              value={exportMode}
              onChange={(val) => {
                setExportMode(val as "all" | "topics" | "test");
                setExportTopicIds([]);
                setExportTestId("");
              }}
              options={[
                { value: "all", label: "Все вопросы" },
                { value: "topics", label: "Выбрать темы" },
                { value: "test", label: "По тесту (все темы теста)" },
              ]}
            />
          </Stack>

          {exportMode === "topics" && (
            <Box border radius="m" pad={3}>
              <ScrollArea maxH="sm">
                <Stack gap={2}>
                  {topics?.map((topic) => (
                    <Checkbox
                      key={topic.id}
                      label={topic.name}
                      checked={exportTopicIds.includes(topic.id)}
                      onChange={() => toggleExportTopic(topic.id)}
                    />
                  ))}
                  {(!topics || topics.length === 0) && (
                    <Text variant="body-s" tone="muted">Нет тем</Text>
                  )}
                </Stack>
              </ScrollArea>
            </Box>
          )}

          {exportMode === "test" && (
            <Select
              value={exportTestId}
              onChange={setExportTestId}
              placeholder="Выберите тест"
              fullWidth
              options={tests?.map((test) => ({ value: test.id, label: test.title })) ?? []}
            />
          )}

          {exportMode === "topics" && exportTopicIds.length > 0 && (
            <Text as="p" variant="body-s" tone="muted">
              Выбрано тем: {exportTopicIds.length}
            </Text>
          )}
        </Stack>
      </ModalDialog>

      {/* PRD-15 T-12: content-impact dialog for deletes affecting other tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />
    </Stack>
  );
}

function QuestionPreview({ question }: { question: Question }) {
  const data = question.dataJson as any;
  const correct = question.correctJson as any;

  const mediaSection = question.mediaUrl && question.mediaType ? (
    <Box>
      {question.mediaType === "image" && (
        <Cluster gap={2}>
          <Image size={16} color="var(--ou-fg-muted)" />
          <Text variant="body-s" tone="muted">Прикреплено изображение</Text>
        </Cluster>
      )}
      {question.mediaType === "audio" && (
        <Cluster gap={2}>
          <Music size={16} color="var(--ou-fg-muted)" />
          <Text variant="body-s" tone="muted">Прикреплено аудио</Text>
        </Cluster>
      )}
      {question.mediaType === "video" && (
        <Cluster gap={2}>
          <Video size={16} color="var(--ou-fg-muted)" />
          <Text variant="body-s" tone="muted">Прикреплено видео</Text>
        </Cluster>
      )}
    </Box>
  ) : null;

  if (question.type === "single") {
    return (
      <Stack gap={4}>
        {mediaSection}
        <Stack gap={1}>
          {data.options?.map((opt: string, i: number) => (
            i === correct.correctIndex ? (
              <Box key={i} pad={2} radius="s" surface="muted">
                <Text variant="body-s" tone="success">{i + 1}. {opt}</Text>
              </Box>
            ) : (
              <Box key={i} pad={2} radius="s">
                <Text variant="body-s" tone="muted">{i + 1}. {opt}</Text>
              </Box>
            )
          ))}
        </Stack>
      </Stack>
    );
  }

  if (question.type === "multiple") {
    return (
      <Stack gap={4}>
        {mediaSection}
        <Stack gap={1}>
          {data.options?.map((opt: string, i: number) => (
            correct.correctIndices?.includes(i) ? (
              <Box key={i} pad={2} radius="s" surface="muted">
                <Text variant="body-s" tone="success">{i + 1}. {opt}</Text>
              </Box>
            ) : (
              <Box key={i} pad={2} radius="s">
                <Text variant="body-s" tone="muted">{i + 1}. {opt}</Text>
              </Box>
            )
          ))}
        </Stack>
      </Stack>
    );
  }

  if (question.type === "matching") {
    return (
      <Stack gap={4}>
        {mediaSection}
        <Grid cols={2} gap={4}>
          <Stack gap={1}>
            {data.left?.map((item: string, i: number) => (
              <Box key={i} pad={2} surface="muted" radius="s">
                <Text variant="body-s">{i + 1}. {item}</Text>
              </Box>
            ))}
          </Stack>
          <Stack gap={1}>
            {data.right?.map((item: string, i: number) => (
              <Box key={i} pad={2} surface="muted" radius="s">
                <Text variant="body-s">{String.fromCharCode(65 + i)}. {item}</Text>
              </Box>
            ))}
          </Stack>
        </Grid>
      </Stack>
    );
  }

  if (question.type === "ranking") {
    return (
      <Stack gap={4}>
        {mediaSection}
        <Stack gap={1}>
          {data.items?.map((item: string, i: number) => (
            <Box key={i} pad={2} surface="muted" radius="s">
              <Cluster gap={2}>
                <GripVertical size={12} color="var(--ou-fg-muted)" />
                <Text variant="body-s">{i + 1}. {item}</Text>
              </Cluster>
            </Box>
          ))}
        </Stack>
      </Stack>
    );
  }

  return null;
}

function SingleChoiceBuilder({
  options,
  setOptions,
  correctIndex,
  setCorrectIndex,
}: {
  options: string[];
  setOptions: (opts: string[]) => void;
  correctIndex: number;
  setCorrectIndex: (idx: number) => void;
}) {
  const groupName = useId();
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
      <Label>{t.questions.correctAnswer}</Label>
      <Stack gap={2}>
        {options.map((opt, i) => (
          <Cluster key={i} gap={2} wrap={false}>
            <Radio
              name={groupName}
              checked={correctIndex === i}
              onChange={() => setCorrectIndex(i)}
              aria-label={`${t.questions.correctAnswer} ${i + 1}`}
            />
            <Box grow>
              <Input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
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
      <Label>{t.questions.correctAnswers}</Label>
      <Stack gap={2}>
        {options.map((opt, i) => (
          <Cluster key={i} gap={2} wrap={false}>
            <Checkbox
              checked={correctIndices.includes(i)}
              onChange={() => toggleCorrect(i)}
              aria-label={`${t.questions.optionPlaceholder} ${i + 1}`}
            />
            <Box grow>
              <Input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
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
          <Cluster key={i} gap={2} wrap={false}>
            <GripVertical size={16} color="var(--ou-fg-muted)" />
            <Text variant="body-s" weight="medium">{i + 1}.</Text>
            <Box grow>
              <Input
                value={item}
                onChange={(e) => updateItem(i, e.target.value)}
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
        ))}
      </Stack>
      <Button type="button" variant="secondary" size="s" leadingIcon={<Plus size={16} />} onClick={addItem}>
        {t.questions.addOption}
      </Button>
    </Stack>
  );
}
