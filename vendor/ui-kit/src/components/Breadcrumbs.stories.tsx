import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumbs } from './Breadcrumbs';

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Navigation/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  argTypes: {
    separator: { control: 'inline-radio', options: ['chevron', 'slash', 'dot'] },
    maxItems: { control: 'number' },
    items: { control: false },
    onExpand: { control: false },
  },
  args: {
    items: [
      { label: 'Главная', href: '#' },
      { label: 'Каталог', href: '#' },
      { label: 'Бизнес-навыки', href: '#' },
      { label: 'Excel для аналитиков' },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof Breadcrumbs>;

export const Default: Story = {};
export const Slash: Story = { args: { separator: 'slash' } };
export const Dot: Story = { args: { separator: 'dot' } };
export const Collapsed: Story = {
  args: {
    maxItems: 3,
    items: [
      { label: 'Главная', href: '#' },
      { label: 'Программы', href: '#' },
      { label: 'Цифровые', href: '#' },
      { label: 'Аналитика', href: '#' },
      { label: 'Курс PdM-2' },
    ],
  },
};

