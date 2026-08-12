import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Skeleton, SkeletonCard, SkeletonListRow, SkeletonRow, SkeletonStack,
} from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  argTypes: {
    shape: { control: 'inline-radio', options: ['line', 'circle', 'button', 'block'] },
    animation: { control: 'inline-radio', options: ['shimmer', 'pulse', 'static'] },
    size: { control: 'inline-radio', options: ['caption', 'body', 'heading', 'display'] },
    width: { control: 'text' },
    height: { control: 'text' },
  },
  args: { shape: 'line', width: 'full' },
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Lines: Story = {
  render: () => (
    <SkeletonStack>
      <Skeleton shape="line" size="heading" width="2/3" />
      <Skeleton shape="line" width="full" />
      <Skeleton shape="line" width="3/4" />
      <Skeleton shape="line" width="1/2" />
    </SkeletonStack>
  ),
};

export const Row: Story = {
  render: () => (
    <SkeletonRow>
      <Skeleton shape="circle" />
      <SkeletonStack density="tight" className="ou-story-flex-1">
        <Skeleton shape="line" width="2/3" />
        <Skeleton shape="line" width="1/3" size="caption" />
      </SkeletonStack>
      <Skeleton shape="button" width={120} />
    </SkeletonRow>
  ),
};

export const Card: Story = {
  render: () => <SkeletonCard media lines={3} className="ou-story-card-narrow" />,
};

export const ListRows: Story = {
  render: () => (
    <SkeletonStack>
      {Array.from({ length: 4 }, (_, i) => <SkeletonListRow key={i} trail={2} />)}
    </SkeletonStack>
  ),
};

