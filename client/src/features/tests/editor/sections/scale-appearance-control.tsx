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

import { useMemo, useState } from "react";
import { Banner, ColorPicker } from "@universityrt/ui-kit";
import { IconGlyph, IconPickerModal, useGlyphTable, type GlyphTable } from "./icon-picker-modal";
import { buildRoseChart } from "@shared/template/rose-view";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import { categoricalColor } from "@shared/template/categorical-palette";
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

/**
 * Colour the picker shows for a scale the author has not painted yet.
 *
 * The PALETTE SLOT, not a constant: the slot is what the rose actually draws until the author
 * overrides it, and a row showing one colour while the sector beside it shows another would be
 * a lie about the current state. The slot is reserved by POSITION, so it is the position that
 * decides — the same rule the renderer follows.
 *
 * Past the end of the palette there is no slot; the rose refuses to draw more than six scales
 * anyway, so the chip falls back to a neutral rather than pretending a seventh hue exists.
 */
function unsetHex(index: number): string {
  return toHex(categoricalColor(index) ?? "", NEUTRAL_HEX);
}

/** Neutral used where no identity hue applies: past the palette, and on a disabled field. */
const NEUTRAL_HEX = "#7A7F8A";

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
  /** Key of the scale whose pictogram picker is open; `null` while none is. */
  const [picking, setPicking] = useState<string | null>(null);

  const map = useMemo(() => parseScaleAppearance(value), [value]);
  // The glyph table is a quarter of a megabyte, so it is fetched only once something needs
  // drawing: a set pictogram to show in a row, or an open picker asking for the whole set.
  const glyphs = useGlyphTable(picking !== null || Object.values(map).some((l) => l.icon));
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

  /**
   * Write the chosen glyph NAME. The contours are not written here: they are resolved by the
   * host when the chart is built, so the stored value survives a library upgrade and no editor
   * ever bakes geometry into the test.
   */
  const setIcon = (key: string, icon: string | undefined) => {
    setPicking(null);
    if (disabled) return;
    const look = { ...map[key] };
    if (icon) look.icon = icon;
    else delete look.icon;
    // A row with neither colour nor pictogram leaves the map entirely: an entry that declares
    // nothing would still make «this scale is dressed» true for every reader of the map.
    const next: ScaleAppearanceMap = { ...map };
    if (look.color === undefined && look.icon === undefined) delete next[key];
    else next[key] = look;
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
                ? "Цвет доступен, потому что ни у одной шкалы теста не объявлено направление. Стоит объявить его хотя бы у одной — и цвет по идентичности пропадёт у ВСЕХ: два языка цвета на одной фигуре не смешиваются, роза целиком перейдёт на схему уровней. Пиктограммы это не затрагивает."
                : "Хотя бы у одной шкалы объявлено направление, поэтому цвет на розе показывает уровень и совпадает с линейкой в карточке рядом. Задать свой цвет нельзя: два языка цвета на одной фигуре не смешиваются. Пиктограмма остаётся доступной — она несёт идентичность, а не оценку."
            }
            data-testid={`${testId}-color-rule`}
          />
          <div className="tb-appearance">
            <div className="tb-appearance__list">
              {drawn.map((scale, index) => {
                const stored = map[scale.key]?.color;
                return (
                  <div className="tb-appearance__row" key={scale.key}>
                    <span className="tb-appearance__name">{scale.label || scale.key}</span>
                    <ColorPicker
                      // Neutral while the field is off. The swatch is an assertion about what
                      // the sector will be painted, and where a direction is declared that is
                      // the LEVEL the learner reached — a hue no editor can know. Leaving the
                      // identity colour on a disabled chip would state the one thing that is
                      // certainly not going to be drawn.
                      value={byIdentity ? toHex(stored, unsetHex(index)) : NEUTRAL_HEX}
                      // The picker speaks HEX and the renderer's contract is an HSL triple, so
                      // the value converts on the way out (see `color-format`): one format in
                      // storage, and no `hsl(#RRGGBB)` ever reaches a stylesheet.
                      onChange={(hex) => setColor(scale.key, hex)}
                      disabled={disabled || !byIdentity}
                      valueLabel={byIdentity ? undefined : "По схеме уровней"}
                      aria-label={`Цвет шкалы «${scale.label || scale.key}»`}
                      data-testid={`${testId}-color-${scale.key}`}
                    />
                    <IconTrigger
                      icon={map[scale.key]?.icon}
                      glyphs={glyphs}
                      scaleLabel={scale.label || scale.key}
                      onOpen={() => setPicking(scale.key)}
                      testId={`${testId}-icon-${scale.key}`}
                    />
                  </div>
                );
              })}
            </div>
            <ScaleSetPreview
              scales={drawn}
              map={map}
              glyphs={glyphs}
              byIdentity={byIdentity}
              testId={testId}
            />
          </div>
          {hiddenCount > 0 && (
            <p className="tb-appearance__note" data-testid={`${testId}-hidden-note`}>
              Скрытых от учащегося шкал: {hiddenCount}. На диаграмме они не рисуются, поэтому строк для них нет.
            </p>
          )}
          {picking !== null && (
            <IconPickerModal
              scaleLabel={drawn.find((s) => s.key === picking)?.label || picking}
              value={map[picking]?.icon}
              onPick={(name) => setIcon(picking, name)}
              onClose={() => setPicking(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The pictogram cell of a row: the current glyph plus its name, or an explicit «не выбрана».
 *
 * The empty box is DASHED and not blank. A pictogram is optional, so «not chosen» has to read
 * as a state of the field; an empty square reads as a glyph that failed to load.
 *
 * Available even where the colour is not: a pictogram carries identity, not a verdict, so it
 * does not argue with the level the colour states.
 */
function IconTrigger(props: {
  icon: string | undefined;
  glyphs: GlyphTable | null;
  scaleLabel: string;
  onOpen: () => void;
  testId: string;
}) {
  const paths = props.icon ? (props.glyphs?.[props.icon] ?? null) : null;
  return (
    <button
      type="button"
      className="tb-icon-trigger"
      onClick={props.onOpen}
      aria-label={`Пиктограмма шкалы «${props.scaleLabel}»`}
      data-testid={props.testId}
    >
      {paths ? (
        <span className="tb-icon-trigger__box">
          <IconGlyph paths={paths} size={18} />
        </span>
      ) : (
        <span className="tb-icon-trigger__box tb-icon-trigger__box--empty" aria-hidden="true" />
      )}
      {props.icon ? <span>{props.icon}</span> : <span className="tb-appearance__note">Не выбрана</span>}
    </button>
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
  glyphs: GlyphTable | null;
  byIdentity: boolean;
  testId: string;
}) {
  const { scales, map, glyphs, byIdentity, testId } = props;

  const chart = useMemo(() => {
    if (!byIdentity) return null;
    return buildRoseChart({
      axes: scales.map((scale, i) => {
        const icon = map[scale.key]?.icon;
        const paths = icon ? glyphs?.[icon] : undefined;
        return {
          key: scale.key,
          name: scale.label || scale.key,
          value: PREVIEW_WEIGHTS[i % PREVIEW_WEIGHTS.length],
          visibility: "level_and_value" as const,
          interpretation: { domainMin: null, domainMax: null, valence: scale.valence, bands: [] },
          ...(map[scale.key]?.color ? { color: map[scale.key].color } : {}),
          // Resolved here for the same reason the hosts resolve: the builder places CONTOURS,
          // never a name. The preview therefore shows the very glyph the chart will draw.
          ...(paths && paths.length ? { iconPaths: paths } : {}),
        };
      }),
      ramp: LEVEL_SCHEMES.traffic,
    });
  }, [scales, map, glyphs, byIdentity]);

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
        {chart.icons.map((icon, i) => (
          <g key={`icon-${i}`} className="tb-rose__icon" transform={icon.transform}>
            {icon.paths.map((d, j) => (
              <path key={j} d={d} />
            ))}
          </g>
        ))}
      </svg>
      <p className="tb-appearance__note">
        Превью набора: соседние секторы смыкаются, поэтому близкие оттенки видно сразу — по
        одному цвету этого не заметить. Доли взяты условные, они ничего не говорят о тесте.
      </p>
    </div>
  );
}
