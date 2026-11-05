import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Tabs } from './Tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Navigation/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['underline', 'pill', 'segment'] },
    size: { control: 'inline-radio', options: ['s', 'm'] },
    align: { control: 'inline-radio', options: ['start', 'center', 'stretch'] },
    hidePanel: { control: 'boolean' },
    items: { control: false },
    onChange: { control: false },
  },
  args: {
    items: [
      { id: 'overview', label: 'Обзор', content: <p className="ou-story-tab-content">Контент вкладки «Обзор»</p> },
      { id: 'modules', label: 'Модули', badge: 12, content: <p className="ou-story-tab-content">12 модулей</p> },
      { id: 'students', label: 'Слушатели', badge: 142, content: <p className="ou-story-tab-content">142 человека</p> },
      { id: 'archive', label: 'Архив', disabled: true },
    ],
    variant: 'underline',
    size: 'm',
    onChange: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Tabs>;

export const Underline: Story = {};
export const Pill: Story = { args: { variant: 'pill' } };
export const Segment: Story = { args: { variant: 'segment' } };
export const Stretch: Story = { args: { align: 'stretch' } };

/**
 * `fill`: the active panel takes what the tab list leaves in a bounded flex column and
 * scrolls itself — a long tab does not push the tab list away.
 */
export const Fill: Story = {
  args: {
    variant: 'segment',
    align: 'stretch',
    fill: true,
    items: [
      { id: 'short', label: 'Коротко', content: <p>Одна строка.</p> },
      {
        id: 'long', label: 'Длинно',
        content: <div>{Array.from({ length: 40 }, (_, i) => <p key={i}>Строка {i + 1}</p>)}</div>,
      },
    ],
  },
  render: (args) => (
    <div style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
      <Tabs {...args} />
    </div>
  ),
};
