import { describe, expect, it, vi } from "vitest";
import { createClient } from "../../scripts/deps/repo-client.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };

function ok(artifacts: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ artifacts }), headers: new Headers() };
}

function fail(status: number, headers: Record<string, string> = {}, body = "") {
  return { ok: false, status, json: async () => ({}), headers: new Headers(headers), text: async () => body };
}

function client(fetchImpl: unknown, overrides = {}) {
  return createClient({
    fetchImpl,
    getToken: vi.fn(async () => "T0"),
    sleep: vi.fn(async () => {}),
    random: () => 0,
    ...overrides,
  });
}

/** A page of 50 records under an unrelated name — noise a substring search on `pkg.name` could return. */
function noisePage(from: number) {
  return Array.from({ length: 50 }, (_, i) => ({ npm: { name: "noise", scope: "", version: `9.9.${from + i}` } }));
}

describe("createClient.findArtifacts", () => {
  it("шлёт имя и область раздельно и подставляет токен", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl).findArtifacts(pkg);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://repository.rt.ru/gateway/artifacts/findArtifacts");
    expect(init.headers.Authorization).toBe("Bearer T0");
    expect(JSON.parse(init.body)).toEqual({
      npm: { name: "pglite", scope: "@electric-sql", version: "0.4.1", state: {} },
      offset: 0,
      limit: 50,
      strict: false,
    });
  });

  it("забирает следующую страницу, когда ответ полон", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ npm: { version: `0.4.${i}` } }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(full))
      .mockResolvedValueOnce(ok([{ npm: { version: "0.4.99" } }]));
    const artifacts = await client(fetchImpl).findArtifacts(pkg);

    expect(artifacts).toHaveLength(51);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).offset).toBe(50);
  });

  it("выдерживает паузу перед каждым запросом", async () => {
    const sleep = vi.fn(async () => {});
    await client(vi.fn(async () => ok([])), { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("пауза наступает ДО fetch, а не после — иначе первый запрос уходит без задержки", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(fetchImpl.mock.invocationCallOrder[0]);
  });

  it("темп получает случайную добавку: random: () => 0.5 даёт 600 мс, а не голые 500", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl, { sleep, random: () => 0.5 }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(600);
  });

  it("передаёт fetch сигнал с таймаутом, чтобы зависшее соединение не вешало прогон навсегда", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl).findArtifacts(pkg);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("обновляет токен на 401 и повторяет запрос один раз", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(ok([]));
    const getToken = vi.fn().mockResolvedValueOnce("T0").mockResolvedValueOnce("T1");
    await client(fetchImpl, { getToken }).findArtifacts(pkg);

    expect(getToken).toHaveBeenLastCalledWith({ force: true });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer T1");
  });

  it("не форсирует повторное обновление токена после уже прошедшего 401 в том же вызове", async () => {
    // 401 forces one refresh; the retry that follows gets a 503 (unrelated) and succeeds on the
    // third attempt — that third getToken() call must NOT carry {force: true} again, or every
    // retry after a 401 would keep forcing a fresh token for no reason.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail(401))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok([]));
    const getToken = vi.fn(async () => "T");
    const sleep = vi.fn(async () => {});
    await client(fetchImpl, { getToken, sleep }).findArtifacts(pkg);
    expect(getToken.mock.calls).toEqual([[undefined], [{ force: true }], [undefined]]);
  });

  it("сдаётся на втором 401 подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(401));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/401/);
    // The CLI decides whether to stop the whole run off this flag, not by pattern-matching the
    // message — see the stopError() comment in repo-client.mjs.
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
  });

  it("на 429 ждёт столько, сколько просит сервер", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(429, { "Retry-After": "3" })).mockResolvedValueOnce(ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("останавливается после трёх отказов подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(503));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/503/);
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("останавливает прогон, когда сервер просит ждать дольше минуты", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => fail(429, { "Retry-After": "3600" }));
    const error = await client(fetchImpl, { sleep })
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/3600|час|минут/);
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalledWith(60000);
  });

  it("сдаётся сразу на статусе, который бессмысленно повторять (400), без пометки stopRun", async () => {
    const fetchImpl = vi.fn(async () => fail(400, {}, "scope и name обязательны"));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toMatch(/400/);
    // The response body is the only diagnosis a reverse-engineered API gives us — must not be lost.
    expect((error as Error).message).toContain("scope и name обязательны");
    expect((error as Error & { stopRun?: boolean }).stopRun).toBeUndefined();
  });

  it("повторяет сетевое исключение (например обрыв соединения) так же, как 5xx", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(ok([]));
    const artifacts = await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(artifacts).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("останавливает прогон после трёх сетевых сбоев подряд, как и для 5xx", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const error = await client(fetchImpl, { sleep })
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect((error as Error).message).toMatch(/ECONNRESET/);
  });

  it("после остановки прогона больше не обращается к сети на следующем вызове findArtifacts", async () => {
    const fetchImpl = vi.fn(async () => fail(503));
    const sleep = vi.fn(async () => {});
    const c = client(fetchImpl, { sleep });
    await expect(c.findArtifacts(pkg)).rejects.toMatchObject({ stopRun: true });
    const callsAfterStop = fetchImpl.mock.calls.length;

    await expect(c.findArtifacts({ ...pkg, version: "9.9.9" })).rejects.toMatchObject({ stopRun: true });
    expect(fetchImpl).toHaveBeenCalledTimes(callsAfterStop);
  });

  it("считает ответ без поля artifacts пустой страницей, а не падает", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: new Headers() }));
    await expect(client(fetchImpl).findArtifacts(pkg)).resolves.toEqual([]);
  });

  it("пагинация продолжается дальше прежнего потолка в 200 записей (потолок теперь 1000)", async () => {
    const match = { npm: { name: pkg.name, scope: pkg.scope, version: pkg.version } };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(noisePage(0)))
      .mockResolvedValueOnce(ok(noisePage(50)))
      .mockResolvedValueOnce(ok(noisePage(100)))
      .mockResolvedValueOnce(ok(noisePage(150)))
      .mockResolvedValueOnce(ok(noisePage(200)))
      .mockResolvedValueOnce(ok([...noisePage(250).slice(0, 9), match]));
    const artifacts = await client(fetchImpl).findArtifacts(pkg);

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(artifacts).toHaveLength(260);
  });

  it("на потолке в 1000 записей без точного совпадения бросает обычную (не stopRun) ошибку, не молчит", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => ok(noisePage(call++ * 50)));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(20); // 1000 / 50
    expect((error as Error).message).toMatch(/обрезан/);
    expect((error as Error).message).toContain("1000");
    expect((error as Error & { stopRun?: boolean }).stopRun).toBeUndefined();
  });

  it("не бросает ошибку на потолке, если точное совпадение уже нашлось раньше", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      const page = noisePage(call * 50);
      if (call === 0) page[0] = { npm: { name: pkg.name, scope: pkg.scope, version: pkg.version } };
      call += 1;
      return ok(page);
    });
    const artifacts = await client(fetchImpl).findArtifacts(pkg);
    expect(artifacts).toHaveLength(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });

  it("403 с Retry-After трактуется как отказ по частоте, а не как «повторять бессмысленно»: ждёт и повторяет тот же запрос", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail(403, { "Retry-After": "30" }))
      .mockResolvedValueOnce(ok([]));
    const artifacts = await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(artifacts).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(30000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("стендовый повтор ревью: 403 с Retry-After: 600 (10 минут) останавливает прогон на первом же запросе, без выдержки минутой", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => fail(403, { "Retry-After": "600" }));
    const c = client(fetchImpl, { sleep });

    const first = await c.findArtifacts(pkg).catch((e: Error) => e);
    expect((first as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect((first as Error).message).toMatch(/600|минут/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalledWith(600000);

    // A second package must not reach the network at all once the run has stopped.
    await expect(c.findArtifacts({ ...pkg, name: "other" })).rejects.toMatchObject({ stopRun: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("любой статус с Retry-After считается отказом по частоте, не только 429/5xx (например 404)", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(404, { "Retry-After": "5" })).mockResolvedValueOnce(ok([]));
    const artifacts = await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(artifacts).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("три 403 подряд по трём разным пакетам (без Retry-After) останавливают прогон — счётчик сквозной", async () => {
    const fetchImpl = vi.fn(async () => fail(403));
    const c = client(fetchImpl);
    const pkgs = ["a", "b", "c"].map((name) => ({ ...pkg, name }));

    const errors: Array<Error & { stopRun?: boolean }> = [];
    for (const p of pkgs) {
      errors.push(await c.findArtifacts(p).catch((e: Error) => e));
    }

    expect(errors[0].stopRun).toBeUndefined();
    expect(errors[1].stopRun).toBeUndefined();
    expect(errors[2].stopRun).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("успешный ответ обнуляет сквозной счётчик отказов, так что два отказа + успех + два отказа не останавливают прогон", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail(403)) // pkgA: refusal #1
      .mockResolvedValueOnce(fail(403)) // pkgB: refusal #2
      .mockResolvedValueOnce(ok([])) // pkgC: success -> resets to 0
      .mockResolvedValueOnce(fail(403)) // pkgD: refusal #1 again
      .mockResolvedValueOnce(fail(403)); // pkgE: refusal #2 again
    const c = client(fetchImpl);
    const results: Array<unknown> = [];
    for (const name of ["a", "b", "c", "d", "e"]) {
      results.push(await c.findArtifacts({ ...pkg, name }).catch((err: Error) => err));
    }
    const [a, b, cRes, d, e] = results as Array<Error & { stopRun?: boolean }>;

    expect(a.stopRun).toBeUndefined();
    expect(b.stopRun).toBeUndefined();
    expect(cRes).toEqual([]);
    expect(d.stopRun).toBeUndefined();
    expect(e.stopRun).toBeUndefined();
  });

  it("удваивает выдержку по умолчанию, когда 503 пришёл без Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("даёт передышку в 5 секунд на пятидесятом запросе, даже между разными вызовами findArtifacts", async () => {
    const sleep = vi.fn(async () => {});
    const c = client(vi.fn(async () => ok([])), { sleep });
    for (let i = 0; i < 50; i += 1) await c.findArtifacts(pkg);
    sleep.mockClear();
    await c.findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("sent() считает все отправленные запросы, включая повтор после 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(ok([]));
    const c = client(fetchImpl);
    await c.findArtifacts(pkg);
    expect(c.sent()).toBe(2);
  });
});
