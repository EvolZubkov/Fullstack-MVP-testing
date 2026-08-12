import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { BudgetAllocation, type BudgetAllocationItem } from './BudgetAllocation';

const meta: Meta<typeof BudgetAllocation> = {
  title: 'Inputs/BudgetAllocation',
  component: BudgetAllocation,
  tags: ['autodocs'],
  argTypes: {
    items: { control: false },
    value: { control: false },
    onChange: { control: false },
    renderCounter: { control: false },
    budget: { control: 'number' },
    minPerOption: { control: 'number' },
    maxPerOption: { control: 'number' },
    readOnly: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Учащийся делит фиксированный бюджет между утверждениями, и сумма обязана сойтись ровно. ' +
          'Доступный максимум каждой строки зависит от значений соседних строк, поэтому это одна группа, ' +
          'а не два примитива рядом: превышение бюджета невозможно по построению, а не отклоняется после ввода.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof BudgetAllocation>;

const ITEMS: BudgetAllocationItem[] = [
  { label: 'Разберу вместе с ним первую рабочую задачу' },
  { label: 'Познакомлю с командой и объясню, к кому идти с чем' },
  { label: 'Дам чёткий регламент и сроки на первый месяц' },
  { label: 'Расскажу, ради чего мы это делаем' },
];

/** Живая обёртка: компонент контролируемый, состояние держит история. */
function Live({ start, ...props }: { start: number[] } & Omit<React.ComponentProps<typeof BudgetAllocation>, 'value' | 'onChange'>) {
  const [value, setValue] = useState(start);
  return <BudgetAllocation {...props} value={value} onChange={setValue} />;
}

export const Empty: Story = {
  name: 'Нетронутый',
  render: () => <Live start={[0, 0, 0, 0]} items={ITEMS} budget={7} />,
};

export const Partial: Story = {
  name: 'Частично распределён',
  render: () => <Live start={[3, 1, 0, 0]} items={ITEMS} budget={7} />,
};

export const Complete: Story = {
  name: 'Весь бюджет распределён',
  render: () => <Live start={[3, 1, 1, 2]} items={ITEMS} budget={7} />,
};

export const WithFloor: Story = {
  name: 'Ненулевой минимум на вариант',
  parameters: {
    docs: {
      description: {
        story:
          'Минимум обеспечивается предзаполнением, а не запретом: иначе учащийся распределит весь бюджет ' +
          'и застрянет с нулевым утверждением, которое уже нечем поднять. Подсветка «выше минимума» ' +
          'поэтому не отмечает предзаполненные строки.',
      },
    },
  },
  render: () => <Live start={[1, 1, 1, 1]} items={ITEMS} budget={7} minPerOption={1} />,
};

export const CappedOption: Story = {
  name: 'Максимум на вариант ниже бюджета',
  render: () => <Live start={[2, 2, 1, 0]} items={ITEMS} budget={7} maxPerOption={3} />,
};

export const ReadOnly: Story = {
  name: 'Только чтение (обзор ответов)',
  parameters: {
    docs: {
      description: {
        story: 'Разметки верности нет и быть не может: правильного распределения у типа не существует.',
      },
    },
  },
  render: () => <BudgetAllocation items={ITEMS} value={[3, 1, 1, 2]} budget={7} readOnly />,
};
