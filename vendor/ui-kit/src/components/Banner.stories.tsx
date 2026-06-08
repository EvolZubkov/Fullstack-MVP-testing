import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Banner } from './Banner';

const meta: Meta<typeof Banner> = {
  title: 'Feedback/Banner',
  component: Banner,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['subtle', 'outline', 'bar', 'solid'] },
    tone: { control: 'select', options: ['success', 'error', 'warning', 'info', 'neutral'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    stacked: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    icon: { control: false },
    title: { control: 'text' },
    description: { control: 'text' },
    actions: { control: false },
    onClose: { control: false },
    children: { control: false },
  },
  args: {
    variant: 'subtle', tone: 'info',
    title: 'Дедлайн через 3 дня',
    description: '17 сотрудников ещё не приступили к курсу. Можно отправить напоминание.',
    actions: [{ label: 'Напомнить' }],
    onClose: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Banner>;

export const Default: Story = {};
export const Outline: Story = { args: { variant: 'outline' } };
export const Bar: Story = { args: { variant: 'bar', tone: 'warning' } };
export const Solid: Story = { args: { variant: 'solid', tone: 'error' } };
export const Dismissible: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="ou-story-stack ou-story-max-720">
      {(['success', 'error', 'warning', 'info', 'neutral'] as const).map(t => (
        <Banner key={t} {...args} tone={t} title={t} />
      ))}
    </div>
  ),
};
