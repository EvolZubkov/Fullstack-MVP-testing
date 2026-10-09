import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { useState } from 'react';
import { Select } from './Select';

const OPTIONS = [
  { value: 'biz', label: 'Бизнес-навыки' },
  { value: 'b2c', label: 'B2C' },
  { value: 'b2b', label: 'B2B' },
  { value: 'b2o', label: 'B2O' },
  { value: 'digital', label: 'Цифровые навыки' },
  { value: 'bti', label: 'БТИ (скоро)', disabled: true },
  { value: 'lead', label: 'Лидерские программы' },
];

/** Long enough that picking by eye stops working — the case `searchable` is for. */
const MANY_OPTIONS = [
  { value: 'ot', label: 'Охрана труда. Базовый курс', group: 'Обязательные' },
  { value: 'pb', label: 'Пожарная безопасность', group: 'Обязательные' },
  { value: 'gto', label: 'Гражданская оборона', group: 'Обязательные' },
  { value: 'burnout', label: 'Опросник профессионального выгорания', group: 'Опросники' },
  { value: 'chil', label: 'Человекоцентричное лидерство', group: 'Опросники' },
  { value: 'fin', label: 'Финансовая грамотность', group: 'Программы' },
  { value: 'fingram', label: 'Финансовая грамота для детей', group: 'Программы' },
  { value: 'demo', label: 'Демография рынков', group: 'Программы' },
];

const meta: Meta<typeof Select> = {
  title: 'Inputs/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    tone: { control: 'inline-radio', options: ['default', 'error'] },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: false },
    hint: { control: false },
    error: { control: false },
    options: { control: false },
    onChange: { control: false },
  },
  args: {
    label: 'Направление',
    placeholder: 'Выберите…',
    options: OPTIONS,
    size: 'm',
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: (args) => {
    const [v, setV] = useState<string | undefined>();
    return <Select {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
};

export const Preselected: Story = { args: { defaultValue: 'digital' } };
export const Error: Story = { args: { error: 'Выберите направление' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'biz' } };

/**
 * `searchable` — то же поле одиночного выбора, только меню получает строку поиска:
 * список отбирается по ПОДСТРОКЕ подписи, совпадение подсвечивается, пустой запрос
 * показывает всё. Берётся, когда вариантов столько, что глазами их уже не просмотреть.
 */
export const Searchable: Story = {
  args: {
    label: 'Тема',
    placeholder: 'Выберите тему',
    options: MANY_OPTIONS,
    searchable: true,
    searchPlaceholder: 'Поиск по названию',
    fullWidth: true,
  },
  render: (args) => {
    const [v, setV] = useState<string | undefined>();
    return <Select {...args} value={v} onChange={(val) => { setV(val); args.onChange?.(val); }} />;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    const search = canvas.getByRole('combobox');

    // Подстрока из СЕРЕДИНЫ слова: отбор идёт не по префиксу — поэтому в выдачу
    // попадает и «Демография», и «Гражданская», где «гра» стоит в начале слова.
    await userEvent.type(search, 'гра');
    const shown = canvas.getAllByRole('option').map((o) => o.textContent);
    await expect(shown).toEqual([
      'Гражданская оборона',
      'Финансовая грамотность',
      'Финансовая грамота для детей',
      'Демография рынков',
    ]);

    await userEvent.click(canvas.getByRole('option', { name: 'Финансовая грамотность' }));
    await expect(canvas.getByRole('button')).toHaveTextContent('Финансовая грамотность');
    await expect(canvas.queryByRole('listbox')).toBeNull();
  },
};

/** Запрос никому не найден — вместо списка одна строка `emptyMessage`. */
export const SearchableEmpty: Story = {
  args: {
    label: 'Тема',
    options: MANY_OPTIONS,
    searchable: true,
    emptyMessage: 'Тема не найдена',
    fullWidth: true,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await userEvent.type(canvas.getByRole('combobox'), 'кварк');

    await expect(canvas.getByText('Тема не найдена')).toBeInTheDocument();
    await expect(canvas.queryAllByRole('option')).toHaveLength(0);
  },
};

/**
 * `onClear` — крестик сброса на триггере. Поле само не придумывает «пустого значения»:
 * что означает сброс, решает владелец значения, поэтому обработчик обязателен, а кнопка
 * появляется и исчезает вместе с выбранным вариантом.
 */
export const Clearable: Story = {
  args: { onClear: fn(), clearLabel: 'Очистить', fullWidth: true },
  render: (args) => {
    const [v, setV] = useState<string | undefined>('digital');
    return (
      <Select
        {...args}
        value={v}
        onChange={(val) => { setV(val); args.onChange?.(val); }}
        onClear={() => { setV(undefined); args.onClear?.(); }}
      />
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Очистить' }));

    await expect(canvas.getByRole('button')).toHaveTextContent('Выберите…');
    await expect(canvas.queryByRole('button', { name: 'Очистить' })).toBeNull();
  },
};

