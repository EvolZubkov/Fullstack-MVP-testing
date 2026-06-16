/**
 * @module features/content/content-filters
 *
 * Facet filter for the unified "Темы и вопросы" tree (Phase 2): a toggleable
 * panel (Тип / Сложность / Теги / Медиа / Автор / Область) plus a bar of
 * removable active-condition chips. Filtering itself is applied by the tree
 * (client-side); this component is presentation + value state shape. See
 * docs/PLAN_content_axis_implementation.md.
 */
import { X } from "lucide-react";
import { Box, Button, Checkbox, Cluster, SegmentedControl, Select, Stack, Text } from "@universityrt/ui-kit";

export type QuestionType = "single" | "multiple" | "matching" | "ranking";
export type DiffBucket = "easy" | "medium" | "hard";
export type MediaBucket = "image" | "audio" | "video" | "none";
export type ContentScope = "all" | "mine" | "accessible" | "shared";

export interface ContentFilterValue {
  types: QuestionType[];
  diffs: DiffBucket[];
  tags: string[];
  media: MediaBucket[];
  author: string; // user id, "" = any
  scope: ContentScope;
}

export const EMPTY_FILTER: ContentFilterValue = { types: [], diffs: [], tags: [], media: [], author: "", scope: "all" };

/** Number of active conditions (drives the "Фильтры (N)" badge). */
export function filterCount(f: ContentFilterValue): number {
  return f.types.length + f.diffs.length + f.tags.length + f.media.length + (f.author ? 1 : 0) + (f.scope !== "all" ? 1 : 0);
}

const TYPE_OPTS: { value: QuestionType; label: string }[] = [
  { value: "single", label: "Одиночный" },
  { value: "multiple", label: "Множественный" },
  { value: "matching", label: "Соответствие" },
  { value: "ranking", label: "Порядок" },
];
const DIFF_OPTS: { value: DiffBucket; label: string }[] = [
  { value: "easy", label: "Легко" },
  { value: "medium", label: "Средне" },
  { value: "hard", label: "Сложно" },
];
const MEDIA_OPTS: { value: MediaBucket; label: string }[] = [
  { value: "image", label: "С изображением" },
  { value: "audio", label: "С аудио" },
  { value: "video", label: "С видео" },
  { value: "none", label: "Без медиа" },
];
const SCOPE_ITEMS: { value: ContentScope; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "mine", label: "Мои" },
  { value: "accessible", label: "Доступные" },
  { value: "shared", label: "Общие" },
];

function toggle<T>(arr: T[], item: T, on: boolean): T[] {
  return on ? [...arr, item] : arr.filter((x) => x !== item);
}

interface ContentFiltersProps {
  value: ContentFilterValue;
  onChange: (next: ContentFilterValue) => void;
  open: boolean;
  tagOptions: string[];
  authorOptions: { value: string; label: string }[];
}

export function ContentFilters({ value, onChange, open, tagOptions, authorOptions }: ContentFiltersProps) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  for (const ty of value.types) chips.push({ key: `t-${ty}`, label: `Тип: ${TYPE_OPTS.find((o) => o.value === ty)?.label}`, clear: () => onChange({ ...value, types: value.types.filter((x) => x !== ty) }) });
  for (const d of value.diffs) chips.push({ key: `d-${d}`, label: `Сложность: ${DIFF_OPTS.find((o) => o.value === d)?.label}`, clear: () => onChange({ ...value, diffs: value.diffs.filter((x) => x !== d) }) });
  for (const tg of value.tags) chips.push({ key: `g-${tg}`, label: `Тег: ${tg}`, clear: () => onChange({ ...value, tags: value.tags.filter((x) => x !== tg) }) });
  for (const m of value.media) chips.push({ key: `m-${m}`, label: `Медиа: ${MEDIA_OPTS.find((o) => o.value === m)?.label}`, clear: () => onChange({ ...value, media: value.media.filter((x) => x !== m) }) });
  if (value.author) chips.push({ key: "a", label: `Автор: ${authorOptions.find((o) => o.value === value.author)?.label ?? value.author}`, clear: () => onChange({ ...value, author: "" }) });
  if (value.scope !== "all") chips.push({ key: "s", label: `Область: ${SCOPE_ITEMS.find((o) => o.value === value.scope)?.label}`, clear: () => onChange({ ...value, scope: "all" }) });

  return (
    <>
      {open && (
        <Box border radius="m" pad={4}>
          <Stack gap={4}>
            <Stack gap={2}>
              <Text variant="caption" tone="muted" weight="semibold">Тип вопроса</Text>
              <Cluster gap={4} wrap>
                {TYPE_OPTS.map((o) => (
                  <Checkbox key={o.value} label={o.label} checked={value.types.includes(o.value)} onChange={(e) => onChange({ ...value, types: toggle(value.types, o.value, e.target.checked) })} />
                ))}
              </Cluster>
            </Stack>
            <Stack gap={2}>
              <Text variant="caption" tone="muted" weight="semibold">Сложность</Text>
              <Cluster gap={4} wrap>
                {DIFF_OPTS.map((o) => (
                  <Checkbox key={o.value} label={o.label} checked={value.diffs.includes(o.value)} onChange={(e) => onChange({ ...value, diffs: toggle(value.diffs, o.value, e.target.checked) })} />
                ))}
              </Cluster>
            </Stack>
            {tagOptions.length > 0 && (
              <Stack gap={2}>
                <Text variant="caption" tone="muted" weight="semibold">Теги (подтемы)</Text>
                <Cluster gap={4} wrap>
                  {tagOptions.map((tg) => (
                    <Checkbox key={tg} label={tg} checked={value.tags.includes(tg)} onChange={(e) => onChange({ ...value, tags: toggle(value.tags, tg, e.target.checked) })} />
                  ))}
                </Cluster>
              </Stack>
            )}
            <Stack gap={2}>
              <Text variant="caption" tone="muted" weight="semibold">Медиа</Text>
              <Cluster gap={4} wrap>
                {MEDIA_OPTS.map((o) => (
                  <Checkbox key={o.value} label={o.label} checked={value.media.includes(o.value)} onChange={(e) => onChange({ ...value, media: toggle(value.media, o.value, e.target.checked) })} />
                ))}
              </Cluster>
            </Stack>
            {authorOptions.length > 0 && (
              <Stack gap={2}>
                <Text variant="caption" tone="muted" weight="semibold">Автор</Text>
                <Select value={value.author} onChange={(v) => onChange({ ...value, author: v })} options={[{ value: "", label: "Любой" }, ...authorOptions]} />
              </Stack>
            )}
            <Stack gap={2}>
              <Text variant="caption" tone="muted" weight="semibold">Область</Text>
              <SegmentedControl<ContentScope> value={value.scope} onChange={(v) => onChange({ ...value, scope: v })} items={SCOPE_ITEMS} />
            </Stack>
            <Cluster gap={2}>
              <Button variant="ghost" size="s" onClick={() => onChange(EMPTY_FILTER)}>Сбросить всё</Button>
            </Cluster>
          </Stack>
        </Box>
      )}
      {chips.length > 0 && (
        <Cluster gap={2} wrap>
          {chips.map((c) => (
            <Button key={c.key} variant="secondary" size="s" leadingIcon={<X size={12} />} onClick={c.clear}>{c.label}</Button>
          ))}
          <Button variant="ghost" size="s" onClick={() => onChange(EMPTY_FILTER)}>Очистить всё</Button>
        </Cluster>
      )}
    </>
  );
}
