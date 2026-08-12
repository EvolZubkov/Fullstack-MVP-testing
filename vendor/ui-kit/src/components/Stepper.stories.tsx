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
    choice: { control: 'boolean' },
    review: { control: 'boolean' },
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

// ─── Choice mode: the stepper as an ordered answer scale (Likert) ─────────────

const SCALE = [
  { id: 'never', title: 'Никогда' },
  { id: 'very-rarely', title: 'Очень редко' },
  { id: 'rarely', title: 'Редко' },
  { id: 'often', title: 'Часто' },
  { id: 'very-often', title: 'Очень часто' },
  { id: 'always', title: 'Постоянно' },
];

/** Answer scale: the picked graduation is `current`, everything before it `done`. */
export const Choice: Story = {
  args: { steps: SCALE, current: 2, choice: true, onStepClick: () => {} },
};

/** Verdict, right answer: the picked graduation is the correct one. */
export const ChoiceVerdictRight: Story = {
  args: {
    steps: SCALE, current: 2, choice: true, review: true,
    statuses: { rarely: 'success' },
  },
};

/** Verdict, wrong answer: picked `rarely`, the key is `often`. */
export const ChoiceVerdictWrong: Story = {
  args: {
    steps: SCALE, current: 2, choice: true, review: true,
    statuses: { rarely: 'error', often: 'success' },
  },
};

/** Narrow layout: the same markup with the base vertical modifier. */
export const ChoiceVertical: Story = {
  args: { steps: SCALE, current: 2, choice: true, vertical: true, onStepClick: () => {} },
};

