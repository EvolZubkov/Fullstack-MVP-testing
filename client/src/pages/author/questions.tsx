/**
 * @module pages/author/questions
 * @description Author question bank: a filterable card list of questions plus
 * the reusable question editor (mounted via {@link QuestionEditorDrawer}) and
 * the Excel import/export dialogs. Rendered entirely with the UniversityRT
 * design system — layout via Stack/Cluster/Grid/Box, typography via Text, forms
 * via FormGroup and the controls' built-in labels (no raw utility classes).
 * The question editor itself was extracted into
 * `features/questions/question-editor-drawer` so the bank and the future
 * `/author/content` section share one editor.
 */
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, FileQuestion, GripVertical, Image, Music, Video, Copy, Upload, Download } from "lucide-react";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Cluster,
  EmptyState,
  Grid,
  IconButton,
  Input,
  Label,
  ModalDialog,
  RadioGroup,
  ScrollArea,
  Select,
  Stack,
  Tag,
  Text,
  type Tone,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import { QuestionEditorDrawer } from "@/features/questions/question-editor-drawer";
import type { Question, Topic } from "@shared/schema";

const questionTypes = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
] as const;

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

interface QuestionWithTopic extends Question {
  topicName: string;
}

export default function QuestionsPage() {
  const { toast } = useToast();
  const contentGuard = useContentGuard();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [filterTopicId, setFilterTopicId] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  // Question edits go through the content guard (see QuestionEditorDrawer, PRD-15 T-12).

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

  const handleDuplicate = (id: string) => {
    duplicateMutation.mutate(id);
  };

  const handleOpenCreate = () => {
    setEditingQuestion(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (question: Question) => {
    setEditingQuestion(question);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingQuestion(null);
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
        <Stack gap={1}>
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

      {/* Reusable question editor (Drawer). Mounts in create or edit mode and
          owns its own content guard for guarded edits (PRD-15 T-12). */}
      <QuestionEditorDrawer
        open={isDialogOpen}
        question={editingQuestion}
        defaultTopicId={filterTopicId !== "all" ? filterTopicId : undefined}
        topics={topics ?? []}
        tagSuggestions={tagSuggestions}
        onClose={handleCloseDialog}
      />

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
