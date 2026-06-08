import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
  AppShell, AppShellActions, AppShellBrand, AppShellPageHead,
  AppShellSearch, AppShellUser,
} from './AppShell';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { CardKpi } from './Card';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { Sidebar } from './Sidebar';

const Bell = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const meta: Meta<typeof AppShell> = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    collapsed: { control: 'boolean' },
    side: { control: false },
    header: { control: false },
    children: { control: false },
  },
};
export default meta;
type Story = StoryObj<typeof AppShell>;

export const FullLayout: Story = {
  render: () => {
    const [active, setActive] = useState('catalog');
    const [collapsed, setCollapsed] = useState(false);
    return (
      <AppShell
        collapsed={collapsed}
        side={
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(c => !c)}
            activeId={active}
            onSelect={setActive}
            brand={<><span className="ou-story-brand-mark">U</span><span className="brand-text">UniversityRT</span></>}
            groups={[
              {
                title: 'Главное', items: [
                  { id: 'home', label: 'Дашборд' },
                  { id: 'catalog', label: 'Каталог', badge: 482 },
                  { id: 'people', label: 'Люди' },
                ],
              },
              {
                title: 'Управление', items: [
                  { id: 'analytics', label: 'Аналитика' },
                  { id: 'settings', label: 'Настройки' },
                ],
              },
            ]}
          />
        }
        header={
          <>
            <AppShellBrand mark="U">UniversityRT</AppShellBrand>
            <AppShellSearch>
              <Input fullWidth placeholder="Найти курс, человека или команду" />
            </AppShellSearch>
            <AppShellActions>
              <IconButton icon={<Bell />} aria-label="Уведомления" badge={3} />
              <AppShellUser avatar={<Avatar size="s" initials="МИ" color="purple" />}
                name="Мария Иванова" role="HR-партнёр" />
            </AppShellActions>
          </>
        }
      >
        <AppShellPageHead
          title="Каталог курсов"
          subtitle="482 курса · 12 программ"
          actions={<><Button variant="secondary">Импорт</Button><Button>+ Создать</Button></>}
        />
        <div className="ou-story-grid-4">
          <CardKpi label="Активных" value="2 481" delta="+12%" deltaTrend="up" />
          <CardKpi label="Завершили" value="847" delta="−3%" deltaTrend="down" />
          <CardKpi label="Просрочено" value="32" delta="—" deltaTrend="flat" />
          <CardKpi label="Сертификатов" value="612" delta="+5%" deltaTrend="up" />
        </div>
      </AppShell>
    );
  },
};
