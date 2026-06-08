import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { DatePicker, type DatePickerValue } from './DatePicker';

const meta: Meta<typeof DatePicker> = {
  title: 'Pickers/DatePicker',
  component: DatePicker,
  tags: ['autodocs'],
  argTypes: {
    mode: { control: 'inline-radio', options: ['single', 'range'] },
    disabled: { control: 'boolean' },
    label: { control: false },
    value: { control: false },
    defaultValue: { control: false },
    formatValue: { control: false },
    onChange: { control: false },
  },
  args: { label: 'Дата начала', placeholder: 'Выберите дату', mode: 'single', onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof DatePicker>;

export const Single: Story = {
  render: (args) => {
    const [v, setV] = useState<DatePickerValue>(null);
    return <DatePicker {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Range: Story = { args: { mode: 'range', label: 'Период обучения' } };
export const Preselected: Story = {
  args: { defaultValue: { y: 2026, m: 4, d: 26 } },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: { y: 2024, m: 0, d: 1 } } };

