import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

const BoxArt = () => (
  <svg viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="14" y="32" width="68" height="50" rx="6" />
    <path d="M14 44h68M40 44v8h16v-8" />
    <path d="M30 32l8-14h20l8 14" />
  </svg>
);

const meta: Meta<typeof EmptyState> = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  argTypes: {
    layout: { control: 'inline-radio', options: ['default', 'horizontal', 'inline', 'page'] },
    tone: { control: 'select', options: ['neutral', 'info', 'success', 'warn', 'error'] },
    well: { control: 'boolean' },
    art: { control: false },
    title: { control: false },
    description: { control: false },
    hint: { control: false },
    actions: { control: false },
    children: { control: false },
  },
  args: {
    art: <BoxArt />,
    title: 'Ничего не назначено',
    description: 'Назначьте курс сотрудникам, чтобы они увидели его в своём кабинете',
    actions: <><Button variant="ghost">Импорт</Button><Button>Назначить</Button></>,
  },
};
export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};
export const Horizontal: Story = { args: { layout: 'horizontal' } };
export const Inline: Story = { args: { layout: 'inline', well: true } };
export const Page: Story = { args: { layout: 'page' } };

