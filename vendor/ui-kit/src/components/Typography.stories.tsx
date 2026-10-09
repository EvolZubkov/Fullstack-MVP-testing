import type { Meta, StoryObj } from '@storybook/react-vite';
import { Heading, Text } from './Typography';

const meta: Meta<typeof Text> = {
  title: 'Layout/Typography',
  component: Text,
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'inline-radio', options: ['default', 'soft', 'muted', 'subtle'] },
    size: { control: 'inline-radio', options: ['xs', 's', 'm', 'l'] },
    weight: { control: 'inline-radio', options: ['regular', 'medium', 'strong'] },
    as: { control: 'inline-radio', options: ['span', 'p', 'div'] },
  },
  args: { children: 'Роль назначена пользователям', tone: 'default', size: 'm', weight: 'regular', as: 'span' },
};
export default meta;
type Story = StoryObj<typeof Text>;

export const Default: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="ou-story-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(['default', 'soft', 'muted', 'subtle'] as const).map((tone) => (
        <Text key={tone} {...args} tone={tone} as="div">{tone}</Text>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="ou-story-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(['body-xs', 'body-s', 'body-m', 'body-l'] as const).map((variant) => (
        <Text key={variant} {...args} variant={variant} as="div">{variant} — Просмотр публикаций</Text>
      ))}
    </div>
  ),
};

export const Weights: Story = {
  render: (args) => (
    <div className="ou-story-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(['regular', 'medium', 'semibold', 'bold'] as const).map((weight) => (
        <Text key={weight} {...args} weight={weight} as="div">{weight}</Text>
      ))}
    </div>
  ),
};

/** The pairing these two are for: a name with its quieter identifier beneath. */
export const NameWithIdentifier: Story = {
  render: () => (
    <div className="ou-story-wrap">
      <Text as="div" weight="medium">Менеджер рассылок</Text>
      <Text as="div" tone="muted" variant="body-s">manager</Text>
    </div>
  ),
};

export const Headings: StoryObj<typeof Heading> = {
  render: () => (
    <div className="ou-story-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Heading level={1}>Настройки</Heading>
      <Heading level={2}>Точки входа</Heading>
      <Heading level={3}>Каналы активации</Heading>
    </div>
  ),
};
