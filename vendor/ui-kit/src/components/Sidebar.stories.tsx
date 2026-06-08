import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Avatar } from './Avatar';
import { Sidebar } from './Sidebar';

const GROUPS = [
  {
    title: 'Главное', items: [
      { id: 'home', label: 'Дашборд' },
      { id: 'catalog', label: 'Каталог', badge: 482 },
      { id: 'people', label: 'Люди', badge: 'NEW' },
    ],
  },
  {
    title: 'Управление', items: [
      { id: 'analytics', label: 'Аналитика' },
      { id: 'reports', label: 'Отчёты' },
      { id: 'settings', label: 'Настройки' },
    ],
  },
];

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  argTypes: {
    collapsed: { control: 'boolean' },
    collapseLabel: { control: false },
    groups: { control: false },
    onSelect: { control: false },
    onToggleCollapse: { control: false },
    brand: { control: false },
    footer: { control: false },
  },
  args: { groups: GROUPS, activeId: 'catalog', onSelect: fn(), onToggleCollapse: fn() },
};
export default meta;
type Story = StoryObj<typeof Sidebar>;

export const Default: Story = {
  render: (args) => {
    const [collapsed, setCollapsed] = useState(false);
    const [active, setActive] = useState('catalog');
    return (
      <div className="ou-story-sidebar-stage">
        <Sidebar
          {...args}
          collapsed={collapsed}
          onToggleCollapse={() => { setCollapsed(c => !c); args.onToggleCollapse?.(); }}
          activeId={active}
          onSelect={(id, item) => { setActive(id); args.onSelect?.(id, item); }}
          brand={<>
            <span className="ou-story-brand-mark">U</span>
            <span className="brand-text">UniversityRT</span>
          </>}
          footer={
            <div className="ou-story-user-row">
              <Avatar size="s" initials="МИ" color="purple" />
              {!collapsed && (
                <div className="ou-story-user-text">
                  <span className="ou-story-user-name">Мария Иванова</span>
                  <span className="ou-story-muted-xs">HR-партнёр</span>
                </div>
              )}
            </div>
          }
        />
      </div>
    );
  },
};

export const Collapsed: Story = {
  args: { groups: GROUPS, activeId: 'catalog', collapsed: true },
};
