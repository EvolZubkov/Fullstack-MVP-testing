import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Fab, FabGroup, FabMenu } from './FAB';

/* ── icon helpers ─────────────────────────────────────────────────── */
const svgProps = {
  viewBox: '0 0 24 24', width: 18, height: 18,
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const;

const IcoPlus = () => (
  <svg {...svgProps} width={22} height={22}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IcoFileText = () => (
  <svg {...svgProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const IcoUsers = () => (
  <svg {...svgProps}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IcoCalendar = () => (
  <svg {...svgProps}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IcoCommand = () => (
  <svg {...svgProps}>
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
);

/* ── meta ─────────────────────────────────────────────────────────── */
const meta: Meta<typeof Fab> = {
  title: 'Feedback/FAB',
  component: Fab,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    variant: { control: 'select', options: ['primary', 'neutral', 'surface', 'success'] },
    shape: { control: 'inline-radio', options: ['round', 'square'] },
    anchor: { control: 'boolean' },
    mini: { control: 'boolean' },
    icon: { control: false },
    label: { control: false },
    badge: { control: false },
    onClick: { control: false },
  },
  args: { icon: <IcoPlus />, anchor: true, 'aria-label': 'Добавить', onClick: fn() },
};
export default meta;
type Story = StoryObj<typeof Fab>;

export const Default: Story = {
  render: (args) => (
    <div className="ou-story-fab-stage">
      <Fab {...args} className="ou-story-fab-anchor" />
    </div>
  ),
};

export const Extended: Story = {
  ...Default,
  args: { icon: <IcoPlus />, label: 'Добавить курс', anchor: true },
};

export const Group: Story = {
  render: () => (
    <div className="ou-story-fab-stage ou-story-fab-stage--tall">
      <FabGroup
        className="ou-story-fab-group-anchor"
        trigger={<Fab icon={<IcoPlus />} aria-label="Создать" />}
        actions={[
          { id: 'a1', icon: <IcoFileText />, label: 'Создать курс' },
          { id: 'a2', icon: <IcoUsers />,    label: 'Создать группу' },
          { id: 'a3', icon: <IcoCalendar />, label: 'Запланировать' },
        ]}
      />
    </div>
  ),
};

export const Menu: Story = {
  render: () => (
    <div className="ou-story-fab-menu-stage">
      <FabMenu
        trigger={<Fab icon={<IcoPlus />} aria-label="Меню" />}
        groups={[
          {
            label: 'Создать',
            items: [
              { id: 'c1', icon: <IcoFileText />, title: 'Новый курс', description: 'С нуля или из шаблона' },
              { id: 'c2', icon: <IcoUsers />,    title: 'Новую группу' },
            ],
          },
          {
            items: [
              { id: 'i1', icon: <IcoCommand />, title: 'Палитра команд', shortcut: '⌘K' },
            ],
          },
        ]}
      />
    </div>
  ),
};
