/**
 * @module shared/report/report-measures
 *
 * PRD-47 §5.1. Превращает вход измерений ЭКРАНА во вход измерений ОТЧЁТА.
 *
 * Оба хоста уже умеют собирать вход экрана — веб в `server/services/result-context.ts`,
 * пакет в `render/viewResults.js`. Отчёту нужен тот же набор данных и ДРУГИЕ настройки
 * диаграммы: у него свой переключатель вида (PRD-35 §9, документ уносят специалисту).
 * Собирать вход заново на каждом хосте значит держать две сборки синхронными руками — а
 * этот продукт уже трижды платил за такие пары.
 *
 * Что берётся откуда:
 * - вид, предел оси, переключатель радара — из полей варианта ОТЧЁТА;
 * - облик шкал (цвет и пиктограмма) — с ЭКРАНА: колонки у отчёта нет и не будет,
 *   покраска не свойство страницы, и профиль в двух документах не может оказаться
 *   разного цвета;
 * - измерения, шкала уровней, признак ипсативности — с экрана без изменений.
 *
 * Пиктограммы приезжают УЖЕ разрешёнными в контуры — экранный вход собирают сервер
 * (`withResolvedScaleIcons`) и выпечка пакета. Разрешать их здесь второй раз нечем:
 * таблицы глифов в пакете нет.
 */
import type { MeasuresInput } from "../template/result-context";
import type { ChartKindSettings } from "../template/scales-chart";

/** Поля варианта отчёта, как их отдаёт `resolveReportBake`. */
export interface ReportChartValues {
  scalesChartKind?: unknown;
  radarAxisLimit?: unknown;
  showCompetencyRadar?: unknown;
}

/**
 * Вход измерений для отчёта.
 *
 * @param screen Вход измерений экрана итогов этого же прогона.
 * @param values Значения полей варианта отчёта, уже слитые с умолчаниями манифеста.
 * @returns Новый объект; `screen` не мутируется — его тут же рисует экран.
 */
export function buildReportMeasures(
  screen: MeasuresInput,
  values: ReportChartValues,
): MeasuresInput {
  const chartSettings: ChartKindSettings = {
    // Экранные настройки — ПЕРВЫМИ: из них нужен облик, а вид и предел оси ниже
    // перекрываются полями отчёта. Незаявленное поле отчёта затирает экранное
    // сознательно: иначе тест, где автор выключил диаграмму в отчёте, печатал бы её,
    // унаследовав вид с экрана.
    ...(screen.chartSettings ?? {}),
    scalesChartKind: values.scalesChartKind as ChartKindSettings["scalesChartKind"],
    radarAxisLimit: values.radarAxisLimit as ChartKindSettings["radarAxisLimit"],
    showCompetencyRadar: values.showCompetencyRadar === true,
  };
  return { ...screen, chartSettings };
}
