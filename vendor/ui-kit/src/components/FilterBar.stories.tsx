import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { Input } from './Input';

const meta: Meta<typeof FilterBar> = {
  title: 'Data/FilterBar',
  component: FilterBar,
  tags: ['autodocs'],
  argTypes: {
    count: { control: 'number' },
    filterLabel: { control: 'text' },
    resetLabel: { control: 'text' },
    search: { control: false },
    applied: { control: false },
    savedSets: { control: false },
    actions: { control: false },
  },
  args: {
    search: <Input size="s" placeholder="Имя или идентификатор" />,
    count: 2,
    applied: [
      { id: 'state', label: 'состояние: работает' },
      { id: 'messenger', label: 'мессенджер: MAX' },
    ],
    onOpenFilter: fn(),
    onRemove: fn(),
    onReset: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Default: Story = {};

export const Empty: Story = { args: { count: 0, applied: [] } };

export const WithSavedSets: Story = {
  args: {
    savedSets: [
      { id: 'mine', name: 'Мои боты' },
      { id: 'broken', name: 'С проблемами', shared: true },
    ],
    activeSetId: 'broken',
    onApplySet: fn(),
    onSaveSet: fn(),
    onUpdateSet: fn(),
    onDeleteSet: fn(),
  },
};

export const SavedSetChanged: Story = {
  args: {
    savedSets: [{ id: 'broken', name: 'С проблемами' }],
    activeSetId: 'broken',
    dirty: true,
    onApplySet: fn(),
    onUpdateSet: fn(),
    onSaveSet: fn(),
  },
};

export const Live: Story = {
  render: (args) => {
    const [applied, setApplied] = useState([
      { id: 'state', label: 'состояние: запланирована' },
      { id: 'segment', label: 'сегмент: Новые' },
    ]);
    return (
      <FilterBar
        {...args}
        count={applied.length}
        applied={applied}
        onRemove={(id) => setApplied((rest) => rest.filter((item) => item.id !== id))}
        onReset={() => setApplied([])}
      />
    );
  },
};

export const NoSavedSets: Story = {
  args: {
    savedSets: [],
    count: 0,
    applied: [],
    onApplySet: fn(),
    onSaveSet: fn(),
  },
};

export const NothingSavedYetButFiltered: Story = {
  args: {
    savedSets: [],
    onApplySet: fn(),
    onSaveSet: fn(),
  },
};
