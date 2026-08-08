/**
 * @module features/tests/editor/sections/scale-appearance-control
 * @description The «Оформление шкал» property of the «Итоги теста» variant (PRD-46 §7):
 * one row per scale, where the author gives the scale the colour the rose paints its sector
 * with, plus a preview of the WHOLE set beside the rows.
 *
 * Why a set and not a field per scale. Sectors of a rose touch each other, so two close hues
 * are indistinguishable exactly where they meet — and that is invisible while picking colours
 * one at a time. The rows and the figure therefore stand side by side, and the figure is built
 * by the very core that draws the results screen (`buildRoseChart`), not by a lookalike.
 *
 * Why colour is disabled rather than hidden when a direction is declared. On a scale with a
 * declared direction the colour states the VERDICT and has to agree with the ruler in the card
 * next to the chart; an identity colour there would put two different colours on one value.
 * One such scale switches the whole figure over — mixing two colour languages on one figure was
 * rejected — so the field is disabled for ALL scales and the reason is spelled out. A field
 * that simply vanished would read as a defect.
 *
 * Storage is a MAP keyed by the scale key, in the variant settings; see
 * `shared/template/scale-appearance` for the contract and why it does not live on the scale.
 */

import { useMemo } from "react";
import { Banner, ColorPicker } from "@universityrt/ui-kit";
import { buildRoseChart } from "@shared/template/rose-view";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import { parseScaleAppearance, type ScaleAppearanceMap } from "@shared/template/scale-appearance";
import type { LearnerVisibility, Valence } from "@shared/scales/interpretation";
import { fromHex, toHex } from "./color-format";

/** One scale of the test as this control needs it — identity, order and the two rules. */
export interface AppearanceScale {
  key: string;
  label: string;
  valence: Valence;
  learnerVisibility: LearnerVisibility;
}

/**
 * Relative weights of the PREVIEW figure, in drawing order.
 *
 * The preview needs a shape, and an even split would draw a plain disc where the real chart
 * draws a rose — the sector edges the eye actually compares would be missing. The numbers are
 * fixed and carry no claim about the test: they exist so that adjacent sectors differ in
 * radius the way a real profile makes them differ.
 */
const PREVIEW_WEIGHTS = [10, 5, 4, 10, 7, 6];

/** Colour offered by the picker for a scale the author has not painted yet. */
const UNSET_HEX = "#8F6AE6";

