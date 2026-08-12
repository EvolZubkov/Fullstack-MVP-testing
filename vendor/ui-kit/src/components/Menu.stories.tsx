import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import {
  Menu, MenuDivider, MenuGroup, MenuHeader, MenuItem, MenuLabel, MenuTrigger,
} from './Menu';

const meta: Meta<typeof Menu> = {
  title: 'Overlay/Menu',
  component: Menu,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    children: { control: false },
  },
};
export default meta;
type Story = StoryObj<typeof Menu>;

export const Standalone: Story = {
  render: (args) => (
    <Menu {...args}>
      <MenuLabel>Действия</MenuLabel>
      <MenuItem title="Редактировать" shortcut="⌘E" />
      <MenuItem title="Дублировать" shortcut="⌘D" />
      <MenuDivider />
      <MenuItem title="Опубликовать" selected />
      <MenuItem title="В черновики" />
      <MenuDivider />
      <MenuItem title="Удалить" danger shortcut="⌫" />
    </Menu>
  ),
};

export const Account: Story = {
  render: () => (
    <Menu size="lg">
      <MenuHeader title="Мария Иванова" meta="maria@example.com" />
      <MenuGroup>
        <MenuItem title="Мой профиль" />
        <MenuItem title="Назначения" meta="12 активных" />
        <MenuItem title="Настройки" hasSubmenu />
      </MenuGroup>
      <MenuDivider />
      <MenuItem title="Выйти" danger />
    </Menu>
  ),
};

export const Trigger: Story = {
  render: () => (
    <MenuTrigger trigger={<Button variant="secondary">Открыть меню</Button>}>
      <MenuItem title="Редактировать" />
      <MenuItem title="Дублировать" />
      <MenuDivider />
      <MenuItem title="Удалить" danger />
    </MenuTrigger>
  ),
};

