import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Calendar } from './Calendar';

const meta: Meta<typeof Calendar> = {
  title: 'Pickers/Calendar',
  component: Calendar,
  tags: ['autodocs'],
  argTypes: {
    mode: { control: 'inline-radio', options: ['single', 'range'] },
    view: { control: 'inline-radio', options: ['days', 'months', 'years'] },
    presets: { control: 'boolean' },
    value: { control: false },
    defaultValue: { control: false },
    onChange: { control: false },
    today: { control: false },
    customPresets: { control: false },
    onApply: { control: false },
    onReset: { control: false },
  },
  args: { mode: 'single', view: 'days', presets: true, onChange: fn(), onApply: fn(), onReset: fn() },
  decorators: [
    (Story) => (
      <div className="ou-story-align-start ou-story-row">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Calendar>;

export const Single: Story = {};
export const Range: Story = {
  args: {
    mode: 'range',
    defaultValue: [{ y: 2026, m: 4, d: 12 }, { y: 2026, m: 4, d: 26 }],
  },
};
export const Months: Story = { args: { view: 'months' } };
export const Years: Story = { args: { view: 'years' } };
