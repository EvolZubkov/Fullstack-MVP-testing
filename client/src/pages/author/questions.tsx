import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileQuestion, GripVertical, ArrowRight, Image, Music, Video, Copy, Upload, Download } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState, LoadingSpinner } from "@/components/loading-state";
import { t, formatPoints } from "@/lib/i18n";
import type { Question, Topic } from "@shared/schema";

const questionTypes = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
] as const;

type QuestionType = typeof questionTypes[number]["value"];

const baseQuestionSchema = z.object({
  topicId: z.string().min(1, t.questions.topicRequired),
  type: z.enum(["single", "multiple", "matching", "ranking"]),
  prompt: z.string().min(1, t.questions.textRequired),
  points: z.coerce.number().min(1, t.questions.minPoints).default(1),
});

interface QuestionWithTopic extends Question {
  topicName: string;
}

export default function QuestionsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedType, setSelectedType] = useState<QuestionType>("single");
  const [filterTopicId, setFilterTopicId] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const [singleOptions, setSingleOptions] = useState<string[]>(["", "", "", ""]);
  const [singleCorrect, setSingleCorrect] = useState<number>(0);

  const [multipleOptions, setMultipleOptions] = useState<string[]>(["", "", "", ""]);
  const [multipleCorrect, setMultipleCorrect] = useState<number[]>([]);

  const [matchingLeft, setMatchingLeft] = useState<string[]>(["", "", ""]);
  const [matchingRight, setMatchingRight] = useState<string[]>(["", "", ""]);
  const [matchingPairs, setMatchingPairs] = useState<{ left: number; right: number }[]>([]);

  const [rankingItems, setRankingItems] = useState<string[]>(["", "", "", ""]);

  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"image" | "audio" | "video" | "">("");
  const [shuffleAnswers, setShuffleAnswers] = useState<boolean>(true);
  const [feedbackMode, setFeedbackMode] = useState<"general" | "conditional">("general");
  const [feedback, setFeedback] = useState<string>("");
  const [feedbackCorrect, setFeedbackCorrect] = useState<string>("");
  const [feedbackIncorrect, setFeedbackIncorrect] = useState<string>("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: questions, isLoading: questionsLoading } = useQuery<QuestionWithTopic[]>({
    queryKey: ["/api/questions"],
  });

  const { data: topics } = useQuery<Topic[]>({
    queryKey: ["/api/topics"],
  });

  const form = useForm({
    resolver: zodResolver(baseQuestionSchema),
    defaultValues: {
      topicId: "",
      type: "single" as QuestionType,
      prompt: "",
      points: 1,
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PUT", `/api/questions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.questions.questionUpdated, description: t.questions.questionUpdatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToUpdate });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/questions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.questions.questionDeleted, description: t.questions.questionDeletedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToDelete });
    },
  });

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

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/questions/bulk-delete", { ids }),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.questions.questionsDeleted, description: `${t.questions.deletedCount} ${ids.length}` });
      setSelectedQuestions(new Set());
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToDelete });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/questions/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data: { imported: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      let description = `${t.questions.importedCount} ${data.imported}`;
      if (data.errors.length > 0) {
        description += `. ${t.questions.importErrors} ${data.errors.length}`;
      }
      toast({ title: t.questions.importSuccess, description });
      setIsImportDialogOpen(false);
      setImportFile(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToImport });
    },
  });

  const handleExport = () => {
    window.location.href = "/api/questions/export";
  };

  const handleImport = () => {
    if (importFile) {
      importMutation.mutate(importFile);
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
    setFeedbackMode("general");
    setFeedback("");
    setFeedbackCorrect("");
    setFeedbackIncorrect("");
  };

  const handleOpenCreate = () => {
    setEditingQuestion(null);
    form.reset({ topicId: "", type: "single", prompt: "", points: 1 });
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
      points: question.points || 1,
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
    setFeedbackMode((question.feedbackMode as "general" | "conditional") || "general");
    setFeedback(question.feedback || "");
    setFeedbackCorrect(question.feedbackCorrect || "");
    setFeedbackIncorrect(question.feedbackIncorrect || "");

    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingQuestion(null);
    form.reset();
    resetQuestionData();
  };

  const handleDelete = (id: string) => {
    if (confirm(t.questions.confirmDelete)) {
      deleteMutation.mutate(id);
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
    }

    return { dataJson, correctJson };
  };

  const onSubmit = (formData: any) => {
    const { dataJson, correctJson } = buildQuestionData();
    const data = {
      ...formData,
      dataJson,
      correctJson,
      mediaUrl: mediaUrl.trim() || null,
      mediaType: mediaType || null,
      shuffleAnswers,
      feedbackMode,
      feedback: feedbackMode === "general" ? (feedback.trim() || null) : null,
      feedbackCorrect: feedbackMode === "conditional" ? (feedbackCorrect.trim() || null) : null,
      feedbackIncorrect: feedbackMode === "conditional" ? (feedbackIncorrect.trim() || null) : null,
    };

    if (editingQuestion) {
      updateMutation.mutate({ id: editingQuestion.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleBulkDelete = () => {
    if (selectedQuestions.size === 0) return;
    if (confirm(`${t.questions.confirmBulkDelete} ${selectedQuestions.size}?`)) {
      bulkDeleteMutation.mutate(Array.from(selectedQuestions));
    }
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
            <Button variant="outline" onClick={handleExport} data-testid="button-export-questions">
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
                  disabled={bulkDeleteMutation.isPending}
                  data-testid="button-bulk-delete"
                >
                  {bulkDeleteMutation.isPending ? (
                    <LoadingSpinner className="mr-2" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
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
                      <Badge variant="outline">{formatPoints(question.points || 1)}</Badge>
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

              <FormField
                control={form.control}
                name="points"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.questions.points}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder="1"
                        className="w-32"
                        data-testid="input-question-points"
                        value={field.value}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormLabel>{t.questions.mediaOptional}</FormLabel>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">{t.questions.mediaUrl}</Label>
                    <Input
                      type="url"
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

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-question"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <LoadingSpinner className="mr-2" />
                  )}
                  {editingQuestion ? t.common.update : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent>
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
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground"
              data-testid="input-import-file"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              {t.common.cancel}
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
              className={`text-sm p-2 rounded ${
                i === correct.correctIndex
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
              className={`text-sm p-2 rounded ${
                correct.correctIndices?.includes(i)
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
