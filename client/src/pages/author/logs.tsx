import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, RefreshCw, Play, Square } from "lucide-react";

type LogLevel = "all" | "info" | "warn" | "error" | "debug";

function getLevelBadge(line: string) {
  if (line.includes("[ERROR]")) return <Badge variant="destructive" className="text-xs px-1 py-0">ERROR</Badge>;
  if (line.includes("[WARN ]")) return <Badge variant="outline" className="text-xs px-1 py-0 border-yellow-500 text-yellow-600">WARN</Badge>;
  if (line.includes("[DEBUG]")) return <Badge variant="outline" className="text-xs px-1 py-0 text-muted-foreground">DEBUG</Badge>;
  return <Badge variant="outline" className="text-xs px-1 py-0 border-blue-500 text-blue-600">INFO</Badge>;
}

function LogLine({ line }: { line: string }) {
  // Формат: 2026-03-19 14:32:01 [ERROR] [source] message
  const match = line.match(/^(\S+ \S+) \[(\w+)\s*\] \[([^\]]+)\] (.+)$/);
  if (!match) return <div className="font-mono text-xs text-muted-foreground py-0.5">{line}</div>;
  const [, ts, , source, message] = match;
  return (
    <div className="font-mono text-xs py-0.5 flex items-start gap-2 hover:bg-muted/30 px-2 rounded">
      <span className="text-muted-foreground shrink-0">{ts}</span>
      {getLevelBadge(line)}
      <span className="text-muted-foreground shrink-0">[{source}]</span>
      <span className="break-all">{message}</span>
    </div>
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
    <div className="flex flex-col h-full">
      <PageHeader
        title="Логи сервера"
        description="Просмотр серверных логов"
        icon={<ScrollText className="h-6 w-6" />}
      />

      {/* Панель фильтров */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b">
        {/* Дата */}
        <Select value={date} onValueChange={setDate}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Дата" />
          </SelectTrigger>
          <SelectContent>
            {dates.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Уровень */}
        <Select value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Уровень" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="info">INFO</SelectItem>
            <SelectItem value="warn">WARN</SelectItem>
            <SelectItem value="error">ERROR</SelectItem>
            <SelectItem value="debug">DEBUG</SelectItem>
          </SelectContent>
        </Select>

        {/* Поиск */}
        <Input
          placeholder="Поиск по тексту..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-56"
        />

        {/* Кнопки */}
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>

        <Button
          variant={liveMode ? "default" : "outline"}
          size="sm"
          onClick={() => setLiveMode(!liveMode)}
        >
          {liveMode
            ? <><Square className="h-4 w-4 mr-1" />Стоп</>
            : <><Play className="h-4 w-4 mr-1" />Живой режим</>
          }
        </Button>

        {data && (
          <span className="text-sm text-muted-foreground ml-auto">
            Записей: {data.total}
          </span>
        )}
      </div>

      {/* Лог-вывод */}
      <div className="flex-1 overflow-y-auto bg-muted/20 p-2">
        {!data || data.lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {isFetching ? "Загрузка..." : "Нет записей для выбранных фильтров"}
          </div>
        ) : (
          <>
            {data.lines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}