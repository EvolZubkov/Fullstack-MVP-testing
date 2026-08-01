/**
 * Материализация домена шкалы (PRD-35 §5).
 *
 * Проверяется чистая часть: какой патч конфигурации получает шкала. Запись домена
 * в данные — а не расчёт при отрисовке — нужна ради воспроизводимости (NFR-21):
 * иначе добавление вопроса в тест перерисовало бы радар уже сданной попытки.
 */
import { describe, expect, it } from "vitest";
import { domainPatch } from "../server/services/scale-domain";

describe("domainPatch", () => {
  it("заполняет пустой домен расчётным диапазоном", () => {
    const config = { bands: [{ min: 0, max: 45, level: "l0" }] };
    expect(domainPatch(config, { min: 0, max: 45 })).toEqual({
      bands: config.bands,
      domainMin: 0,
      domainMax: 45,
    });
  });

  it("не трогает домен, заданный автором", () => {
    const config = { domainMin: 0, domainMax: 60, bands: [] };
    expect(domainPatch(config, { min: 0, max: 45 })).toBeNull();
  });

  it("не трогает шкалу, у которой задана только одна граница", () => {
    // Половина домена — это не домен: дописывать вторую границу расчётом значило бы
    // смешать замысел автора с арифметикой инструмента.
    const config = { domainMin: 0, bands: [] };
    expect(domainPatch(config, { min: 0, max: 45 })).toEqual({
      bands: [],
      domainMin: 0,
      domainMax: 45,
    });
  });

  it("отказывается, когда диапазон не вычислим", () => {
    expect(domainPatch({ bands: [] }, null)).toBeNull();
  });

  it("отказывается от вырожденного диапазона", () => {
    // Нулевая ширина дала бы деление на ноль в радиусе и «домен», в котором любое
    // значение стоит в одной точке.
    expect(domainPatch({ bands: [] }, { min: 5, max: 5 })).toBeNull();
  });

  it("сохраняет прочие поля конфигурации нетронутыми", () => {
    const config = { valence: "lower_is_better", bands: [{ min: 0, max: 10, level: "l0" }] };
    const patch = domainPatch(config, { min: 0, max: 10 });
    expect(patch).toMatchObject({ valence: "lower_is_better", domainMin: 0, domainMax: 10 });
  });
});
