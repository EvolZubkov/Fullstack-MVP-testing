/**
 * @module features/analytics/registry/__tests__/registry
 * @description PRD-56 FR-01 - FR-03: экран реестра прохождений.
 *
 * Проверяется договор экрана с человеком и с сервером: какие условия он показывает чипами,
 * что запрашивает при их смене, как догружает следующую порцию и что говорит, когда под
 * условия ничего не подошло. Разметку рисуют компоненты ui-kit — их поведение здесь не
 * переспрашивается.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassageRegistry } from "../passage-registry";

/** Ответ ручки реестра: одна страница прохождений и общее число. */
function page(rows: unknown[], total: number) {
  return { ok: true, json: async () => ({ rows, total, limit: 25, offset: 0 }) };
}

const ROW = {
  id: "web-1", participant: "Морозова Анна", participantKey: null, userId: "u1",
  testId: "t1", testTitle: "Сертификация руководителей",
  startedAt: "2026-09-11T14:00:00.000Z", finishedAt: "2026-09-11T14:20:00.000Z",
  durationMs: 1_200_000, percent: 78, passed: true, outcome: "passed",
  source: "web", groupId: null, groups: ["Отдел продаж"],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => (String(url).includes("/analytics/filters")
    // Сохранённые фильтры — своя ручка: она ничего не считает, а отдаёт условия (решение
    // владельца 2026-09-25 о разведении фильтра и среза).
    ? { ok: true, json: async () => ({ filters: [{ id: "f1", name: "Мои потоки", conditions: { testIds: ["t1", "t2"], sources: ["web"] } }] }) }
    : page([ROW], 1)));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", class {
    observe() { /* догрузка проверяется отдельным тестом */ }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Условия последнего запроса к ручке реестра. */
