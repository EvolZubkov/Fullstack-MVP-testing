import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Avatar } from './Avatar';
import { Combobox, type ComboboxOption } from './Combobox';

const PEOPLE: ComboboxOption[] = [
  { value: 'e1', label: 'Мария Иванова', meta: 'ОИТ · Старший аналитик', group: 'Сотрудники',
    leading: <Avatar size="xs" initials="МИ" color="purple" /> },
  { value: 'e2', label: 'Михаил Конев', meta: 'ДКП · Тимлид', group: 'Сотрудники',
    leading: <Avatar size="xs" initials="МК" color="blue" /> },
  { value: 'e3', label: 'Лариса Воронина', meta: 'HR · Куратор', group: 'Сотрудники',
    leading: <Avatar size="xs" initials="ЛВ" color="green" /> },
  { value: 'g1', label: 'Группа «Иницииации 2025»', meta: '12 участников', group: 'Группы' },
];

const meta: Meta<typeof Combobox> = {
  title: 'Inputs/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    tone: { control: 'inline-radio', options: ['default', 'error'] },
    multiple: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
    highlightMatches: { control: 'boolean' },
    value: { control: false },
    values: { control: false },
    label: { control: false },
    hint: { control: false },
    error: { control: false },
    options: { control: false },
    footerAction: { control: false },
    footerHint: { control: false },
    renderChip: { control: false },
    emptyTitle: { control: 'text' },
    emptyMessage: { control: 'text' },
    onChange: { control: false },
    onValuesChange: { control: false },
    onQueryChange: { control: false },
  },
  args: {
    label: 'Слушатели',
    placeholder: 'Найти сотрудника…',
    options: PEOPLE,
    multiple: true,
    fullWidth: true,
    onValuesChange: fn(),
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Combobox>;

export const Multi: Story = {
  render: (args) => {
    const [vals, setVals] = useState<string[]>(['e1']);
    return <Combobox {...args} values={vals} onValuesChange={(v) => { setVals(v); args.onValuesChange?.(v); }} />;
  },
};

export const Single: Story = {
  render: (args) => {
    const [v, setV] = useState<string | null>(null);
    return <Combobox {...args} multiple={false} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Empty: Story = {
  args: { options: [], emptyTitle: 'Ничего не найдено', emptyMessage: 'Попробуйте другой запрос.' },
};

