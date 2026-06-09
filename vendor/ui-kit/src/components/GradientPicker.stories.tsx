import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { cn, cssStyleClass } from '../utils';
import {
  GradientPicker, buildGradientCss, makeDefaultGradientState, type GradientState,
} from './GradientPicker';

const meta: Meta<typeof GradientPicker> = {
  title: 'Pickers/GradientPicker',
  component: GradientPicker,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    value: { control: false },
    hideFooter: { control: 'boolean' },
    title: { control: false },
    label: { control: false },
    onApply: { control: false },
    onCancel: { control: false },
    onChange: { control: false },
  },
  args: { onApply: fn(), onCancel: fn() },
};
export default meta;
type Story = StoryObj<typeof GradientPicker>;

export const Default: Story = {
  render: (args) => {
    const [applied, setApplied] = useState<GradientState>(makeDefaultGradientState());
    return (
      <div className="ou-story-row-lg ou-story-align-start">
        <GradientPicker
          value={applied}
          title="Область"
          label="Подложка"
          onApply={(v) => { setApplied(v); args.onApply?.(v); }}
          onCancel={() => args.onCancel?.()}
        />
        <div
          className={cn(
            'ou-story-gradient-preview',
            cssStyleClass({ background: buildGradientCss(applied) }, 'ou-story-gradient'),
          )}
        />
      </div>
    );
  },
};
