import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ClipboardList, Download, Settings, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState, LoadingSpinner } from "@/components/loading-state";
import { t, formatQuestions, formatTopics } from "@/lib/i18n";
import type { Test, TestSection, Topic } from "@shared/schema";

interface TopicWithQuestionCount extends Topic {
  questionCount: number;
}

interface TestWithSections extends Test {
  sections: (TestSection & { topicName: string; maxQuestions: number })[];
}

const testFormSchema = z.object({
  title: z.string().min(1, t.tests.titleRequired),
  description: z.string().optional(),
  feedback: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  overallPassType: z.enum(["percent", "absolute"]),
  overallPassValue: z.coerce.number().min(0, "Должно быть не менее 0"),
  timeLimitMinutes: z.coerce.number().min(0).optional().nullable(),
  maxAttempts: z.coerce.number().min(1).optional().nullable(),
  showCorrectAnswers: z.boolean(),
  startPageContent: z.string().optional(),
});

type TestFormData = z.infer<typeof testFormSchema>;

interface SectionConfig {
  topicId: string;
  topicName: string;
  maxQuestions: number;
  drawCount: number;
  hasPassRule: boolean;
  passType: "percent" | "absolute";
  passValue: number;
}

export default function TestsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<TestWithSections | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSections, setSelectedSections] = useState<SectionConfig[]>([]);

  const { data: tests, isLoading: testsLoading } = useQuery<TestWithSections[]>({
    queryKey: ["/api/tests"],
  });

  const { data: topics } = useQuery<TopicWithQuestionCount[]>({
    queryKey: ["/api/topics"],
  });

  const form = useForm<TestFormData>({
    resolver: zodResolver(testFormSchema),
    defaultValues: {
      title: "",
      description: "",
      feedback: "",
      webhookUrl: "",
      overallPassType: "percent",
      overallPassValue: 80,
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      startPageContent: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tests", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      toast({ title: t.tests.testCreated, description: t.tests.testCreatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.tests.failedToCreate });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PUT", `/api/tests/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      toast({ title: t.tests.testUpdated, description: t.tests.testUpdatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.tests.failedToUpdate });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tests/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      toast({ title: t.tests.testDeleted, description: t.tests.testDeletedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.tests.failedToDelete });
    },
  });

  const handleOpenCreate = () => {
    setEditingTest(null);
    form.reset({
      title: "",
      description: "",
      feedback: "",
      webhookUrl: "",
      overallPassType: "percent",
      overallPassValue: 80,
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      startPageContent: "",
    });
    setSelectedSections([]);
    setStep(1);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (test: TestWithSections) => {
    setEditingTest(test);
    const passRule = test.overallPassRuleJson as any;
    form.reset({
      title: test.title,
      description: test.description || "",
      feedback: test.feedback || "",
      webhookUrl: test.webhookUrl || "",
      overallPassType: passRule?.type || "percent",
      overallPassValue: passRule?.value || 80,
      timeLimitMinutes: test.timeLimitMinutes || null,
      maxAttempts: test.maxAttempts || null,
      showCorrectAnswers: test.showCorrectAnswers || false,
      startPageContent: test.startPageContent || "",
    });

    const sections: SectionConfig[] = test.sections.map((s) => {
      const sectionPassRule = s.topicPassRuleJson as any;
      return {
        topicId: s.topicId,
        topicName: s.topicName,
        maxQuestions: s.maxQuestions,
        drawCount: s.drawCount,
        hasPassRule: !!sectionPassRule,
        passType: sectionPassRule?.type || "percent",
        passValue: sectionPassRule?.value || 80,
      };
    });
    setSelectedSections(sections);
    setStep(1);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingTest(null);
    setStep(1);
    setSelectedSections([]);
    form.reset();
  };

  const handleDelete = (id: string) => {
    if (confirm(t.tests.confirmDelete)) {
      deleteMutation.mutate(id);
    }
  };

  const handleExportScorm = async (testId: string) => {
    try {
      const response = await fetch(`/api/tests/${testId}/export/scorm`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `test_${testId}_scorm.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast({ title: t.tests.exportSuccessful, description: t.tests.scormDownloaded });
    } catch {
      toast({ variant: "destructive", title: t.tests.exportFailed, description: t.tests.couldNotExport });
    }
  };

  const toggleTopicSelection = (topic: TopicWithQuestionCount) => {
    const existing = selectedSections.find((s) => s.topicId === topic.id);
    if (existing) {
      setSelectedSections(selectedSections.filter((s) => s.topicId !== topic.id));
    } else {
      setSelectedSections([
        ...selectedSections,
        {
          topicId: topic.id,
          topicName: topic.name,
          maxQuestions: topic.questionCount,
          drawCount: Math.min(5, topic.questionCount),
          hasPassRule: false,
          passType: "percent",
          passValue: 80,
        },
      ]);
    }
  };

  const updateSection = (topicId: string, updates: Partial<SectionConfig>) => {
    setSelectedSections(
      selectedSections.map((s) => (s.topicId === topicId ? { ...s, ...updates } : s))
    );
  };

  const onSubmit = (formData: TestFormData) => {
    const data = {
      title: formData.title,
      description: formData.description,
      feedback: formData.feedback || null,
      webhookUrl: formData.webhookUrl || null,
      timeLimitMinutes: formData.timeLimitMinutes || null,
      maxAttempts: formData.maxAttempts || null,
      showCorrectAnswers: formData.showCorrectAnswers,
      startPageContent: formData.startPageContent || null,
      overallPassRuleJson: {
        type: formData.overallPassType,
        value: formData.overallPassValue,
      },
      sections: selectedSections.map((s) => ({
        topicId: s.topicId,
        drawCount: s.drawCount,
        topicPassRuleJson: s.hasPassRule
          ? { type: s.passType, value: s.passValue }
          : null,
      })),
    };

    if (editingTest) {
      updateMutation.mutate({ id: editingTest.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getTotalQuestions = () => {
    return selectedSections.reduce((sum, s) => sum + s.drawCount, 0);
  };

  if (testsLoading) {
    return <LoadingState message={t.tests.loadingTests} />;
  }

  return (
    <div>
      <PageHeader
        title={t.tests.title}
        description={t.tests.description}
        actions={
          <Button onClick={handleOpenCreate} data-testid="button-create-test">
            <Plus className="h-4 w-4 mr-2" />
            {t.tests.createTest}
          </Button>
        }
      />

      {!tests || tests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t.tests.noTests}
          description={t.tests.noTestsDescription}
          actionLabel={t.tests.createTest}
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tests.map((test) => {
            const passRule = test.overallPassRuleJson as any;
            const totalQuestions = test.sections.reduce((sum, s) => sum + s.drawCount, 0);

            return (
              <Card key={test.id} data-testid={`card-test-${test.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{test.title}</CardTitle>
                    {test.description && (
                      <CardDescription className="mt-1 line-clamp-2">
                        {test.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenEdit(test)}
                      data-testid={`button-edit-test-${test.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(test.id)}
                      data-testid={`button-delete-test-${test.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {formatQuestions(totalQuestions)}
                    </Badge>
                    <Badge variant="secondary">
                      {formatTopics(test.sections.length)}
                    </Badge>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      {t.tests.pass} {passRule?.value}
                      {passRule?.type === "percent" ? "%" : ` из ${totalQuestions}`}
                    </Badge>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium mb-1">{t.common.topics}:</p>
                    <ul className="space-y-1">
                      {test.sections.map((section) => (
                        <li key={section.id} className="flex items-center gap-2">
                          <ChevronRight className="h-3 w-3" />
                          <span>{section.topicName}</span>
                          <span className="text-xs">({section.drawCount} в.)</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    onClick={() => handleExportScorm(test.id)}
                    data-testid={`button-export-scorm-${test.id}`}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {t.tests.exportScorm}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTest ? t.tests.editTest : t.tests.createTest} - {t.tests.step} {step} {t.tests.of} 3
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-2 w-16 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-semibold">{t.tests.selectTopics}</h3>
              <p className="text-sm text-muted-foreground">
                {t.tests.selectTopicsDescription}
              </p>

              {!topics || topics.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t.tests.noTopicsAvailable}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {topics
                    .filter((topicItem) => topicItem.questionCount > 0)
                    .map((topicItem) => {
                      const isSelected = selectedSections.some((s) => s.topicId === topicItem.id);
                      return (
                        <div
                          key={topicItem.id}
                          onClick={() => toggleTopicSelection(topicItem)}
                          className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          data-testid={`topic-select-${topicItem.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{topicItem.name}</span>
                            <Badge variant="secondary">
                              {topicItem.questionCount} в.
                            </Badge>
                          </div>
                          {topicItem.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                              {topicItem.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={selectedSections.length === 0}
                  data-testid="button-next-step"
                >
                  {t.tests.nextConfigure}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold">{t.tests.configureSections}</h3>
              <p className="text-sm text-muted-foreground">
                {t.tests.configureSectionsDescription}
              </p>

              <div className="space-y-4">
                {selectedSections.map((section) => (
                  <Card key={section.topicId}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{section.topicName}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t.tests.questionsToDrawPrefix}</Label>
                          <Select
                            value={String(section.drawCount)}
                            onValueChange={(val) =>
                              updateSection(section.topicId, { drawCount: Number(val) })
                            }
                          >
                            <SelectTrigger data-testid={`select-draw-count-${section.topicId}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: section.maxQuestions }, (_, i) => i + 1).map(
                                (n) => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n} из {section.maxQuestions}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center justify-between">
                          <Label>{t.tests.topicPassRule}</Label>
                          <Switch
                            checked={section.hasPassRule}
                            onCheckedChange={(checked) =>
                              updateSection(section.topicId, { hasPassRule: checked })
                            }
                            data-testid={`switch-pass-rule-${section.topicId}`}
                          />
                        </div>
                      </div>

                      {section.hasPassRule && (
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="space-y-2">
                            <Label>{t.tests.passType}</Label>
                            <Select
                              value={section.passType}
                              onValueChange={(val: "percent" | "absolute") =>
                                updateSection(section.topicId, { passType: val })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percent">{t.tests.percentage}</SelectItem>
                                <SelectItem value="absolute">{t.tests.absolute}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>
                              {section.passType === "percent"
                                ? t.tests.minimumPercent
                                : `${t.tests.minimumCorrect} ${section.drawCount})`}
                            </Label>
                            <Input
                              type="number"
                              value={section.passValue}
                              onChange={(e) =>
                                updateSection(section.topicId, {
                                  passValue: Number(e.target.value),
                                })
                              }
                              min={0}
                              max={section.passType === "percent" ? 100 : section.drawCount}
                              data-testid={`input-pass-value-${section.topicId}`}
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t.common.back}
                </Button>
                <Button onClick={() => setStep(3)} data-testid="button-next-step">
                  {t.tests.nextFinalize}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 3 && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <h3 className="font-semibold">{t.tests.testDetails}</h3>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t.tests.testTitle}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={t.tests.testTitlePlaceholder} data-testid="input-test-title" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t.tests.testDescription}</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder={t.tests.testDescriptionPlaceholder} rows={2} data-testid="input-test-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="feedback"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t.tests.feedback}</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value || ""} placeholder={t.tests.feedbackPlaceholder} rows={2} data-testid="input-test-feedback" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="timeLimitMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.tests.timeLimit}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder={t.tests.timeLimitPlaceholder}
                            data-testid="input-time-limit"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                          />
                        </FormControl>
                        <FormDescription>{t.tests.timeLimitDescription}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxAttempts"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.tests.maxAttempts}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            placeholder={t.tests.maxAttemptsPlaceholder}
                            data-testid="input-max-attempts"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                          />
                        </FormControl>
                        <FormDescription>{t.tests.maxAttemptsDescription}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="showCorrectAnswers"
                    render={({ field }) => (
                      <FormItem className="col-span-2 flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">{t.tests.showCorrectAnswers}</FormLabel>
                          <FormDescription>{t.tests.showCorrectAnswersDescription}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-show-correct-answers"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="startPageContent"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t.tests.startPageContent}</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value || ""}
                            placeholder={t.tests.startPageContentPlaceholder}
                            rows={3}
                            data-testid="input-start-page-content"
                          />
                        </FormControl>
                        <FormDescription>{t.tests.startPageContentDescription}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="font-medium">{t.tests.overallPassCriteria}</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="overallPassType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.tests.overallPassType}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-overall-pass-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="percent">{t.tests.percentage}</SelectItem>
                              <SelectItem value="absolute">{t.tests.absolute}</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="overallPassValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.tests.overallPassValue}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={form.watch("overallPassType") === "percent" ? 100 : getTotalQuestions()}
                              data-testid="input-overall-pass-value"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <Separator />

                <FormField
                  control={form.control}
                  name="webhookUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.tests.webhookUrl}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://..." data-testid="input-webhook-url" />
                      </FormControl>
                      <FormDescription>{t.tests.webhookUrlDescription}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">{t.tests.summary}</h4>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{selectedSections.length} {t.common.topics}</p>
                    <p>{getTotalQuestions()} {t.tests.totalQuestions}</p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep(2)}>
                    {t.common.back}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-submit-test"
                  >
                    {(createMutation.isPending || updateMutation.isPending) && (
                      <LoadingSpinner className="mr-2" />
                    )}
                    {editingTest ? t.common.update : t.common.create}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
