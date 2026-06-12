import { useState, useRef, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, FileQuestion, GripVertical, ArrowRight, Image, Music, Video, Copy, Upload, Download } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState, LoadingSpinner } from "@/components/loading-state";
import { t, formatPoints } from "@/lib/i18n";
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

      setMediaUrl(payload.url); // ✅ короткий URL (без base64)
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

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "single":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "multiple":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "matching":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "ranking":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      default:
        return "";
    }
  };

  const getDifficultyBadgeColor = (difficulty: number) => {
    if (difficulty <= 33) {
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    } else if (difficulty <= 66) {
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    } else {
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    }
  };

  if (questionsLoading) {
    return <LoadingState message={t.questions.loadingQuestions} />;
  }

  return (
    <div>
      <PageHeader
        title={t.questions.title}
        description={t.questions.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)} data-testid="button-import-questions">
              <Upload className="h-4 w-4 mr-2" />
              {t.questions.import}
            </Button>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(true)} data-testid="button-export-questions">
              <Download className="h-4 w-4 mr-2" />
              {t.questions.export}
            </Button>
            <Button onClick={handleOpenCreate} data-testid="button-create-question">
              <Plus className="h-4 w-4 mr-2" />
              {t.questions.createQuestion}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">{t.questions.topic}:</Label>
          <Select value={filterTopicId} onValueChange={setFilterTopicId}>
            <SelectTrigger className="w-40" data-testid="select-filter-topic">
              <SelectValue placeholder={t.questions.allTopics} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.questions.allTopics}</SelectItem>
              {topics?.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">{t.questions.type}:</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40" data-testid="select-filter-type">
              <SelectValue placeholder={t.questions.allTypes} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.questions.allTypes}</SelectItem>
              {questionTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">{t.questions.difficulty}:</Label>
          <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
            <SelectTrigger className="w-44" data-testid="select-filter-difficulty">
              <SelectValue placeholder={t.questions.allDifficulties} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.questions.allDifficulties}</SelectItem>
              <SelectItem value="easy">{t.questions.difficultyEasy}</SelectItem>
              <SelectItem value="medium">{t.questions.difficultyMedium}</SelectItem>
              <SelectItem value="hard">{t.questions.difficultyHard}</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Поиск по тексту вопроса..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {!filteredQuestions || filteredQuestions.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title={t.questions.noQuestions}
          description={t.questions.noQuestionsDescription}
          actionLabel={t.questions.createQuestion}
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-3 rounded-md bg-muted/30">
            <div className="flex items-center gap-2">
              <Checkbox
                id="selectAll"
                checked={selectedQuestions.size === filteredQuestions.length && filteredQuestions.length > 0}
                onCheckedChange={toggleAllQuestions}
                data-testid="checkbox-select-all"
              />
              <Label htmlFor="selectAll" className="text-sm cursor-pointer">
                {selectedQuestions.size === filteredQuestions.length ? t.questions.deselectAll : t.questions.selectAll}
              </Label>
            </div>
            {selectedQuestions.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedQuestions.size} {t.questions.selected}
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t.questions.deleteSelected}
                </Button>
              </div>
            )}
          </div>
          {filteredQuestions.map((question) => (
            <Card key={question.id} data-testid={`card-question-${question.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <Checkbox
                    checked={selectedQuestions.has(question.id)}
                    onCheckedChange={() => toggleQuestionSelection(question.id)}
                    data-testid={`checkbox-question-${question.id}`}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="secondary">{question.topicName}</Badge>
                      <Badge className={getTypeBadgeColor(question.type)}>
                        {questionTypes.find((ty) => ty.value === question.type)?.label}
                      </Badge>
                      <Badge variant="outline" className={getDifficultyBadgeColor(question.difficulty ?? 50)}>
                        {t.questions.difficulty}: {question.difficulty ?? 50}
                      </Badge>
                    </div>
                    <CardTitle className="text-base font-medium">{question.prompt}</CardTitle>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDuplicate(question.id)}
                    data-testid={`button-duplicate-question-${question.id}`}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(question)}
                    data-testid={`button-edit-question-${question.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(question.id)}
                    data-testid={`button-delete-question-${question.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <QuestionPreview question={question} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? t.questions.editQuestion : t.questions.createQuestion}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="topicId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.questions.topic}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-question-topic">
                            <SelectValue placeholder={t.questions.selectTopic} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {topics?.map((topic) => (
                            <SelectItem key={topic.id} value={topic.id}>
                              {topic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.questions.questionType}</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          field.onChange(val);
                          setSelectedType(val as QuestionType);
                          resetQuestionData();
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-question-type">
                            <SelectValue placeholder={t.questions.selectType} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {questionTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.questions.questionText}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t.questions.questionTextPlaceholder}
                        rows={2}
                        data-testid="input-question-prompt"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormItem>
                  <FormLabel>{t.questions.difficulty}</FormLabel>
                  <div className="flex items-center gap-4">
                    <Slider
                      value={[difficulty]}
                      onValueChange={(values) => setDifficulty(values[0])}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                      data-testid="slider-question-difficulty"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={difficulty}
                      onChange={(e) => setDifficulty(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="w-20"
                      data-testid="input-question-difficulty"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t.questions.difficultyHint}</p>
                </FormItem>
              </div>

              <div className="space-y-4">
                <FormLabel>{t.questions.mediaOptional}</FormLabel>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">{t.questions.mediaUrl}</Label>
                    <Input
                      type="text"
                      placeholder={t.questions.mediaUrlPlaceholder}
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      data-testid="input-question-media-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">{t.questions.mediaType}</Label>
                    <Select
                      value={mediaType || "none"}
                      onValueChange={(val) => setMediaType(val === "none" ? "" : val as "image" | "audio" | "video")}
                    >
                      <SelectTrigger data-testid="select-question-media-type">
                        <SelectValue placeholder={t.questions.selectType} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t.common.none}</SelectItem>
                        <SelectItem value="image">{t.questions.image}</SelectItem>
                        <SelectItem value="audio">{t.questions.audio}</SelectItem>
                        <SelectItem value="video">{t.questions.video}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePickMediaFile}
                    disabled={isUploadingMedia}
                    data-testid="button-upload-question-media"
                  >
                    {isUploadingMedia ? (
                      <>
                        <LoadingSpinner className="mr-2" />
                        Загрузка...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Загрузить файл
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearMedia}
                    disabled={!mediaUrl || isUploadingMedia}
                    data-testid="button-clear-question-media"
                  >
                    Очистить
                  </Button>

                  {mediaFileName && (
                    <span className="text-xs text-muted-foreground">
                      {mediaFileName}
                    </span>
                  )}
                </div>

                <input
                  ref={mediaFileInputRef}
                  type="file"
                  accept="image/*,audio/*,video/*"
                  className="hidden"
                  onChange={handleMediaFileChange}
                />
                {mediaUrl && mediaType && (
                  <div className="rounded-md border p-4">
                    {mediaType === "image" && (
                      <img
                        src={mediaUrl}
                        alt="Превью медиа вопроса"
                        className="max-h-48 object-contain mx-auto"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    {mediaType === "audio" && (
                      <audio controls className="w-full">
                        <source src={mediaUrl} />
                        {t.questions.browserNotSupported}
                      </audio>
                    )}
                    {mediaType === "video" && (
                      <video controls className="max-h-48 w-full">
                        <source src={mediaUrl} />
                        {t.questions.browserNotSupported}
                      </video>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="shuffleAnswers"
                  checked={shuffleAnswers}
                  onCheckedChange={(checked) => setShuffleAnswers(checked === true)}
                  data-testid="checkbox-shuffle-answers"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="shuffleAnswers" className="text-sm font-medium">
                    {t.questions.shuffleAnswers}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t.questions.shuffleAnswersHint}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">{t.questions.feedback}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{t.questions.feedbackModeGeneral}</span>
                    <Switch
                      checked={feedbackMode === "conditional"}
                      onCheckedChange={(checked) => setFeedbackMode(checked ? "conditional" : "general")}
                      data-testid="switch-feedback-mode"
                    />
                    <span className="text-xs text-muted-foreground">{t.questions.feedbackModeConditional}</span>
                  </div>
                </div>

                {feedbackMode === "general" ? (
                  <div className="space-y-2">
                    <Textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder={t.questions.feedbackPlaceholder}
                      rows={2}
                      data-testid="input-question-feedback"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t.questions.feedbackHint}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-green-600 dark:text-green-400">{t.questions.feedbackCorrect}</Label>
                      <Textarea
                        value={feedbackCorrect}
                        onChange={(e) => setFeedbackCorrect(e.target.value)}
                        placeholder={t.questions.feedbackCorrectPlaceholder}
                        rows={2}
                        data-testid="input-question-feedback-correct"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-red-600 dark:text-red-400">{t.questions.feedbackIncorrect}</Label>
                      <Textarea
                        value={feedbackIncorrect}
                        onChange={(e) => setFeedbackIncorrect(e.target.value)}
                        placeholder={t.questions.feedbackIncorrectPlaceholder}
                        rows={2}
                        data-testid="input-question-feedback-incorrect"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.questions.feedbackConditionalHint}
                    </p>
                  </div>
                )}
              </div>

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
              <div
                className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
                data-testid="question-scoring-moved-hint"
              >
                Балл и цена ответа настраиваются в каждом тесте отдельно — вкладка «Оценка»
                редактора теста. В банке вопрос хранит только содержание.
              </div>

              <TagsInput value={tags} onChange={setTags} suggestions={tagSuggestions} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={isUploadingMedia || createMutation.isPending}
                  data-testid="button-submit-question"
                >
                  {createMutation.isPending && <LoadingSpinner className="mr-2" />}
                  {editingQuestion ? t.common.update : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isImportDialogOpen}
        onOpenChange={(open) => {
          setIsImportDialogOpen(open);
          if (!open) {
            setImportFile(null);
            setImportPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.questions.importQuestions}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t.questions.selectFile}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => handleImportFileChange(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground"
              data-testid="input-import-file"
            />

            {/* PRD-14 Ф2 (FR-12): шаблон с заголовками и листом-справкой. */}
            <a
              href="/api/questions/template"
              className="inline-flex items-center text-sm text-primary hover:underline"
              data-testid="link-download-template"
            >
              <Download className="h-4 w-4 mr-1" />
              Скачать шаблон Excel
            </a>

            {/* PRD-14 Ф2 (FR-14): краткие подсказки по формату. */}
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-1">
              <p>Колонки берутся из шаблона. Обязательные: Тема, Тип вопроса, Текст вопроса, варианты и правильные ответы.</p>
              <p>Тип: multiple_choice, multiple_response, matching, ranking. Разделитель вариантов — «#».</p>
              <p>Заполненный «ID» обновляет вопрос; пустой — создаёт. Подробности — на листе «Справка».</p>
            </div>

            {/* PRD-14 Ф2 (FR-13): результат предпросмотра (dry-run). */}
            {importPreview && (
              <div className="rounded-md border p-3 text-sm space-y-2" data-testid="import-preview">
                <p className="font-medium">Предпросмотр (запись ещё не выполнена):</p>
                <p className="text-muted-foreground">
                  Будет создано: {importPreview.created}. Обновлено: {importPreview.updated}. Пропущено дублей:{" "}
                  {importPreview.skipped}. Ошибок: {importPreview.errors.length}.
                </p>
                {importPreview.errors.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto list-disc pl-5 text-destructive space-y-0.5">
                    {importPreview.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="outline"
              onClick={handleCheckImport}
              disabled={!importFile || importMutation.isPending}
              data-testid="button-check-import"
            >
              {importMutation.isPending && <LoadingSpinner className="mr-2" />}
              Проверить
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importFile || importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending && <LoadingSpinner className="mr-2" />}
              {t.questions.uploadFile}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Export Dialog */}
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Экспорт вопросов</DialogTitle>
            <DialogDescription>
              Выберите какие вопросы экспортировать в Excel
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>Режим экспорта</Label>
              <RadioGroup
                value={exportMode}
                onValueChange={(val) => {
                  setExportMode(val as "all" | "topics" | "test");
                  setExportTopicIds([]);
                  setExportTestId("");
                }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="export-all" />
                  <Label htmlFor="export-all" className="cursor-pointer">
                    Все вопросы
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="topics" id="export-topics" />
                  <Label htmlFor="export-topics" className="cursor-pointer">
                    Выбрать темы
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="test" id="export-test" />
                  <Label htmlFor="export-test" className="cursor-pointer">
                    По тесту (все темы теста)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {exportMode === "topics" && (
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                {topics?.map((topic) => (
                  <div key={topic.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`export-topic-${topic.id}`}
                      checked={exportTopicIds.includes(topic.id)}
                      onCheckedChange={() => toggleExportTopic(topic.id)}
                    />
                    <Label htmlFor={`export-topic-${topic.id}`} className="cursor-pointer text-sm">
                      {topic.name}
                    </Label>
                  </div>
                ))}
                {(!topics || topics.length === 0) && (
                  <p className="text-sm text-muted-foreground">Нет тем</p>
                )}
              </div>
            )}

            {exportMode === "test" && (
              <Select value={exportTestId} onValueChange={setExportTestId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тест" />
                </SelectTrigger>
                <SelectContent>
                  {tests?.map((test) => (
                    <SelectItem key={test.id} value={test.id}>
                      {test.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {exportMode === "topics" && exportTopicIds.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Выбрано тем: {exportTopicIds.length}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleExport}
              disabled={
                (exportMode === "topics" && exportTopicIds.length === 0) ||
                (exportMode === "test" && !exportTestId)
              }
              data-testid="button-confirm-export"
            >
              <Download className="h-4 w-4 mr-2" />
              {t.questions.export}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PRD-15 T-12: content-impact dialog for deletes affecting other tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />
    </div>
  );
}

function QuestionPreview({ question }: { question: Question }) {
  const data = question.dataJson as any;
  const correct = question.correctJson as any;

  const mediaSection = question.mediaUrl && question.mediaType ? (
    <div className="mb-4">
      {question.mediaType === "image" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Image className="h-4 w-4" />
          <span>Прикреплено изображение</span>
        </div>
      )}
      {question.mediaType === "audio" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Music className="h-4 w-4" />
          <span>Прикреплено аудио</span>
        </div>
      )}
      {question.mediaType === "video" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Video className="h-4 w-4" />
          <span>Прикреплено видео</span>
        </div>
      )}
    </div>
  ) : null;

  if (question.type === "single") {
    return (
      <div>
        {mediaSection}
        <div className="space-y-1">
          {data.options?.map((opt: string, i: number) => (
            <div
              key={i}
              className={`text-sm p-2 rounded ${i === correct.correctIndex
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "text-muted-foreground"
                }`}
            >
              {i + 1}. {opt}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "multiple") {
    return (
      <div>
        {mediaSection}
        <div className="space-y-1">
          {data.options?.map((opt: string, i: number) => (
            <div
              key={i}
              className={`text-sm p-2 rounded ${correct.correctIndices?.includes(i)
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "text-muted-foreground"
                }`}
            >
              {i + 1}. {opt}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "matching") {
    return (
      <div>
        {mediaSection}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            {data.left?.map((item: string, i: number) => (
              <div key={i} className="text-sm p-2 bg-muted rounded">
                {i + 1}. {item}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {data.right?.map((item: string, i: number) => (
              <div key={i} className="text-sm p-2 bg-muted rounded">
                {String.fromCharCode(65 + i)}. {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (question.type === "ranking") {
    return (
      <div>
        {mediaSection}
        <div className="space-y-1">
          {data.items?.map((item: string, i: number) => (
            <div key={i} className="text-sm p-2 bg-muted rounded flex items-center gap-2">
              <GripVertical className="h-3 w-3 text-muted-foreground" />
              {i + 1}. {item}
            </div>
          ))}
        </div>
      </div>
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
    <div className="space-y-4">
      <FormLabel>{t.questions.correctAnswer}</FormLabel>
      <RadioGroup
        value={String(correctIndex)}
        onValueChange={(val) => setCorrectIndex(Number(val))}
        className="space-y-2"
      >
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <RadioGroupItem value={String(i)} id={`option-${i}`} />
            <Input
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
              className="flex-1"
              data-testid={`input-option-${i}`}
            />
            {options.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeOption(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </RadioGroup>
      <Button type="button" variant="outline" size="sm" onClick={addOption}>
        <Plus className="h-4 w-4 mr-2" />
        {t.questions.addOption}
      </Button>
    </div>
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
    <div className="space-y-4">
      <FormLabel>{t.questions.correctAnswers}</FormLabel>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Checkbox
              checked={correctIndices.includes(i)}
              onCheckedChange={() => toggleCorrect(i)}
              id={`multi-option-${i}`}
            />
            <Input
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
              className="flex-1"
              data-testid={`input-multi-option-${i}`}
            />
            {options.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeOption(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addOption}>
        <Plus className="h-4 w-4 mr-2" />
        {t.questions.addOption}
      </Button>
    </div>
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <FormLabel>{t.questions.leftItems}</FormLabel>
          {left.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm font-medium w-6">{i + 1}.</span>
              <Input
                value={item}
                onChange={(e) => updateLeft(i, e.target.value)}
                placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
                data-testid={`input-matching-left-${i}`}
              />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <FormLabel>{t.questions.rightItems}</FormLabel>
          {right.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm font-medium w-6">{String.fromCharCode(65 + i)}.</span>
              <Input
                value={item}
                onChange={(e) => updateRight(i, e.target.value)}
                placeholder={`${t.questions.optionPlaceholder} ${String.fromCharCode(65 + i)}`}
                data-testid={`input-matching-right-${i}`}
              />
            </div>
          ))}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addPair}>
        <Plus className="h-4 w-4 mr-2" />
        {t.questions.addPair}
      </Button>
    </div>
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
    <div className="space-y-4">
      <FormLabel>{t.questions.itemsToRank}</FormLabel>
      <p className="text-sm text-muted-foreground">{t.questions.orderItems}</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium w-6">{i + 1}.</span>
            <Input
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
              placeholder={`${t.questions.optionPlaceholder} ${i + 1}`}
              className="flex-1"
              data-testid={`input-ranking-${i}`}
            />
            {items.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeItem(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus className="h-4 w-4 mr-2" />
        {t.questions.addOption}
      </Button>
    </div>
  );
}
