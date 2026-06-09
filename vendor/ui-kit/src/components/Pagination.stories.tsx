import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { Pagination, PaginationBar } from './Pagination';

const meta: Meta<typeof Pagination> = {
  title: 'Navigation/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    variant: { control: 'inline-radio', options: ['default', 'outline', 'soft'] },
    compact: { control: 'boolean' },
    showPrevNext: { control: 'boolean' },
    onChange: { control: false },
    labels: { control: false },
  },
  args: { page: 7, totalPages: 24, onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {
  render: (args) => {
    const [p, setP] = useState(args.page);
    return <Pagination {...args} page={p} onChange={(n) => { setP(n); args.onChange?.(n); }} />;
  },
};

export const Outline: Story = { ...Default, args: { variant: 'outline' } };
export const Soft: Story = { ...Default, args: { variant: 'soft' } };
export const Compact: Story = { ...Default, args: { compact: true } };

export const Bar: Story = {
  render: () => {
    const [page, setPage] = useState(1);
    const [size, setSize] = useState(25);
    return (
      <PaginationBar
        page={page} pageSize={size} total={487}
        onPageChange={setPage} onPageSizeChange={setSize}
        pageSizeOptions={[10, 25, 50, 100]}
        jumpTo
      />
    );
  },
};

