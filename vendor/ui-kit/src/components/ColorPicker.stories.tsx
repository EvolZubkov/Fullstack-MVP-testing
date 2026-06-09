import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { ColorPicker } from './ColorPicker';

const meta: Meta<typeof ColorPicker> = {
  title: 'Pickers/ColorPicker',
  component: ColorPicker,
  tags: ['autodocs'],
  argTypes: {
    value: { control: false },
    iconOnly: { control: 'boolean' },
    allowTransparent: { control: 'boolean' },
    disabled: { control: 'boolean' },
    valueLabel: { control: false },
    baseColors: { control: false },
    customStorageKey: { control: false },
    onChange: { control: false },
  },
  args: { value: '#7700FF', onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof ColorPicker>;

export const Default: Story = {
  render: (args) => {
    const [c, setC] = useState<string>(args.value);
    return <ColorPicker {...args} value={c} onChange={(v) => { setC(v); args.onChange?.(v); }} />;
  },
};

export const IconOnly: Story = { args: { iconOnly: true } };
export const WithTransparent: Story = { args: { allowTransparent: true, value: 'transparent' } };

