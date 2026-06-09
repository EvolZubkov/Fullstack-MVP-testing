import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Button } from './Button';
import { Drawer } from './Drawer';

const meta: Meta<typeof Drawer> = {
  title: 'Overlay/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  argTypes: {
    side: { control: 'inline-radio', options: ['left', 'right'] },
    size: { control: 'select', options: ['narrow', 'wide', 'xl', 'full'] },
    open: { control: false },
    closeOnBackdrop: { control: 'boolean' },
    closeOnEsc: { control: 'boolean' },
    hideCloseButton: { control: 'boolean' },
    usePortal: { control: 'boolean' },
    title: { control: false },
    description: { control: false },
    footer: { control: false },
    onClose: { control: false },
    children: { control: false },
  },
  args: { title: 'Профиль сотрудника', description: 'Мария Иванова · ОИТ', side: 'right', size: 'narrow', onClose: fn() },
};
export default meta;
type Story = StoryObj<typeof Drawer>;

export const Default: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Открыть drawer</Button>
        <Drawer {...args} open={open} onClose={() => { setOpen(false); args.onClose?.(); }}>
          <p>Содержимое drawer. Здесь может быть форма, профиль или детали.</p>
        </Drawer>
      </>
    );
  },
};

export const Left: Story = { ...Default, args: { side: 'left' } };
export const Wide: Story = { ...Default, args: { size: 'wide' } };

