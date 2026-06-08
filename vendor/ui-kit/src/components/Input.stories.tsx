import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Inputs/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    tone: { control: 'select', options: ['default', 'error', 'success'] },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    clearable: { control: 'boolean' },
    iconLeft: { control: false },
    iconRight: { control: false },
    prefix: { control: false },
    suffix: { control: false },
    onClear: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Название курса',
    placeholder: 'Введите название',
    size: 'm',
    onChange: fn(),
    onClear: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Покажем в каталоге и в письмах слушателям' } };
export const Error: Story = { args: { error: 'Минимум 3 символа', defaultValue: 'AB' } };
export const Success: Story = { args: { tone: 'success', defaultValue: 'Excel для аналитиков' } };
export const WithAffix: Story = { args: { prefix: '@', placeholder: 'username' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Нельзя редактировать' } };

export const Sizes: Story = {
  render: (args) => (
    <div className="ou-story-stack ou-story-max-320">
      <Input {...args} size="s" label="Small" />
      <Input {...args} size="m" label="Medium" />
      <Input {...args} size="l" label="Large" />
    </div>
  ),
};
