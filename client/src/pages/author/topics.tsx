import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, FolderOpen, Copy, CheckSquare, Square, Folder, ChevronRight, ChevronDown, FolderPlus, LayoutGrid, List, Shield } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState, LoadingSpinner } from "@/components/loading-state";
import { t, formatQuestions } from "@/lib/i18n";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import { TopicDrawer, type TopicDrawerTarget } from "@/features/topics/topic-drawer";
import { useAuth } from "@/lib/auth";
import { ROLES } from "@shared/access";
import type { Topic, TopicCourse, TopicEvent, Folder as FolderType, FeedbackContent } from "@shared/schema";

// Topic / course / event form schemas moved into <TopicDrawer/> (PRD-15 T-32);
// the page keeps only the folder form.
const folderFormSchema = z.object({
  name: z.string().min(1, t.topics.nameRequired),
  parentId: z.string().nullable().optional(),
});

type FolderFormData = z.infer<typeof folderFormSchema>;

interface TopicWithDetails extends Topic {
  courses: TopicCourse[];
  events: TopicEvent[];
  questionCount: number;
}

/** Admin duplicates report (PRD-15 FR-27/BRC-12, GET /api/topics/duplicates-report). */
interface DuplicatesReport {
  groups: {
    nameNormalized: string;
    topics: { id: string; name: string; ownerId: string | null; visibility: "private" | "shared" }[];
  }[];
}

interface ReportUser { id: string; name: string | null; email: string }

/** Recommended-item counts derived from the topic's rich feedback (TD-02): links
 *  are courses, assets are documents, events are events. */
function feedbackCounts(topic: { feedbackJson?: unknown }): { courses: number; docs: number; events: number } {
  const fb = (topic.feedbackJson ?? null) as FeedbackContent | null;
  return {
    courses: fb?.links?.length ?? 0,
    docs: fb?.assets?.length ?? 0,
    events: fb?.events?.length ?? 0,
  };
}

