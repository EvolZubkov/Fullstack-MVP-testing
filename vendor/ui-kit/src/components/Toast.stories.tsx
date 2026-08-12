import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Toast, ToastProvider, useToast } from './Toast';
import { Button } from './Button';

const meta: Meta<typeof Toast> = {
  title: 'Overlay/Toast',
  component: Toast,
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'select', options: ['success', 'error', 'warning', 'info'] },
    title: { control: false },
    description: { control: false },
    icon: { control: false },
    action: { control: false },
    onClose: { control: false },
  },
  args: { tone: 'success', title: 'Курс опубликован', description: '142 сотрудника получат письмо', onClose: fn() },
};
export default meta;
type Story = StoryObj<typeof Toast>;

export const Standalone: Story = {
  render: (args) => <Toast {...args} />,
};

export const WithAction: Story = {
  args: { action: { label: 'Открыть' }, tone: 'info', title: 'Загрузка завершена' },
  render: Standalone.render,
};

function Demo() {
  const { push } = useToast();
  return (
    <div className="ou-story-wrap">
      <Button onClick={() => push({ tone: 'success', title: 'Сохранено', description: 'Изменения применены' })}>Success</Button>
      <Button variant="secondary" onClick={() => push({ tone: 'error', title: 'Ошибка', description: 'Не удалось сохранить' })}>Error</Button>
      <Button variant="ghost" onClick={() => push({ tone: 'warning', title: 'Внимание', description: 'Скоро дедлайн' })}>Warning</Button>
      <Button variant="ghost" onClick={() => push({ tone: 'info', title: 'Загрузка', action: { label: 'Открыть' } })}>Info</Button>
    </div>
  );
}

export const Provider: Story = {
  render: () => (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  ),
};
