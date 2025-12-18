import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FolderOpen, ExternalLink, BookMarked, Copy, CheckSquare, Square, Folder, ChevronRight, ChevronDown, FolderPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
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
import type { Topic, TopicCourse, Folder as FolderType } from "@shared/schema";

const topicFormSchema = z.object({
  name: z.string().min(1, t.topics.nameRequired),
  description: z.string().optional(),
  feedback: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

const folderFormSchema = z.object({
  name: z.string().min(1, t.topics.nameRequired),
  parentId: z.string().nullable().optional(),
});

const courseFormSchema = z.object({
  title: z.string().min(1, t.topics.titleRequired),
  url: z.string().url(t.topics.validUrl),
});

type TopicFormData = z.infer<typeof topicFormSchema>;
type FolderFormData = z.infer<typeof folderFormSchema>;
type CourseFormData = z.infer<typeof courseFormSchema>;

interface TopicWithDetails extends Topic {
  courses: TopicCourse[];
  questionCount: number;
}

export default function TopicsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [selectedTopicForCourse, setSelectedTopicForCourse] = useState<string | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderType | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const { data: topics, isLoading: topicsLoading } = useQuery<TopicWithDetails[]>({
    queryKey: ["/api/topics"],
  });

  const { data: folders, isLoading: foldersLoading } = useQuery<FolderType[]>({
    queryKey: ["/api/folders"],
  });

  const isLoading = topicsLoading || foldersLoading;

  const form = useForm<TopicFormData>({
    resolver: zodResolver(topicFormSchema),
    defaultValues: { name: "", description: "", feedback: "", folderId: null },
  });

  const folderForm = useForm<FolderFormData>({
    resolver: zodResolver(folderFormSchema),
    defaultValues: { name: "", parentId: null },
  });

  const courseForm = useForm<CourseFormData>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: { title: "", url: "" },
  });

  const createMutation = useMutation({
    mutationFn: (data: TopicFormData) => apiRequest("POST", "/api/topics", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.topics.topicCreated, description: t.topics.topicCreatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToCreate });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TopicFormData }) =>
      apiRequest("PUT", `/api/topics/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.topics.topicUpdated, description: t.topics.topicUpdatedDescription });
      handleCloseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToUpdate });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/topics/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.topics.topicDeleted, description: t.topics.topicDeletedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToDelete });
    },
  });

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

  const addCourseMutation = useMutation({
    mutationFn: ({ topicId, data }: { topicId: string; data: CourseFormData }) =>
      apiRequest("POST", `/api/topics/${topicId}/courses`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.topics.courseAdded, description: t.topics.courseAddedDescription });
      handleCloseCourseDialog();
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToAddCourse });
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: (courseId: string) => apiRequest("DELETE", `/api/courses/${courseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      toast({ title: t.topics.courseRemoved, description: t.topics.courseRemovedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToRemoveCourse });
    },
  });

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

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/topics/bulk-delete", { ids }),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      toast({ title: t.topics.topicsDeleted, description: t.topics.topicsDeletedDescription(ids.length) });
      setSelectedTopics(new Set());
      setBulkDeleteDialogOpen(false);
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.topics.failedToDeleteTopics });
    },
  });

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

  const confirmBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedTopics));
  };

  const handleOpenCreate = (folderId?: string | null) => {
    setEditingTopic(null);
    form.reset({ name: "", description: "", feedback: "", folderId: folderId || null });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (topic: Topic) => {
    setEditingTopic(topic);
    form.reset({ 
      name: topic.name, 
      description: topic.description || "", 
      feedback: topic.feedback || "",
      folderId: topic.folderId || null
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingTopic(null);
    form.reset();
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

  const handleOpenCourseDialog = (topicId: string) => {
    setSelectedTopicForCourse(topicId);
    courseForm.reset({ title: "", url: "" });
    setCourseDialogOpen(true);
  };

  const handleCloseCourseDialog = () => {
    setCourseDialogOpen(false);
    setSelectedTopicForCourse(null);
    courseForm.reset();
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

  const onSubmit = (data: TopicFormData) => {
    if (editingTopic) {
      updateMutation.mutate({ id: editingTopic.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const onSubmitFolder = (data: FolderFormData) => {
    if (editingFolder) {
      updateFolderMutation.mutate({ id: editingFolder.id, data });
    } else {
      createFolderMutation.mutate(data);
    }
  };

  const onSubmitCourse = (data: CourseFormData) => {
    if (selectedTopicForCourse) {
      addCourseMutation.mutate({ topicId: selectedTopicForCourse, data });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm(t.topics.confirmDelete)) {
      deleteMutation.mutate(id);
    }
  };

  const rootFolders = folders?.filter((f) => !f.parentId) || [];
  const getChildFolders = (parentId: string) => folders?.filter((f) => f.parentId === parentId) || [];
  const getTopicsInFolder = (folderId: string | null) => 
    topics?.filter((topic) => topic.folderId === folderId) || [];
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
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{formatQuestions(topic.questionCount)}</span>
          <span>{topic.courses.length} {t.common.courses}</span>
        </div>

        {topic.courses.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t.topics.recommendedCourses}
            </p>
            <div className="space-y-1">
              {topic.courses.map((course) => (
                <div
                  key={course.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted"
                >
                  <a
                    href={course.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:underline truncate"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{course.title}</span>
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => deleteCourseMutation.mutate(course.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleOpenCourseDialog(topic.id)}
          data-testid={`button-add-course-${topic.id}`}
        >
          <BookMarked className="h-4 w-4 mr-2" />
          {t.topics.addCourse}
        </Button>
      </CardFooter>
    </Card>
  );

  const renderFolder = (folder: FolderType, depth: number = 0) => {
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2 pl-8">
                {folderTopics.map(renderTopicCard)}
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
          {rootFolders.map((folder) => renderFolder(folder))}
          
          {rootTopics.length > 0 && (
            <div>
              {rootFolders.length > 0 && (
                <div className="flex items-center gap-2 mb-4 text-muted-foreground">
                  <FolderOpen className="h-4 w-4" />
                  <span className="text-sm font-medium">{t.folders.root}</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {rootTopics.map(renderTopicCard)}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTopic ? t.topics.editTopic : t.topics.createTopic}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.topicName}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t.topics.topicNamePlaceholder} data-testid="input-topic-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="folderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.folder}</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(value) => field.onChange(value === "__none__" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-topic-folder">
                          <SelectValue placeholder={t.topics.selectFolder} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">{t.topics.noFolder}</SelectItem>
                        {folders?.map((folder) => (
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
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.topicDescription}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t.topics.topicDescriptionPlaceholder}
                        rows={3}
                        data-testid="input-topic-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="feedback"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.feedback}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ""}
                        placeholder={t.topics.feedbackPlaceholder}
                        rows={2}
                        data-testid="input-topic-feedback"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-topic"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <LoadingSpinner className="mr-2" />
                  )}
                  {editingTopic ? t.common.update : t.common.create}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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

      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.topics.addRecommendedCourse}</DialogTitle>
          </DialogHeader>
          <Form {...courseForm}>
            <form onSubmit={courseForm.handleSubmit(onSubmitCourse)} className="space-y-4">
              <FormField
                control={courseForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.courseTitle}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t.topics.courseTitlePlaceholder} data-testid="input-course-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={courseForm.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.topics.courseUrl}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t.topics.courseUrlPlaceholder} data-testid="input-course-url" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseCourseDialog}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" disabled={addCourseMutation.isPending} data-testid="button-submit-course">
                  {addCourseMutation.isPending && <LoadingSpinner className="mr-2" />}
                  {t.topics.addCourse}
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
              {bulkDeleteMutation.isPending && <LoadingSpinner className="mr-2" />}
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
