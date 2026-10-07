/**
 * @module features/tests/editor/sections/sim-penalties
 * @description «Сценарий в ИС», этап Э5а: штрафы сценария — согласованный эскиз
 * `docs/wireframes/sim-scenario-test-editor.html` (состояния sim-e5-answer, sim-e5-qscoring).
 *
 * Одна таблица служит двум уровням цепочки «система → тест → вопрос»: блоку «Штрафы сценариев по
 * умолчанию» вкладки «Оценка ответа» и окну «Оценка вопроса в тесте». Штраф хранится долей цены
 * (0,05), показывается процентами (5). Пустое поле — значение уровнем выше, оно стоит в поле
 * подсказкой.
 */
import { Input, SegmentedControl, Switch } from "@skillum/ui-kit";
import { SIM_PENALTY_KEYS, type SimPenalties } from "@shared/sim/scoring";
import type { SimScoringSettings } from "@shared/schema";

/** Подписи штрафов — в порядке эскиза. */
export const SIM_PENALTY_LABEL: Record<keyof SimPenalties, string> = {
  miss: "Промах — щелчок мимо действий экрана",
  blocked: "Недоступное действие — условие действия не выполнено",
  wrongValue: "Неверное значение в поле",
  detour: "Шаг в сторону — действие мимо основного и других путей",
  trap: "Ловушка",
  hint: "Подсказка",
};

/** Доля цены → проценты для поля; без хвоста плавающей точки. */
export function shareToPercent(share: number): string {
  return String(Math.round(share * 10000) / 100);
}

/** Проценты из поля → доля; пусто — `null` (наследовать); неверное — `undefined`. */
export function percentToShare(raw: string): number | null | undefined {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 10000;
}

export interface SimPenaltiesTableProps {
  /** Штрафы этого уровня (доли); отсутствующий — наследуется. */
  value: SimScoringSettings["penalties"] | null | undefined;
  /** Значения уровнем выше (доли) — подсказки пустых полей. */
  inherited: SimPenalties;
  onChange: (next: NonNullable<SimScoringSettings["penalties"]>) => void;
  disabled?: boolean;
  /** Подпись таблицы для чтения с экрана. */
  label: string;
  testIdPrefix: string;
}

/** Таблица «Штраф — В этом тесте». */
export function SimPenaltiesTable({ value, inherited, onChange, disabled, label, testIdPrefix }: SimPenaltiesTableProps) {
  const set = (key: keyof SimPenalties, raw: string) => {
    const share = percentToShare(raw);
    if (share === undefined) return;
    const next = { ...(value ?? {}) };
    if (share === null) delete next[key];
    else next[key] = share;
    onChange(next);
  };
  return (
    <table className="tb-table tb-weights" aria-label={label}>
      <thead>
        <tr>
          <th>Штраф</th>
          <th>В этом тесте</th>
        </tr>
      </thead>
      <tbody>
        {SIM_PENALTY_KEYS.map((key) => {
          const own = value?.[key];
          return (
            <tr key={key}>
              <td>{SIM_PENALTY_LABEL[key]}</td>
              <td>
                <Input
                  size="s"
                  fullWidth
                  inputMode="decimal"
                  value={typeof own === "number" ? shareToPercent(own) : ""}
                  placeholder={shareToPercent(inherited[key])}
                  suffix="%"
                  disabled={disabled}
                  aria-label={SIM_PENALTY_LABEL[key]}
                  onChange={(e) => set(key, e.target.value)}
                  data-testid={`${testIdPrefix}-${key}`}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const PARTIAL_HINT = "Все критичные проверки цели прошли, часть остальных — нет: балл по доле пройденных проверок";

/** «Засчитывать частичное выполнение» уровня теста: переключатель. */
export function SimPartialSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      label="Засчитывать частичное выполнение"
      description={PARTIAL_HINT}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      data-testid="sim-partial-switch"
    />
  );
}

type PartialChoice = "inherit" | "on" | "off";

/**
 * «Частичное выполнение» вопроса: выбор из трёх. Переключатель здесь не годится — он не умеет
 * сказать «как в тесте».
 */
export function SimPartialChoice({
  value,
  inherited,
  onChange,
  disabled,
}: {
  value: boolean | null | undefined;
  inherited: boolean;
  onChange: (next: boolean | null) => void;
  disabled?: boolean;
}) {
  const current: PartialChoice = value === true ? "on" : value === false ? "off" : "inherit";
  return (
    <div className="ou-formfield">
      <label className="ou-formfield__lbl" id="sim-partial-lbl">Частичное выполнение</label>
      <SegmentedControl<PartialChoice>
        size="s"
        value={current}
        aria-labelledby="sim-partial-lbl"
        // У контрола нет общего `disabled` — недоступность задаётся каждому пункту.
        items={[
          { value: "inherit", label: "Как в тесте", disabled },
          { value: "on", label: "Засчитывать", disabled },
          { value: "off", label: "Не засчитывать", disabled },
        ]}
        onChange={(next) => onChange(next === "inherit" ? null : next === "on")}
        data-testid="sim-partial-choice"
      />
      <div className="ou-formfield__desc">
        {inherited ? `В тесте — засчитывается: ${PARTIAL_HINT.charAt(0).toLowerCase()}${PARTIAL_HINT.slice(1)}` : "В тесте — не засчитывается: частичное выполнение даёт ноль"}
      </div>
    </div>
  );
}
