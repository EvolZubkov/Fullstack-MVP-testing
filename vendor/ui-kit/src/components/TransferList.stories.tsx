import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { TransferList, type TransferItem } from './TransferList';
import { Input } from './Input';

const PEOPLE: TransferItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i+1}`,
  name: ['Мария Иванова','Михаил Конев','Лариса Воронина','Ольга Соколова','Иван Котов','Павел Рябцев','Артём Лебедев','Тимур Хисматов','Светлана Юдина','Денис Поляков','Виктория Терёхина','Юлия Кравчук'][i],
  meta: ['ОИТ · Аналитик','ДКП · Тимлид','HR · Партнёр','ДКП · Менеджер','ОИТ · Разработчик'][i % 5],
  tag: `${(i+1) * 3} курс.`,
  color: (['purple','blue','green','orange','pink'] as const)[i % 5],
  category: ['ОИТ','ДКП','HR','ДКП','ОИТ'][i % 5],
}));

const meta: Meta<typeof TransferList> = {
  title: 'Data/TransferList',
  component: TransferList,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    compact: { control: 'boolean' },
    showSummary: { control: 'boolean' },
    available: { control: false },
    assigned: { control: false },
    onChange: { control: false },
    leftTitle: { control: false },
    rightTitle: { control: false },
    searchPlaceholder: { control: 'text' },
    filters: { control: false },
    renderRow: { control: false },
    summary: { control: false },
  },
  args: { onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof TransferList>;

export const Default: Story = {
  render: (args) => {
    const [available, setAvailable] = useState<TransferItem[]>(PEOPLE.slice(0, 8));
    const [assigned, setAssigned] = useState<TransferItem[]>(PEOPLE.slice(8));
    return (
      <div className="ou-story-pad">
        <TransferList
          available={available}
          assigned={assigned}
          onChange={({ available: a, assigned: b }) => { setAvailable(a); setAssigned(b); args.onChange?.({ available: a, assigned: b }); }}
          leftTitle="Доступные сотрудники"
          rightTitle="Назначенные"
          filters={[
            { value: 'ОИТ', label: 'ОИТ' },
            { value: 'ДКП', label: 'ДКП' },
            { value: 'HR', label: 'HR' },
          ]}
          showSummary
        />
      </div>
    );
  },
};

/**
 * `fill` + `above`: the panes reach the bottom of a bounded box, and the row above them
 * lives in the same grid — the two fields line up with the panes edge to edge.
 */
export const FillWithAbove: Story = {
  render: (args) => {
    const [available, setAvailable] = useState<TransferItem[]>(PEOPLE.slice(0, 9));
    const [assigned, setAssigned] = useState<TransferItem[]>(PEOPLE.slice(9));
    return (
      <div className="ou-story-pad" style={{ height: 560, display: 'flex', flexDirection: 'column' }}>
        <TransferList
          fill
          available={available}
          assigned={assigned}
          onChange={({ available: a, assigned: b }) => { setAvailable(a); setAssigned(b); args.onChange?.({ available: a, assigned: b }); }}
          leftTitle="Пользователи"
          rightTitle="К назначению"
          above={{
            left: <Input type="date" label="Срок выполнения" fullWidth />,
            right: <Input type="date" label="Ссылка активна до" fullWidth />,
          }}
        />
      </div>
    );
  },
};
