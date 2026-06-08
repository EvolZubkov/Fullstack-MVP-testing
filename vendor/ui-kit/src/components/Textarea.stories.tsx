import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Textarea } from './Textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Inputs/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    tone: { control: 'select', options: ['default', 'error', 'warn'] },
    showCount: { control: 'select', options: [false, 'footer', 'outside'] },
    fullWidth: { control: 'boolean' },
    autosize: { control: 'boolean' },
    required: { control: 'boolean' },
    optional: { control: 'boolean' },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    label: { control: false },
    hint: { control: false },
    error: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Описание модуля',
    placeholder: 'Опишите, что слушатель освоит за модуль',
    fullWidth: true,
    rows: 4,
    maxLength: 280,
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};
export const WithCounter: Story = { args: { showCount: 'footer' } };
export const Error: Story = { args: { error: 'Минимум 60 символов', defaultValue: 'Курс' } };
export const Required: Story = { args: { required: true, hint: 'Покажем на карточке курса' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Этот текст недоступен для редактирования' } };

