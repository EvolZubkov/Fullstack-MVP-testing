/**
 * @module features/import/import-kinds-table
 *
 * Перечень «Что можно загрузить» под загрузчиком раздела «Импорт» (Э6 UX-аудита, эскиз
 * `docs/wireframes/approved/e6-import-single-point.html`): строка на вид файла — только виды, на
 * которые у читателя есть право; шаблон файла и руководство — там, где они есть. Вид без права
 * не показывается вовсе: перечень — это то, что человек МОЖЕТ сделать, а не карта запретов.
 */
import type { ReactNode } from "react";
import { BookOpen, Download } from "lucide-react";
import { Button, Cluster, DataGrid, Text } from "@skillum/ui-kit";
import type { ImportKind } from "@shared/access";
import { t } from "@/lib/i18n";

const tr = t.importPage;

/** Скачать файл по адресу, не уводя страницу: присваивание `location` ушло бы до загрузки. */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Форматы, которые раздел принимает для каждого вида. */
export const KIND_EXTENSIONS: Readonly<Record<ImportKind, readonly string[]>> = {
  workbook: [".xlsx"],
  lmsExport: [".xlsx"],
  package: [".tbtest"],
  users: [".csv", ".xlsx"],
  template: [".zip"],
};

interface KindRow {
  kind: ImportKind;
  title: string;
  target: string;
  extras?: ReactNode;
}

export interface ImportKindsTableProps {
  /** Виды, на которые у читателя есть право, в порядке перечня. */
  kinds: readonly ImportKind[];
  /**
   * Может ли читатель заводить пользователей выше обычных: менеджеру список заводит только
   * учётные записи участников (потолок ролей PRD-13), и строка говорит именно это.
   */
  usersBeyondLearners: boolean;
}

export function ImportKindsTable({ kinds, usersBeyondLearners }: ImportKindsTableProps) {
  const all: Record<ImportKind, KindRow> = {
    workbook: {
      kind: "workbook",
      title: "Книга с вопросами",
      target: "банк вопросов; шкалы, показатели и вклады — в выбранный тест",
      extras: (
        <Cluster gap={1} wrap={false}>
          <Button variant="ghost" size="s" leadingIcon={<Download size={14} />} onClick={() => download("/api/workbook/template")}>
            {tr.kindTemplateButton}
          </Button>
          <Button variant="ghost" size="s" leadingIcon={<BookOpen size={14} />} onClick={() => download("/api/workbook/docs/guide")}>
            {tr.kindGuideButton}
          </Button>
        </Cluster>
      ),
    },
    lmsExport: {
      kind: "lmsExport",
      title: "Выгрузка отчёта LMS",
      target: "прохождения — в аналитику теста, к которому относится файл",
    },
    package: {
      kind: "package",
      title: "Пакет теста",
      target: "тест целиком: содержание, оформление, тексты итогов",
    },
    users: {
      kind: "users",
      title: "Список пользователей",
      target: usersBeyondLearners ? "учётные записи и группы" : "учётные записи участников и группы",
      extras: (
        <Button variant="ghost" size="s" leadingIcon={<Download size={14} />} onClick={() => download("/api/users/bulk-template")}>
          {tr.kindTemplateButton}
        </Button>
      ),
    },
    template: {
      kind: "template",
      title: "Шаблон оформления",
      target: "реестр шаблонов — черновиком, до проверки работоспособности",
    },
  };

  const rows = kinds.map((kind) => all[kind]);

  return (
    <DataGrid
      rowKey={(row: KindRow) => row.kind}
      rows={rows}
      columns={[
        { key: "title", header: tr.kindsTitle, render: (row: KindRow) => <Text weight="semibold">{row.title}</Text> },
        { key: "format", header: tr.kindsFormat, render: (row: KindRow) => KIND_EXTENSIONS[row.kind].join(", ") },
        { key: "target", header: tr.kindsTarget, render: (row: KindRow) => row.target },
        { key: "extras", header: "", render: (row: KindRow) => row.extras ?? null },
      ]}
    />
  );
}
