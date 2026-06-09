import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Table } from './Table';
import type { SortDir } from './Table';

type Row = { id: string; name: string; dept: string; progress: number };
const ROWS: Row[] = [
  { id: '1', name: 'Мария Иванова', dept: 'ОИТ', progress: 62 },
  { id: '2', name: 'Михаил Конев', dept: 'ДКП', progress: 100 },
  { id: '3', name: 'Лариса Воронина', dept: 'HR', progress: 28 },
  { id: '4', name: 'Ольга Соколова', dept: 'ДКП', progress: 0 },
];

const meta: Meta<typeof Table<Row>> = {
  title: 'Data/Table',
  component: Table,
  tags: ['autodocs'],
  argTypes: {
    density: { control: 'inline-radio', options: ['compact', 'normal', 'spacious'] },
    selectable: { control: 'boolean' },
    columns: { control: false },
    rows: { control: false },
    rowKey: { control: false },
    onSelectChange: { control: false },
    onSort: { control: false },
    onRowClick: { control: false },
    emptyMessage: { control: false },
  },
  args: { onSelectChange: fn(), onSort: fn() },
};
export default meta;
type Story = StoryObj<typeof Table<Row>>;

export const Default: Story = {
  render: (args) => {
    const [sortKey, setSortKey] = useState<string>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [selected, setSelected] = useState<string[]>([]);
    const sorted = [...ROWS].sort((a, b) => {
      const x = (a as any)[sortKey], y = (b as any)[sortKey];
      return (x > y ? 1 : -1) * (sortDir === 'asc' ? 1 : -1);
    });
    return (
      <Table<Row>
        {...args}
        rows={sorted}
        rowKey={r => r.id}
        selected={selected}
        onSelectChange={(s) => { setSelected(s); args.onSelectChange?.(s); }}
        sortKey={sortKey} sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); args.onSort?.(k, d); }}
        columns={[
          { key: 'name', header: 'Сотрудник', sortable: true },
          { key: 'dept', header: 'Подразделение', sortable: true },
          { key: 'progress', header: 'Прогресс', align: 'right', numeric: true,
            render: r => `${r.progress}%` },
        ]}
      />
    );
  },
  args: { density: 'normal', selectable: true },
};

export const Compact: Story = { ...Default, args: { density: 'compact', selectable: false } };
export const Empty: Story = {
  render: () => (
    <Table<Row>
      rows={[]}
      rowKey={r => r.id}
      columns={[{ key: 'name', header: 'Сотрудник' }]}
      emptyMessage="Нет сотрудников"
    />
  ),
};

