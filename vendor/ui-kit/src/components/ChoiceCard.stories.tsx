import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import {
  ChoiceCard, ChoiceCardGroup, ChoiceCardInset,
} from './ChoiceCard';
import { Select } from './Select';

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);
const TrashIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10Z" />
  </svg>
);
const StarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
  </svg>
);

const meta: Meta<typeof ChoiceCard> = {
  title: 'Form/ChoiceCard',
  component: ChoiceCard,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Карточка-выбор: радио-кнопка, оформленная как полноширинная карточка с иконкой, заголовком, описанием и опциональным inset-блоком, раскрывающимся при выборе. Обычно используется в модалках уничтожающих действий, мастерах настройки и flow-выборе сценариев.',
      },
    },
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'destructive'] },
    disabled: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<typeof ChoiceCard>;

export const Basic: Story = {
  render: () => (
    <div className="ou-story-card-narrow">
      <ChoiceCardGroup name="basic" defaultValue="a">
        <ChoiceCard
          value="a"
          icon={<StarIcon />}
          title="Стандартный курс"
          description="Линейная последовательность модулей с итоговым тестом."
        />
        <ChoiceCard
          value="b"
          icon={<StarIcon />}
          title="Адаптивный курс"
          description="Содержание подбирается под уровень обучающегося."
        />
      </ChoiceCardGroup>
    </div>
  ),
};

export const WithDestructiveOption: Story = {
  render: () => {
    const [value, setValue] = useState('keep');
    return (
      <div className="ou-story-card-narrow">
        <ChoiceCardGroup
          name="folder-delete"
          value={value}
          onChange={setValue}
          legend="Что сделать с тестами при удалении папки?"
        >
          <ChoiceCard
            value="keep"
            icon={<FolderIcon />}
            title="Только папку"
            description="Тесты сохраняются и перемещаются в указанное место."
          >
            <ChoiceCardInset>
              <Select
                label="Переместить тесты в:"
                defaultValue="root"
                options={[
                  { value: 'root', label: 'Корень (Все тесты)' },
                  { value: 'onboarding', label: 'Онбординг' },
                  { value: 'safety', label: 'Охрана труда' },
                ]}
              />
            </ChoiceCardInset>
          </ChoiceCard>
          <ChoiceCard
            value="purge"
            tone="destructive"
            icon={<TrashIcon />}
            title="Папку и все тесты"
            description="2 теста будут удалены без возможности восстановления."
          />
        </ChoiceCardGroup>
        <div className="ou-story-row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" size="s">Отмена</Button>
          <Button variant={value === 'purge' ? 'destructive' : 'primary'} size="s">
            {value === 'purge' ? 'Удалить всё' : 'Удалить папку'}
          </Button>
        </div>
      </div>
    );
  },
};

export const StandaloneCheckedState: Story = {
  args: {
    value: 'sample',
    icon: <StarIcon />,
    title: 'Карточка без группы',
    description: 'Используется когда выбор управляется снаружи через checked и onChange.',
    checked: true,
    name: 'standalone',
  },
};

export const WithRadioIndicator: Story = {
  render: () => {
    const [value, setValue] = useState('a');
    return (
      <div className="ou-story-card-narrow">
        <ChoiceCardGroup name="radio-demo" value={value} onChange={setValue}>
          <ChoiceCard
            value="a"
            icon={<FolderIcon />}
            title="Только папку"
            description="Тесты сохраняются и перемещаются в указанное место."
            showRadio
          />
          <ChoiceCard
            value="b"
            tone="destructive"
            icon={<TrashIcon />}
            title="Папку и все тесты"
            description="2 теста будут удалены без возможности восстановления."
            showRadio
          />
        </ChoiceCardGroup>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="ou-story-card-narrow">
      <ChoiceCardGroup name="disabled-demo" defaultValue="a">
        <ChoiceCard
          value="a"
          icon={<StarIcon />}
          title="Доступный вариант"
          description="Можно выбрать."
        />
        <ChoiceCard
          value="b"
          disabled
          icon={<StarIcon />}
          title="Заблокированный вариант"
          description="Недоступен на текущем тарифе."
        />
      </ChoiceCardGroup>
    </div>
  ),
};
