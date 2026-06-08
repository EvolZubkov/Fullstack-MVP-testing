import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import {
  FormActions, FormCard, FormField, FormGroup, FormSection,
} from './Form';
import { Input } from './Input';
import { Textarea } from './Textarea';

const meta: Meta = {
  title: 'Layout/Form',
};
export default meta;
type Story = StoryObj;

export const FieldAnatomy: Story = {
  render: () => (
    <div className="ou-story-grid-2 ou-story-max-880">
      <FormField label="Название курса" required hint="Покажем в каталоге">
        <Input fullWidth defaultValue="Управление продуктом для PdM-2" />
      </FormField>
      <FormField label="Внутренний код" optional hint="Используется только в админке">
        <Input fullWidth placeholder="LRT-PDM-002" />
      </FormField>
      <FormField label="Slug курса" required error="Только латиница, цифры и дефис">
        <Input fullWidth defaultValue="управление продуктом" />
      </FormField>
      <FormField label="Дедлайн" success="Достаточно времени">
        <Input fullWidth defaultValue="28 окт 2025, 18:00" />
      </FormField>
    </div>
  ),
};

export const FullForm: Story = {
  render: () => (
    <FormCard title="Создание курса" subtitle="Шаг 1 из 3" headerExtra={<span className="ou-story-muted-xs">Шаг 1 из 3</span>}>
      <FormSection title="Основное" subtitle="Так курс будет отображаться в каталоге" meta="Обязательная секция">
        <FormGroup columns="two">
          <FormField label="Название" required>
            <Input fullWidth defaultValue="Управление продуктом для PdM-2" />
          </FormField>
          <FormField label="Slug" required>
            <Input fullWidth defaultValue="product-management" />
          </FormField>
        </FormGroup>
        <FormField label="Описание">
          <Textarea fullWidth rows={4} placeholder="Кратко опишите курс" />
        </FormField>
      </FormSection>
      <FormActions align="end">
        <Button variant="ghost">Отмена</Button>
        <Button>Сохранить</Button>
      </FormActions>
    </FormCard>
  ),
};
