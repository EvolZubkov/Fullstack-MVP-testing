/**
 * @module features/analytics/test/scale-profile
 * @description PRD-56 FR-21, FR-21a, FR-21b: профиль измерительного теста по шкалам.
 *
 * Две карточки, потому что вопросы разные. «Профиль по шкалам» отвечает, где выборка в среднем
 * стоит по каждой шкале; «Распределение уровней» — как люди разошлись по полосам толкования, и
 * у каждой шкалы полоса СВОЯ: полосы задаются в самой шкале (PRD-45), у одной их три с одними
 * названиями, у другой пять с другими, и общая легенда была бы ложью.
 *
 * Средние рисуются АКЦЕНТОМ, а не тонами «успех / предупреждение» (FR-21b): эталона у опросника
 * не существует, и высокое значение шкалы не «хорошо», а низкое не «плохо» — тон выносил бы
 * оценку, которой методика не выносит. Цвета полос приходят готовыми с сервера: экран их не
 * выбирает, иначе один и тот же уровень окрасится здесь иначе, чем в итогах участника.
 */
import { Card, CardBody, CardHeader, ProgressBar, ProgressStacked, Stack, Text } from "@skillum/ui-kit";

import { percent } from "../format";

export interface ScaleBandView {
  level: string;
  label: string;
  count: number;
  share: number;
  /** ГОТОВЫЙ CSS-цвет: его решает сервер по рампе теста и тону уровня (FR-21a). */
  color: string;
  tone: string | null;
}

export interface ScaleProfileView {
  key: string;
  label: string;
  average: number | null;
  sampleSize: number;
  domainMin: number | null;
  domainMax: number | null;
  hasBands: boolean;
  bands: ScaleBandView[];
}

export interface ScaleProfilePanelProps {
  scales: ScaleProfileView[];
  observations: number;
}

/** Доля значения в домене шкалы: ею и заполняется полоса среднего. */
function fill(scale: ScaleProfileView): number {
  if (scale.average === null) return 0;
  const min = scale.domainMin ?? 0;
  const max = scale.domainMax ?? 0;
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((scale.average - min) / (max - min)) * 100));
}

/** Подпись среднего: «27 из 35», а без домена — просто значение. */
function averageText(scale: ScaleProfileView): string {
  if (scale.average === null) return "значения не считались";
  const rounded = Math.round(scale.average * 10) / 10;
  return scale.domainMax === null
    ? `среднее ${rounded}`
    : `среднее ${rounded} из ${scale.domainMax}`;
}

export function ScaleProfilePanel({ scales, observations }: ScaleProfilePanelProps) {
  const withBands = scales.filter(scale => scale.bands.length > 0);
  // Две РАЗНЫЕ причины молчать, и путать их нельзя: у одной шкалы полос нет вовсе, у другой
  // они заданы, но распределять пока некого. «Полосы не заданы» на второй — прямая неправда.
  const withoutBands = scales.filter(scale => scale.bands.length === 0);

  return (
    <Stack gap={5}>
      <Card>
        <CardHeader
          title="Профиль по шкалам"
          subtitle={`${observations} прохождений опросника · среднее значение по каждой шкале`}
        />
        <CardBody>
          {scales.length === 0 ? (
            <Text variant="body-s" tone="muted">У теста нет шкал: показывать нечего.</Text>
          ) : (
            <Stack gap={4}>
              {scales.map(scale => (
                <Stack key={scale.key} gap={1}>
                  <Text variant="body-s">{scale.label}</Text>
                  {/* Акцент, а не тон: у опросника нет эталона, и цвет здесь не судит. */}
                  <ProgressBar value={fill(scale)} size="s" hideHeader />
                  <Text variant="body-xs" tone="muted">
                    {averageText(scale)} · {scale.sampleSize} прохождений
                  </Text>
                </Stack>
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Распределение уровней"
          subtitle="Доля участников в каждой полосе толкования — у каждой шкалы своя шкала полос"
        />
        <CardBody>
          <Stack gap={4}>
            {withBands.map(scale => (
              <Stack key={scale.key} gap={1}>
                <Stack direction="row" gap={4} justify="between" align="baseline">
                  <Text variant="body-s" weight="medium">{scale.label}</Text>
                  <Text variant="body-xs" tone="muted">
                    {scale.sampleSize} прохождений · {scale.bands.length} полос
                  </Text>
                </Stack>
                <ProgressStacked
                  showLegend
                  segments={scale.bands.map(band => ({
                    value: Math.round(band.share),
                    color: band.color,
                    label: `${band.label} — ${percent(band.share)}`,
                  }))}
                />
              </Stack>
            ))}
            {/* Шкала без полос молчит ЧЕСТНО: пустая полоса читалась бы как «никто никуда не
                попал», хотя строить распределение просто не по чему. */}
            {withoutBands.map(scale => (
              <Stack key={scale.key} gap={1}>
                <Text variant="body-s" weight="medium" tone="muted">{scale.label}</Text>
                <Text variant="body-xs" tone="muted">
                  {scale.hasBands
                    ? `полосы заданы, но прохождений с этим значением нет · ${scale.sampleSize} прохождений`
                    : `полосы толкования не заданы · ${scale.sampleSize} прохождений`}
                </Text>
              </Stack>
            ))}
            {scales.length === 0 && (
              <Text variant="body-s" tone="muted">Полос толкования пока не по чему строить.</Text>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