export function ScaleAppearanceControl(props: {
  label: string;
  description?: string;
  /** The stored map, straight from `settings_json` — parsed here, never trusted. */
  value: unknown;
  onChange: (value: unknown) => void;
  scales: AppearanceScale[];
  disabled?: boolean;
  testId: string;
}) {
  const { label, description, value, onChange, scales, testId } = props;
  const disabled = Boolean(props.disabled);

  const map = useMemo(() => parseScaleAppearance(value), [value]);
  // The chart draws what the learner sees, so those are the scales worth dressing. A scale
  // hidden from the learner never reaches the figure; its stored entry survives untouched and
  // comes back the moment the scale is shown again.
  const drawn = useMemo(() => scales.filter((s) => s.learnerVisibility !== "hidden"), [scales]);
  const hiddenCount = scales.length - drawn.length;

  // The SAME rule the rose applies (`rose-view`: `byIdentity`). Kept as one predicate over the
  // drawn scales so the editor cannot offer a colour the renderer would then ignore.
  const byIdentity = drawn.length > 0 && drawn.every((s) => s.valence === "none");

  const setColor = (key: string, hex: string) => {
    if (disabled) return;
    const previous = map[key]?.color;
    const next: ScaleAppearanceMap = {
      ...map,
      [key]: { ...map[key], color: fromHex(hex, previous, "hsl") },
    };
    onChange(next);
  };

  return (
    <div className="tb-appearance-field" data-testid={testId}>
      <span className="ou-formfield__lbl">{label}</span>
      {description && <span className="ou-formfield__desc">{description}</span>}

      {drawn.length === 0 ? (
        <Banner
          tone="info"
          size="sm"
          description={
            scales.length === 0
              ? "В тесте нет шкал. Диаграмма по шкалам строится из них, поэтому оформлять пока нечего."
              : "Все шкалы теста скрыты от учащегося. Диаграмма рисует только видимые шкалы, поэтому оформлять пока нечего."
          }
          data-testid={`${testId}-empty`}
        />
      ) : (
        <>
          <Banner
            tone="info"
            size="sm"
            description={
              byIdentity
                ? "Цвет доступен, потому что ни у одной шкалы теста не объявлено направление. Стоит объявить его хотя бы у одной — и цвет по идентичности пропадёт у ВСЕХ: два языка цвета на одной фигуре не смешиваются, роза целиком перейдёт на схему уровней."
                : "Хотя бы у одной шкалы объявлено направление, поэтому цвет на розе показывает уровень и совпадает с линейкой в карточке рядом. Задать свой цвет нельзя: два языка цвета на одной фигуре не смешиваются."
            }
            data-testid={`${testId}-color-rule`}
          />
          <div className="tb-appearance">
            <div className="tb-appearance__list">
              {drawn.map((scale) => {
                const stored = map[scale.key]?.color;
                return (
                  <div className="tb-appearance__row" key={scale.key}>
                    <span className="tb-appearance__name">{scale.label || scale.key}</span>
                    <ColorPicker
                      value={toHex(stored, UNSET_HEX)}
                      // The picker speaks HEX and the renderer's contract is an HSL triple, so
                      // the value converts on the way out (see `color-format`): one format in
                      // storage, and no `hsl(#RRGGBB)` ever reaches a stylesheet.
                      onChange={(hex) => setColor(scale.key, hex)}
                      disabled={disabled || !byIdentity}
                      valueLabel={byIdentity ? undefined : "По схеме уровней"}
                      aria-label={`Цвет шкалы «${scale.label || scale.key}»`}
                      data-testid={`${testId}-color-${scale.key}`}
                    />
                  </div>
                );
              })}
            </div>
            <ScaleSetPreview scales={drawn} map={map} byIdentity={byIdentity} testId={testId} />
          </div>
          {hiddenCount > 0 && (
            <p className="tb-appearance__note" data-testid={`${testId}-hidden-note`}>
              Скрытых от учащегося шкал: {hiddenCount}. На диаграмме они не рисуются, поэтому строк для них нет.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The set as the rose will draw it — figure only, no captions.
 *
 * Built by `buildRoseChart`, the same builder both players use, so what the author compares
 * here is the geometry and the colours they will actually get. The captions are left out on
 * purpose: this preview answers «do two neighbouring sectors read apart», and names around the
 * figure would only shrink it.
 *
 * Drawn ONLY where colour carries identity. With a direction declared the sector colour is the
 * level the learner reached, which no editor can know — a preview there would be a picture of
 * invented answers.
 */
function ScaleSetPreview(props: {
  scales: AppearanceScale[];
  map: ScaleAppearanceMap;
  byIdentity: boolean;
  testId: string;
}) {
  const { scales, map, byIdentity, testId } = props;

  const chart = useMemo(() => {
    if (!byIdentity) return null;
    return buildRoseChart({
      axes: scales.map((scale, i) => ({
        key: scale.key,
        name: scale.label || scale.key,
        value: PREVIEW_WEIGHTS[i % PREVIEW_WEIGHTS.length],
        visibility: "level_and_value" as const,
        interpretation: { domainMin: null, domainMax: null, valence: scale.valence, bands: [] },
        ...(map[scale.key]?.color ? { color: map[scale.key].color } : {}),
      })),
      ramp: LEVEL_SCHEMES.traffic,
    });
  }, [scales, map, byIdentity]);

  if (!byIdentity) {
    return (
      <p className="tb-appearance__note" data-testid={`${testId}-preview-off`}>
        Предпросмотр набора не строится: цвет секторов показывает уровень и зависит от ответов
        учащегося.
      </p>
    );
  }
  if (!chart) {
    // The builder's own refusal, shown as its reason rather than as an empty box: under three
    // scales there is no figure to divide, over six a sector is narrower than its own caption.
    return (
      <p className="tb-appearance__note" data-testid={`${testId}-preview-none`}>
        Роза рисуется от трёх до шести видимых шкал. Сейчас их {scales.length} — предпросмотр не
        строится.
      </p>
    );
  }

  return (
    <div>
      <svg
        className="tb-appearance__preview"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Превью: так выглядит набор на диаграмме"
        data-testid={`${testId}-preview`}
      >
        {chart.sectors.map((sector) => (
          <path
            key={sector.key}
            className={`tb-rose__sector ${sector.overflowClass}`.trim()}
            d={sector.d}
            style={{ ["--tb-hue" as string]: sector.color }}
          />
        ))}
        {chart.rings.map((ring, i) => (
          <circle key={`ring-${i}`} className="tb-chart__ring" cx={ring.cx} cy={ring.cy} r={ring.radius} />
        ))}
        {chart.spokes.map((spoke, i) => (
          <line key={`spoke-${i}`} className="tb-chart__axis" x1={spoke.cx} y1={spoke.cy} x2={spoke.x} y2={spoke.y} />
        ))}
      </svg>
      <p className="tb-appearance__note">
        Превью набора: соседние секторы смыкаются, поэтому близкие оттенки видно сразу — по
        одному цвету этого не заметить. Доли взяты условные, они ничего не говорят о тесте.
      </p>
    </div>
  );
}
