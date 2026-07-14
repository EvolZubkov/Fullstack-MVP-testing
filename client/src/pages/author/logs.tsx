/**
 * @module pages/author/logs
 * @description Server-log viewer for authors/admins: a filter row (date, level,
 * debounced text search, refresh, live-tail) over a monospace, auto-scrolling log
 * output. Rendered entirely with the UniversityRT design system — layout via
 * Stack/Cluster/Box, typography via Text (mono-s for log lines), level badges via
 * Tag, the empty/loading state via EmptyState — with no raw utility classes.
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

type LogLevel = "all" | "info" | "warn" | "error" | "fatal" | "debug";

function getLevelBadge(line: string) {
  if (line.includes("[FATAL]")) return <Tag tone="error" variant="solid" size="s">FATAL</Tag>;
  if (line.includes("[ERROR]")) return <Tag tone="error" size="s">ERROR</Tag>;
  if (line.includes("[WARN ]")) return <Tag tone="warning" variant="outline" size="s">WARN</Tag>;
  if (line.includes("[DEBUG]")) return <Tag variant="outline" size="s">DEBUG</Tag>;
  return <Tag tone="info" variant="outline" size="s">INFO</Tag>;
}

function LogLine({ line }: { line: string }) {
  // Формат: 2026-03-19 14:32:01 [ERROR] [source] message
  const match = line.match(/^(\S+ \S+) \[(\w+)\s*\] \[([^\]]+)\] (.+)$/);
  if (!match) return <Text as="div" variant="mono-s" tone="muted">{line}</Text>;
  const [, ts, , source, message] = match;
  return (
    <Cluster gap={2} align="start" wrap={false}>
      <Text variant="mono-s" tone="muted">{ts}</Text>
      {getLevelBadge(line)}
      <Text variant="mono-s" tone="muted">[{source}]</Text>
      <Text variant="mono-s">{message}</Text>
    </Cluster>
  );
}

export default function LogsPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [level, setLevel] = useState<LogLevel>("all");
  const [search, setSearch] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Debounce поиска — не дёргаем сервер на каждый символ
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: dates = [] } = useQuery<string[]>({
    queryKey: ["/api/logs/dates"],
    queryFn: async () => {
      const res = await fetch("/api/logs/dates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dates");
      return res.json();
    },
    refetchInterval: false,
    staleTime: 60000,
  });

  const { data, refetch, isFetching } = useQuery<{ date: string; total: number; shown: number; lines: string[] }>({
    queryKey: ["logs", date, level, search],
    queryFn: async () => {
      const params = new URLSearchParams({ date, level });
      if (search) params.set("search", search);
      const res = await fetch(`/api/logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
    refetchInterval: liveMode ? 5000 : false,
  });

  // Автоскролл вниз в живом режиме
  useEffect(() => {
    if (liveMode && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.lines, liveMode]);

  return (
    <Stack gap={0} full>
      <PageHeader
        title="Логи сервера"
        description="Просмотр серверных логов"
        icon={<ScrollText size={24} />}
      />

      {/* Панель фильтров */}
      <Box border>
        <Cluster gap={2} justify="between">
          <Cluster gap={2}>
            {/* Дата */}
            <Select
              value={date}
              onChange={setDate}
              placeholder="Дата"
              options={dates.map((d) => ({ value: d, label: d }))}
            />

            {/* Уровень */}
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
              ]}
            />

            {/* Поиск */}
            <Input
              placeholder="Поиск по тексту..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />

            {/* Кнопки */}
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

      {/* Лог-вывод */}
      <Box surface="muted" pad={2} grow>
        {!data || data.lines.length === 0 ? (
          <EmptyState
            art={<ScrollText size={48} color="var(--ou-fg-subtle)" />}
            title={isFetching ? "Загрузка..." : "Нет записей для выбранных фильтров"}
          />
        ) : (
          <ScrollArea>
            <Stack gap={1}>
              {data.lines.map((line, i) => (
                <LogLine key={i} line={line} />
              ))}
              <div ref={bottomRef} />
            </Stack>
          </ScrollArea>
        )}
      </Box>
    </Stack>
  );
}
