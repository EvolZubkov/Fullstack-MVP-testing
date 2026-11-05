/**
 * @module features/tests/list/public-link-modal
 * @description Public link window of a published test (stage 1): shows the link, copies it,
 * issues a new one (the old one stops working) or disables it. Anyone holding the link
 * takes the test without signing in; nothing of the passage is stored. The server gates
 * every call by `tests.edit` plus the edit scope of the test.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, ModalDialog, Stack, Text, useToast } from "@skillum/ui-kit";
import { Copy, RefreshCw, Link2Off, Link2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/** Server answer of `/api/tests/:id/public-link`. */
interface PublicLinkState {
  url: string | null;
  published: boolean;
}

/**
 * Window with the public link of a test.
 * @param props.test The test to manage, or `null` while the window is closed.
 * @param props.onClose Called when the window is dismissed.
 */
export function PublicLinkModal({
  test,
  onClose,
}: {
  test: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const { push: toast } = useToast();
  const queryClient = useQueryClient();
  const testId = test?.id ?? null;
  const queryKey = ["/api/tests", testId, "public-link"];

  const { data } = useQuery<PublicLinkState>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/tests/${testId}/public-link`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить ссылку");
      return res.json();
    },
    enabled: testId !== null,
  });

  const mutation = useMutation({
    mutationFn: async (method: "POST" | "DELETE") => {
      const res = await apiRequest(method, `/api/tests/${testId}/public-link`);
      return (await res.json()) as PublicLinkState;
    },
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (e: Error) => toast({ tone: "error", title: "Ошибка", description: e.message }),
  });

  if (!test) return null;

  const url = data?.url ?? null;
  const published = data?.published ?? true;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: "success", title: "Ссылка скопирована" });
    } catch {
      toast({ tone: "error", title: "Не удалось скопировать ссылку" });
    }
  }

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="m"
      title="Публичная ссылка"
      footer={
        <>
          {url && (
            <>
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Link2Off size={14} />}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("DELETE")}
                data-testid="public-link-disable"
              >
                Выключить
              </Button>
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<RefreshCw size={14} />}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("POST")}
                data-testid="public-link-rotate"
              >
                Выпустить новую
              </Button>
            </>
          )}
          <Button variant="ghost" size="s" onClick={onClose}>
            Закрыть
          </Button>
        </>
      }
    >
      <Stack gap={3}>
        <Text variant="body-s" tone="muted">{test.title}</Text>
        {url ? (
          <>
            <Input
              size="m"
              fullWidth
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Публичная ссылка"
              data-testid="public-link-url"
            />
            <div>
              <Button
                variant="primary"
                size="s"
                leadingIcon={<Copy size={14} />}
                onClick={() => void copy()}
                data-testid="public-link-copy"
              >
                Копировать
              </Button>
            </div>
            <Text variant="body-s" tone="muted">
              Кто угодно с этой ссылкой может пройти тест. Прохождения не сохраняются.
            </Text>
          </>
        ) : (
          <>
            <Text variant="body-m">Ссылка выключена</Text>
            {published ? (
              <Text variant="body-s" tone="muted">
                После включения любой, у кого есть ссылка, сможет пройти тест без входа.
                Прохождения не сохраняются.
              </Text>
            ) : (
              <Text variant="body-s" tone="muted">
                Ссылку можно выпустить только для опубликованного теста.
              </Text>
            )}
            <div>
              <Button
                variant="primary"
                size="s"
                leadingIcon={<Link2 size={14} />}
                disabled={!published || mutation.isPending || data === undefined}
                onClick={() => mutation.mutate("POST")}
                data-testid="public-link-enable"
              >
                Включить
              </Button>
            </div>
          </>
        )}
      </Stack>
    </ModalDialog>
  );
}
