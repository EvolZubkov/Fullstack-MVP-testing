import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { TimePicker, type TimePickerValue } from './TimePicker';

const meta: Meta<typeof TimePicker> = {
  title: 'Pickers/TimePicker',
  component: TimePicker,
  tags: ['autodocs'],
  argTypes: {
    step: { control: 'select', options: [1, 5, 10, 15, 30] },
    hour12: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: false },
    onChange: { control: false },
    presets: { control: false },
    value: { control: false },
    defaultValue: { control: false },
  },
  args: { label: 'Время дедлайна', step: 15, onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof TimePicker>;

export const Default: Story = {
  render: (args) => {
    const [v, setV] = useState<TimePickerValue | null>(null);
    return <TimePicker {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Preset: Story = {
  args: {
    label: 'Начало вебинара',
    step: 5,
    defaultValue: { hours: 14, minutes: 30 },
    presets: ['09:00', '12:00', '14:30', '18:00'],
  },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: { hours: 9, minutes: 0 } } };

