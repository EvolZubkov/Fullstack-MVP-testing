import type { Meta, StoryObj } from '@storybook/react-vite';
import { QuizMap, QuizSummary, type QuizDotState } from './QuizMap';

const meta: Meta<typeof QuizMap> = {
  title: 'Feedback/QuizMap',
  component: QuizMap,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    shape:       { control: 'inline-radio', options: ['circle', 'square', 'pill'] },
    size:        { control: 'inline-radio', options: ['xs', 's', 'm', 'l'] },
    hideNumbers: { control: 'boolean' },
    states: { control: false },
    label: { control: false },
    valueLabel: { control: false },
    legend: { control: false },
    sections: { control: false },
    onDotClick: { control: false },
  },
  args: {
    shape: 'circle', size: 'm',
    label: 'Тест · 12 вопросов',
    valueLabel: <><strong>5</strong> из 12</>,
    states: ['answered','answered','answered','answered','answered','current',
             '','','','','',''] as QuizDotState[],
  },
};
export default meta;
type Story = StoryObj<typeof QuizMap>;

/** Базовый режим прохождения — кружки M, легенда. */
export const InProgress: Story = {
  name: 'Прохождение · базовый',
  args: {
    label: 'Кружки · 20 вопросов',
    valueLabel: <><strong>7</strong> из 20 · текущий 8 · помечено 2</>,
    states: [
      'answered','answered','answered','answered','flagged',
      'answered','answered','current','','',
      'flagged','','','','','','','','','',
    ] as QuizDotState[],
    legend: [
      { state: 'answered',  label: <>Отвечено · <strong>7</strong></> },
      { state: 'current',   label: 'Текущий' },
      { state: '',          label: <>Без ответа · <strong>12</strong></> },
      { state: 'flagged',   label: <>Помечено к возврату · <strong>2</strong></> },
    ],
  },
};

/** Три формы: кружок / квадрат / pill — в одном блоке. */
export const Shapes: Story = {
  name: 'Формы · circle / square / pill',
  render: () => (
    <div className="ou-story-quiz-card">
      <QuizMap
        shape="circle" size="m"
        label="Кружки · 20 вопросов"
        valueLabel={<><strong>7</strong> из 20</>}
        states={[
          'answered','answered','answered','answered','flagged',
          'answered','answered','current','','',
          'flagged','','','','','','','','','',
        ] as QuizDotState[]}
        legend={[
          { state: 'answered', label: <>Отвечено · <strong>7</strong></> },
          { state: 'current',  label: 'Текущий' },
          { state: '',         label: <>Без ответа · <strong>12</strong></> },
          { state: 'flagged',  label: <>Помечено · <strong>2</strong></> },
        ]}
      />
      <QuizMap
        shape="square" size="m"
        label="Квадраты с закруглением · 12 вопросов"
        valueLabel={<><strong>3</strong> из 12</>}
        states={['answered','answered','answered','current','','','','','','','',''] as QuizDotState[]}
      />
      <QuizMap
        shape="pill" size="m"
        label="Pill · 8 вопросов · короткие тесты"
        valueLabel={<><strong>5</strong> из 8</>}
        states={['answered','answered','answered','answered','answered','current','',''] as QuizDotState[]}
      />
    </div>
  ),
};

/** Без номеров — обзорный режим для всех форм + разбор. */
export const HideNumbers: Story = {
  name: 'Без номеров · обзорный режим',
  render: () => {
    const inProgress20: QuizDotState[] = [
      'answered','answered','answered','answered','answered','answered','answered',
      'current','','','','','','','','','','','','',
    ];
    const review20: QuizDotState[] = [
      'correct','correct','correct','incorrect','correct','partial',
      'correct','correct','correct','incorrect','correct','correct',
      'correct','correct','partial','correct','correct','correct','incorrect','correct',
    ];
    return (
      <div className="ou-story-quiz-card">
        <QuizMap shape="circle" size="m" hideNumbers
          label="Кружки · режим прохождения"
          valueLabel={<><strong>7</strong>/20</>}
          states={inProgress20}
        />
        <QuizMap shape="square" size="m" hideNumbers
          label="Квадраты · режим прохождения"
          valueLabel={<><strong>7</strong>/20</>}
          states={inProgress20}
        />
        <QuizMap shape="pill" size="m" hideNumbers
          dotsColumns={20} dotsColumnsFill
          label="Pills · сегментная полоса"
          valueLabel={<><strong>7</strong>/20</>}
          states={inProgress20}
        />
        <QuizMap shape="square" size="m" hideNumbers
          label="Квадраты · разбор после теста"
          valueLabel={<><strong>14</strong>/20 правильных · 70%</>}
          states={review20}
        />
      </div>
    );
  },
};

