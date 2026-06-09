import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Slider } from './Slider';

const meta: Meta<typeof Slider> = {
  title: 'Inputs/Slider',
  component: Slider,
  tags: ['autodocs'],
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    tone: { control: 'select', options: ['accent', 'success', 'warning', 'error'] },
    range: { control: 'boolean' },
    disabled: { control: 'boolean' },
    min: { control: 'number' }, max: { control: 'number' }, step: { control: 'number' },
    label: { control: false },
    valueLabel: { control: false },
    formatValue: { control: false },
    marks: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Проходной балл',
    min: 0, max: 100, step: 1, defaultValue: 42,
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Slider>;

export const Single: Story = {
  render: (args) => {
    const [v, setV] = useState<number>(42);
    return <Slider {...args} value={v} onChange={(n) => { setV(n as number); args.onChange?.(n); }} />;
  },
};

export const Range: Story = {
  args: { range: true, defaultValue: [20, 75], label: 'Балл (от — до)' },
};

export const Marks: Story = { args: { marks: [0, 25, 50, 75, 100] } };
export const Success: Story = { args: { tone: 'success', defaultValue: 80 } };
export const Vertical: Story = {
  args: { orientation: 'vertical', defaultValue: 62, label: '' },
  render: (args) => <div className="ou-story-slider-vertical"><Slider {...args} /></div>,
};
