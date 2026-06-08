import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Button } from './Button';
import { CommandPalette, type CommandItem } from './CommandPalette';

const ITEMS: CommandItem[] = [
  { id: 'new-course', title: 'Создать курс', meta: 'Новый курс с нуля', group: 'Действия', scope: 'actions', shortcut: ['⌘', 'N'] },
  { id: 'new-program', title: 'Создать программу', group: 'Действия', scope: 'actions' },
  { id: 'assign', title: 'Назначить курс', group: 'Действия', scope: 'actions' },
  { id: 'c-pdm', title: 'Управление продуктом для PdM-2', meta: 'Курс · 12 модулей', group: 'Курсы', scope: 'courses' },
  { id: 'c-excel', title: 'Excel для аналитиков', meta: 'Курс · 8 модулей', group: 'Курсы', scope: 'courses' },
  { id: 'p-maria', title: 'Мария Иванова', meta: 'ОИТ · Старший аналитик', group: 'Люди', scope: 'people' },
  { id: 'p-mikhail', title: 'Михаил Конев', meta: 'ДКП · Тимлид', group: 'Люди', scope: 'people' },
];

const meta: Meta<typeof CommandPalette> = {
  title: 'Overlay/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    open: { control: false },
    onClose: { control: false },
    items: { control: false },
    scopes: { control: false },
    onSelect: { control: false },
    highlightMatches: { control: 'boolean' },
    usePortal: { control: 'boolean' },
    emptyMessage: { control: false },
    allScopeLabel: { control: false },
    searchHint: { control: false },
    footer: { control: false },
  },
  args: { onClose: fn(), onSelect: fn() },
};
export default meta;
type Story = StoryObj<typeof CommandPalette>;

export const Default: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <div className="ou-story-pad-lg">
        <Button onClick={() => setOpen(true)}>Открыть палитру (⌘K)</Button>
        <CommandPalette
          open={open}
          onClose={() => { setOpen(false); args.onClose?.(); }}
          items={ITEMS}
          scopes={[
            { value: 'actions', label: 'Действия' },
            { value: 'courses', label: 'Курсы' },
            { value: 'people', label: 'Люди' },
          ]}
          onSelect={(it) => args.onSelect?.(it)}
        />
      </div>
    );
  },
};
