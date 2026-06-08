import type { Meta, StoryObj } from '@storybook/react-vite';
import { cn } from '../utils';
import { Button } from './Button';
import {
  Card, CardBody, CardFooter, CardHeader, CardKpi,
} from './Card';

const meta: Meta<typeof Card> = {
  title: 'Data/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    variant: { control: 'select', options: ['default', 'outlined', 'filled', 'ghost', 'accent'] },
    interactive: { control: 'boolean' },
    selected: { control: 'boolean' },
    disabled: { control: 'boolean' },
    flatFooter: { control: 'boolean' },
    flush: { control: 'boolean' },
    children: { control: false },
  },
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Basic: Story = {
  render: (args) => (
    <Card {...args} className={cn('ou-story-card-narrow', args.className)}>
      <CardHeader title="Excel для аналитиков" subtitle="Бизнес-навыки · 4 ч" />
      <CardBody>Курс знакомит с базовыми возможностями Excel для анализа данных.</CardBody>
      <CardFooter><Button size="s">Назначить</Button></CardFooter>
    </Card>
  ),
};

export const Interactive: Story = { ...Basic, args: { interactive: true } };
export const Selected: Story = { ...Basic, args: { interactive: true, selected: true } };

export const KPI: Story = {
  render: () => (
    <div className="ou-story-grid-3 ou-story-max-720">
      <CardKpi label="Активных" value="2 481" delta="+12%" deltaTrend="up" />
      <CardKpi label="Завершили" value="847" delta="−3%" deltaTrend="down" />
      <CardKpi label="Просрочено" value="32" delta="без изменений" deltaTrend="flat" />
    </div>
  ),
};
