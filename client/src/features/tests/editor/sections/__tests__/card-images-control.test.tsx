/**
 * @module features/tests/editor/sections/__tests__/card-images-control
 *
 * «Картинки карточек» (approved wireframe `editor-router-card-images.html`): one file row per
 * item of the hub, in hub order. Checked is what the wireframe decides — the actions an empty
 * and a set row offer, the file name in the caption, a refused file reported on its own row —
 * and the value contract: canonical item keys, `{url, name}` entries, no keys of items that
 * have left the test.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardImagesControl, CARD_IMAGE_MAX_KB, type CardImageItem } from "../card-images-control";

afterEach(cleanup);

const ITEMS: CardImageItem[] = [
  { key: "topic:t1", title: "О компании", meta: "Тема · 16 вопросов" },
  { key: "scenario:s1", title: "Работа в CRM", meta: "Сценарий" },
];

function renderControl(value: unknown, onChange = vi.fn()) {
  render(
    <CardImagesControl
      label="Картинки карточек"
      description="Квадратная иллюстрация на прозрачном фоне."
      value={value}
      onChange={onChange}
      items={ITEMS}
      testId="card-images"
    />,
  );
  return onChange;
}

/** Minimal XMLHttpRequest the upload talks to; the test decides the response. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  withCredentials = false;
  url = "";
  open(_method: string, url: string) {
    this.url = url;
  }
  send() {
    FakeXhr.last = this;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

describe("CardImagesControl", () => {
  beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists every item of the hub in hub order, an empty one offering only «Загрузить»", () => {
    renderControl({});
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("О компании"),
      expect.stringContaining("Работа в CRM"),
    ]);
    expect(screen.getByRole("button", { name: "Загрузить картинку карточки «О компании»" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Удалить картинку карточки «О компании»/ })).toBeNull();
    expect(screen.getByText("Тема · 16 вопросов")).toBeTruthy();
  });

  it("shows a set picture as the thumbnail, its file name in the caption, «Заменить» and «Удалить»", () => {
    const { container } = render(
      <CardImagesControl
        label="Картинки карточек"
        value={{ "topic:t1": { url: "/api/media/a", name: "company.png" } }}
        onChange={() => {}}
        items={ITEMS}
        testId="card-images"
      />,
    );
    expect(container.querySelector('img[src="/api/media/a"]')).toBeTruthy();
    expect(screen.getByText("Тема · 16 вопросов · company.png")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Заменить картинку карточки «О компании»" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить картинку карточки «О компании»" })).toBeTruthy();
  });

  it("reads a bare topic id as the topic's item key", () => {
    const { container } = render(
      <CardImagesControl label="Картинки карточек" value={{ t1: "/api/media/a" }} onChange={() => {}} items={ITEMS} testId="card-images" />,
    );
    expect(container.querySelector('img[src="/api/media/a"]')).toBeTruthy();
  });

  it("removes one picture and drops the keys of items that have left the test", () => {
    const onChange = renderControl({
      "topic:t1": { url: "/api/media/a", name: "a.png" },
      "scenario:s1": { url: "/api/media/c" },
      "topic:gone": { url: "/api/media/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Удалить картинку карточки «О компании»" }));
    expect(onChange).toHaveBeenCalledWith({ "scenario:s1": { url: "/api/media/c" } });
  });

  it("uploads a picture for the chosen item and stores its address and file name", async () => {
    const onChange = renderControl({ "topic:t1": { url: "/api/media/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить картинку карточки «Работа в CRM»" }));
    const input = screen.getByTestId("card-images-file") as HTMLInputElement;
    const file = new File(["x"], "crm.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(FakeXhr.last?.url).toBe("/api/media/upload");
    await act(async () => {
      FakeXhr.last?.respond(200, { url: "/api/media/c", originalName: "crm.png" });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      "topic:t1": { url: "/api/media/a" },
      "scenario:s1": { url: "/api/media/c", name: "crm.png" },
    });
  });

  it("refuses a file over the limit on that row only, keeping the value untouched", () => {
    const onChange = renderControl({});
    fireEvent.click(screen.getByRole("button", { name: "Загрузить картинку карточки «О компании»" }));
    const big = new File([new Uint8Array(CARD_IMAGE_MAX_KB * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("card-images-file"), { target: { files: [big] } });
    expect(screen.getByText(`Файл превышает ${CARD_IMAGE_MAX_KB} КБ.`)).toBeTruthy();
    expect(FakeXhr.last).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // The other row still reads normally.
    expect(screen.getByText("Сценарий")).toBeTruthy();
  });

  it("reports a failed upload on its row", async () => {
    renderControl({});
    fireEvent.click(screen.getByRole("button", { name: "Загрузить картинку карточки «О компании»" }));
    fireEvent.change(screen.getByTestId("card-images-file"), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await act(async () => {
      FakeXhr.last?.respond(500, {});
    });
    expect(screen.getByText("Не удалось загрузить изображение (HTTP 500).")).toBeTruthy();
  });
});
