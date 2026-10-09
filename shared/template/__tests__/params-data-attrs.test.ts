/**
 * @module shared/template/__tests__/params-data-attrs
 * @description Значение параметра как АТРИБУТ корня сцены (спека §6, `dataAttr`).
 *
 * Зачем отдельно от `cssVar`: кастомное свойство — только значение, по нему нельзя
 * выбрать правило. Шаблон, который меняет картинку по выбранному варианту, выбирает
 * ИМЕННО селектором (`[data-brand-logo="b2b"] .logo`), поэтому хосты кладут такие
 * параметры атрибутом. Правило одно на оба хоста — иначе пакет и веб разъедутся.
 */
import { describe, it, expect } from "vitest";
import { buildTemplateDataAttrs, DATA_ATTR_PATTERN } from "../params-css";

const LOGO_PARAM = { key: "brandLogo", dataAttr: "data-brand-logo", default: "plain" };

describe("buildTemplateDataAttrs", () => {
  it("кладёт значение параметра в объявленный атрибут", () => {
    expect(buildTemplateDataAttrs({ brandLogo: "b2b" }, [LOGO_PARAM])).toEqual({
      "data-brand-logo": "b2b",
    });
  });

  it("без значения теста подставляет умолчание манифеста", () => {
    expect(buildTemplateDataAttrs({}, [LOGO_PARAM])).toEqual({ "data-brand-logo": "plain" });
    expect(buildTemplateDataAttrs(null, [LOGO_PARAM])).toEqual({ "data-brand-logo": "plain" });
  });

  it("параметр без dataAttr не даёт атрибута — это не regression, а контракт", () => {
    expect(buildTemplateDataAttrs({ primaryColor: "0 0% 0%" }, [{ key: "primaryColor" }])).toEqual({});
  });

  it("пропускает параметр без значения и без умолчания", () => {
    expect(buildTemplateDataAttrs({}, [{ key: "brandLogo", dataAttr: "data-brand-logo" }])).toEqual({});
  });

  it("читает вложенный ключ через точку, как и сборщик CSS-переменных", () => {
    const attrs = buildTemplateDataAttrs({ brand: { logo: "b2c" } }, [
      { key: "brand.logo", dataAttr: "data-brand-logo" },
    ]);
    expect(attrs).toEqual({ "data-brand-logo": "b2c" });
  });

  it("НЕ ставит атрибут с недопустимым именем: хост не пишет произвольное имя", () => {
    const bad = [
      { key: "a", dataAttr: "onclick", default: "x" },
      { key: "b", dataAttr: "data-BrandLogo", default: "x" },
      { key: "c", dataAttr: "data-", default: "x" },
      { key: "d", dataAttr: "data-a b", default: "x" },
    ];
    expect(buildTemplateDataAttrs({}, bad)).toEqual({});
  });

  it("числовое значение приводится к строке без единиц: это не размер", () => {
    expect(buildTemplateDataAttrs({ n: 3 }, [{ key: "n", dataAttr: "data-n" }])).toEqual({
      "data-n": "3",
    });
  });

  it("шаблон пустого имени — тот же, что проверяет валидатор манифеста", () => {
    expect(DATA_ATTR_PATTERN.test("data-brand-logo")).toBe(true);
    expect(DATA_ATTR_PATTERN.test("data-x1")).toBe(true);
    expect(DATA_ATTR_PATTERN.test("data--x")).toBe(false);
    expect(DATA_ATTR_PATTERN.test("datax")).toBe(false);
  });
});
