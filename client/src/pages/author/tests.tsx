import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, ClipboardList, Download, Settings, ChevronRight, BarChart3, UserPlus } from "lucide-react";
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
import { Link } from "wouter";
import { AssignTestDialog } from "@/components/assign-test-dialog";

interface TopicWithQuestionCount extends Topic {
  questionCount: number;
}

interface TestWithSections extends Test {
  sections: (TestSection & { topicName: string; maxQuestions: number })[];
  adaptiveSettings?: AdaptiveTopicConfig[] | null;
}

const testFormSchema = z.object({
  title: z.string().min(1, t.tests.titleRequired),
  description: z.string().optional(),
  feedback: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  overallPassType: z.enum(["percent", "absolute", "none"]),
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

interface AdaptiveLevelLink {
  title: string;
  url: string;
}

interface AdaptiveLevel {
  levelIndex: number;
  levelName: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
  passThreshold: number;
  passThresholdType: "percent" | "absolute";
  feedback: string;
  links: AdaptiveLevelLink[];
}

interface AdaptiveTopicConfig {
  topicId: string;
  topicName: string;
  failureFeedback: string;
  levels: AdaptiveLevel[];
}

interface DifficultyDistribution {
  totalQuestions: number;
  histogram: { min: number; max: number; count: number }[];
  suggestedLevels: { levelName: string; minDifficulty: number; maxDifficulty: number; questionCount: number }[];
  warnings: string[];
}

export default function TestsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<TestWithSections | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSections, setSelectedSections] = useState<SectionConfig[]>([]);

  // Adaptive mode states
  const [testMode, setTestMode] = useState<"standard" | "adaptive">("standard");
  const [showDifficultyLevel, setShowDifficultyLevel] = useState(true);
  const [adaptiveTopicConfigs, setAdaptiveTopicConfigs] = useState<AdaptiveTopicConfig[]>([]);
  const [distributionCache, setDistributionCache] = useState<Record<string, DifficultyDistribution>>({});
  const [loadingDistribution, setLoadingDistribution] = useState<string | null>(null);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTestId, setExportTestId] = useState<string | null>(null);
  const [enableTelemetry, setEnableTelemetry] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Assignment dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTestId, setAssignTestId] = useState<string | null>(null);
  const [assignTestTitle, setAssignTestTitle] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: tests, isLoading: testsLoading } = useQuery<TestWithSections[]>({
    queryKey: ["/api/tests"],
  });

  const { data: topics } = useQuery<TopicWithQuestionCount[]>({
    queryKey: ["/api/topics"],
  });

  const filteredTests = tests?.filter((test) =>
    test.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (test.description || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    setTestMode("standard");
    setShowDifficultyLevel(true);
    setAdaptiveTopicConfigs([]);
    setStep(1);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (test: TestWithSections) => {
    console.log("=== ОТКРЫТИЕ ТЕСТА ДЛЯ РЕДАКТИРОВАНИЯ ===");
    console.log("test:", test);
    console.log("test.mode:", test.mode);
    console.log("test.adaptiveSettings:", test.adaptiveSettings);

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
    console.log("sections загружены:", sections);
    console.log("test.sections:", test.sections);

    // Load adaptive settings
    setTestMode((test.mode as "standard" | "adaptive") || "standard");
    setShowDifficultyLevel(test.showDifficultyLevel ?? true);

    if (test.mode === "adaptive" && test.adaptiveSettings) {
      setAdaptiveTopicConfigs(test.adaptiveSettings.map(as => ({
        topicId: as.topicId,
        topicName: as.topicName || "",
        failureFeedback: as.failureFeedback || "",
        levels: (as.levels || []).map(l => ({
          levelIndex: l.levelIndex,
          levelName: l.levelName,
          minDifficulty: l.minDifficulty,
          maxDifficulty: l.maxDifficulty,
          questionsCount: l.questionsCount,
          passThreshold: l.passThreshold,
          passThresholdType: l.passThresholdType as "percent" | "absolute",
          feedback: l.feedback || "",
          links: (l.links || []).map(link => ({ title: link.title, url: link.url })),
        })),
      })));
    } else {
      setAdaptiveTopicConfigs([]);
    }

    setStep(1);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingTest(null);
    setStep(1);
    setSelectedSections([]);
    setTestMode("standard");
    setShowDifficultyLevel(true);
    setAdaptiveTopicConfigs([]);
    form.reset();
  };

  const handleDelete = (id: string) => {
    if (confirm(t.tests.confirmDelete)) {
      deleteMutation.mutate(id);
    }
  };

  const openExportDialog = (testId: string) => {
    setExportTestId(testId);
    setEnableTelemetry(true); // По умолчанию включено
    setExportDialogOpen(true);
  };

  const handleExportScorm = async () => {
    if (!exportTestId) return;

    setIsExporting(true);
    try {
      const url = `/api/tests/${exportTestId}/export/scorm${enableTelemetry ? '?telemetry=true' : ''}`;
      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/) || disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : `test_${exportTestId}_scorm.zip`;
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: t.tests.exportSuccessful,
        description: enableTelemetry
          ? "SCORM пакет с телеметрией успешно создан"
          : t.tests.scormDownloaded
      });
      setExportDialogOpen(false);
    } catch {
      toast({ variant: "destructive", title: t.tests.exportFailed, description: t.tests.couldNotExport });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleTopicSelection = async (topic: TopicWithQuestionCount) => {
    const existing = selectedSections.find((s) => s.topicId === topic.id);
    if (existing) {
      setSelectedSections(selectedSections.filter((s) => s.topicId !== topic.id));
      // Also remove from adaptive configs
      setAdaptiveTopicConfigs(prev => prev.filter(c => c.topicId !== topic.id));
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

      // If adaptive mode, initialize adaptive config for this topic
      if (testMode === "adaptive") {
        const config = await initAdaptiveTopicConfig(topic.id, topic.name);
        setAdaptiveTopicConfigs(prev => [...prev, config]);
      }
    }
  };

  const updateSection = (topicId: string, updates: Partial<SectionConfig>) => {
    setSelectedSections(
      selectedSections.map((s) => (s.topicId === topicId ? { ...s, ...updates } : s))
    );
  };

  // Load difficulty distribution for a topic
  const loadDifficultyDistribution = async (topicId: string) => {
    if (distributionCache[topicId]) return distributionCache[topicId];

    setLoadingDistribution(topicId);
    try {
      const response = await fetch(`/api/topics/${topicId}/difficulty-distribution`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load distribution");
      const data: DifficultyDistribution = await response.json();
      setDistributionCache(prev => ({ ...prev, [topicId]: data }));
      return data;
    } catch (error) {
      console.error("Failed to load difficulty distribution:", error);
      return null;
    } finally {
      setLoadingDistribution(null);
    }
  };

  // Initialize adaptive config for a topic
  const initAdaptiveTopicConfig = async (topicId: string, topicName: string): Promise<AdaptiveTopicConfig> => {
    const distribution = await loadDifficultyDistribution(topicId);

    const defaultLevels: AdaptiveLevel[] = distribution?.suggestedLevels?.map((sl, index) => ({
      levelIndex: index,
      levelName: sl.levelName,
      minDifficulty: sl.minDifficulty,
      maxDifficulty: sl.maxDifficulty,
      questionsCount: Math.min(10, sl.questionCount),
      passThreshold: 80,
      passThresholdType: "percent" as const,
      feedback: "",
      links: [],
    })) || [{
      levelIndex: 0,
      levelName: "Базовый",
      minDifficulty: 0,
      maxDifficulty: 100,
      questionsCount: 10,
      passThreshold: 80,
      passThresholdType: "percent" as const,
      feedback: "",
      links: [],
    }];

    return {
      topicId,
      topicName,
      failureFeedback: "",
      levels: defaultLevels,
    };
  };

  // Update adaptive topic config
  const updateAdaptiveTopicConfig = (topicId: string, updates: Partial<AdaptiveTopicConfig>) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config =>
        config.topicId === topicId ? { ...config, ...updates } : config
      )
    );
  };

  // Update a specific level in a topic
  const updateAdaptiveLevel = (topicId: string, levelIndex: number, updates: Partial<AdaptiveLevel>) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        return {
          ...config,
          levels: config.levels.map(level =>
            level.levelIndex === levelIndex ? { ...level, ...updates } : level
          ),
        };
      })
    );
  };

  // Add a new level to a topic
  const addAdaptiveLevel = (topicId: string) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        const maxIndex = Math.max(...config.levels.map(l => l.levelIndex), -1);
        const lastLevel = config.levels[config.levels.length - 1];
        const newLevel: AdaptiveLevel = {
          levelIndex: maxIndex + 1,
          levelName: `Уровень ${maxIndex + 2}`,
          minDifficulty: lastLevel ? lastLevel.maxDifficulty + 1 : 0,
          maxDifficulty: 100,
          questionsCount: 10,
          passThreshold: 80,
          passThresholdType: "percent",
          feedback: "",
          links: [],
        };
        return { ...config, levels: [...config.levels, newLevel] };
      })
    );
  };

  // Remove a level from a topic
  const removeAdaptiveLevel = (topicId: string, levelIndex: number) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        const newLevels = config.levels
          .filter(l => l.levelIndex !== levelIndex)
          .map((l, i) => ({ ...l, levelIndex: i }));
        return { ...config, levels: newLevels };
      })
    );
  };

  // Add link to a level
  const addLevelLink = (topicId: string, levelIndex: number) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        return {
          ...config,
          levels: config.levels.map(level => {
            if (level.levelIndex !== levelIndex) return level;
            return { ...level, links: [...level.links, { title: "", url: "" }] };
          }),
        };
      })
    );
  };

  // Update link in a level
  const updateLevelLink = (topicId: string, levelIndex: number, linkIndex: number, updates: Partial<AdaptiveLevelLink>) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        return {
          ...config,
          levels: config.levels.map(level => {
            if (level.levelIndex !== levelIndex) return level;
            return {
              ...level,
              links: level.links.map((link, i) =>
                i === linkIndex ? { ...link, ...updates } : link
              ),
            };
          }),
        };
      })
    );
  };

  // Remove link from a level
  const removeLevelLink = (topicId: string, levelIndex: number, linkIndex: number) => {
    setAdaptiveTopicConfigs(prev =>
      prev.map(config => {
        if (config.topicId !== topicId) return config;
        return {
          ...config,
          levels: config.levels.map(level => {
            if (level.levelIndex !== levelIndex) return level;
            return { ...level, links: level.links.filter((_, i) => i !== linkIndex) };
          }),
        };
      })
    );
  };

  const onSubmit = (formData: TestFormData) => {
    const data: any = {
      title: formData.title,
      description: formData.description,
      feedback: formData.feedback || null,
      webhookUrl: formData.webhookUrl || null,
      timeLimitMinutes: formData.timeLimitMinutes || null,
      maxAttempts: formData.maxAttempts || null,
      showCorrectAnswers: formData.showCorrectAnswers,
      startPageContent: formData.startPageContent || null,
      // Для адаптивного теста проходной балл не используется
      overallPassRuleJson: testMode === "adaptive"
        ? { type: "none", value: 0 }  // Специальный маркер "не используется"
        : {
          type: formData.overallPassType,
          value: formData.overallPassValue,
        },
      mode: testMode,
      showDifficultyLevel: showDifficultyLevel,
    };
    console.log("=== ОТПРАВКА ТЕСТА ===");
    console.log("testMode:", testMode);
    console.log("data.mode:", data.mode);
    console.log("data:", data)

    if (testMode === "standard") {
      data.sections = selectedSections.map((s) => ({
        topicId: s.topicId,
        drawCount: s.drawCount,
        topicPassRuleJson: s.hasPassRule
          ? { type: s.passType, value: s.passValue }
          : null,
      }));
    } else {
      // Adaptive mode - send sections for topic reference and adaptive settings
      data.sections = selectedSections.map((s) => ({
        topicId: s.topicId,
        drawCount: 0, // Not used in adaptive mode
        topicPassRuleJson: null,
      }));

      data.adaptiveSettings = adaptiveTopicConfigs.map((config) => ({
        topicId: config.topicId,
        failureFeedback: config.failureFeedback || null,
        levels: config.levels.map((level) => ({
          levelIndex: level.levelIndex,
          levelName: level.levelName,
          minDifficulty: level.minDifficulty,
          maxDifficulty: level.maxDifficulty,
          questionsCount: level.questionsCount,
          passThreshold: level.passThreshold,
          passThresholdType: level.passThresholdType,
          feedback: level.feedback || null,
          links: level.links.filter((l) => l.title && l.url),
        })),
      }));
    }

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

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Поиск тестов..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {!filteredTests || filteredTests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t.tests.noTests}
          description={t.tests.noTestsDescription}
          actionLabel={t.tests.createTest}
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTests.map((test) => {
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
                      title="Назначить"
                      onClick={() => {
                        setAssignTestId(test.id);
                        setAssignTestTitle(test.title);
                        setAssignDialogOpen(true);
                      }}
                      data-testid={`button-assign-test-${test.id}`}
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    <Link href={`/author/tests/${test.id}/analytics`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Аналитика"
                        data-testid={`button-analytics-test-${test.id}`}
                      >
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                    </Link>
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
                    {test.mode === "adaptive" ? (
                      <Badge variant="secondary">Адаптивный</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {formatQuestions(totalQuestions)}
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {formatTopics(test.sections.length)}
                    </Badge>
                    {/* Проходной балл - только для стандартного режима */}
                    {test.mode !== "adaptive" && passRule && passRule.type !== "none" && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {t.tests.pass} {passRule?.value}
                        {passRule?.type === "percent" ? "%" : ` из ${totalQuestions}`}
                      </Badge>
                    )}
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
                    onClick={() => openExportDialog(test.id)}
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
                className={`h-2 w-16 rounded-full transition-colors ${s <= step ? "bg-primary" : "bg-muted"
                  }`}
              />
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              {/* Mode selector */}
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="space-y-1">
                  <Label className="text-base font-semibold">{t.tests.testMode}</Label>
                  <p className="text-sm text-muted-foreground">
                    {testMode === "standard" ? t.tests.standardModeDescription : t.tests.adaptiveModeDescription}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${testMode === "standard" ? "font-medium" : "text-muted-foreground"}`}>
                    {t.tests.standardMode}
                  </span>
                  <Switch
                    checked={testMode === "adaptive"}
                    onCheckedChange={async (checked) => {
                      const newMode = checked ? "adaptive" : "standard";
                      setTestMode(newMode);

                      if (newMode === "adaptive") {
                        // Try to load saved adaptive settings from server
                        if (editingTest) {
                          try {
                            const response = await fetch(`/api/tests/${editingTest.id}/adaptive-settings`, {
                              credentials: "include",
                            });
                            if (response.ok) {
                              const savedSettings = await response.json();
                              if (savedSettings && savedSettings.length > 0) {
                                setAdaptiveTopicConfigs(savedSettings.map((as: any) => ({
                                  topicId: as.topicId,
                                  topicName: as.topicName || "",
                                  failureFeedback: as.failureFeedback || "",
                                  levels: (as.levels || []).map((l: any) => ({
                                    levelIndex: l.levelIndex,
                                    levelName: l.levelName,
                                    minDifficulty: l.minDifficulty,
                                    maxDifficulty: l.maxDifficulty,
                                    questionsCount: l.questionsCount,
                                    passThreshold: l.passThreshold,
                                    passThresholdType: l.passThresholdType as "percent" | "absolute",
                                    feedback: l.feedback || "",
                                    links: (l.links || []).map((link: any) => ({ title: link.title, url: link.url })),
                                  })),
                                })));
                                return; // Settings loaded, exit
                              }
                            }
                          } catch (error) {
                            console.error("Failed to load adaptive settings:", error);
                          }
                        }

                        // No saved settings - initialize new adaptive configs for selected topics
                        const configs: AdaptiveTopicConfig[] = [];
                        for (const section of selectedSections) {
                          const config = await initAdaptiveTopicConfig(section.topicId, section.topicName);
                          configs.push(config);
                        }
                        setAdaptiveTopicConfigs(configs);
                      }
                      // Note: we don't clear adaptiveTopicConfigs when switching to standard
                      // This preserves them in memory for potential switch back
                    }}
                  />
                  <span className={`text-sm ${testMode === "adaptive" ? "font-medium" : "text-muted-foreground"}`}>
                    {t.tests.adaptiveMode}
                  </span>
                </div>
              </div>

              <Separator />

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
                          className={`p-4 rounded-lg border cursor-pointer transition-colors ${isSelected
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

          {step === 2 && testMode === "standard" && (
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

          {step === 2 && testMode === "adaptive" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{t.tests.configureAdaptiveLevels}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t.tests.configureAdaptiveLevelsDescription}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="showDifficultyLevel" className="text-sm">
                    {t.tests.showDifficultyToUser}
                  </Label>
                  <Switch
                    id="showDifficultyLevel"
                    checked={showDifficultyLevel}
                    onCheckedChange={setShowDifficultyLevel}
                  />
                </div>
              </div>

              <div className="space-y-6">
                {adaptiveTopicConfigs.map((topicConfig) => {
                  const distribution = distributionCache[topicConfig.topicId];
                  const isLoading = loadingDistribution === topicConfig.topicId;

                  return (
                    <Card key={topicConfig.topicId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center justify-between">
                          <span>{topicConfig.topicName}</span>
                          {distribution && (
                            <Badge variant="outline">
                              {distribution.totalQuestions} {t.tests.questionsTotal}
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Distribution histogram */}
                        {isLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <LoadingSpinner />
                            <span className="ml-2 text-sm text-muted-foreground">{t.tests.loadingDistribution}</span>
                          </div>
                        ) : distribution ? (
                          <div className="space-y-2">
                            <Label className="text-sm">{t.tests.difficultyDistribution}</Label>
                            <div className="flex items-end gap-1 h-16">
                              {distribution.histogram.map((bar, i) => {
                                const maxCount = Math.max(...distribution.histogram.map(h => h.count), 1);
                                const height = (bar.count / maxCount) * 100;
                                return (
                                  <div
                                    key={i}
                                    className="flex-1 bg-primary/20 hover:bg-primary/40 transition-colors rounded-t relative group"
                                    style={{ height: `${Math.max(height, 4)}%` }}
                                    title={`${bar.min}-${bar.max}: ${bar.count} вопросов`}
                                  >
                                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs opacity-0 group-hover:opacity-100">
                                      {bar.count}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>0</span>
                              <span>50</span>
                              <span>100</span>
                            </div>
                            {distribution.warnings.length > 0 && (
                              <div className="text-sm text-yellow-600 dark:text-yellow-500">
                                {distribution.warnings.map((w, i) => (
                                  <p key={i}>⚠️ {w}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadDifficultyDistribution(topicConfig.topicId)}
                          >
                            {t.tests.loadDistribution}
                          </Button>
                        )}

                        <Separator />

                        {/* Levels */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">{t.tests.difficultyLevels}</Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addAdaptiveLevel(topicConfig.topicId)}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              {t.tests.addLevel}
                            </Button>
                          </div>

                          {topicConfig.levels.map((level, levelIdx) => (
                            <Card key={level.levelIndex} className="bg-muted/30">
                              <CardContent className="pt-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <Input
                                    value={level.levelName}
                                    onChange={(e) =>
                                      updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                        levelName: e.target.value,
                                      })
                                    }
                                    className="font-medium w-48"
                                    placeholder={t.tests.levelName}
                                  />
                                  {topicConfig.levels.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeAdaptiveLevel(topicConfig.topicId, level.levelIndex)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </div>

                                <div className="grid grid-cols-4 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t.tests.minDifficulty}</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={level.minDifficulty}
                                      onChange={(e) =>
                                        updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                          minDifficulty: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t.tests.maxDifficulty}</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={level.maxDifficulty}
                                      onChange={(e) =>
                                        updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                          maxDifficulty: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t.tests.questionsCount}</Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      value={level.questionsCount}
                                      onChange={(e) =>
                                        updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                          questionsCount: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t.tests.passThreshold}</Label>
                                    <div className="flex gap-1">
                                      <Input
                                        type="number"
                                        min={0}
                                        max={level.passThresholdType === "percent" ? 100 : level.questionsCount}
                                        value={level.passThreshold}
                                        onChange={(e) =>
                                          updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                            passThreshold: Number(e.target.value),
                                          })
                                        }
                                        className="w-16"
                                      />
                                      <Select
                                        value={level.passThresholdType}
                                        onValueChange={(val: "percent" | "absolute") =>
                                          updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                            passThresholdType: val,
                                          })
                                        }
                                      >
                                        <SelectTrigger className="w-20">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="percent">%</SelectItem>
                                          <SelectItem value="absolute">шт</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <Label className="text-xs">{t.tests.levelFeedback}</Label>
                                  <Textarea
                                    value={level.feedback}
                                    onChange={(e) =>
                                      updateAdaptiveLevel(topicConfig.topicId, level.levelIndex, {
                                        feedback: e.target.value,
                                      })
                                    }
                                    placeholder={t.tests.levelFeedbackPlaceholder}
                                    rows={2}
                                  />
                                </div>

                                {/* Level links */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs">{t.tests.levelLinks}</Label>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => addLevelLink(topicConfig.topicId, level.levelIndex)}
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      {t.tests.addLink}
                                    </Button>
                                  </div>
                                  {level.links.map((link, linkIdx) => (
                                    <div key={linkIdx} className="flex gap-2 items-center">
                                      <Input
                                        value={link.title}
                                        onChange={(e) =>
                                          updateLevelLink(topicConfig.topicId, level.levelIndex, linkIdx, {
                                            title: e.target.value,
                                          })
                                        }
                                        placeholder={t.tests.linkTitle}
                                        className="flex-1"
                                      />
                                      <Input
                                        value={link.url}
                                        onChange={(e) =>
                                          updateLevelLink(topicConfig.topicId, level.levelIndex, linkIdx, {
                                            url: e.target.value,
                                          })
                                        }
                                        placeholder={t.tests.linkUrl}
                                        className="flex-1"
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeLevelLink(topicConfig.topicId, level.levelIndex, linkIdx)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>

                        <Separator />

                        {/* Failure feedback */}
                        <div className="space-y-1">
                          <Label className="text-sm">{t.tests.failureFeedback}</Label>
                          <Textarea
                            value={topicConfig.failureFeedback}
                            onChange={(e) =>
                              updateAdaptiveTopicConfig(topicConfig.topicId, {
                                failureFeedback: e.target.value,
                              })
                            }
                            placeholder={t.tests.failureFeedbackPlaceholder}
                            rows={2}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
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
              <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
                console.log("=== ОШИБКИ ВАЛИДАЦИИ ===");
                console.log(errors);
              })} className="space-y-6">
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

                {/* Проходной балл - только для стандартного режима */}
                {testMode !== "adaptive" && (
                  <>
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
                  </>
                )}

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
      {/* Export SCORM Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Экспорт SCORM</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Включить телеметрию</Label>
                <p className="text-sm text-muted-foreground">
                  Собирать статистику прохождения из LMS
                </p>
              </div>
              <Switch
                checked={enableTelemetry}
                onCheckedChange={setEnableTelemetry}
              />
            </div>

            {enableTelemetry && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-4 text-sm">
                <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                  📊 Телеметрия позволит:
                </p>
                <ul className="list-disc list-inside text-blue-700 dark:text-blue-300 space-y-1">
                  <li>Видеть результаты из LMS в аналитике</li>
                  <li>Отслеживать ответы пользователей</li>
                  <li>Получать данные о времени прохождения</li>
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleExportScorm} disabled={isExporting}>
              {isExporting ? (
                <>
                  <LoadingSpinner className="mr-2 h-4 w-4" />
                  Экспорт...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Скачать SCORM
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Test Dialog */}
      {assignTestId && (
        <AssignTestDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          testId={assignTestId}
          testTitle={assignTestTitle}
        />
      )}
    </div>
  );
}