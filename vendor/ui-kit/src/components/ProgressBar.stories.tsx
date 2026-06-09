import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressBar, ProgressSegmented, ProgressStacked } from './ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Feedback/ProgressBar',
  component: ProgressBar,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 's', 'm', 'l'] },
    tone: { control: 'select', options: ['accent', 'success', 'warning', 'error', 'neutral'] },
    striped: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
    hideHeader: { control: 'boolean' },
    label: { control: false },
    valueLabel: { control: false },
  },
  args: { label: 'Прогресс по курсу', value: 62, size: 'm', tone: 'accent' },
};
export default meta;
type Story = StoryObj<typeof ProgressBar>;

/** Базовый линейный прогресс — акцентный цвет, показывает label + value. */
export const Linear: Story = {};

/** Четыре размера: XS / S / M / L. */
export const Sizes: Story = {
  name: 'Размеры XS · S · M · L',
  render: () => (
    <div className="ou-story-progress-stack">
      {(
        [
          { size: 'xs', value: 35 },
          { size: 's',  value: 55 },
          { size: 'm',  value: 72 },
          { size: 'l',  value: 88 },
        ] as const
      ).map(({ size, value }) => (
        <div key={size} className="ou-story-progress-size-row">
          <span className="ou-story-progress-size-cap">{size.toUpperCase()}</span>
          <ProgressBar value={value} size={size} hideHeader />
        </div>
      ))}
    </div>
  ),
};

/** Тона: акцент, успех, предупреждение, ошибка — с подписями и контекстным текстом значения. */
export const Tones: Story = {
  name: 'Тона · состояния прохождения',
  render: () => (
    <div className="ou-story-progress-stack">
      <ProgressBar
        value={62} size="m"
        label="Excel для аналитиков"
      />
      <ProgressBar
        value={100} size="m" tone="success"
        label="Информационная безопасность"
        valueLabel={<><strong>100</strong>% · завершено</>}
      />
      <ProgressBar
        value={14} size="m" tone="warning"
        label="Сложные переговоры"
        valueLabel={<><strong>14</strong>% · дедлайн через 2 дня</>}
      />
      <ProgressBar
        value={30} size="m" tone="error"
        label="Охрана труда (просрочен)"
      />
    </div>
  ),
};

/** Анимированные полосы — striped и indeterminate — для фоновых операций. */
export const Striped: Story = {
  name: 'Striped · загрузка с прогрессом',
  render: () => (
    <div className="ou-story-progress-stack">
      <ProgressBar
        value={68} size="m" striped
        label="Рендер отчёта"
      />
      <ProgressBar
        size="m" indeterminate
        label="Импорт сотрудников из 1С"
        valueLabel="в процессе…"
      />
    </div>
  ),
};

export const Indeterminate: Story = { args: { indeterminate: true, label: 'Загрузка…' } };

/**
 * Сегментированная полоса: шаги онбординга (с подписями и частичным шагом),
 * главы курса (размер S, частичный текущий сегмент), тест (тон success).
 */
export const Segmented: Story = {
  name: 'Сегментированный · шаги / главы / тест',
  render: () => (
    <div className="ou-story-progress-stack">
      <ProgressSegmented
        steps={5} current={3} currentPartial={0.6}
        label="Шаг 3 из 5"
        labels={['Профиль', 'Аватар', 'Цели', 'Команда', 'Готово']}
      />
      <ProgressSegmented
        steps={8} current={4} currentPartial={0.6}
        size="s"
        label="Глава 4 из 8 · с прогрессом в текущей"
      />
      <ProgressSegmented
        steps={10} current={9}
        size="s" tone="success"
        label="Тест из 10 вопросов"
      />
    </div>
  ),
};

/** Один многосегментный бар: статусы команды с легендой. */
export const Stacked: Story = {
  name: 'Стек · статусы команды',
  render: () => (
    <div className="ou-story-progress-narrow">
      <ProgressStacked
        size="l"
        label="Команда финансов · 24 сотрудника"
        max={24}
        showLegend
        segments={[
          { value: 15, color: 'var(--ou-success-default)', label: 'Завершили · 15' },
          { value: 6,  color: 'var(--ou-accent-default)',  label: 'В работе · 6' },
          { value: 2,  color: 'var(--ou-warning-default)', label: 'Близко к дедлайну · 2' },
          { value: 1,  color: 'var(--ou-error-default)',   label: 'Просрочено · 1' },
        ]}
      />
    </div>
  ),
};
