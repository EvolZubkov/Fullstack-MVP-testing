import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Matching, type MatchingItem } from './Matching';

const TOOLS_L: MatchingItem[] = [
  { id: 'mixpanel', text: 'Mixpanel', secondary: 'Product analytics' },
  { id: 'notion',   text: 'Notion',   secondary: 'Knowledge base' },
  { id: 'figma',    text: 'Figma',    secondary: 'Design & prototyping' },
  { id: 'linear',   text: 'Linear',   secondary: 'Issue tracker' },
];
const TOOLS_R: MatchingItem[] = [
  { id: 't-design',     text: 'Прототипы UI и совместный design-review',     secondary: 'Дизайн-команда, ревью макетов' },
  { id: 't-analytics',  text: 'Продуктовые метрики, воронки и retention',    secondary: 'Аналитика по событиям и когортам' },
  { id: 't-issues',     text: 'Issue-трекер для команды разработки',         secondary: 'Спринты, циклы, релиз-ноуты' },
  { id: 't-docs',       text: 'База знаний и страницы документации',         secondary: 'Wiki, onboarding, runbooks' },
];

const METHOD_L: MatchingItem[] = [
  { id: 'scrum',     text: 'Scrum' },
  { id: 'kanban',    text: 'Kanban' },
  { id: 'xp',        text: 'XP' },
  { id: 'waterfall', text: 'Waterfall' },
];
const METHOD_R: MatchingItem[] = [
  { id: 'm-sprint',    text: 'Sprint backlog и daily standup' },
  { id: 'm-wip',       text: 'WIP-лимиты на доске' },
  { id: 'm-pair',      text: 'Pair programming и TDD' },
  { id: 'm-gantt',     text: 'Gantt-диаграмма и stage-gate' },
];

const meta: Meta<typeof Matching> = {
  title: 'Data/Matching',
  component: Matching,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    side: { control: 'inline-radio', options: ['l', 'r'] },
    gap:  { control: 'inline-radio', options: ['wide', 'narrow'] },
    icon: { control: 'inline-radio', options: ['burger', 'dots', 'arrows', 'palm'] },
    locked: { control: 'boolean' },
    left: { control: false },
    right: { control: false },
    value: { control: false },
    defaultValue: { control: false },
    onChange: { control: false },
    correct: { control: false },
  },
};
export default meta;
type Story = StoryObj<typeof Matching>;

export const Default: Story = {
  args: { side: 'l', gap: 'wide', icon: 'burger' },
  render: (args) => {
    const [value, setValue] = useState<Record<string, string>>({});
    return (
      <div className="ou-story-max-840">
        <Matching {...args} left={TOOLS_L} right={TOOLS_R} value={value} onChange={setValue} />
        <p className="ou-story-note">
          Подключено: <strong>{Object.keys(value).length} из {TOOLS_L.length}</strong>
        </p>
      </div>
    );
  },
};

export const NarrowGap: Story = {
  name: 'Узкий просвет (merged-панель)',
  args: { side: 'l', gap: 'narrow', icon: 'dots' },
  render: (args) => {
    const [value, setValue] = useState<Record<string, string>>({});
    return (
      <div className="ou-story-max-720">
        <Matching {...args} left={TOOLS_L} right={TOOLS_R} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const RightSideDraggable: Story = {
  name: 'Справа перетаскиваемая',
  args: { side: 'r', gap: 'wide', icon: 'arrows' },
  render: (args) => {
    const [value, setValue] = useState<Record<string, string>>({});
    return (
      <div className="ou-story-max-840">
        <Matching {...args} left={TOOLS_R} right={TOOLS_L} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const LockedReview: Story = {
  name: 'Locked · после проверки',
  args: { side: 'l', gap: 'wide', locked: true },
  render: (args) => (
    <div className="ou-story-max-720">
      <Matching
        {...args}
        left={METHOD_L}
        right={METHOD_R}
        // student's answer: Scrum→sprint ✓, Kanban→pair ✗, XP→wip ✗, Waterfall→gantt ✓
        value={{
          scrum:     'm-sprint',
          kanban:    'm-pair',
          xp:        'm-wip',
          waterfall: 'm-gantt',
        }}
        correct={{
          scrum:     'm-sprint',
          kanban:    'm-wip',
          xp:        'm-pair',
          waterfall: 'm-gantt',
        }}
      />
    </div>
  ),
};

export const NarrowReview: Story = {
  name: 'Locked + merged-панель',
  args: { side: 'l', gap: 'narrow', locked: true },
  render: (args) => (
    <div className="ou-story-max-720">
      <Matching
        {...args}
        left={METHOD_L}
        right={METHOD_R}
        value={{
          scrum:     'm-sprint',
          kanban:    'm-pair',
          xp:        'm-wip',
          waterfall: 'm-gantt',
        }}
        correct={{
          scrum:     'm-sprint',
          kanban:    'm-wip',
          xp:        'm-pair',
          waterfall: 'm-gantt',
        }}
      />
    </div>
  ),
};