/** Мгновенная проверка — correct / incorrect / partial во время теста. */
export const InstantCheck: Story = {
  name: 'Мгновенная проверка · обучающий режим',
  render: () => {
    const adaptive: QuizDotState[] = [
      'correct','correct','incorrect','correct','partial',
      'correct','correct','incorrect','current','','','','',
    ];
    return (
      <div className="ou-story-quiz-card">
        <QuizMap
          shape="circle" size="m"
          label="Адаптивный тренажёр · 20 вопросов · текущий 9"
          valueLabel={
            <><strong>5</strong> верных · <strong>1</strong> частично · <strong>2</strong> неверно · осталось 11</>
          }
          states={[
            'correct','correct','incorrect','correct','partial',
            'correct','correct','incorrect','current','','','','','','','','','','','',
          ] as QuizDotState[]}
          legend={[
            { state: 'correct',   label: <>Верно · <strong>5</strong></> },
            { state: 'partial',   label: <>Частично · <strong>1</strong></> },
            { state: 'incorrect', label: <>Неверно · <strong>2</strong></> },
            { state: 'current',   label: 'Текущий' },
            { state: '',          label: <>Без ответа · <strong>11</strong></> },
          ]}
        />
        <QuizMap shape="square" size="m" hideNumbers
          label="Квадраты без номеров · обзорный"
          valueLabel={<><strong>5</strong>/8 правильных по ходу</>}
          states={adaptive}
        />
        <QuizMap shape="circle" size="m" hideNumbers
          label="Кружки без номеров · обзорный"
          valueLabel={<><strong>5</strong>/8 правильных по ходу</>}
          states={adaptive}
        />
        <QuizMap shape="pill" size="m" hideNumbers
          dotsColumns={13} dotsColumnsFill
          label="Pills без номеров · сегментная полоса"
          valueLabel={<><strong>5</strong>/8 правильных по ходу</>}
          states={adaptive}
        />
      </div>
    );
  },
};

/** Четыре размера: XS (40 вопросов) / S / M / L. */
export const Sizes: Story = {
  name: 'Размеры XS · S · M · L',
  render: () => (
    <div className="ou-story-quiz-card">
      <QuizMap shape="circle" size="xs" hideNumbers
        label="XS · без номеров · 40 вопросов"
        valueLabel={<><strong>25</strong>/40</>}
        states={[
          ...Array<QuizDotState>(25).fill('answered'),
          'current',
          ...Array<QuizDotState>(14).fill(''),
        ]}
      />
      <QuizMap shape="circle" size="s" hideNumbers
        label="S · номера скрыты"
        valueLabel={<><strong>15</strong>/20</>}
        states={[
          ...Array<QuizDotState>(15).fill('answered'),
          'current',
          ...Array<QuizDotState>(4).fill(''),
        ]}
      />
      <QuizMap shape="circle" size="m"
        label="M · базовый размер"
        valueLabel={<><strong>5</strong>/12</>}
        states={[
          ...Array<QuizDotState>(5).fill('answered'),
          'current',
          ...Array<QuizDotState>(6).fill(''),
        ]}
      />
      <QuizMap shape="circle" size="l"
        label="L · если карта — главный навигатор"
        valueLabel={<><strong>3</strong>/8</>}
        states={[
          ...Array<QuizDotState>(3).fill('answered'),
          'current',
          ...Array<QuizDotState>(4).fill(''),
        ]}
      />
    </div>
  ),
};

