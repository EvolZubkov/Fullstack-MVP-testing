import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useRef, useState } from 'react';
import { Checkbox } from './Checkbox';
import { FilterBar } from './FilterBar';
import { FilterPanel, FilterPanelGroup } from './FilterPanel';
import { Input } from './Input';
import { SegmentedControl } from './SegmentedControl';

const meta: Meta<typeof FilterPanel> = {
  title: 'Data/FilterPanel',
  component: FilterPanel,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof FilterPanel>;

/** The bar and its panel together: the panel opens under the «Фильтр» button, flush with its left edge. */
export const UnderFilterBar: Story = {
  render: () => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <div style={{ minHeight: 480 }}>
        <FilterBar
          search={<Input size="s" placeholder="Поиск по названию..." />}
          count={1}
          applied={[{ id: 'status', label: 'Статус: опубликован' }]}
          filterButtonRef={buttonRef}
          filterOpen={open}
          onOpenFilter={() => setOpen((value) => !value)}
          onRemove={fn()}
          onReset={fn()}
        />
        <FilterPanel
          open={open}
          anchorRef={buttonRef}
          onClose={() => setOpen(false)}
          onApply={() => setOpen(false)}
          onReset={fn()}
        >
          <FilterPanelGroup title="Статус" inline>
            <Checkbox label="Черновик" />
            <Checkbox label="Опубликован" defaultChecked />
            <Checkbox label="В архиве" />
          </FilterPanelGroup>
          <FilterPanelGroup title="Область">
            <SegmentedControl
              size="s"
              items={[
                { value: 'all', label: 'Все' },
                { value: 'mine', label: 'Мои' },
              ]}
              value="all"
              onChange={fn()}
            />
          </FilterPanelGroup>
        </FilterPanel>
      </div>
    );
  },
};