function lastQuery(): URLSearchParams {
  const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

describe("PassageRegistry", () => {
  it("показывает прохождения, которые вернула ручка", async () => {
    render(<PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText("Морозова Анна")).toBeTruthy();
    expect(screen.getByText("Сертификация руководителей")).toBeTruthy();
  });

  // FR-01: группа названа прямо в перечне колонок реестра, а FR-09 говорит, что прохождение
  // вне групп не исчезает. Обе половины проверяются здесь, потому что одна без другой
  // оставляет колонку, которая молчит ровно там, где от неё ждут ответа.
  it("показывает группы прохождения, а вне групп говорит «без группы»", async () => {
    fetchMock.mockResolvedValue(page([
      { ...ROW, groups: ["Отдел продаж", "Поток 2026"] },
      { ...ROW, id: "web-2", participant: "Сомов Пётр", groups: [] },
    ], 2));

    render(<PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText("Группа")).toBeTruthy();
    expect(screen.getByText("Отдел продаж, Поток 2026")).toBeTruthy();
    expect(screen.getByText("без группы")).toBeTruthy();
  });

  it("говорит в подзаголовке, сколько прохождений и откуда они", async () => {
    fetchMock.mockResolvedValue(page([ROW], 1284));

    render(<PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText(/1284 прохождения за всё время/)).toBeTruthy();
    expect(screen.getByText(/веб, телеметрия LMS и импортированные выгрузки/)).toBeTruthy();
  });

  it("говорит, что число относится к условиям отбора, когда они есть", async () => {
    fetchMock.mockResolvedValue(page([ROW], 128));

    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["import"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    // «128 прохождений» без оговорки читается как весь объём данных — и тогда снятие условия
    // выглядит потерей данных, а не расширением выборки.
    expect(await screen.findByText(/128 прохождений под условия отбора/)).toBeTruthy();
  });

  it("печатает в подвале, сколько строк показано из скольких", async () => {
    fetchMock.mockResolvedValue(page([ROW], 128));

    render(<PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText(/Показано 1 из 128/)).toBeTruthy();
  });

  it("переносит условия отбора в запрос", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["import"], outcomes: ["failed"], from: "2026-09-01" }}
        onFilterChange={() => {}}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const query = lastQuery();
    expect(query.getAll("testId")).toEqual(["t1"]);
    expect(query.getAll("source")).toEqual(["import"]);
    expect(query.getAll("outcome")).toEqual(["failed"]);
    expect(query.get("from")).toBe("2026-09-01");
  });

  it("называет тест и группу в чипах по-человечески", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/tests")) {
        return { ok: true, json: async () => [{ id: "t1", title: "Сертификация руководителей" }] };
      }
      if (String(url).startsWith("/api/groups")) {
        return { ok: true, json: async () => [{ id: "g1", name: "Розница" }] };
      }
      return page([ROW], 1);
    });

    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: ["g1"], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    // Идентификатор в чипе не говорит читателю ничего: применённое условие он узнаёт по
    // названию, а по «6e10d1e6-0fc9…» не может ни проверить отбор, ни объяснить его коллеге.
    expect(await screen.findByText("Тест: Сертификация руководителей")).toBeTruthy();
    expect(screen.getByText("Группа: Розница")).toBeTruthy();
  });

  it("снимает оргусловие по одному значению, не трогая соседнее (FR-06b)", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: ["Отдел продаж", "Логистика: склад"], positions: [], sources: [], outcomes: [] }}
        onFilterChange={onFilterChange}
      />,
    );

    // Двоеточие внутри значения — не граница вида условия: снять надо именно «Логистика: склад».
    await userEvent.click(
      await screen.findByRole("button", { name: /Снять условие: Подразделение: Логистика: склад/ }),
    );

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ units: ["Отдел продаж"] }));
  });

  it("показывает применённые условия чипами и снимает их по одному", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["import"], outcomes: [], from: "2026-09-01", to: "2026-09-30" }}
        onFilterChange={onFilterChange}
      />,
    );

    expect(await screen.findByText(/Источник: импорт/)).toBeTruthy();
    expect(screen.getByText(/Период: 2026-09-01 — 2026-09-30/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Снять условие: Источник: импорт/ }));

    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [], from: "2026-09-01" }),
    );
  });

  it("сбрасывает все условия разом", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["web"], outcomes: [] }}
        onFilterChange={onFilterChange}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Сбросить/ }));

    expect(onFilterChange).toHaveBeenCalledWith({
      testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [],
    });
  });

  it("говорит, что условия не подошли, а не просто «нет данных»", async () => {
    fetchMock.mockResolvedValue(page([], 0));

    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["import"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    expect(await screen.findByText(/Под эти условия не подошло ни одного прохождения/)).toBeTruthy();
  });

  it("запрашивает первую порцию заново, когда условия изменились", async () => {
    /** Запросы прохождений: справочники тестов и групп к порциям отношения не имеют. */
    const registryCalls = () =>
      fetchMock.mock.calls.filter(call => String(call[0]).includes("/api/analytics/registry")).length;

    const { rerender } = render(
      <PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />,
    );
    await waitFor(() => expect(registryCalls()).toBe(1));

    rerender(
      <PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["web"], outcomes: [] }} onFilterChange={() => {}} />,
    );

    await waitFor(() => expect(registryCalls()).toBe(2));
    expect(lastQuery().get("offset")).toBe("0");
  });
});

/**
 * Задача 2.4 плана сверки: «Попытка» и «Группа» сортируются, как в эскизе, — и сортирует их
 * СЕРВЕР: номер попытки считается по всем попыткам человека, а на странице видны не все.
 */
describe("PassageRegistry — сортировка по попытке и группе", () => {
  /** Параметры последнего запроса именно к реестру: ручка сохранённых фильтров — своя. */
  const lastRegistryQuery = () => {
    const url = String(fetchMock.mock.calls
      .map(call => String(call[0]))
      .filter(u => u.includes("/api/analytics/registry"))
      .at(-1));
    return new URLSearchParams(url.slice(url.indexOf("?")));
  };

  for (const [header, key] of [["Попытка", "attempt"], ["Группа", "group"]] as const) {
    it(`«${header}» уходит на сервер параметром sort=${key}`, async () => {
      render(<PassageRegistry filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);
      await screen.findByText("Морозова Анна");

      const th = screen.getAllByText(header).find(el => el.closest(".ou-grid__th")) as HTMLElement;
      expect(th.closest(".ou-grid__th")!.classList.contains("is-sortable")).toBe(true);
      await userEvent.click(th);

      await waitFor(() => expect(lastRegistryQuery().get("sort")).toBe(key));
      expect(lastRegistryQuery().get("dir")).toBe("asc");
    });
  }
});

