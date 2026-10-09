/**
 * @module client/src/components/__tests__/data-grid-loadmore
 * @description PRD-56 FR-01c: `DataGrid` догружает строки при прокрутке.
 *
 * У реестра прохождений постраничности нет: подвал говорит, сколько строк показано из скольких,
 * а следующая порция приходит сама. Компонент умел только страницы, поэтому догрузка заводится
 * здесь — в ui-kit, а не в экране: иначе каждый список изобретал бы её заново.
 *
 * `IntersectionObserver` в jsdom отсутствует, поэтому он подменяется: тест проверяет ДОГОВОР
 * компонента с наблюдателем (кого наблюдаем, когда зовём `onLoadMore`), а не браузерную
 * реализацию пересечений.
 *
 * Лежит в `client/src`, а не в `tests/`: `vitest` берёт из `tests` только `.ts`, а тест
 * компонента написан с JSX.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataGrid } from "../../../../vendor/ui-kit/src/components/DataGrid";

interface Row { id: string; name: string }

const COLUMNS = [{ key: "name", header: "Имя", render: (r: Row) => r.name }];
const ROWS: Row[] = [
  { id: "1", name: "Морозова Анна" },
  { id: "2", name: "Сафин Ильдар" },
];

/** Наблюдатели, заведённые компонентом за время теста. */
let observers: Array<{ trigger: () => void; observed: Element[]; disconnected: boolean }>;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void;
    observed: Element[] = [];
    disconnected = false;

    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.callback = callback;
      observers.push({
        trigger: () => this.callback([{ isIntersecting: true }]),
        observed: this.observed,
        disconnected: false,
      });
    }

    observe(el: Element) {
      this.observed.push(el);
      observers[observers.length - 1].observed.push(el);
    }

    unobserve() { /* поведение не проверяется */ }

    disconnect() {
      this.disconnected = true;
      const mine = observers.find(o => o.observed === this.observed);
      if (mine) mine.disconnected = true;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataGrid — ленивая подгрузка", () => {
  it("печатает в подвале, сколько строк показано из скольких", () => {
    render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} hasMore total={128} onLoadMore={() => {}} />,
    );

    expect(screen.getByText(/Показано 2 из 128/)).toBeTruthy();
  });

  it("зовёт onLoadMore, когда хвост списка показался", () => {
    const onLoadMore = vi.fn();
    render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} hasMore total={128} onLoadMore={onLoadMore} />,
    );

    observers[0].trigger();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("не зовёт onLoadMore повторно, пока идёт загрузка", () => {
    const onLoadMore = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS} rows={ROWS} rowKey={r => r.id}
        hasMore total={128} loadingMore onLoadMore={onLoadMore}
      />,
    );

    observers[0]?.trigger();

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("не заводит наблюдателя, когда догружать нечего", () => {
    render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} total={2} onLoadMore={() => {}} />,
    );

    expect(observers).toHaveLength(0);
  });

  it("не показывает постраничность, пока список догружается прокруткой", () => {
    render(
      <DataGrid
        columns={COLUMNS} rows={ROWS} rowKey={r => r.id}
        hasMore total={128} onLoadMore={() => {}}
        page={1} pageSize={25} onPageChange={() => {}}
      />,
    );

    expect(screen.queryByText(/Стр\. 1 из/)).toBeNull();
  });

  it("не вешает над таблицей голое число без подписи", () => {
    // Счётчик тулбара — спутник заголовка. Без заголовка, поиска и своих кнопок над таблицей
    // остаётся одно число, которое читателю не к чему отнести: сколько чего и из скольких —
    // это говорит подвал («Показано 25 из 158») и подзаголовок карточки.
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} total={158} />,
    );

    expect(container.querySelector(".ou-grid__toolbar")).toBeNull();
  });

  it("показывает тулбар, когда в нём есть что показать", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} total={158} title="Прохождения" />,
    );

    expect(container.querySelector(".ou-grid__toolbar")).not.toBeNull();
    expect(screen.getByText("158")).toBeTruthy();
  });

  it("следит за хвостом ВНУТРИ области прокрутки таблицы", () => {
    // Таблица прокручивается в своём контейнере (`ou-grid__scroll`, max-height). Метка,
    // положенная снаружи, видна всегда — и список догружался бы до конца сам, без участия
    // человека: именно это показала приёмка на 158 строках.
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} rowKey={r => r.id} hasMore total={128} onLoadMore={() => {}} />,
    );

    const sentinel = container.querySelector(".ou-grid__sentinel");
    expect(sentinel?.closest(".ou-grid__scroll")).not.toBeNull();
    expect(observers[0].observed[0]).toBe(sentinel);
  });
});