/** Итоговый разбор после теста — correct / incorrect / partial + легенда. */
export const ReviewAfterTest: Story = {
  name: 'Разбор после теста',
  args: {
    shape: 'square', size: 'm',
    label: 'Информационная безопасность · итоговый тест',
    valueLabel: <><strong>14</strong> правильных из 20 · 70%</>,
    states: [
      'correct','correct','correct','incorrect','correct','partial',
      'correct','correct','correct','incorrect','correct','correct',
      'correct','correct','partial','correct','correct','correct','incorrect','correct',
    ] as QuizDotState[],
    legend: [
      { state: 'correct',   label: <>Верно · <strong>14</strong></> },
      { state: 'partial',   label: <>Частично · <strong>2</strong></> },
      { state: 'incorrect', label: <>Неверно · <strong>3</strong></> },
      { state: '',          label: <>Без ответа · <strong>1</strong></> },
    ],
  },
};

/** Длинный тест: 60 вопросов по 10 в строке, три формы. */
export const LongTest: Story = {
  name: 'Длинный тест · 60 вопросов по 10',
  render: () => {
    const seq60: QuizDotState[] = Array.from({ length: 60 }, (_, i) => {
      const n = i + 1;
      if (n === 35) return 'current';
      if (n < 35)  return [7, 12, 19, 28].includes(n) ? 'flagged' : 'answered';
      return [42, 48].includes(n) ? 'flagged' : '';
    });
    const legend = [
      { state: 'answered' as QuizDotState, label: 'Отвечено' },
      { state: 'current'  as QuizDotState, label: 'Текущий' },
      { state: ''         as QuizDotState, label: 'Без ответа' },
      { state: 'flagged'  as QuizDotState, label: 'Помечено' },
    ];
    return (
      <div className="ou-story-quiz-card">
        <QuizMap shape="circle" size="s" hideNumbers dotsColumns={10}
          label="Кружки · 60 вопросов"
          valueLabel={<><strong>34</strong>/60 отвечено</>}
          states={seq60}
        />
        <QuizMap shape="square" size="s" hideNumbers dotsColumns={10}
          label="Квадраты · 60 вопросов"
          valueLabel={<><strong>34</strong>/60 отвечено</>}
          states={seq60}
        />
        <QuizMap shape="pill" size="s" hideNumbers dotsColumns={10} dotsColumnsFill
          label="Pills · 60 вопросов · полосы-сегменты"
          valueLabel={<><strong>34</strong>/60 отвечено</>}
          states={seq60}
          legend={legend}
        />
      </div>
    );
  },
};

/** По разделам — структурированный тест с группировкой по главам. */
export const Sections: Story = {
  name: 'По разделам · структурированный тест',
  args: {
    shape: 'circle', size: 'm',
    label: 'Excel для аналитиков · итоговая работа',
    valueLabel: <><strong>18</strong>/24</>,
    sections: [
      {
        label: <><strong>Формулы</strong>{'  '}8/8</>,
        states: Array<QuizDotState>(8).fill('correct'),
        start: 1,
      },
      {
        label: <><strong>Сводные</strong>{'  '}6/8</>,
        states: ['correct','correct','incorrect','correct','correct','partial','correct','correct'] as QuizDotState[],
        start: 9,
      },
      {
        label: <><strong>Power Query</strong>{'  '}4/8</>,
        states: ['correct','correct','correct','incorrect','incorrect','partial','',''] as QuizDotState[],
        start: 17,
      },
    ],
  },
};

/** Компактная сводка — три варианта: успех / предупреждение / провал. */
export const Summary: Story = {
  name: 'Компактная сводка · QuizSummary',
  render: () => (
    <div className="ou-story-quiz-summary-row">
      <QuizSummary score={18} total={20} />
      <QuizSummary score={14} total={20} variant="warn" />
      <QuizSummary score={6}  total={20} variant="fail" />
    </div>
  ),
};
