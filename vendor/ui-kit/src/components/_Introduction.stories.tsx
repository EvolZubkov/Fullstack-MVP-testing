import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

const meta: Meta = {
  title: 'Overview/Introduction',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

type Story = StoryObj;

export const Welcome: Story = {
  render: () => (
    <div className="ou-story-intro">
      <h1 className="ou-story-intro-title">
        UniversityRT · React UI Kit
      </h1>
      <p className="ou-story-intro-lead">
        Storybook собран на базе дизайн-системы UniversityRT. Каждый компонент
        — обёртка над CSS-классами из <code>tokens/components/*.css</code> с
        строгой типизацией, <code>forwardRef</code> и a11y.
      </p>

      <h2 className="ou-story-intro-heading">Что внутри</h2>
      <ul className="ou-story-intro-list">
        <li><strong>52 компонента</strong> — формы, оверлеи, данные, навигация, фидбэк, layout</li>
        <li><strong>Тема light/dark</strong> и <strong>плотность normal/compact</strong> в тулбаре сверху</li>
        <li><strong>Controls</strong> для всех публичных props</li>
        <li><strong>Auto-generated docs</strong> на каждой странице</li>
      </ul>

      <h2 className="ou-story-intro-heading">Как пользоваться</h2>
      <pre className="ou-story-intro-code">{`import { Button, Card, Modal } from '@universityrt/ui-kit';
import '@universityrt/ui-kit/css';

<Button variant="primary" size="m">Применить</Button>`}</pre>
    </div>
  ),
};
