import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FileItem, FileTile, FileUploader } from './FileUploader';

const meta: Meta<typeof FileUploader> = {
  title: 'Pickers/FileUploader',
  component: FileUploader,
  tags: ['autodocs'],
  argTypes: {
    compact: { control: 'boolean' },
    error: { control: 'boolean' },
    disabled: { control: 'boolean' },
    multiple: { control: 'boolean' },
    title: { control: false },
    description: { control: false },
    cta: { control: false },
    icon: { control: false },
    children: { control: false },
    onFiles: { control: false },
  },
  args: {
    title: 'Перетащите файл сюда',
    description: 'или нажмите, чтобы выбрать · PDF, DOCX, JPG до 10 МБ',
    cta: 'Выбрать файл',
    accept: '.pdf,.doc,.docx,.jpg,.png',
    maxSizeMb: 10,
    onFiles: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof FileUploader>;

export const Dropzone: Story = {};
export const Compact: Story = { args: { compact: true } };
export const Error: Story = { args: { error: true, title: 'Не удалось загрузить', description: 'Размер больше 10 МБ' } };
export const Disabled: Story = { args: { disabled: true } };

export const ItemsList: Story = {
  render: () => (
    <div className="ou-story-stack-tight ou-story-max-560">
      <FileItem name="Договор-184729.pdf" kind="pdf" meta="Готово · 1.4 МБ"
        status="success" actions={[{ icon: '↓', ariaLabel: 'Скачать' }]} />
      <FileItem name="report.docx" kind="doc" status="uploading" progress={62}
        meta="Загрузка · 4.2 МБ из 6.8 МБ · 62%" />
      <FileItem name="archive.zip" kind="zip" status="error"
        meta="Ошибка · превышен размер" />
    </div>
  ),
};

export const Tiles: Story = {
  render: () => (
    <div className="ou-story-grid-3 ou-story-max-560">
      <FileTile name="passport.jpg" tag="JPG"
        previewBackground="linear-gradient(135deg, var(--ou-purple-400), var(--ou-purple-600))"
        meta="2.4 МБ · 1920×1280" />
      <FileTile name="contract.pdf" tag="PDF" meta="6.8 МБ · 12 страниц" onRemove={fn()} />
      <FileTile add />
    </div>
  ),
};
