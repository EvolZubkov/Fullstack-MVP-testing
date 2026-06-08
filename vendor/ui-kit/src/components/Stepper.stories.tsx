import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper } from './Stepper';

const STEPS = [
  { id: 'basic', title: 'Основное', description: 'Название, slug, описание' },
  { id: 'program', title: 'Программа', description: 'Модули и материалы' },
  { id: 'audience', title: 'Слушатели', description: 'Кто будет учиться' },
  { id: 'publish', title: 'Публикация' },
];

const meta: Meta<typeof Stepper> = {
  title: 'Navigation/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  argTypes: {
    current: { control: 'number' },
    vertical: { control: 'boolean' },
    compact: { control: 'boolean' },
    steps: { control: false },
    statuses: { control: false },
    onStepClick: { control: false },
  },
  args: { steps: STEPS, current: 1 },
};
export default meta;
type Story = StoryObj<typeof Stepper>;

export const Horizontal: Story = {};
export const Vertical: Story = { args: { vertical: true } };
export const Compact: Story = { args: { compact: true } };
export const WithError: Story = {
  args: { current: 2, statuses: { audience: 'error' } },
};

