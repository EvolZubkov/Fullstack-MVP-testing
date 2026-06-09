import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { WizardSteps, type WizardStep } from './WizardSteps';

const STEPS: WizardStep[] = [
  {
    id: 'basic', title: 'Основное', description: 'Название и описание',
    heading: 'Основная информация',
    bodyDescription: 'Как курс будет отображаться слушателям',
    content: <p>Здесь форма основной информации</p>,
  },
  {
    id: 'program', title: 'Программа', description: 'Модули и материалы',
    heading: 'Программа курса',
    content: <p>Список модулей</p>,
  },
  {
    id: 'audience', title: 'Слушатели', description: 'Кто будет учиться',
    heading: 'Назначение слушателей',
    content: <p>TransferList или Combobox</p>,
  },
];

const meta: Meta<typeof WizardSteps> = {
  title: 'Navigation/WizardSteps',
  component: WizardSteps,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    horizontal: { control: 'boolean' },
    narrow: { control: 'boolean' },
    steps: { control: false },
    onChange: { control: false },
    statuses: { control: false },
    footer: { control: false },
    onBack: { control: false },
    onNext: { control: false },
    onFinish: { control: false },
    backLabel: { control: false },
    nextLabel: { control: false },
    finishLabel: { control: false },
  },
  args: { onChange: fn(), onBack: fn(), onNext: fn(), onFinish: fn() },
};
export default meta;
type Story = StoryObj<typeof WizardSteps>;

export const Vertical: Story = {
  render: (args) => {
    const [cur, setCur] = useState<string>('program');
    return <div className="ou-story-pad"><WizardSteps steps={STEPS} current={cur} onChange={(id, idx) => { setCur(id); args.onChange?.(id, idx); }} /></div>;
  },
};

export const Horizontal: Story = {
  render: () => (
    <div className="ou-story-pad">
      <WizardSteps steps={STEPS} defaultCurrent="basic" horizontal />
    </div>
  ),
};
