import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Tag } from './Tag';

const meta: Meta<typeof Tag> = {
  title: 'Data/Tag',
  component: Tag,
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'accent', 'success', 'warning', 'error', 'info'] },
    variant: { control: 'inline-radio', options: ['soft', 'solid', 'outline'] },
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    dot: { control: 'boolean' },
    icon: { control: false },
    onRemove: { control: false },
  },
  args: { children: 'Метка', tone: 'neutral', variant: 'soft', size: 'm', onRemove: fn() },
};
export default meta;
type Story = StoryObj<typeof Tag>;

export const Default: Story = {};
export const WithDot: Story = { args: { dot: true, tone: 'success', children: 'Опубликовано' } };
export const Removable: Story = { args: { children: 'Фильтр' } };

export const Tones: Story = {
  render: (args) => (
    <div className="ou-story-wrap">
      {(['neutral', 'accent', 'success', 'warning', 'error', 'info'] as const).map(t => (
        <Tag key={t} {...args} tone={t}>{t}</Tag>
      ))}
    </div>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <div className="ou-story-wrap">
      <Tag {...args} variant="soft" tone="accent">soft</Tag>
      <Tag {...args} variant="solid" tone="accent">solid</Tag>
      <Tag {...args} variant="outline" tone="accent">outline</Tag>
    </div>
  ),
};