describe("PassageRegistry — сохранение среза", () => {
  it("показывает НОМЕР ПОПЫТКИ, а где его нет — прочерк", async () => {
    // Строка «45 %» не отвечает на вопрос, первый это заход или четвёртый после трёх
    // провалов. У импортированного прохождения истории участника может не быть вовсе, и
    // «первая попытка» стала бы утверждением, которого мы не знаем (FR-02).
    fetchMock.mockResolvedValue(page([
      { ...ROW, id: "a1", attemptNumber: 3 },
      { ...ROW, id: "a2", participant: "Участник импорта", attemptNumber: null },
    ], 2));

    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await screen.findByText("Участник импорта");
    expect(screen.getByText("Попытка")).toBeTruthy();
    const withNumber = screen.getAllByRole("row")[1];
    expect(within(withNumber).getByText("3")).toBeTruthy();
    const withoutNumber = screen.getAllByRole("row")[2];
    expect(within(withoutNumber).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("при нескольких тестах СПРАШИВАЕТ, по какому сохранять срез", async () => {
    // Срез — выборка ОДНОГО теста (решение владельца 2026-09-25), но заставлять автора
    // пересобирать отбор незачем: условия он уже набрал, не хватает только теста.
    render(
      <PassageRegistry
        filter={{ testIds: ["t1", "t2"], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["web"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await screen.findByText("Морозова Анна");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить как срез/ }));

    // Выбор — только из тестов ВЫБОРКИ: срез сужает уже отобранное, а не открывает каталог.
    expect(await screen.findByText(/по какому тесту/i)).toBeTruthy();
    expect(screen.getByText(/прочие тесты в условия среза не войдут/i)).toBeTruthy();
  });

  it("срез сохраняется по ВЫБРАННОМУ тесту, прочие условия переносятся", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: ["t1", "t2"], groupIds: ["g1"], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["web"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await screen.findByText("Морозова Анна");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить как срез/ }));
    await userEvent.type(screen.getByLabelText(/Название среза/i), "Розница по сертификации");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/analytics/slices"));
    const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? "{}"));
    expect(body.kind).toBe("slice");
    // Тест ровно один — выбранный; группы и источники остаются как были.
    expect(body.conditions.testIds).toHaveLength(1);
    expect(body.conditions.groupIds).toEqual(["g1"]);
    expect(body.conditions.sources).toEqual(["web"]);
  });

  it("без теста в выборке срез сохранить нельзя: выбирать не из чего", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: ["g1"], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await screen.findByText("Морозова Анна");
    expect(screen.getByRole("button", { name: /Сохранить как срез/ })).toBeDisabled();
    // Фильтром — можно: он и существует ради выборок шире одного теста.
    expect(screen.getByRole("button", { name: /Сохранить фильтр/ })).toBeEnabled();
  });

  it("сохранённый фильтр можно применить к реестру", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }}
        onFilterChange={onFilterChange}
      />,
    );

    await screen.findByText("Морозова Анна");
    await userEvent.click(screen.getByRole("button", { name: "Сохранённые" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Мои потоки/ }));

    // Применение подставляет УСЛОВИЯ фильтра: реестр пересобирается ими, а не открывает
    // отдельный экран.
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ testIds: ["t1", "t2"], sources: ["web"] }),
    );
  });

  it("не предлагает сохранить срез, когда условий нет", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await screen.findByText("Морозова Анна");
    expect(screen.getByRole("button", { name: /Сохранить как срез/ })).toBeDisabled();
  });

  it("сохраняет отбор срезом и говорит, что хранятся условия, а не состав", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: ["import"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Сохранить как срез/ }));

    // FR-07d: срез — это условия, а не снимок состава. Сказать об этом нужно там, где
    // человек нажимает «сохранить», иначе он примет срез за список людей.
    expect(screen.getByText(/пересчитывается при каждом открытии/i)).toBeTruthy();

    await userEvent.type(screen.getByLabelText(/Название среза/), "Импорт по тесту");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      const saved = fetchMock.mock.calls.find(call => String(call[0]).endsWith("/api/analytics/slices"));
      expect(saved).toBeTruthy();
      expect(JSON.parse(String((saved![1] as RequestInit).body))).toMatchObject({
        name: "Импорт по тесту",
        conditions: { testIds: ["t1"], sources: ["import"] },
      });
    });
  });
});
