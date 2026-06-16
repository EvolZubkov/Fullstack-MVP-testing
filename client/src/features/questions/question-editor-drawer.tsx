/**
 * @module features/questions/question-editor-drawer
 * @description Reusable question editor mounted in a UniversityRT design-system
 * Drawer. Extracted verbatim (behaviour preserved 1:1) from the «Вопросы» page
 * so both the question bank and the future `/author/content` section can mount
 * the same editor. Holds all editor-local state: the react-hook-form bridge,
 * the active question type, the per-type answer builders
 * (single/multiple/matching/ranking), media attachment + upload, conditional
 * feedback, sub-topic tags (PRD-11), difficulty (nullable, PRD-15) and
 * shuffle. Create vs. edit is driven by the `question` prop. Edits run through
 * the PRD-15 content guard (T-12) and render the {@link ContentImpactDialog}
 * locally; creates go straight through the create mutation. The only visible
 * change vs. the previous ModalDialog host is the Drawer shell — fields,
 * layout, validation, uploads and toasts are unchanged.
 */
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Upload, GripVertical } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Button,
  Checkbox,
  Cluster,
  Drawer,
  FormGroup,
  IconButton,
  Input,
  Label,
  Radio,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { t } from "@/lib/i18n";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import type { Question, Topic } from "@shared/schema";
import { TagsInput } from "@/pages/author/tags-input";

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
  const { toast } = useToast();
  const contentGuard = useContentGuard();

  const [selectedType, setSelectedType] = useState<QuestionType>("single");

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
  const [mediaFileName, setMediaFileName] = useState<string>("");
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [shuffleAnswers, setShuffleAnswers] = useState<boolean>(true);
  const [difficulty, setDifficulty] = useState<number | null>(50);
  const [feedbackMode, setFeedbackMode] = useState<"general" | "conditional">("general");
  const [feedback, setFeedback] = useState<string>("");
  const [feedbackCorrect, setFeedbackCorrect] = useState<string>("");
  const [feedbackIncorrect, setFeedbackIncorrect] = useState<string>("");
  // PRD-11 §3a: sub-topic tags (chip input). By these tags the author sets draw quotas.
  const [tags, setTags] = useState<string[]>([]);

  const mediaFileInputRef = useRef<HTMLInputElement>(null);

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
      onSaved?.();
      onClose();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.questions.failedToCreate });
    },
  });

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

  // Initialize the draft when the Drawer opens: from `question` (edit) or as an
  // empty draft seeded with `defaultTopicId` (create). Mirrors the old
  // handleOpenCreate / handleOpenEdit handlers exactly.
  useEffect(() => {
    if (!open) return;
    if (question) {
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
      setDifficulty(question.difficulty);
      setFeedbackMode((question.feedbackMode as "general" | "conditional") || "general");
      setFeedback(question.feedback || "");
      setFeedbackCorrect(question.feedbackCorrect || "");
      setFeedbackIncorrect(question.feedbackIncorrect || "");
      setTags(Array.isArray(question.tags) ? question.tags : []);
    } else {
      form.reset({ topicId: defaultTopicId ?? "", type: "single", prompt: "" });
      setSelectedType("single");
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

    if (question) {
      // PRD-15 T-12: edits that affect delivery/grading of published tests are
      // gated by the content guard (dry-run first). A clean edit saves directly;
      // a warning-only edit asks for confirmation; a blocking one shows the 409.
      contentGuard.guard({
        url: `/api/questions/${question.id}`,
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
          onSaved?.();
          onClose();
        },
      });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <>
      {/* Question editor — ui-kit Drawer + react-hook-form bridge
          (Controller on the Selects, register on the prompt Textarea). */}
      <Drawer
        open={open}
        onClose={onClose}
        side="right"
        size="xl"
        title={question ? t.questions.editQuestion : t.questions.createQuestion}
        footer={
          <Cluster justify="end" gap={2} wrap={false}>
            <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={isUploadingMedia}
              loading={createMutation.isPending}
              data-testid="button-submit-question"
            >
              {question ? t.common.update : t.common.create}
            </Button>
          </Cluster>
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
            <Switch
              label={t.questions.difficultyUnset}
              checked={difficulty === null}
              onChange={(e) => setDifficulty(e.target.checked ? null : 50)}
              data-testid="switch-question-difficulty-unset"
            />
            {difficulty !== null && (
              <>
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
              </>
            )}
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
      </Drawer>

      {/* PRD-15 T-12: content-impact dialog for edits affecting other tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />
    </>
  );
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
