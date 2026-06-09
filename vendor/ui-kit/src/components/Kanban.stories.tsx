import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Kanban, KanbanAddCard, KanbanAddColumn, KanbanCard, KanbanCardFoot,
  KanbanCardFootStats, KanbanCardMeta, KanbanCardProgress, KanbanCardTags,
  KanbanCardTitle, KanbanColumn, KanbanTag,
} from './Kanban';

const meta: Meta<typeof Kanban> = {
  title: 'Data/Kanban',
  component: Kanban,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof Kanban>;

export const Board: Story = {
  render: () => (
    <Kanban className="ou-story-pad">
      <KanbanColumn columnId="todo" title="К выполнению" count={4} dot="purple"
        footer={<KanbanAddCard />}>
        <KanbanCard cardId="c1" columnId="todo">
          <KanbanCardTags>
            <KanbanTag tone="purple">Курс</KanbanTag>
            <KanbanTag tone="blue">Срочно</KanbanTag>
          </KanbanCardTags>
          <KanbanCardTitle>Подготовить материалы для PdM-2 модуля 5</KanbanCardTitle>
          <KanbanCardMeta><span>📅 28 мая</span><span>👤 Анна</span></KanbanCardMeta>
          <KanbanCardProgress value={62} />
          <KanbanCardFoot>
            <KanbanCardFootStats><span>💬 4</span><span>📎 2</span></KanbanCardFootStats>
          </KanbanCardFoot>
        </KanbanCard>
        <KanbanCard cardId="c2" columnId="todo">
          <KanbanCardTitle>Согласовать программу с HR</KanbanCardTitle>
          <KanbanCardMeta><span>📅 30 мая</span></KanbanCardMeta>
        </KanbanCard>
      </KanbanColumn>

      <KanbanColumn columnId="doing" title="В работе" count={2} dot="orange"
        footer={<KanbanAddCard />}>
        <KanbanCard cardId="c3" columnId="doing">
          <KanbanCardTitle>Запись вебинара по продуктовой стратегии</KanbanCardTitle>
          <KanbanCardMeta><span className="danger">📅 Сегодня</span></KanbanCardMeta>
        </KanbanCard>
      </KanbanColumn>

      <KanbanColumn columnId="done" title="Готово" count={12} dot="green">
        <KanbanCard cardId="c4" columnId="done">
          <KanbanCardTitle>Опубликовать курс Excel для аналитиков</KanbanCardTitle>
        </KanbanCard>
      </KanbanColumn>

      <KanbanAddColumn />
    </Kanban>
  ),
};
