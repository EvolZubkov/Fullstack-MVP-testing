import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { IconButton } from './IconButton';

const Bell = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const meta: Meta<typeof IconButton> = {
  title: 'Inputs/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'destructive', 'outline'] },
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    round: { control: 'boolean' },
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
    icon: { control: false },
    badge: { control: false },
    onClick: { control: false },
  },
  args: {
    icon: <Bell />,
    'aria-label': 'Уведомления',
    variant: 'ghost',
    size: 'm',
    onClick: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {};
export const WithBadge: Story = { args: { badge: 7 } };
export const Active: Story = { args: { active: true } };

export const Variants: Story = {
  render: (args) => (
    <div className="ou-story-wrap">
      {(['primary', 'secondary', 'ghost', 'outline', 'destructive'] as const).map(v => (
        <IconButton key={v} {...args} variant={v} aria-label={v} />
      ))}
    </div>
  ),
};

