/**
 * @module pages/author/logs
 * @description Recent-events viewer for authors/admins over the server's in-memory
 * ring buffer: a filter row (level, debounced text search, refresh, live-tail) above a
 * monospace, auto-scrolling output. There is no date/history access by design — full
 * historical log viewing lives outside the application. Rendered entirely with the
 * UniversityRT design system: layout via Stack/Cluster/Box, typography via Text
 * (mono-s for log lines), level badges via Tag, the empty/loading state via EmptyState.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import {
  Box,
  Button,
  Cluster,
  EmptyState,
  Input,
  ScrollArea,
  Select,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";
import { ScrollText, RefreshCw, Play, Square } from "lucide-react";

type LogLevel = "all" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  ts: string;
  level: Exclude<LogLevel, "all">;
  source: string;
  message: string;
  reqId?: string;
  userId?: string;
}

interface LogsResponse {
  total: number;
  shown: number;
  entries: LogEntry[];
}

function getLevelBadge(level: LogEntry["level"]) {
  switch (level) {
    case "fatal":
      return <Tag tone="error" variant="solid" size="s">FATAL</Tag>;
    case "error":
      return <Tag tone="error" size="s">ERROR</Tag>;
    case "warn":
      return <Tag tone="warning" variant="outline" size="s">WARN</Tag>;
    case "debug":
      return <Tag variant="outline" size="s">DEBUG</Tag>;
    case "trace":
      return <Tag variant="outline" size="s">TRACE</Tag>;
    default:
      return <Tag tone="info" variant="outline" size="s">INFO</Tag>;
  }
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <Cluster gap={2} align="start" wrap={false}>
      <Text variant="mono-s" tone="muted">{entry.ts}</Text>
      {getLevelBadge(entry.level)}
      <Text variant="mono-s" tone="muted">[{entry.source}]</Text>
      {entry.reqId && <Text variant="mono-s" tone="muted">[req:{entry.reqId}]</Text>}
      {entry.userId && <Text variant="mono-s" tone="muted">[user:{entry.userId}]</Text>}
      <Text variant="mono-s">{entry.message}</Text>
    </Cluster>
  );
}

export default function LogsPage() {
  const [level, setLevel] = useState<LogLevel>("all");
  const [search, setSearch] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Debounce search — do not hit the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, refetch, isFetching } = useQuery<LogsResponse>({
    queryKey: ["logs", level, search],
    queryFn: async () => {
      const params = new URLSearchParams({ level });
      if (search) params.set("search", search);
      const res = await fetch(`/api/logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
    refetchInterval: liveMode ? 5000 : false,
  });

  // Auto-scroll to bottom in live mode.
  useEffect(() => {
    if (liveMode && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.entries, liveMode]);

  return (
    <Stack gap={0} full>
      <PageHeader
        title="Логи сервера"
        description="Последние события из памяти сервера"
        icon={<ScrollText size={24} />}
      />

      {/* Filter panel */}
      <Box border>
        <Cluster gap={2} justify="between">
          <Cluster gap={2}>
            {/* Level */}
            <Select<LogLevel>
              value={level}
              onChange={setLevel}
              placeholder="Уровень"
              options={[
                { value: "all", label: "Все" },
                { value: "fatal", label: "FATAL" },
                { value: "error", label: "ERROR" },
                { value: "warn", label: "WARN" },
                { value: "info", label: "INFO" },
                { value: "debug", label: "DEBUG" },
                { value: "trace", label: "TRACE" },
              ]}
            />

            {/* Search */}
            <Input
              placeholder="Поиск по тексту..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />

            {/* Actions */}
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<RefreshCw size={16} />}
              loading={isFetching}
              onClick={() => refetch()}
              disabled={isFetching}
            >
              Обновить
            </Button>

            <Button
              variant={liveMode ? "primary" : "secondary"}
              size="s"
              leadingIcon={liveMode ? <Square size={16} /> : <Play size={16} />}
              onClick={() => setLiveMode(!liveMode)}
            >
              {liveMode ? "Стоп" : "Живой режим"}
            </Button>
          </Cluster>

          {data && (
            <Text variant="body-s" tone="muted">
              Записей: {data.total}
            </Text>
          )}
        </Cluster>
      </Box>

      {/* Log output */}
      <Box surface="muted" pad={2} grow>
        {!data || data.entries.length === 0 ? (
          <EmptyState
            art={<ScrollText size={48} color="var(--ou-fg-subtle)" />}
            title={isFetching ? "Загрузка..." : "Нет записей для выбранных фильтров"}
          />
        ) : (
          <ScrollArea>
            <Stack gap={1}>
              {data.entries.map((entry, i) => (
                <LogLine key={i} entry={entry} />
              ))}
              <div ref={bottomRef} />
            </Stack>
          </ScrollArea>
        )}
      </Box>
    </Stack>
  );
}
