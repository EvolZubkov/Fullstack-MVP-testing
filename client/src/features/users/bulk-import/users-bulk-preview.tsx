/**
 * @module features/users/bulk-import/users-bulk-preview
 *
 * Предпросмотр и итог загрузки списка пользователей — общие для окна «Массовая загрузка
 * пользователей» и шага списка в разделе «Импорт» (Э6 UX-аудита). Разметка перенесена из окна
 * страницы «Пользователи» без изменений, кроме двух правок согласованного эскиза
 * `docs/wireframes/approved/e6-import-single-point.html`: роль пишется названием, а не кодом
 * (`learner`), и под статусом «Ошибка» стоит её причина — менеджер видит отказ по роли ДО записи.
 */
import {
  Box,
  Checkbox,
  Cluster,
  Grid,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tag,
  Text,
  type TableColumn,
} from "@skillum/ui-kit";
import { isStoredRole } from "@shared/access";
import { ROLE_LABELS } from "@/lib/roles";
import type { UsersBulkImport, UsersImportResult, UsersPreviewRow } from "./use-users-bulk-import";

/** Название роли строки; неизвестный код показывается как есть, чтобы не спрятать опечатку файла. */
function roleLabel(role: string): string {
  return isStoredRole(role) ? ROLE_LABELS[role] : role;
}

function previewColumns(bulk: UsersBulkImport): TableColumn<UsersPreviewRow>[] {
  return [
    { key: "email", header: "Email", render: (row) => <Text variant="mono-s">{row.email}</Text> },
    { key: "name", header: "Имя", render: (row) => <Text variant="body-s" tone="muted">{row.name || "—"}</Text> },
    { key: "role", header: "Роль", render: (row) => <Tag variant="outline" size="s">{roleLabel(row.role)}</Tag> },
    {
      key: "group",
      header: "Группа",
      render: (row) =>
        row.groupName ? (
          <Tag
            size="s"
            tone={row.groupFound ? "success" : "error"}
            title={row.groupFound ? undefined : "Группа не найдена — будет пропущена"}
          >
            {row.groupName}{!row.groupFound && " ⚠"}
          </Tag>
        ) : (
          <Text variant="body-xs" tone="muted">—</Text>
        ),
    },
    {
      // Org-structure plan: one column in two lines — the unit, then position and
      // organisation. Separate columns made ten, and «Статус» with «Действие»
      // went past the edge of the dialog.
      key: "org",
      header: "Подразделение и должность",
      render: (row) => {
        const second = [row.position, row.organization].filter(Boolean).join(" · ");
        if (!row.unit && !second) return <Text variant="body-xs" tone="muted">—</Text>;
        return (
          <Stack gap={1}>
            <Text variant="body-s">{row.unit || "—"}</Text>
            {second && <Text variant="body-xs" tone="muted">{second}</Text>}
          </Stack>
        );
      },
    },
    {
      // PRD-54: колонка нужна, чтобы до записи было видно, кому проставится ключ. Без неё
      // состояние «Ключ будет обновлён» сообщало бы о факте, не показывая самого значения.
      // Оба ключа связывания — в одной колонке, по строке на ключ.
      key: "keys",
      header: "Ключи связывания",
      render: (row) =>
        row.lmsLearnerId || row.externalKey ? (
          <Stack gap={1}>
            {row.lmsLearnerId && <Text variant="mono-s" className="tb-users-key">LMS: {row.lmsLearnerId}</Text>}
            {row.externalKey && (
              <Text variant="mono-s" tone="muted" className="tb-users-key">Ключ: {row.externalKey}</Text>
            )}
          </Stack>
        ) : <Text variant="body-xs" tone="muted">—</Text>,
    },
    {
      key: "status",
      header: "Статус",
      render: (row) => (
        <>
          {row.status === "new" && <Text variant="body-xs" weight="medium" tone="success">Новый</Text>}
          {row.status === "duplicate" && <Text variant="body-xs" weight="medium" tone="warning">Дубль</Text>}
          {row.status === "keyUpdate" && <Text variant="body-xs" weight="medium" tone="info">Ключ будет обновлён</Text>}
          {row.status === "error" && (
            // Причина — под статусом, а не в подсказке: строку, которую не запишут, надо понять
            // до записи, не наводя на неё мышь.
            <Stack gap={1}>
              <Text variant="body-xs" weight="medium" tone="error">Ошибка</Text>
              {row.error && <Text variant="body-xs" tone="muted">{row.error}</Text>}
            </Stack>
          )}
        </>
      ),
    },
    {
      key: "action",
      header: "Действие",
      width: "160px",
      render: (row) => (
        <>
          {row.status === "duplicate" && (
            <Select<NonNullable<UsersPreviewRow["duplicateAction"]>>
              size="s"
              fullWidth
              aria-label="Действие для дубля"
              value={row.duplicateAction}
              onChange={(value) => bulk.setDuplicateAction(row.idx, value)}
              options={[
                { value: "skip", label: "Пропустить" },
                { value: "update", label: "Обновить" },
              ]}
            />
          )}
          {row.status === "new" && <Text variant="body-xs" tone="muted">Создать</Text>}
          {row.status === "error" && <Text variant="body-xs" tone="muted">Пропустить</Text>}
        </>
      ),
    },
  ];
}

/** Предпросмотр: счётчики, таблица строк и выбор, слать ли приглашения. */
export function UsersBulkPreview({ bulk }: { bulk: UsersBulkImport }) {
  const { rows } = bulk;
  return (
    <Stack gap={4}>
      <Cluster gap={3}>
        <Tag tone="success" dot size="s">Новых: {rows.filter((r) => r.status === "new").length}</Tag>
        <Tag tone="warning" dot size="s">Дублей: {rows.filter((r) => r.status === "duplicate").length}</Tag>
        <Tag tone="error" dot size="s">Ошибок: {rows.filter((r) => r.status === "error").length}</Tag>
      </Cluster>

      <Box border radius="m">
        <ScrollArea maxH="md">
          <Table columns={previewColumns(bulk)} rows={rows} rowKey={(row) => String(row.idx)} />
        </ScrollArea>
      </Box>

      <Checkbox
        label="Отправить письма-приглашения с ссылкой для установки пароля"
        checked={bulk.sendInvites}
        onChange={(e) => bulk.setSendInvites(e.target.checked)}
      />
    </Stack>
  );
}

/** Итог записи: четыре числа и перечень строк, которые записать не удалось. */
export function UsersBulkResult({ result }: { result: UsersImportResult }) {
  const tiles: Array<{ value: number; label: string; tone: "success" | "info" | "muted" | "accent" }> = [
    { value: result.created, label: "Создано", tone: "success" },
    { value: result.updated, label: "Обновлено", tone: "info" },
    { value: result.skipped, label: "Пропущено", tone: "muted" },
    { value: result.invitesSent, label: "Писем отправлено", tone: "accent" },
  ];
  return (
    <Stack gap={4}>
      <Grid cols={4} gap={3}>
        {tiles.map((tile) => (
          <Box key={tile.label} border radius="l" pad={4}>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold" tone={tile.tone}>{tile.value}</Text>
              <Text as="p" variant="body-s" tone="muted">{tile.label}</Text>
            </Stack>
          </Box>
        ))}
      </Grid>
      {result.errors.length > 0 && (
        <Box border radius="m" pad={3}>
          <Stack gap={1}>
            <Text as="p" variant="body-s" weight="medium" tone="error">Ошибки:</Text>
            {result.errors.map((e, i) => (
              <Text as="p" key={i} variant="body-xs" tone="muted">{e}</Text>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
