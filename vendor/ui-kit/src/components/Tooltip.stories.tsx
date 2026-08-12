import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Overlay/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  argTypes: {
    placement: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] },
    tone: { control: 'select', options: ['default', 'accent', 'success', 'warning', 'error', 'light'] },
    wrap: { control: 'boolean' },
    open: { control: 'boolean' },
    content: { control: false },
    title: { control: false },
    shortcut: { control: false },
    children: { control: false },
  },
  args: { content: 'Подсказка', placement: 'top' },
};
export default meta;
type Story = StoryObj<typeof Tooltip>;

const Icon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M11.5 2.5l2 2-8 8H3.5v-2z" />
  </svg>
);

export const Default: Story = {
  args: { open: true },
  render: (args) => (
    <div className="ou-story-inline-pad-lg">
      <Tooltip {...args}>
        <IconButton icon={<Icon />} aria-label="Редактировать" variant="outline" />
      </Tooltip>
    </div>
  ),
};

export const WithTitle: Story = {
  args: { open: true, title: 'SCORM 1.2 / 2004', content: 'Пакет до 500 МБ', wrap: true },
  render: Default.render,
};

export const Tones: Story = {
  render: () => (
    <div className="ou-story-row-lg ou-story-pad-lg">
      {(['default', 'accent', 'success', 'warning', 'error', 'light'] as const).map(t => (
        <Tooltip key={t} open content={t} tone={t}>
          <IconButton icon={<Icon />} aria-label={t} variant="outline" />
        </Tooltip>
      ))}
    </div>
  ),
};
