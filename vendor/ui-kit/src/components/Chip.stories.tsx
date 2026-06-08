import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Chip } from './Chip';

const meta: Meta<typeof Chip> = {
  title: 'Data/Chip',
  component: Chip,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 's', 'm', 'l'] },
    selected: { control: 'boolean' },
    solid: { control: 'boolean' },
    disabled: { control: 'boolean' },
    icon: { control: false },
    avatar: { control: false },
    count: { control: false },
    onChange: { control: false },
    onRemove: { control: false },
    children: { control: 'text' },
  },
  args: { children: 'Финансы', size: 'm', onChange: fn(), onRemove: fn() },
};
export default meta;
type Story = StoryObj<typeof Chip>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const WithCount: Story = { args: { count: 12 } };
export const Removable: Story = { args: { children: 'Аналитика' } };

export const Filterbar: Story = {
  render: () => {
    const items = ['Все', 'Аналитика', 'Менеджмент', 'Финансы', 'Лидерство'];
    const [active, setActive] = useState('Все');
    return (
      <div className="ou-story-wrap-tight">
        {items.map(it => (
          <Chip key={it} selected={active === it} onChange={() => setActive(it)}>{it}</Chip>
        ))}
      </div>
    );
  },
};
