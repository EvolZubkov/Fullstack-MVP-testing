import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Radio, RadioGroup } from './Radio';

const meta: Meta<typeof RadioGroup> = {
  title: 'Inputs/Radio',
  component: RadioGroup,
  tags: ['autodocs'],
  argTypes: {
    layout: { control: 'inline-radio', options: ['column', 'row'] },
    options: { control: false },
    onChange: { control: false },
    legend: { control: false },
    hint: { control: false },
  },
  args: {
    layout: 'column',
    onChange: fn(),
    options: [
      { value: 'all', label: 'Все сотрудники', description: 'Любой увидит курс в каталоге' },
      { value: 'depts', label: 'Конкретные подразделения' },
      { value: 'invite', label: 'Только по приглашению' },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof RadioGroup>;

export const Group: Story = {
  render: (args) => {
    const [val, setVal] = useState<string>('all');
    return <RadioGroup {...args} value={val} onChange={(v) => { setVal(v); args.onChange?.(v); }} />;
  },
};

export const Row: Story = {
  render: (args) => {
    const [val, setVal] = useState<string>('all');
    return <RadioGroup {...args} layout="row" value={val} onChange={(v) => { setVal(v); args.onChange?.(v); }} />;
  },
};

export const Single: Story = {
  render: () => <Radio label="Я согласен" description="С условиями использования" />,
};

