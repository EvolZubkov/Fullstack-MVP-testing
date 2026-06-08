import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Checkbox } from './Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Inputs/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    label: { control: 'text' },
    description: { control: 'text' },
    descriptionVariant: { control: 'inline-radio', options: [undefined, 'error'] },
    indeterminate: { control: 'boolean' },
    invalid: { control: 'boolean' },
    card: { control: 'boolean' },
    disabled: { control: 'boolean' },
    onChange: { control: false },
  },
  args: { label: 'Отправлять отчёт по понедельникам', size: 'm', onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {};
export const WithDescription: Story = { args: { label: 'Уведомления', description: 'Уведомления о новых сотрудниках в группе' } };
export const Indeterminate: Story = { args: { indeterminate: true, label: 'Выбрать всё' } };
export const Card: Story = { args: { card: true, label: 'Опубликовать сразу', description: '142 сотрудника получат письмо' } };

export const States: Story = {
  render: (args) => {
    const [a, setA] = useState(false);
    return (
      <div className="ou-story-stack">
        <Checkbox {...args} label="Обычный" />
        <Checkbox {...args} label="Выбран" defaultChecked />
        <Checkbox {...args} label="Контролируемый" checked={a} onChange={e => { setA(e.target.checked); args.onChange?.(e); }} />
        <Checkbox {...args} label="Невалидный" invalid description="Поле обязательное" descriptionVariant="error" />
        <Checkbox {...args} label="Заблокирован" disabled defaultChecked />
      </div>
    );
  },
};
