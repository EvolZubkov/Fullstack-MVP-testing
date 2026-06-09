import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Button } from './Button';

const PlusIcon = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const meta: Meta<typeof Button> = {
  title: 'Inputs/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'ghost', 'destructive'],
    },
    size: { control: 'inline-radio', options: ['s', 'm', 'l'] },
    fullWidth: { control: 'boolean' },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    leadingIcon: { control: false },
    trailingIcon: { control: false },
  },
  args: {
    children: 'Применить',
    variant: 'primary',
    size: 'm',
    onClick: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Удалить' },
};
export const Loading: Story = {
  args: { loading: true, children: 'Сохранение…' },
};
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole('button');
    await userEvent.click(button);
    await expect(button).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
export const WithLeadingIcon: Story = { args: { leadingIcon: PlusIcon } };

/** Proves the design-system CSS was loaded: primary button background resolves to the brand purple. */
export const CssCheck: Story = {
  args: { children: 'CSS Check' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: /css check/i });
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(119, 0, 255)');
  },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="ou-story-row">
      <Button {...args} size="s">
        Small
      </Button>
      <Button {...args} size="m">
        Medium
      </Button>
      <Button {...args} size="l">
        Large
      </Button>
    </div>
  ),
};
