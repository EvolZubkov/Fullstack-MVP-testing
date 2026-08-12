import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BarChart, Chart, LineChart, ProgressRing,
  type BarChartProps, type LineChartProps,
} from './Charts';

const meta: Meta = { title: 'Data/Charts' };
export default meta;
type Story = StoryObj;

// ─── Static stories ───────────────────────────────────────────────────────────

export const Line: Story = {
  render: () => (
    <Chart
      title="Активность слушателей"
      subtitle="за последние 6 недель"
      legend={[
        { label: 'PdM-2', tone: 'purple' },
        { label: 'Excel', tone: 'blue' },
      ]}
    >
      <LineChart
        categories={['1', '2', '3', '4', '5', '6']}
        series={[
          { id: 'pdm', data: [10, 22, 18, 30, 28, 42], area: true },
          { id: 'excel', data: [4, 8, 12, 14, 12, 18] },
        ]}
      />
    </Chart>
  ),
};

export const LineWithLabels: Story = {
  render: () => (
    <Chart
      title="Активность слушателей"
      subtitle="все значения — PdM-2, только экстремумы — Excel"
      legend={[
        { label: 'PdM-2', tone: 'purple' },
        { label: 'Excel', tone: 'blue' },
      ]}
    >
      <LineChart
        categories={['1', '2', '3', '4', '5', '6']}
        labelFormat={(v) => `${v}`}
        series={[
          { id: 'pdm', data: [10, 22, 18, 30, 28, 42], area: true, labels: true },
          { id: 'excel', data: [4, 8, 12, 14, 12, 18], labels: [0, 2, 5], labelFormat: (v) => `${v} ч` },
        ]}
      />
    </Chart>
  ),
};

export const Bar: Story = {
  render: () => (
    <Chart title="Завершения по подразделениям" subtitle="за май">
      <BarChart
        categories={['ОИТ', 'ДКП', 'HR', 'Маркетинг']}
        series={[{ id: 'done', data: [124, 87, 56, 32], labels: 'outside' }]}
      />
    </Chart>
  ),
};

export const BarInside: Story = {
  render: () => (
    <Chart title="Завершения по подразделениям" subtitle="значения внутри">
      <BarChart
        categories={['ОИТ', 'ДКП', 'HR', 'Маркетинг']}
        series={[{ id: 'done', data: [124, 87, 56, 32], labels: 'inside' }]}
        labelFormat={(v) => `${v} чел.`}
      />
    </Chart>
  ),
};

export const Stacked: Story = {
  render: () => (
    <Chart title="Стек завершений" legend={[
      { label: 'Курсы', tone: 'purple' },
      { label: 'Программы', tone: 'green' },
    ]}>
      <BarChart
        categories={['Q1', 'Q2', 'Q3', 'Q4']}
        series={[
          { id: 'courses', data: [40, 55, 60, 75] },
          { id: 'programs', data: [10, 20, 25, 30] },
        ]}
        stacked
      />
    </Chart>
  ),
};

export const Ring: Story = {
  render: () => (
    <div className="ou-story-row-lg">
      <ProgressRing value={62} label={<><strong>62%</strong><div className="ou-story-muted-small">прогресс</div></>} />
      <ProgressRing value={88} size={120} color="var(--ou-success-default)" label={<><strong>88%</strong></>} />
    </div>
  ),
};

// ─── Interactive controls ─────────────────────────────────────────────────────

// Extra args that live only in the story (not real chart props).
type LineControlArgs = LineChartProps & {
  _labelFmt: string;
  _yTickFmt: string;
};