export default function TopicsPage() {
  const { toast } = useToast();
  const contentGuard = useContentGuard();
  // PRD-15 block C: topic access management (owner/visibility/grants).
  const { can, hasRole, user } = useAuth();
  const isAdmin = hasRole(ROLES.ADMINISTRATOR) || hasRole(ROLES.SUPERADMIN);
  const canGrantAccessCap = can("topics.access.grant");
  const canGrantAccessFor = (topic: Topic) =>
    canGrantAccessCap && (isAdmin || topic.ownerId === user?.id);
  // PRD-15 T-32: unified topic Drawer (Свойства + Доступ). Replaces the old edit
  // dialog, the standalone access panel and the per-card course/event dialogs.
  const [drawerTarget, setDrawerTarget] = useState<TopicDrawerTarget | null>(null);
  const [drawerTab, setDrawerTab] = useState<"props" | "access">("props");
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderType | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  // PRD-15 block C (FR-22): scope filter. Server already returns only visible
  // topics; this narrows the view client-side by relationship.
  const [topicFilter, setTopicFilter] = useState<"mine" | "accessible" | "shared" | "all">("mine");
  const [showEmptyFolders, setShowEmptyFolders] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("topics_view") as any) || "grid";
  });

  const handleViewChange = (mode: "grid" | "list") => {
    setViewMode(mode);
    localStorage.setItem("topics_view", mode);
  };

  const { data: topics, isLoading: topicsLoading } = useQuery<TopicWithDetails[]>({
    queryKey: ["/api/topics"],
  });

  const { data: folders, isLoading: foldersLoading } = useQuery<FolderType[]>({
    queryKey: ["/api/folders"],
  });

  const isLoading = topicsLoading || foldersLoading;

  const folderForm = useForm<FolderFormData>({
    resolver: zodResolver(folderFormSchema),
    defaultValues: { name: "", parentId: null },
  });

  // PRD-15 FR-27/BRC-12: admin-only system-wide duplicates report.
  const { data: duplicates } = useQuery<DuplicatesReport>({
    queryKey: ["/api/topics/duplicates-report"],
    queryFn: async () => {
      const res = await fetch("/api/topics/duplicates-report", { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить отчёт");
      return res.json();
    },
    enabled: duplicatesOpen && isAdmin,
  });
  const { data: reportUsers = [] } = useQuery<ReportUser[]>({
    queryKey: ["/api/users"],
    enabled: duplicatesOpen && isAdmin,
  });
  const ownerLabel = (id: string | null): string => {
    if (!id) return "не назначен";
    const u = reportUsers.find((x) => x.id === id);
    return u?.name?.trim() || u?.email || id;
  };

  // Topic create/update now lives in the unified <TopicDrawer/> (PRD-15 T-32).
  // Topic deletion goes through the content guard (see handleDelete, PRD-15 T-12).

  const createFolderMutation = useMutation({
    mutationFn: (data: FolderFormData) => apiRequest("POST", "/api/folders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      toast({ title: t.folders.folderCreated, description: t.folders.folderCreatedDescription });
      handleCloseFolderDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.folders.failedToCreate });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FolderFormData }) =>
      apiRequest("PUT", `/api/folders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      toast({ title: t.folders.folderUpdated, description: t.folders.folderUpdatedDescription });
      handleCloseFolderDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.folders.failedToUpdate });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/folders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.folders.folderDeleted, description: t.folders.folderDeletedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.folders.failedToDelete });
    },
  });

  // Recommended courses / events are now edited inside the topic feedback
  // (TD-02); the per-card course/event dialogs and their mutations are gone.

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/topics/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      toast({ title: t.topics.duplicated, description: t.topics.duplicatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToDuplicate });
    },
  });

  // Bulk topic delete goes through the content guard (see confirmBulkDelete, PRD-15 T-12).

  const handleDuplicate = (id: string) => {
    duplicateMutation.mutate(id);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!topics) return;
    if (selectedTopics.size === topics.length) {
      setSelectedTopics(new Set());
    } else {
      setSelectedTopics(new Set(topics.map((t) => t.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedTopics.size > 0) {
      setBulkDeleteDialogOpen(true);
    }
  };

  // PRD-15 T-12: the AlertDialog above is the plain confirm; on accept the guard
  // dry-runs — a clean batch deletes, an impacting one opens the content dialog.
  const confirmBulkDelete = () => {
    const ids = Array.from(selectedTopics);
    setBulkDeleteDialogOpen(false);
    contentGuard.guard({
      url: "/api/topics/bulk-delete",
      method: "POST",
      body: { ids },
      blockTitle: "Темы нельзя удалить: их используют опубликованные тесты",
      blockDescription:
        "Часть выбранных тем входит в выдачу вопросов опубликованных тестов. Удаление нарушит их работу.",
      warnTitle: "Удалить выбранные темы? Это затронет другие тесты",
      warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
      confirmLabel: `Удалить (${ids.length})`,
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
        toast({
          title: t.topics.topicsDeleted,
          description: t.topics.topicsDeletedDescription(ids.length),
        });
        setSelectedTopics(new Set());
      },
    });
  };

  const handleOpenCreate = (folderId?: string | null) => {
    setDrawerTab("props");
    setDrawerTarget({ mode: "create", folderId: folderId ?? null });
  };

  const handleOpenEdit = (topic: Topic) => {
    setDrawerTab("props");
    setDrawerTarget({ mode: "edit", topic });
  };

  const handleOpenAccess = (topic: Topic) => {
    setDrawerTab("access");
    setDrawerTarget({ mode: "edit", topic });
  };

  const handleOpenCreateFolder = (parentId?: string | null) => {
    setEditingFolder(null);
    folderForm.reset({ name: "", parentId: parentId || null });
    setFolderDialogOpen(true);
  };

  const handleOpenEditFolder = (folder: FolderType) => {
    setEditingFolder(folder);
    folderForm.reset({ name: folder.name, parentId: folder.parentId || null });
    setFolderDialogOpen(true);
  };

  const handleCloseFolderDialog = () => {
    setFolderDialogOpen(false);
    setEditingFolder(null);
    folderForm.reset();
  };

  const handleDeleteFolder = (id: string) => {
    if (confirm(t.folders.confirmDelete)) {
      deleteFolderMutation.mutate(id);
    }
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const onSubmitFolder = (data: FolderFormData) => {
    if (editingFolder) {
      updateFolderMutation.mutate({ id: editingFolder.id, data });
    } else {
      createFolderMutation.mutate(data);
    }
  };

  // PRD-15 T-12: dry-run first. Clean delete keeps the plain confirm; a delete
  // that affects published tests opens the content-impact dialog (block/warn).
  const handleDelete = (id: string) => {
    contentGuard.guard({
      url: `/api/topics/${id}`,
      method: "DELETE",
      blockTitle: "Тему нельзя удалить: её используют опубликованные тесты",
      blockDescription:
        "Тема входит в выдачу вопросов опубликованных тестов. Удаление нарушит их работу.",
      warnTitle: "Удалить тему? Это затронет другие тесты",
      warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
      confirmLabel: "Удалить тему",
      confirmClean: () => confirm(t.topics.confirmDelete),
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
        toast({ title: t.topics.topicDeleted, description: t.topics.topicDeletedDescription });
      },
    });
  };

  const rootFolders = folders?.filter((f) => !f.parentId) || [];
  const getChildFolders = (parentId: string) => folders?.filter((f) => f.parentId === parentId) || [];

  // PRD-15 FR-22: classify a topic by relationship for the scope filter. The
  // server already returns only visible topics, so an unowned non-shared one
  // is, by definition, visible via a grant.
  const matchesFilter = (topic: Topic): boolean => {
    if (topicFilter === "all") return true;
    if (topicFilter === "shared") return topic.visibility === "shared";
    if (topicFilter === "mine") return topic.ownerId === user?.id;
    return topic.ownerId !== user?.id && topic.visibility !== "shared"; // accessible (granted)
  };

  const getTopicsInFolder = (folderId: string | null) =>
    topics?.filter((topic) => topic.folderId === folderId && matchesFilter(topic)) || [];

  // FR-28: a folder is shown only if it (or a descendant) holds a matching
  // topic — unless the admin opts to show empty folders.
  const folderHasVisibleTopics = (folderId: string): boolean =>
    getTopicsInFolder(folderId).length > 0 ||
    getChildFolders(folderId).some((c) => folderHasVisibleTopics(c.id));

  const searchedTopics = searchQuery
    ? topics?.filter((topic) =>
      matchesFilter(topic) && (
        topic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (topic.description || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    ) || []
    : null;

  const rootTopics = getTopicsInFolder(null);

  const renderTopicCard = (topic: TopicWithDetails) => (
    <Card key={topic.id} data-testid={`card-topic-${topic.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Checkbox
            checked={selectedTopics.has(topic.id)}
            onCheckedChange={() => handleToggleSelect(topic.id)}
            data-testid={`checkbox-topic-${topic.id}`}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{topic.name}</CardTitle>
            {topic.description && (
              <CardDescription className="mt-1 line-clamp-2">
                {topic.description}
              </CardDescription>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDuplicate(topic.id)}
            data-testid={`button-duplicate-topic-${topic.id}`}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleOpenEdit(topic)}
            data-testid={`button-edit-topic-${topic.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {canGrantAccessFor(topic) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleOpenAccess(topic)}
              title="Доступ к теме"
              data-testid={`button-access-topic-${topic.id}`}
            >
              <Shield className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(topic.id)}
            data-testid={`button-delete-topic-${topic.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* TD-02: recommended courses / documents / events are part of the topic
            feedback now; the card shows only their counts. Edit them in the Drawer. */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span>{formatQuestions(topic.questionCount)}</span>
          {(() => {
            const fb = feedbackCounts(topic);
            return (
              <>
                {fb.courses > 0 && <span>{fb.courses} {t.common.courses}</span>}
                {fb.docs > 0 && <span>{fb.docs} док.</span>}
                {fb.events > 0 && <span>{fb.events} мероприятий</span>}
              </>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );

  const renderTopicRow = (topic: TopicWithDetails) => (
    <tr key={topic.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`card-topic-${topic.id}`}>
      <td className="px-4 py-3">
        <Checkbox
          checked={selectedTopics.has(topic.id)}
          onCheckedChange={() => handleToggleSelect(topic.id)}
          data-testid={`checkbox-topic-${topic.id}`}
        />
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{topic.name}</p>
        {topic.description && <p className="text-xs text-muted-foreground line-clamp-1">{topic.description}</p>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{formatQuestions(topic.questionCount)}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{feedbackCounts(topic).courses} {t.common.courses}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="icon" onClick={() => handleDuplicate(topic.id)} data-testid={`button-duplicate-topic-${topic.id}`}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(topic)} data-testid={`button-edit-topic-${topic.id}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          {canGrantAccessFor(topic) && (
            <Button variant="ghost" size="icon" onClick={() => handleOpenAccess(topic)} title="Доступ к теме" data-testid={`button-access-topic-${topic.id}`}>
              <Shield className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => handleDelete(topic.id)} data-testid={`button-delete-topic-${topic.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );

  const renderTopicsTable = (topicList: TopicWithDetails[]) => (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="px-4 py-3 w-10" />
            <th className="text-left px-4 py-3 font-medium">Тема</th>
            <th className="text-left px-4 py-3 font-medium">Вопросы</th>
            <th className="text-left px-4 py-3 font-medium">Курсы</th>
            <th className="px-4 py-3 w-40" />
          </tr>
        </thead>
        <tbody>
          {topicList.map(renderTopicRow)}
        </tbody>
      </table>
    </div>
  );

  const renderFolder = (folder: FolderType, depth: number = 0) => {
    // FR-28: hide folders with no topics visible in the current filter (unless
    // the admin enabled «Показывать пустые папки»).
    if (!showEmptyFolders && !folderHasVisibleTopics(folder.id)) return null;
    const isExpanded = expandedFolders.has(folder.id);
    const folderTopics = getTopicsInFolder(folder.id);
    const childFolders = getChildFolders(folder.id);
    const totalItems = folderTopics.length + childFolders.length;

    return (
      <div key={folder.id} className="mb-4" style={{ marginLeft: depth * 16 }}>
        <Collapsible open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover-elevate">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <Folder className="h-5 w-5 text-primary" />
            <span className="font-medium flex-1">{folder.name}</span>
            <Badge variant="secondary">{totalItems}</Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleOpenCreate(folder.id)}
              data-testid={`button-add-topic-to-folder-${folder.id}`}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleOpenCreateFolder(folder.id)}
              data-testid={`button-add-subfolder-${folder.id}`}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleOpenEditFolder(folder)}
              data-testid={`button-edit-folder-${folder.id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteFolder(folder.id)}
              data-testid={`button-delete-folder-${folder.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <CollapsibleContent className="mt-2">
            {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}
            {folderTopics.length > 0 && (
              <div className="mt-2 pl-8">
                {viewMode === "grid"
                  ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{folderTopics.map(renderTopicCard)}</div>
                  : renderTopicsTable(folderTopics)
                }
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  if (isLoading) {
    return <LoadingState message={`${t.common.loading}`} />;
  }

  return (
    <div>
      <PageHeader
        title={t.topics.title}
        description={t.topics.description}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {topics && topics.length > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={handleSelectAll}
                  data-testid="button-select-all-topics"
                >
                  {selectedTopics.size === topics.length ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      {t.topics.deselectAll}
                    </>
                  ) : (
                    <>
                      <CheckSquare className="h-4 w-4 mr-2" />
                      {t.topics.selectAll}
                    </>
                  )}
                </Button>
                {selectedTopics.size > 0 && (
                  <Button
                    variant="destructive"
                    onClick={handleBulkDelete}
                    data-testid="button-delete-selected-topics"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t.topics.deleteSelected} ({selectedTopics.size})
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" onClick={() => handleOpenCreateFolder()} data-testid="button-create-folder">
              <FolderPlus className="h-4 w-4 mr-2" />
              {t.folders.createFolder}
            </Button>
            <Button onClick={() => handleOpenCreate()} data-testid="button-create-topic">
              <Plus className="h-4 w-4 mr-2" />
              {t.topics.createTopic}
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* PRD-15 FR-22: scope filter (Мои / Доступные / Общие [/ Все]) */}
        <div className="inline-flex items-center border rounded-md overflow-hidden">
          {([
            { value: "mine", label: "Мои" },
            { value: "accessible", label: "Доступные" },
            { value: "shared", label: "Общие" },
            ...(isAdmin ? [{ value: "all", label: "Все" } as const] : []),
          ] as { value: typeof topicFilter; label: string }[]).map((f) => (
            <Button
              key={f.value}
              variant={topicFilter === f.value ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-9"
              onClick={() => setTopicFilter(f.value)}
              data-testid={`filter-topics-${f.value}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Поиск тем..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
            <Checkbox
              checked={showEmptyFolders}
              onCheckedChange={(v) => setShowEmptyFolders(!!v)}
              data-testid="toggle-show-empty-folders"
            />
            Показывать пустые папки
          </label>
        )}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDuplicatesOpen(true)}
            data-testid="button-duplicates-report"
          >
            Отчёт о дублях
          </Button>
        )}
        <div className="flex items-center border rounded-md">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="rounded-r-none h-9 w-9"
            onClick={() => handleViewChange("grid")}
            title="Карточки"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="rounded-l-none h-9 w-9"
            onClick={() => handleViewChange("list")}
            title="Список"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {(!topics || topics.length === 0) && (!folders || folders.length === 0) ? (
        <EmptyState
          icon={FolderOpen}
          title={t.topics.noTopics}
          description={t.topics.noTopicsDescription}
          actionLabel={t.topics.createTopic}
          onAction={() => handleOpenCreate()}
        />
      ) : (
        <div className="space-y-6">
          {searchedTopics ? (
            searchedTopics.length === 0
              ? <p className="text-muted-foreground">Ничего не найдено</p>
              : viewMode === "grid"
                ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{searchedTopics.map(renderTopicCard)}</div>
                : renderTopicsTable(searchedTopics)
          ) : (
            <>
              {rootFolders.map((folder) => renderFolder(folder))}
              {rootTopics.length > 0 && (
                <div>
                  {rootFolders.length > 0 && (
                    <div className="flex items-center gap-2 mb-4 text-muted-foreground">
                      <FolderOpen className="h-4 w-4" />
                      <span className="text-sm font-medium">{t.folders.root}</span>
                    </div>
                  )}
                  {viewMode === "grid"
                    ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{rootTopics.map(renderTopicCard)}</div>
                    : renderTopicsTable(rootTopics)
                  }
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingFolder ? t.folders.editFolder : t.folders.createFolder}
            </DialogTitle>
          </DialogHeader>
          <Form {...folderForm}>
            <form onSubmit={folderForm.handleSubmit(onSubmitFolder)} className="space-y-4">
              <FormField
                control={folderForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.folders.folderName}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t.folders.folderNamePlaceholder} data-testid="input-folder-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={folderForm.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.folders.parentFolder}</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) => field.onChange(value === "__none__" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-parent-folder">
                          <SelectValue placeholder={t.folders.noParent} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">{t.folders.noParent}</SelectItem>
                        {folders?.filter(f => f.id !== editingFolder?.id).map((folder) => (
                          <SelectItem key={folder.id} value={folder.id}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseFolderDialog}>
                  {t.common.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={createFolderMutation.isPending || updateFolderMutation.isPending}
                  data-testid="button-submit-folder"
                >
                  {(createFolderMutation.isPending || updateFolderMutation.isPending) && (
                    <LoadingSpinner className="mr-2" />
                  )}
                  {editingFolder ? t.common.update : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.topics.confirmBulkDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.topics.confirmBulkDeleteDescription(selectedTopics.size)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-bulk-delete-topics"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PRD-15 T-12: content-impact dialog for deletes affecting other tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />

      {/* PRD-15 T-32: unified topic Drawer — properties (incl. rich feedback) + access */}
      <TopicDrawer
        target={drawerTarget}
        folders={folders ?? []}
        isAdmin={isAdmin}
        initialTab={drawerTab}
        onClose={() => setDrawerTarget(null)}
      />

      {/* PRD-15 FR-27 / BRC-12: admin duplicates report */}
      <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Дублирующиеся темы</DialogTitle>
          </DialogHeader>
          {!duplicates ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : duplicates.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Одноимённых тем по системе не найдено</p>
          ) : (
            <div className="space-y-6 max-h-[60vh] overflow-auto">
              {duplicates.groups.map((g) => (
                <div key={g.nameNormalized}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    «{g.nameNormalized}» · {g.topics.length}
                  </p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Название</th>
                          <th className="text-left px-3 py-2 font-medium">Владелец</th>
                          <th className="text-left px-3 py-2 font-medium">Видимость</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.topics.map((tp) => (
                          <tr key={tp.id} className="border-b last:border-0">
                            <td className="px-3 py-2">{tp.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{ownerLabel(tp.ownerId)}</td>
                            <td className="px-3 py-2">
                              <Badge variant={tp.visibility === "shared" ? "default" : "secondary"}>
                                {tp.visibility === "shared" ? "Общая" : "Приватная"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
