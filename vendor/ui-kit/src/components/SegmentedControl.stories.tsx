import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl';

const meta: Meta<typeof SegmentedControl> = {
  title: 'Inputs/SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    variant: { control: 'inline-radio', options: ['default', 'accent'] },
    stretch: { control: 'boolean' },
    iconOnly: { control: 'boolean' },
    items: { control: false },
    onChange: { control: false },
  },
  args: {
    items: [
      { value: 'day', label: 'День' },
      { value: 'week', label: 'Неделя' },
      { value: 'month', label: 'Месяц' },
    ],
    size: 'm',
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof SegmentedControl>;

export const Default: Story = {
  render: (args) => {
    const [v, setV] = useState<string>('week');
    return <SegmentedControl {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Accent: Story = { args: { variant: 'accent', defaultValue: 'week' } };
export const Stretch: Story = { args: { stretch: true, defaultValue: 'week' } };
export const WithBadges: Story = {
  args: {
    items: [
      { value: 'all', label: 'Все', badge: 124 },
      { value: 'mine', label: 'Мои', badge: 12 },
      { value: 'drafts', label: 'Черновики', badge: 2 },
    ],
    defaultValue: 'mine',
  },
};

