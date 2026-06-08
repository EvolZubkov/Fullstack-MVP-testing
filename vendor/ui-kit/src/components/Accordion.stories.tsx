import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Accordion, AccordionItem } from './Accordion';

const meta: Meta<typeof Accordion> = {
  title: 'Feedback/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['plain', 'bordered', 'separated'] },
    type: { control: 'inline-radio', options: ['single', 'multiple'] },
    collapsible: { control: 'boolean' },
    value: { control: false },
    defaultValue: { control: false },
    onChange: { control: false },
    children: { control: false },
  },
  args: { variant: 'bordered', type: 'single', collapsible: true, onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof Accordion>;

export const Default: Story = {
  render: (args) => (
    <Accordion {...args} defaultValue="module-1">
      <AccordionItem value="module-1" title="Модуль 1 · Основы продукта" subtitle="3 урока · 1 ч 20 мин">
        Содержимое модуля. Здесь могут быть уроки, материалы, ссылки.
      </AccordionItem>
      <AccordionItem value="module-2" title="Модуль 2 · Customer Development" subtitle="5 уроков · 2 ч 40 мин">
        Customer development и проверка гипотез.
      </AccordionItem>
      <AccordionItem value="module-3" title="Модуль 3 · A/B-эксперименты" subtitle="4 урока · 1 ч 50 мин">
        Постановка и анализ экспериментов.
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = { ...Default, args: { type: 'multiple', variant: 'separated' } };

