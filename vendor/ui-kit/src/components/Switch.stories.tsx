import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Switch } from './Switch';

const meta: Meta<typeof Switch> = {
  title: 'Inputs/Switch',
  component: Switch,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    disabled: { control: 'boolean' },
    label: { control: false },
    description: { control: false },
    onChange: { control: false },
  },
  args: { label: 'Email-уведомления', size: 'm', onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const WithDescription: Story = {
  args: { label: 'Бета-функции', description: 'Получать доступ к экспериментальным возможностям', defaultChecked: true },
};
export const Sizes: Story = {
  render: (args) => (
      <div className="ou-story-stack">
        <Switch {...args} size="s" label="Small" />
        <Switch {...args} size="m" label="Medium" />
        <Switch {...args} size="l" label="Large" />
      </div>
  ),
};
