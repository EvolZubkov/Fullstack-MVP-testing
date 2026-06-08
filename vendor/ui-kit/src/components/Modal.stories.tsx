import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Button } from './Button';
import { ModalDialog, DialogHeader, DialogContent } from './Modal';

const meta: Meta<typeof ModalDialog> = {
  title: 'Overlay/ModalDialog',
  component: ModalDialog,
  tags: ['autodocs'],
  argTypes: {
    open: { control: false },
    size: { control: 'select', options: ['s', 'm', 'l', 'xl'] },
    iconTone: { control: 'select', options: [undefined, 'danger', 'warning', 'success', 'info', 'neutral'] },
    closeOnBackdrop: { control: 'boolean' },
    closeOnEsc: { control: 'boolean' },
    hideCloseButton: { control: 'boolean' },
    usePortal: { control: 'boolean' },
    title: { control: false },
    description: { control: false },
    footer: { control: false },
    icon: { control: false },
    onClose: { control: false },
    children: { control: false },
  },
  args: { title: 'Опубликовать курс?', description: '142 сотрудника получат уведомление', size: 's', onClose: fn() },
};
export default meta;
type Story = StoryObj<typeof ModalDialog>;

const Demo: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Открыть</Button>
        <ModalDialog {...args} open={open} onClose={() => { setOpen(false); args.onClose?.(); }}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
              <Button onClick={() => setOpen(false)}>Подтвердить</Button>
            </>
          }
        >
          После публикации структуру курса нельзя будет менять. Дополнительные модули можно добавлять.
        </ModalDialog>
      </>
    );
  },
};

export const Default = Demo;
export const Destructive: Story = {
  ...Demo,
  args: {
    title: 'Снять с курса?', description: 'Прогресс сохранится, дедлайн будет пропущен',
    iconTone: 'danger',
    icon: '⚠',
  },
};
export const Large: Story = { ...Demo, args: { size: 'xl', title: 'Настройки курса' } };

/** Composable API: DialogHeader + DialogContent as children, no built-in title prop. */
export const Composable: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Открыть (composable)</Button>
        <ModalDialog
          {...args}
          open={open}
          onClose={() => { setOpen(false); args.onClose?.(); }}
          title={undefined}
          description={undefined}
          hideCloseButton
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
              <Button onClick={() => setOpen(false)}>Сохранить</Button>
            </>
          }
        >
          <DialogHeader
            title="Составной заголовок"
            description="DialogHeader и DialogContent используются как children"
          />
          <DialogContent>
            Тело диалога оформлено через <code>DialogContent</code>.
            Используйте этот паттерн, когда нужна нестандартная структура header или несколько областей контента.
          </DialogContent>
        </ModalDialog>
      </>
    );
  },
};