const LINE_TICK_FMT_MAP: Record<string, ((v: number) => string) | undefined> = {
  'авто':   undefined,
  'целое':  (v) => String(Math.round(v)),
  'k':      (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
};

const LINE_DATA_FMT_MAP: Record<string, ((v: number) => string) | undefined> = {
  'значение':  (v) => String(v),
  '+ ч':       (v) => `${v} ч`,
  '+ %':       (v) => `${Math.round(v / 42 * 100)}%`,
};

export const LineControls: StoryObj<LineControlArgs> = {
  name: 'Line / Управление',
  parameters: {
    controls: {
      include: [
        'showGridX', 'hideGrid',
        'hideXAxis', 'hideXLabels', 'hideYAxis', 'hideYLabels',
        'yTickValues', '_yTickFmt',
        '_labelFmt',
      ],
    },
  },
  args: {
    showGridX:   false,
    hideGrid:    false,
    hideXAxis:   false,
    hideXLabels: false,
    hideYAxis:   false,
    hideYLabels: false,
    yTickValues: undefined,
    _yTickFmt:   'авто',
    _labelFmt:   'значение',
  },
  argTypes: {
    showGridX:   { control: 'boolean', description: 'Вертикальная сетка', table: { category: 'Сетка' } },
    hideGrid:    { control: 'boolean', description: 'Скрыть горизонтальную сетку', table: { category: 'Сетка' } },
    hideXAxis:   { control: 'boolean', description: 'Скрыть ось X (линия + подписи)', table: { category: 'Оси' } },
    hideXLabels: { control: 'boolean', description: 'Скрыть только подписи X', table: { category: 'Оси' } },
    hideYAxis:   { control: 'boolean', description: 'Скрыть ось Y (линия + деления)', table: { category: 'Оси' } },
    hideYLabels: { control: 'boolean', description: 'Скрыть только подписи делений Y', table: { category: 'Оси' } },
    yTickValues: {
      control: 'object',
      description: 'Значения делений Y — массив чисел, напр. [0, 15, 30, 45]',
      table: { category: 'Деления' },
    },
    _yTickFmt: {
      control: 'inline-radio',
      options: Object.keys(LINE_TICK_FMT_MAP),
      description: 'Формат подписей делений',
      table: { category: 'Деления' },
    },
    _labelFmt: {
      control: 'inline-radio',
      options: Object.keys(LINE_DATA_FMT_MAP),
      description: 'Формат меток данных',
      table: { category: 'Метки данных' },
    },
  },
  render: ({ _labelFmt, _yTickFmt, categories: _c, series: _s, ...chartArgs }) => {
    const labelFmt = LINE_DATA_FMT_MAP[_labelFmt];
    const tickFmt  = LINE_TICK_FMT_MAP[_yTickFmt];
    return (
      <Chart
        title="Активность слушателей"
        legend={[{ label: 'PdM-2', tone: 'purple' }, { label: 'Excel', tone: 'blue' }]}
      >
        <LineChart
          categories={['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн']}
          series={[
            { id: 'pdm',   data: [10, 22, 18, 30, 28, 42], area: true, labels: true, labelFormat: labelFmt },
            { id: 'excel', data: [4, 8, 12, 14, 12, 18],   labels: [0, 2, 5],        labelFormat: labelFmt },
          ]}
          yTickFormat={tickFmt}
          {...chartArgs}
        />
      </Chart>
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────

type BarControlArgs = BarChartProps & {
  _labelMode: string;
  _labelFmt:  string;
  _yTickFmt:  string;
};

const BAR_LABEL_MODE_MAP: Record<string, false | 'outside' | 'inside'> = {
  'нет':    false,
  'снаружи': 'outside',
  'внутри':  'inside',
};

const BAR_DATA_FMT_MAP: Record<string, ((v: number) => string) | undefined> = {
  'число':    undefined,
  'число + ед.': (v) => `${v} чел.`,
  '%':        (v) => `${Math.round(v / 124 * 100)}%`,
};

const BAR_TICK_FMT_MAP: Record<string, ((v: number) => string) | undefined> = {
  'авто':  undefined,
  'целое': (v) => String(Math.round(v)),
  'k':     (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
};

export const BarControls: StoryObj<BarControlArgs> = {
  name: 'Bar / Управление',
  parameters: {
    controls: {
      include: [
        'showGridX', 'hideGrid',
        'hideXAxis', 'hideXLabels', 'hideYAxis', 'hideYLabels',
        'yTickValues', '_yTickFmt',
        'stacked',
        '_labelMode', '_labelFmt',
      ],
    },
  },
  args: {
    showGridX:   false,
    hideGrid:    false,
    hideXAxis:   false,
    hideXLabels: false,
    hideYAxis:   false,
    hideYLabels: false,
    yTickValues: undefined,
    stacked:     false,
    _labelMode:  'снаружи',
    _labelFmt:   'число',
    _yTickFmt:   'авто',
  },
  argTypes: {
    showGridX:   { control: 'boolean', description: 'Вертикальная сетка', table: { category: 'Сетка' } },
    hideGrid:    { control: 'boolean', description: 'Скрыть горизонтальную сетку', table: { category: 'Сетка' } },
    hideXAxis:   { control: 'boolean', description: 'Скрыть ось X (линия + подписи)', table: { category: 'Оси' } },
    hideXLabels: { control: 'boolean', description: 'Скрыть только подписи X', table: { category: 'Оси' } },
    hideYAxis:   { control: 'boolean', description: 'Скрыть ось Y (линия + деления)', table: { category: 'Оси' } },
    hideYLabels: { control: 'boolean', description: 'Скрыть только подписи делений Y', table: { category: 'Оси' } },
    yTickValues: {
      control: 'object',
      description: 'Значения делений Y — массив чисел, напр. [0, 40, 80, 120]',
      table: { category: 'Деления' },
    },
    _yTickFmt: {
      control: 'inline-radio',
      options: Object.keys(BAR_TICK_FMT_MAP),
      description: 'Формат подписей делений',
      table: { category: 'Деления' },
    },
    stacked: {
      control: 'boolean',
      description: 'Сгруппированные / стек',
      table: { category: 'Вид' },
    },
    _labelMode: {
      control: 'inline-radio',
      options: Object.keys(BAR_LABEL_MODE_MAP),
      description: 'Расположение меток данных',
      table: { category: 'Метки данных' },
    },
    _labelFmt: {
      control: 'inline-radio',
      options: Object.keys(BAR_DATA_FMT_MAP),
      description: 'Формат меток данных',
      table: { category: 'Метки данных' },
    },
  },
  render: ({ _labelMode, _labelFmt, _yTickFmt, stacked, categories: _c, series: _s, ...chartArgs }) => {
    const labelMode = BAR_LABEL_MODE_MAP[_labelMode];
    const labelFmt  = BAR_DATA_FMT_MAP[_labelFmt];
    const tickFmt   = BAR_TICK_FMT_MAP[_yTickFmt];
    return (
      <Chart
        title="Завершения по подразделениям"
        legend={[{ label: 'Курсы', tone: 'purple' }, { label: 'Программы', tone: 'green' }]}
      >
        <BarChart
          categories={['ОИТ', 'ДКП', 'HR', 'Маркетинг']}
          series={[
            { id: 'courses',  data: [80, 55, 36, 20], labels: labelMode || undefined, labelFormat: labelFmt },
            { id: 'programs', data: [44, 32, 20, 12], labels: labelMode || undefined, labelFormat: labelFmt },
          ]}
          stacked={stacked}
          yTickFormat={tickFmt}
          {...chartArgs}
        />
      </Chart>
    );
  },
};
