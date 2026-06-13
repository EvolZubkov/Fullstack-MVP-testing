import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, FolderOpen, Copy, CheckSquare, Square, Folder, ChevronRight, ChevronDown, FolderPlus, LayoutGrid, List, Shield } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Button,
  Cluster,
  Grid,
  IconButton,
  Input,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  ModalDialog,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tag,
  Text,
  type TableColumn,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
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

/** Sentinel value for «no parent folder» in the ui-kit Select (cannot bind null). */
const NO_PARENT = "__none__";
type TopicScopeFilter = "mine" | "accessible" | "shared" | "all";
type TopicViewMode = "grid" | "list";

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
  // topics; this narrows the view client-side by relationship. Default «Все»
  // (the full visible set) so any role lands on everything it can see.
  const [topicFilter, setTopicFilter] = useState<TopicScopeFilter>("all");
  const [showEmptyFolders, setShowEmptyFolders] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [viewMode, setViewMode] = useState<TopicViewMode>(() => {
    return (localStorage.getItem("topics_view") as TopicViewMode) || "grid";
  });

  const handleViewChange = (mode: TopicViewMode) => {
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

  // Columns for the per-group duplicates table (PRD-15 FR-27 / BRC-12).
  type ReportTopic = DuplicatesReport["groups"][number]["topics"][number];
  const duplicateColumns: TableColumn<ReportTopic>[] = [
    {
      key: "name",
      header: "Название",
      render: (tp) => <Text variant="body-s">{tp.name}</Text>,
    },
    {
      key: "owner",
      header: "Владелец",
      render: (tp) => <Text variant="body-s" tone="muted">{ownerLabel(tp.ownerId)}</Text>,
    },
    {
      key: "visibility",
      header: "Видимость",
      render: (tp) => (
        <Tag tone={tp.visibility === "shared" ? "accent" : "neutral"}>
          {tp.visibility === "shared" ? "Общая" : "Приватная"}
        </Tag>
      ),
    },
  ];

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
      setSelectedTopics(new Set(topics.map((topic) => topic.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedTopics.size > 0) {
      setBulkDeleteDialogOpen(true);
    }
  };

  // PRD-15 T-12: the confirm modal above is the plain confirm; on accept the guard
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

  // Shared row actions (duplicate / edit / access / delete) for both card and table.
  const renderTopicActions = (topic: TopicWithDetails) => (
    <Cluster gap={1} justify="end" wrap={false}>
      <IconButton
        variant="ghost"
        size="s"
        aria-label="Дублировать"
        icon={<Copy size={16} />}
        onClick={() => handleDuplicate(topic.id)}
        data-testid={`button-duplicate-topic-${topic.id}`}
      />
      <IconButton
        variant="ghost"
        size="s"
        aria-label={t.common.edit}
        icon={<Pencil size={16} />}
        onClick={() => handleOpenEdit(topic)}
        data-testid={`button-edit-topic-${topic.id}`}
      />
      {canGrantAccessFor(topic) && (
        <IconButton
          variant="ghost"
          size="s"
          aria-label="Доступ к теме"
          icon={<Shield size={16} />}
          onClick={() => handleOpenAccess(topic)}
          data-testid={`button-access-topic-${topic.id}`}
        />
      )}
      <IconButton
        variant="ghost"
        size="s"
        aria-label={t.common.delete}
        icon={<Trash2 size={16} />}
        onClick={() => handleDelete(topic.id)}
        data-testid={`button-delete-topic-${topic.id}`}
      />
    </Cluster>
  );

  const renderTopicCard = (topic: TopicWithDetails) => (
    <Card key={topic.id} data-testid={`card-topic-${topic.id}`}>
      <CardHeader
        lead={
          <Checkbox
            checked={selectedTopics.has(topic.id)}
            onChange={() => handleToggleSelect(topic.id)}
            aria-label={`Выбрать тему ${topic.name}`}
            data-testid={`checkbox-topic-${topic.id}`}
          />
        }
        title={topic.name}
        subtitle={topic.description || undefined}
        trail={renderTopicActions(topic)}
      />
      <CardBody>
        {/* TD-02: recommended courses / documents / events are part of the topic
            feedback now; the card shows only their counts. Edit them in the Drawer. */}
        <Cluster gap={4}>
          <Text variant="body-s" tone="muted">{formatQuestions(topic.questionCount)}</Text>
          {(() => {
            const fb = feedbackCounts(topic);
            return (
              <>
                {fb.courses > 0 && <Text variant="body-s" tone="muted">{fb.courses} {t.common.courses}</Text>}
                {fb.docs > 0 && <Text variant="body-s" tone="muted">{fb.docs} док.</Text>}
                {fb.events > 0 && <Text variant="body-s" tone="muted">{fb.events} мероприятий</Text>}
              </>
            );
          })()}
        </Cluster>
      </CardBody>
    </Card>
  );

  // List view: shared-Set selection (the checkbox column mirrors the grid cards
  // and the global «Выбрать всё» button) — we deliberately do NOT use the Table's
  // built-in `selectable`, whose per-table «select all» would clash with the
  // folder-scoped rendering.
  const topicColumns: TableColumn<TopicWithDetails>[] = [
    {
      key: "select",
      header: "",
      width: "40px",
      render: (topic) => (
        <Checkbox
          checked={selectedTopics.has(topic.id)}
          onChange={() => handleToggleSelect(topic.id)}
          aria-label={`Выбрать тему ${topic.name}`}
          data-testid={`checkbox-topic-${topic.id}`}
        />
      ),
    },
    {
      key: "name",
      header: "Тема",
      render: (topic) => (
        <Stack gap={1}>
          <Text variant="body-s" weight="medium">{topic.name}</Text>
          {topic.description && <Text variant="body-xs" tone="muted" truncate>{topic.description}</Text>}
        </Stack>
      ),
    },
    {
      key: "questions",
      header: "Вопросы",
      render: (topic) => <Text variant="body-s" tone="muted">{formatQuestions(topic.questionCount)}</Text>,
    },
    {
      key: "courses",
      header: "Курсы",
      render: (topic) => <Text variant="body-s" tone="muted">{feedbackCounts(topic).courses} {t.common.courses}</Text>,
    },
    {
      key: "actions",
      header: "",
      width: "160px",
      align: "right",
      render: (topic) => renderTopicActions(topic),
    },
  ];

  const renderTopicsTable = (topicList: TopicWithDetails[]) => (
    <Table columns={topicColumns} rows={topicList} rowKey={(topic) => topic.id} />
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
      // Tree indent has no DS depth-aware primitive; the left offset stays an
      // inline style anchored to the --ou-space-4 token (see dsGaps).
      <Box key={folder.id} style={{ marginLeft: `calc(${depth} * var(--ou-space-4))` }}>
        <Collapsible open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
          <Box surface="muted" radius="l" pad={3} className="hover-elevate">
            <Cluster gap={2} wrap={false}>
              <CollapsibleTrigger asChild>
                <IconButton
                  variant="ghost"
                  size="s"
                  aria-label={isExpanded ? "Свернуть папку" : "Развернуть папку"}
                  icon={isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                />
              </CollapsibleTrigger>
              <Folder size={20} color="var(--ou-accent-default)" />
              <Box grow><Text variant="body-s" weight="medium" truncate>{folder.name}</Text></Box>
              <Tag>{totalItems}</Tag>
              <IconButton
                variant="ghost"
                size="s"
                aria-label="Добавить тему в папку"
                icon={<Plus size={16} />}
                onClick={() => handleOpenCreate(folder.id)}
                data-testid={`button-add-topic-to-folder-${folder.id}`}
              />
              <IconButton
                variant="ghost"
                size="s"
                aria-label="Добавить подпапку"
                icon={<FolderPlus size={16} />}
                onClick={() => handleOpenCreateFolder(folder.id)}
                data-testid={`button-add-subfolder-${folder.id}`}
              />
              <IconButton
                variant="ghost"
                size="s"
                aria-label="Редактировать папку"
                icon={<Pencil size={16} />}
                onClick={() => handleOpenEditFolder(folder)}
                data-testid={`button-edit-folder-${folder.id}`}
              />
              <IconButton
                variant="ghost"
                size="s"
                aria-label="Удалить папку"
                icon={<Trash2 size={16} />}
                onClick={() => handleDeleteFolder(folder.id)}
                data-testid={`button-delete-folder-${folder.id}`}
              />
            </Cluster>
          </Box>
          <CollapsibleContent>
            <Stack gap={2}>
              {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}
              {folderTopics.length > 0 && (
                // Nested topics sit indented under the folder row; the left inset
                // has no DS left-only padding primitive (see dsGaps).
                <Box style={{ paddingInlineStart: "var(--ou-space-8)" }}>
                  {viewMode === "grid"
                    ? <Grid minItem="sm" gap={4}>{folderTopics.map(renderTopicCard)}</Grid>
                    : renderTopicsTable(folderTopics)
                  }
                </Box>
              )}
            </Stack>
          </CollapsibleContent>
        </Collapsible>
      </Box>
    );
  };

  if (isLoading) {
    return <LoadingState message={`${t.common.loading}`} />;
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title={t.topics.title}
        description={t.topics.description}
        actions={
          <Cluster gap={2}>
            {topics && topics.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  leadingIcon={selectedTopics.size === topics.length ? <Square size={16} /> : <CheckSquare size={16} />}
                  onClick={handleSelectAll}
                  data-testid="button-select-all-topics"
                >
                  {selectedTopics.size === topics.length ? t.topics.deselectAll : t.topics.selectAll}
                </Button>
                {selectedTopics.size > 0 && (
                  <Button
                    variant="destructive"
                    leadingIcon={<Trash2 size={16} />}
                    onClick={handleBulkDelete}
                    data-testid="button-delete-selected-topics"
                  >
                    {t.topics.deleteSelected} ({selectedTopics.size})
                  </Button>
                )}
              </>
            )}
            <Button
              variant="secondary"
              leadingIcon={<FolderPlus size={16} />}
              onClick={() => handleOpenCreateFolder()}
              data-testid="button-create-folder"
            >
              {t.folders.createFolder}
            </Button>
            <Button
              leadingIcon={<Plus size={16} />}
              onClick={() => handleOpenCreate()}
              data-testid="button-create-topic"
            >
              {t.topics.createTopic}
            </Button>
          </Cluster>
        }
      />

      <Cluster gap={3}>
        {/* PRD-15 FR-22: scope filter (Все / Мои / Доступные / Общие) */}
        <SegmentedControl<TopicScopeFilter>
          value={topicFilter}
          onChange={setTopicFilter}
          items={[
            { value: "all", label: "Все" },
            { value: "mine", label: "Мои" },
            { value: "accessible", label: "Доступные" },
            { value: "shared", label: "Общие" },
          ]}
        />
        <Box grow>
          <Input
            iconLeft={<Search size={16} />}
            placeholder="Поиск тем..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
          />
        </Box>
        {isAdmin && (
          <Checkbox
            label="Показывать пустые папки"
            checked={showEmptyFolders}
            onChange={(e) => setShowEmptyFolders(e.target.checked)}
            data-testid="toggle-show-empty-folders"
          />
        )}
        {isAdmin && (
          <Button
            variant="secondary"
            size="s"
            onClick={() => setDuplicatesOpen(true)}
            data-testid="button-duplicates-report"
          >
            Отчёт о дублях
          </Button>
        )}
        <SegmentedControl<TopicViewMode>
          iconOnly
          value={viewMode}
          onChange={handleViewChange}
          items={[
            { value: "grid", icon: <LayoutGrid size={16} />, ariaLabel: "Карточки" },
            { value: "list", icon: <List size={16} />, ariaLabel: "Список" },
          ]}
        />
      </Cluster>

      {(!topics || topics.length === 0) && (!folders || folders.length === 0) ? (
        <EmptyState
          art={<FolderOpen size={48} color="var(--ou-fg-muted)" />}
          title={t.topics.noTopics}
          description={t.topics.noTopicsDescription}
          actions={
            <Button leadingIcon={<Plus size={16} />} onClick={() => handleOpenCreate()}>
              {t.topics.createTopic}
            </Button>
          }
        />
      ) : (
        <Stack gap={6}>
          {searchedTopics ? (
            searchedTopics.length === 0
              ? <Text tone="muted">Ничего не найдено</Text>
              : viewMode === "grid"
                ? <Grid minItem="sm" gap={6}>{searchedTopics.map(renderTopicCard)}</Grid>
                : renderTopicsTable(searchedTopics)
          ) : (
            <>
              {rootFolders.map((folder) => renderFolder(folder))}
              {rootTopics.length > 0 && (
                <Stack gap={4}>
                  {rootFolders.length > 0 && (
                    <Cluster gap={2}>
                      <FolderOpen size={16} color="var(--ou-fg-muted)" />
                      <Text variant="body-s" weight="medium" tone="muted">{t.folders.root}</Text>
                    </Cluster>
                  )}
                  {viewMode === "grid"
                    ? <Grid minItem="sm" gap={6}>{rootTopics.map(renderTopicCard)}</Grid>
                    : renderTopicsTable(rootTopics)
                  }
                </Stack>
              )}
            </>
          )}
        </Stack>
      )}

      {/* Folder create / edit — ui-kit ModalDialog + react-hook-form bridge
          (register on Input, Controller on Select). */}
      <ModalDialog
        open={folderDialogOpen}
        onClose={handleCloseFolderDialog}
        title={editingFolder ? t.folders.editFolder : t.folders.createFolder}
        footer={
          <>
            <Button variant="secondary" onClick={handleCloseFolderDialog}>{t.common.cancel}</Button>
            <Button
              onClick={folderForm.handleSubmit(onSubmitFolder)}
              loading={createFolderMutation.isPending || updateFolderMutation.isPending}
              data-testid="button-submit-folder"
            >
              {editingFolder ? t.common.update : t.common.create}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Input
            label={t.folders.folderName}
            placeholder={t.folders.folderNamePlaceholder}
            error={folderForm.formState.errors.name?.message}
            fullWidth
            data-testid="input-folder-name"
            {...folderForm.register("name")}
          />
          <Controller
            control={folderForm.control}
            name="parentId"
            render={({ field }) => (
              <Select
                label={t.folders.parentFolder}
                value={field.value ?? NO_PARENT}
                onChange={(value) => field.onChange(value === NO_PARENT ? null : value)}
                fullWidth
                options={[
                  { value: NO_PARENT, label: t.folders.noParent },
                  ...(folders
                    ?.filter((f) => f.id !== editingFolder?.id)
                    .map((folder) => ({ value: folder.id, label: folder.name })) ?? []),
                ]}
              />
            )}
          />
        </Stack>
      </ModalDialog>

      {/* PRD-15 T-12: bulk-delete confirm (the guard runs on accept) */}
      <ModalDialog
        open={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        size="s"
        icon={<Trash2 size={20} />}
        iconTone="danger"
        title={t.topics.confirmBulkDelete}
        description={t.topics.confirmBulkDeleteDescription(selectedTopics.size)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkDeleteDialogOpen(false)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              data-testid="button-confirm-bulk-delete-topics"
            >
              {t.common.delete}
            </Button>
          </>
        }
      />

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
      <ModalDialog
        open={duplicatesOpen}
        onClose={() => setDuplicatesOpen(false)}
        size="xl"
        title="Дублирующиеся темы"
      >
        {!duplicates ? (
          <Text variant="body-s" tone="muted">Загрузка…</Text>
        ) : duplicates.groups.length === 0 ? (
          <Text variant="body-s" tone="muted">Одноимённых тем по системе не найдено</Text>
        ) : (
          <ScrollArea maxH="md">
            <Stack gap={6}>
              {duplicates.groups.map((g) => (
                <Stack key={g.nameNormalized} gap={2}>
                  <Text variant="caption" weight="semibold" tone="muted">
                    «{g.nameNormalized}» · {g.topics.length}
                  </Text>
                  <Table
                    columns={duplicateColumns}
                    rows={g.topics}
                    rowKey={(tp) => tp.id}
                  />
                </Stack>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </ModalDialog>
    </Stack>
  );
}
