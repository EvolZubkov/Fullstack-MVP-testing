import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Select } from './Select';

const OPTIONS = [
  { value: 'biz', label: 'Бизнес-навыки' },
  { value: 'b2c', label: 'B2C' },
  { value: 'b2b', label: 'B2B' },
  { value: 'b2o', label: 'B2O' },
  { value: 'digital', label: 'Цифровые навыки' },
  { value: 'bti', label: 'БТИ (скоро)', disabled: true },
  { value: 'lead', label: 'Лидерские программы' },
];

const meta: Meta<typeof Select> = {
  title: 'Inputs/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    tone: { control: 'inline-radio', options: ['default', 'error'] },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: false },
    hint: { control: false },
    error: { control: false },
    options: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Направление',
    placeholder: 'Выберите…',
    options: OPTIONS,
    size: 'm',
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: (args) => {
    const [v, setV] = useState<string | undefined>();
    return <Select {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Preselected: Story = { args: { defaultValue: 'digital' } };
export const Error: Story = { args: { error: 'Выберите направление' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'biz' } };

