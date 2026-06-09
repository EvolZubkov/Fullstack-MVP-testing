import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Tree, type TreeNodeData } from './Tree';

const NODES: TreeNodeData[] = [
  {
    id: 'biz', label: 'Бизнес-программы', folder: true, defaultExpanded: true,
    children: [
      { id: 'pdm', label: 'Управление продуктом для PdM-2', meta: '12 мод.' },
      { id: 'pmo', label: 'PMO-академия', meta: '8 мод.' },
      {
        id: 'lead', label: 'Лидерство', folder: true,
        children: [
          { id: 'l1', label: 'Лидерство 101' },
          { id: 'l2', label: 'Стратегия команды' },
        ],
      },
    ],
  },
  {
    id: 'digital', label: 'Цифровые навыки', folder: true,
    children: [
      { id: 'sql', label: 'SQL с нуля' },
      { id: 'py', label: 'Python для аналитики' },
    ],
  },
];

const meta: Meta<typeof Tree> = {
  title: 'Data/Tree',
  component: Tree,
  tags: ['autodocs'],
  argTypes: {
    density: { control: 'inline-radio', options: ['compact', 'normal', 'comfy'] },
    guides: { control: 'boolean' },
    bordered: { control: 'boolean' },
    checkable: { control: 'boolean' },
    nodes: { control: false },
    expandedKeys: { control: false },
    defaultExpandedKeys: { control: false },
    onExpandChange: { control: false },
    selectedKey: { control: false },
    defaultSelectedKey: { control: false },
    onSelectChange: { control: false },
    checkedKeys: { control: false },
    defaultCheckedKeys: { control: false },
    onCheckChange: { control: false },
    renderRow: { control: false },
  },
  args: { nodes: NODES, density: 'normal', guides: true, bordered: true, onCheckChange: fn() },
};
export default meta;
type Story = StoryObj<typeof Tree>;

export const Default: Story = {};

export const Checkable: Story = {
  args: { checkable: true },
  render: (args) => {
    const [checked, setChecked] = useState<string[]>(['pmo']);
    return <Tree {...args} checkedKeys={checked} onCheckChange={(keys) => { setChecked(keys); args.onCheckChange?.(keys); }} />;
  },
};

export const Compact: Story = { args: { density: 'compact' } };

