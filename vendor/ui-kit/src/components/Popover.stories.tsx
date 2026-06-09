import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useRef, useState } from 'react';
import { Button } from './Button';
import { Popover, PopoverHeader, PopoverRow } from './Popover';

const meta: Meta<typeof Popover> = {
  title: 'Overlay/Popover',
  component: Popover,
  tags: ['autodocs'],
  argTypes: {
    placement: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    arrow: { control: 'boolean' },
    open: { control: false },
    closeOnOutside: { control: 'boolean' },
    closeOnEsc: { control: 'boolean' },
    usePortal: { control: 'boolean' },
    onClose: { control: false },
    anchorRef: { control: false },
    header: { control: false },
    footer: { control: false },
    children: { control: false },
  },
  args: { placement: 'bottom', size: 'md', arrow: true, onClose: fn() },
};
export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  render: (args) => {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <div className="ou-story-pad-xl">
        <Button ref={anchorRef} onClick={() => setOpen(o => !o)}>Anchor</Button>
        <Popover {...args} open={open} anchorRef={anchorRef} onClose={() => { setOpen(false); args.onClose?.(); }}>
          <p>Поповер показан под триггером. Стрелка указывает на anchor.</p>
        </Popover>
      </div>
    );
  },
};

export const Profile: Story = {
  render: () => (
    <Popover
      open
      header={<PopoverHeader title="Мария Иванова" subtitle="Старший аналитик · ОИТ" />}
      footer={<><Button variant="ghost" size="s">Профиль</Button><Button size="s">Назначить</Button></>}
      size="lg"
    >
      <PopoverRow label="Город" value="Москва" />
      <PopoverRow label="Часовой пояс" value="UTC+3" />
      <PopoverRow label="Прогресс PdM-2" value="62%" />
    </Popover>
  ),
};
