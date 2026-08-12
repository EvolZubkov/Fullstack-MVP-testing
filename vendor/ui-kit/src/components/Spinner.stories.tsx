import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner, SpinnerDots, SpinnerOverlay } from './Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Feedback/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 's', 'm', 'l'] },
    tone: { control: 'select', options: ['accent', 'neutral', 'on-accent', 'on-dark'] },
    inline: { control: 'boolean' },
    label: { control: false },
  },
  args: { size: 'm', tone: 'accent' },
};
export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};
export const WithLabel: Story = { args: { label: 'Загрузка курса…' } };

export const Sizes: Story = {
  render: (args) => (
    <div className="ou-story-row-md">
      {(['xs', 's', 'm', 'l'] as const).map(s => <Spinner key={s} {...args} size={s} />)}
    </div>
  ),
};

export const Dots: Story = { render: () => <SpinnerDots /> };

export const Overlay: Story = {
  render: () => (
    <div className="ou-story-overlay-stage">
      <SpinnerOverlay label="Идёт обработка" />
    </div>
  ),
};
