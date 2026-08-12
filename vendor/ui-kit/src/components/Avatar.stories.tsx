import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

const avatarImageSrc = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="bg" x1="18" y1="12" x2="105" y2="112" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFB608"/>
      <stop offset="0.48" stop-color="#FF5E2E"/>
      <stop offset="1" stop-color="#7700FF"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" fill="url(#bg)"/>
  <circle cx="60" cy="48" r="23" fill="#FFE5D3"/>
  <path d="M24 120c4-27 18-42 36-42s32 15 36 42H24Z" fill="#1D2533"/>
  <path d="M38 44c4-20 18-29 35-22 13 6 19 18 14 33-9-5-18-8-30-8-8 0-14-1-19-3Z" fill="#232A38"/>
</svg>
`)}`;

const meta: Meta<typeof Avatar> = {
  title: 'Data/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['xs', 's', 'm', 'l', 'xl', '2xl'] },
    color: { control: 'select', options: ['purple', 'blue', 'green', 'amber', 'pink', 'teal', 'slate'] },
    status: { control: 'select', options: [undefined, 'online', 'offline', 'busy', 'away'] },
    solid: { control: 'boolean' },
    bordered: { control: 'boolean' },
    shape: { control: 'inline-radio', options: [undefined, 'circle', 'square', 'squircle', 'rt'] },
    children: { control: false },
  },
  args: { initials: 'АИ', size: 'm' },
};
export default meta;
type Story = StoryObj<typeof Avatar>;

export const Initials: Story = {};
export const Image: Story = { args: { src: avatarImageSrc, alt: 'Анна' } };
export const Online: Story = { args: { status: 'online' } };
export const Solid: Story = { args: { solid: true, color: 'purple' } };

export const Sizes: Story = {
  render: (args) => (
    <div className="ou-story-row">
      {(['xs', 's', 'm', 'l', 'xl', '2xl'] as const).map(s => (
        <Avatar key={s} {...args} size={s} />
      ))}
    </div>
  ),
};

export const BrandLogo: Story = {
  render: () => (
    <div className="ou-story-row">
      {(['xs', 's', 'm', 'l', 'xl', '2xl'] as const).map(s => (
        <Avatar key={s} size={s} shape="rt" src="/assets/logo-mark.svg" alt="UniversityRT" />
      ))}
    </div>
  ),
};

export const Shapes: Story = {
  render: () => {
    const sizes = ['xs', 's', 'm', 'l', 'xl', '2xl'] as const;
    return (
      <div className="ou-story-stack">
        <div className="ou-story-row">
          {sizes.map(s => <Avatar key={s} size={s} initials="АИ" color="purple" />)}
        </div>
        <div className="ou-story-row">
          {sizes.map(s => <Avatar key={s} size={s} initials="АИ" color="purple" shape="square" />)}
        </div>
        <div className="ou-story-row">
          {sizes.map(s => <Avatar key={s} size={s} initials="АИ" color="purple" shape="squircle" />)}
        </div>
        <div className="ou-story-row">
          {sizes.map(s => <Avatar key={s} size={s} initials="АИ" color="purple" shape="rt" />)}
        </div>
      </div>
    );
  },
};

export const Bordered: Story = {
  render: () => {
    const sizes = ['xs', 's', 'm', 'l', 'xl', '2xl'] as const;
    return (
      <div className="ou-story-stack">
        <div className="ou-story-tile ou-story-tile--accent">
          {sizes.map(s => <Avatar key={s} size={s} bordered initials="АИ" color="purple" solid />)}
        </div>
        <div className="ou-story-tile ou-story-tile--accent">
          {sizes.map(s => <Avatar key={`sq-${s}`} size={s} bordered initials="АИ" color="purple" solid shape="square" />)}
        </div>
        <div className="ou-story-tile ou-story-tile--accent">
          {sizes.map(s => <Avatar key={`sqr-${s}`} size={s} bordered initials="АИ" color="purple" solid shape="squircle" />)}
        </div>
        <div className="ou-story-tile ou-story-tile--accent">
          {sizes.map(s => <Avatar key={`rt-${s}`} size={s} bordered initials="АИ" color="purple" solid shape="rt" />)}
        </div>
        <div className="ou-story-tile">
          <span className="ou-avatar-group">
            {(['АИ', 'РС', 'МК', 'ПВ'] as const).map(i => (
              <Avatar key={i} size="m" initials={i} />
            ))}
          </span>
        </div>
      </div>
    );
  },
};
