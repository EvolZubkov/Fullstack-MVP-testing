import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { SearchField } from './SearchField';

const meta: Meta<typeof SearchField> = {
  title: 'Forms/SearchField',
  component: SearchField,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    scope: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    clearable: { control: 'boolean' },
  },
  args: { scope: 'ботам', onChange: fn(), onClear: fn() },
};
export default meta;
type Story = StoryObj<typeof SearchField>;

export const Default: Story = {};

export const WithOwnPlaceholder: Story = {
  args: { scope: undefined, placeholder: 'Имя или идентификатор' },
};

export const Medium: Story = { args: { size: 'm', scope: 'журналу' } };

export const Live: Story = {
  render: (args) => {
    const [value, setValue] = useState('welcome');
    return (
      <SearchField
        {...args}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onClear={() => setValue('')}
      />
    );
  },
};
