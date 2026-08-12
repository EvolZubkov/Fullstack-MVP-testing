import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { PageNav, type PageNavItem } from './PageNav';

const ITEMS: PageNavItem[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'modules', label: 'Модули', count: 12 },
  { id: 'audience', label: 'Слушатели', count: 142 },
  { id: 'analytics', label: 'Аналитика' },
];

const meta: Meta<typeof PageNav> = {
  title: 'Navigation/PageNav',
  component: PageNav,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'pills', 'underline', 'rail'] },
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    compact: { control: 'boolean' },
    items: { control: false },
    onChange: { control: false },
  },
  args: { items: ITEMS, value: 'modules', variant: 'pills', onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof PageNav>;

export const Pills: Story = {
  render: (args) => {
    const [v, setV] = useState<string>(args.value as string);
    return <PageNav {...args} value={v} onChange={(val, item) => { setV(val); args.onChange?.(val, item); }} />;
  },
};

export const Underline: Story = { ...Pills, args: { variant: 'underline' } };
export const Rail: Story = { ...Pills, args: { variant: 'rail', orientation: 'vertical' } };
export const VerticalGrouped: Story = {
  args: {
    orientation: 'vertical',
    variant: 'default',
    items: [
      { id: 'home', label: 'Главная', group: 'Основное' },
      { id: 'catalog', label: 'Каталог', group: 'Основное', count: 482 },
      { id: 'people', label: 'Люди', group: 'Управление' },
      { id: 'reports', label: 'Отчёты', group: 'Управление' },
    ],
  },
};
