import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Ranking, type RankingItem } from './Ranking';

const CD_STAGES: RankingItem[] = [
  { id: 's1', text: 'Сегментация рынка и гипотезы о клиентах',         secondary: 'Кто наш клиент и какую проблему мы решаем' },
  { id: 's2', text: 'Customer discovery — глубинные интервью',          secondary: '20–40 интервью, проверка проблемы' },
  { id: 's3', text: 'Customer validation — pre-sales и эксперименты',   secondary: 'LOI, предзаказы, MVP-эксперименты' },
  { id: 's4', text: 'Customer creation — масштабирование маркетинга',   secondary: 'Перевод спроса в выручку, performance-каналы' },
  { id: 's5', text: 'Company building — переход к процессной компании', secondary: 'Найм, отделы, операционная зрелость' },
];

const SHORT: RankingItem[] = [
  { id: 'a', text: 'Починить crash при логине' },
  { id: 'b', text: 'Редизайн карточки курса' },
  { id: 'c', text: 'Обновить иконки в навбаре' },
];

const meta: Meta<typeof Ranking> = {
  title: 'Data/Ranking',
  component: Ranking,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    chipShape:   { control: 'inline-radio', options: ['round', 'square', 'pill', 'plain'] },
    chipPalette: { control: 'inline-radio', options: ['neutral', 'accent', 'accent-solid', 'custom'] },
    icon:        { control: 'inline-radio', options: ['grip', 'dots', 'hand', 'arrows', 'none'] },
    iconSide:    { control: 'inline-radio', options: ['left', 'right'] },
    showNumbers: { control: 'boolean' },
    showControls:{ control: 'boolean' },
    locked:      { control: 'boolean' },
    chipColor:   { control: 'color' },
    items: { control: false },
    value: { control: false },
    defaultValue: { control: false },
    onChange: { control: false },
    correct: { control: false },
  },
};
export default meta;
type Story = StoryObj<typeof Ranking>;

export const Default: Story = {
  args: {
    items: CD_STAGES,
    showNumbers: true,
    showControls: true,
    chipShape: 'square',
    chipPalette: 'neutral',
    icon: 'grip',
    iconSide: 'left',
  },
  render: (args) => {
    const [order, setOrder] = useState<string[]>(CD_STAGES.map((i) => i.id));
    return (
      <div className="ou-story-max-720">
        <Ranking {...args} value={order} onChange={setOrder} />
        <p className="ou-story-note">
          Текущий порядок: <strong>{order.join(' → ')}</strong>
        </p>
      </div>
    );
  },
};

export const ShortList: Story = {
  args: {
    items: SHORT,
    chipShape: 'round',
    chipPalette: 'accent',
    icon: 'grip',
  },
  render: (args) => {
    const [order, setOrder] = useState(SHORT.map((i) => i.id));
    return (
      <div className="ou-story-max-480">
        <Ranking {...args} value={order} onChange={setOrder} />
      </div>
    );
  },
};

export const NoChip_NoButtons: Story = {
  name: 'Без чипа и кнопок',
  args: {
    items: CD_STAGES,
    showNumbers: false,
    showControls: false,
    icon: 'dots',
  },
  render: (args) => {
    const [order, setOrder] = useState(CD_STAGES.map((i) => i.id));
    return (
      <div className="ou-story-max-720">
        <Ranking {...args} value={order} onChange={setOrder} />
      </div>
    );
  },
};

export const CustomChipColor: Story = {
  name: 'Кастомный цвет чипа',
  args: {
    items: SHORT,
    chipShape: 'pill',
    chipPalette: 'custom',
    chipColor: '#D946EF',
    icon: 'arrows',
    iconSide: 'right',
  },
  render: (args) => {
    const [order, setOrder] = useState(SHORT.map((i) => i.id));
    return (
      <div className="ou-story-max-480">
        <Ranking {...args} value={order} onChange={setOrder} />
      </div>
    );
  },
};

export const LockedReview: Story = {
  name: 'Locked · после проверки',
  args: {
    items: [
      { id: 'p1', text: 'Исследование' },
      { id: 'p2', text: 'Discovery-воркшоп' },
      { id: 'p3', text: 'MVP-релиз' },
      { id: 'p4', text: 'Альфа-тестирование' },
      { id: 'p5', text: 'GA · публичный запуск' },
    ],
    // student answer: swapped p3 and p4 in the middle
    value:   ['p1', 'p2', 'p4', 'p3', 'p5'],
    correct: ['p1', 'p2', 'p3', 'p4', 'p5'],
    locked: true,
    chipShape: 'square',
  },
  render: (args) => (
    <div className="ou-story-max-720">
      <Ranking {...args} />
      <p className="ou-story-note">
        Чип показывает «правильную» позицию элемента — последовательность <strong>1, 2, 4, 3, 5</strong>
        сама подсказывает, какие элементы поменяны местами.
      </p>
    </div>
  ),
};
