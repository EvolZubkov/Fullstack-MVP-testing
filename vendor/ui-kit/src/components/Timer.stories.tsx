import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { Timer, useCountdown } from './Timer';

const meta: Meta<typeof Timer> = {
  title: 'Feedback/Timer',
  component: Timer,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['digital', 'bar', 'ring', 'pill', 'header'] },
    size: { control: 'select', options: ['s', 'm', 'l', 'xl'] },
    status: { control: 'select', options: [undefined, 'running', 'warning', 'critical', 'paused', 'finished'] },
    ariaLive: { control: 'inline-radio', options: ['off', 'polite', 'assertive'] },
    label: { control: false },
    meta: { control: false },
    formatValue: { control: false },
    icon: { control: false },
  },
  args: { seconds: 187, totalSeconds: 300, variant: 'digital', size: 'm', label: 'До конца' },
};
export default meta;
type Story = StoryObj<typeof Timer>;

export const Digital: Story = {};
export const Bar: Story = { args: { variant: 'bar' } };
export const Ring: Story = { args: { variant: 'ring', size: 'l' } };
export const Pill: Story = { args: { variant: 'pill' } };
export const Header: Story = { args: { variant: 'header', meta: 'Тестирование завершится автоматически' } };

export const LiveCountdown: Story = {
  render: () => {
    const { seconds, isRunning, start, pause, reset } = useCountdown({ totalSeconds: 30, autostart: true });
    return (
      <div className="ou-story-row-md">
        <Timer seconds={seconds} totalSeconds={30} variant="ring" size="l" />
        <div className="ou-story-wrap">
          {isRunning
            ? <Button variant="secondary" onClick={pause}>Pause</Button>
            : <Button onClick={start}>Start</Button>}
          <Button variant="ghost" onClick={() => reset(30)}>Reset</Button>
        </div>
      </div>
    );
  },
};
