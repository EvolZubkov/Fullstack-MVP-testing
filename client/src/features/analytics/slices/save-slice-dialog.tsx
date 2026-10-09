/**
 * @module features/analytics/slices/save-slice-dialog
 * @description Э3.2: окно «Сохранить как срез» фильтра уровня теста (эскиз
 * approved/e3-test-and-question.html, состояние test-save-slice; разметка — из
 * prd56-analytics-section.html, состояние save-slice).
 *
 * Срез создаётся из фильтра теста (замечание владельца 2026-10-03): автор отбирает прохождения и
 * сохраняет отбор. Тест задан страницей — выбирать его не нужно, в условиях-чипах его нет; в
 * запрос он уходит условием, потому что срез — выборка одного теста.
 *
 * Срез хранит УСЛОВИЯ, а не список прохождений (PRD-56 FR-07d), и окно говорит это прямо: число
 * под условиями — сегодняшнее, завтра оно будет другим.
 */
import { useEffect, useState } from "react";

import { Banner, Button, Chip, Input, ModalDialog, Stack, Text } from "@skillum/ui-kit";
import { Info } from "lucide-react";

import { pluralize } from "@/lib/i18n";

/** Свойства окна. */
export interface SaveSliceDialogProps {
  open: boolean;
  onClose: () => void;
  testId: string;
  /** Условия фильтра теста на языке реестра — без теста: он задан страницей. */
  conditions: Record<string, unknown>;
  /** Подписи условий — те же, что у чипов фильтра. */
  labels: ReadonlyArray<{ id: string; label: string }>;
  /** Сколько прохождений подходит под условия сейчас; `null` — неизвестно. */
  total: number | null;
  /** Срез сохранён — список срезов теста стоит перечитать. */
  onSaved?: () => void;
}

/**
 * «Сохранить как срез».
 *
 * @param props - тест, условия и их подписи, сегодняшний объём выборки
 * @returns модальное окно с именем среза и его условиями
 */
export function SaveSliceDialog({ open, onClose, testId, conditions, labels, total, onSaved }: SaveSliceDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Каждое открытие — с чистого листа: прошлое имя и прошлая ошибка к новому отбору не относятся.
  useEffect(() => {
    if (open) { setName(""); setError(null); }
  }, [open]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/analytics/slices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind: "slice", conditions: { ...conditions, testIds: [testId] } }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Не удалось сохранить");
      }
      onSaved?.();
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="s"
      title="Сохранить как срез"
      description="Срез этого теста — сохранённый набор условий отбора. Его можно открыть заново и сравнить с другим"
      footer={
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="m" disabled={!name.trim() || saving} onClick={() => void save()}>
            Сохранить срез
          </Button>
        </>
      }
    >
      {/* Модульная сетка 4 px: поле, условия и пояснение — разные элементы, 4x; подпись и её
          содержимое — родственные, 1x. */}
      <Stack gap={4}>
        <Input
          label="Название среза"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Например: Розница, не сдали"
          fullWidth
        />
        <Stack gap={1}>
          <Text variant="body-xs" tone="muted">Условия — те же, что в фильтре сейчас</Text>
          <Stack direction="row" gap={1} wrap>
            {labels.map(item => <Chip key={item.id} size="xs">{item.label}</Chip>)}
          </Stack>
        </Stack>
        {total !== null && (
          <Banner
            tone="info"
            variant="subtle"
            size="sm"
            icon={<Info size={20} />}
            description={`Под условия сейчас подходит ${total} ${pluralize(total, "прохождение", "прохождения", "прохождений")}. Срез считается заново при каждом открытии — состав не консервируется.`}
          />
        )}
        {error && <Text tone="error">{error}</Text>}
      </Stack>
    </ModalDialog>
  );
}
