import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { NumberInput } from './NumberInput';

const meta: Meta<typeof NumberInput> = {
  title: 'Inputs/NumberInput',
  component: NumberInput,
  tags: ['autodocs'],
  argTypes: {
    layout: { control: 'inline-radio', options: ['split', 'right', 'inline'] },
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    pill: { control: 'boolean' },
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: false },
    hint: { control: false },
    error: { control: false },
    suffix: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Часы в неделю', value: 8, min: 0, max: 40, step: 1, size: 'm', layout: 'split', suffix: 'ч',
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Split: Story = {
  render: (args) => {
    const [v, setV] = useState<number>(args.value as number);
    return <NumberInput {...args} value={v} onChange={(n) => { setV(n); args.onChange?.(n); }} />;
  },
};

export const Right: Story = { args: { layout: 'right', suffix: '%', value: 80, max: 100 } };
export const Inline: Story = { args: { layout: 'inline', value: 3, max: 10 } };
export const Pill: Story = { args: { pill: true, value: 1, max: 99 } };
export const AtMin: Story = { args: { value: 0 } };
export const Invalid: Story = { args: { value: 120, error: 'Не больше 100%' } };

