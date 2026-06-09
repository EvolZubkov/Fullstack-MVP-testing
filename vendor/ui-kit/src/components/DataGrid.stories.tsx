import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { DataGrid, DataGridProgress } from './DataGrid';
import type { SortDir } from './Table';

type Row = { id: string; name: string; dept: string; progress: number; lastLogin: string };
const ROWS: Row[] = Array.from({ length: 24 }, (_, i) => ({
  id: `r${i+1}`,
  name: ['Мария Иванова','Михаил Конев','Лариса Воронина','Ольга Соколова','Артём Лебедев'][i%5] + ` ${i+1}`,
  dept: ['ОИТ','ДКП','HR'][i%3],
  progress: (i * 7) % 100,
  lastLogin: '11 мая 2026',
}));

const meta: Meta<typeof DataGrid<Row>> = {
  title: 'Data/DataGrid',
  component: DataGrid,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    selectable: { control: 'boolean' },
    expandable: { control: 'boolean' },
    columns: { control: false },
    rows: { control: false },
    rowKey: { control: false },
    title: { control: false },
    toolbarExtra: { control: false },
    onQueryChange: { control: false },
    onSort: { control: false },
    onSelectChange: { control: false },
    bulkActions: { control: false },
    renderExpanded: { control: false },
    onPageChange: { control: false },
    onPageSizeChange: { control: false },
    emptyMessage: { control: false },
  },
  args: { onQueryChange: fn(), onSelectChange: fn(), onSort: fn(), onPageChange: fn(), onPageSizeChange: fn() },
};
export default meta;
type Story = StoryObj<typeof DataGrid<Row>>;

export const Default: Story = {
  render: (args) => {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [size, setSize] = useState(10);
    const [sortKey, setSortKey] = useState<string>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const filtered = ROWS.filter(r =>
      !q || (r.name + ' ' + r.dept).toLowerCase().includes(q.toLowerCase()));
    const sorted = [...filtered].sort((a, b) => {
      const x = (a as any)[sortKey], y = (b as any)[sortKey];
      return (x > y ? 1 : -1) * (sortDir === 'asc' ? 1 : -1);
    });
    const paged = sorted.slice((page - 1) * size, page * size);

    return (
      <div className="ou-story-pad">
        <DataGrid<Row>
          title="Сотрудники"
          query={q} onQueryChange={(v) => { setQ(v); args.onQueryChange?.(v); }}
          rows={paged}
          rowKey={r => r.id}
          selectable selected={sel} onSelectChange={(s) => { setSel(s); args.onSelectChange?.(s); }}
          sortKey={sortKey} sortDir={sortDir}
          onSort={(k, d) => { setSortKey(k); setSortDir(d); args.onSort?.(k, d); }}
          page={page} pageSize={size} total={filtered.length}
          onPageChange={(p) => { setPage(p); args.onPageChange?.(p); }}
          onPageSizeChange={(s) => { setSize(s); args.onPageSizeChange?.(s); }}
          pageSizeOptions={[10, 25, 50]}
          expandable
          renderExpanded={r => (
            <div>
              <strong>{r.name}</strong> · {r.dept} · последний вход {r.lastLogin}
            </div>
          )}
          columns={[
            { key: 'name', header: 'Сотрудник', sortable: true, frozen: true, width: 220 },
            { key: 'dept', header: 'Подразделение', sortable: true },
            { key: 'progress', header: 'Прогресс', align: 'right',
              render: r => <DataGridProgress value={r.progress} /> },
            { key: 'lastLogin', header: 'Последний вход' },
          ]}
        />
      </div>
    );
  },
};
