import { describe, expect, it } from "vitest";
import { OUTCOME, classify, failed, matchArtifact } from "../../scripts/deps/classify.mjs";

const pkg = { id: "zod@4.4.3", name: "zod", scope: "", version: "4.4.3", dev: false, requiredBy: ["проект"] };

function artifact(version: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    npm: { name: "zod", scope: "", version },
    state: { status, zone: "MAIN", comment: "", ...extra },
    alerts: [],
  };
}

describe("matchArtifact", () => {
  it("не принимает 4.4.30 за 4.4.3", () => {
    expect(matchArtifact([artifact("4.4.30", "PERMITTED")], pkg)).toBeNull();
  });

  it("не принимает чужое имя с той же версией и областью", () => {
    const other = artifact("4.4.3", "PERMITTED");
    other.npm.name = "zod-form";
    expect(matchArtifact([other], pkg)).toBeNull();
  });

  it("находит запись со строго той же версией", () => {
    const found = matchArtifact([artifact("4.4.30", "RESTRICTED"), artifact("4.4.3", "PERMITTED")], pkg);
    expect(found?.state.status).toBe("PERMITTED");
  });

  it("различает область", () => {
    const scoped = { ...pkg, scope: "@other" };
    expect(matchArtifact([artifact("4.4.3", "PERMITTED")], scoped)).toBeNull();
  });

  it("защищается от scope: null в ответе, а не только от отсутствующего поля", () => {
    // Not an observed response shape (the recorded HAR session always used "" or a real scope) —
    // this is a defensive test for an unseen but plausible variant of an undocumented API.
    const nullScoped = { npm: { name: "zod", scope: null, version: "4.4.3" }, state: { status: "PERMITTED" }, alerts: [] };
    expect(matchArtifact([nullScoped], pkg)).toBe(nullScoped);
  });
});

describe("classify", () => {
  it("разрешённый пакет — норма", () => {
    expect(classify(pkg, [artifact("4.4.3", "PERMITTED")])).toMatchObject({ outcome: OUTCOME.OK, status: "PERMITTED" });
  });

  it("собирает исход целиком, включая паспортные поля пакета", () => {
    const result = classify(pkg, [artifact("4.4.3", "PERMITTED", { zone: "MAIN", comment: "" })]);
    expect(result).toEqual({
      id: "zod@4.4.3",
      name: "zod",
      scope: "",
      version: "4.4.3",
      dev: false,
      requiredBy: ["проект"],
      outcome: OUTCOME.OK,
      status: "PERMITTED",
      known: true,
      zone: "MAIN",
      comment: "",
      alerts: [],
    });
  });

  it("запрещённый пакет — провал", () => {
    expect(classify(pkg, [artifact("4.4.3", "RESTRICTED")])).toMatchObject({ outcome: OUTCOME.BLOCK });
  });

  it("пустой ответ — отсутствие в базе, а не запрет", () => {
    expect(classify(pkg, [])).toMatchObject({ outcome: OUTCOME.BLOCK, status: "ABSENT", comment: "" });
  });

  it("artifacts === null — как пустой ответ", () => {
    expect(classify(pkg, null)).toMatchObject({ outcome: OUTCOME.BLOCK, status: "ABSENT", comment: "" });
  });

  it("ответ не пуст, но нашей версии в нём нет — соседи идут в comment", () => {
    const result = classify(pkg, [artifact("4.4.1", "PERMITTED"), artifact("4.4.2", "RESTRICTED")]);
    expect(result).toMatchObject({
      outcome: OUTCOME.BLOCK,
      status: "ABSENT",
      comment: "в базе есть 4.4.1 (PERMITTED), 4.4.2 (RESTRICTED)",
    });
  });

  it("список соседей в comment ограничен пятью", () => {
    const artifacts = ["4.4.10", "4.4.11", "4.4.12", "4.4.13", "4.4.14", "4.4.15"].map((v) => artifact(v, "PERMITTED"));
    const result = classify(pkg, artifacts);
    expect(result.comment.split(", ")).toHaveLength(5);
    expect(result.comment).not.toContain("4.4.15");
  });

  it("частичное разрешение — предупреждение с комментарием системы", () => {
    const result = classify(pkg, [artifact("4.4.3", "PARTIALLY_PERMITTED", { comment: "только в изоляции" })]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, comment: "только в изоляции" });
  });

  it.each(["REQUESTED", "VERIFICATION", "NOTFOUND", "UNCHECKABLE", "UNDEFINED"])(
    "статус %s — предупреждение",
    (status) => {
      expect(classify(pkg, [artifact("4.4.3", status)]).outcome).toBe(OUTCOME.WARN);
    },
  );

  it("неизвестный статус предупреждает и сохраняет его дословно", () => {
    const result = classify(pkg, [artifact("4.4.3", "SOMETHING_NEW")]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, status: "SOMETHING_NEW", known: false });
  });

  it("переносит зону и уязвимости в исход", () => {
    const withAlert = artifact("4.4.3", "PERMITTED", { zone: "ISOLATED" });
    withAlert.alerts = [{ severity: "HIGH", vulnerabilityId: "CVE-2026-1" }];
    expect(classify(pkg, [withAlert])).toMatchObject({ zone: "ISOLATED", alerts: [{ severity: "HIGH" }] });
  });

  it("запись без state — предупреждение, известное значение не подтверждено", () => {
    const bare = { npm: { name: "zod", scope: "", version: "4.4.3" }, alerts: [] };
    expect(classify(pkg, [bare])).toMatchObject({
      outcome: OUTCOME.WARN,
      status: "UNDEFINED",
      known: false,
      zone: null,
      comment: "",
    });
  });

  it("если ответ содержит дубли одной версии, решает первая запись по порядку ответа", () => {
    // Duplicates were never observed in the recorded session; this pins down a deliberate,
    // deterministic choice for a case the API's own contract does not rule out.
    const first = artifact("4.4.3", "PERMITTED");
    const second = artifact("4.4.3", "RESTRICTED");
    expect(classify(pkg, [first, second])).toMatchObject({ outcome: OUTCOME.OK, status: "PERMITTED" });
  });
});

describe("failed", () => {
  it("формирует отдельный от classify исход: система не ответила, а не ответила плохо", () => {
    const result = failed(pkg, new Error("ECONNRESET"));
    expect(result).toEqual({
      id: "zod@4.4.3",
      name: "zod",
      scope: "",
      version: "4.4.3",
      dev: false,
      requiredBy: ["проект"],
      outcome: OUTCOME.ERROR,
      status: "ERROR",
      known: true,
      zone: null,
      comment: "ECONNRESET",
      alerts: [],
    });
  });
});

describe("OUTCOME", () => {
  it("значения зафиксированы дословно — они уходят в report.json и в сверку прогонов", () => {
    expect(OUTCOME).toEqual({ OK: "ok", WARN: "warn", BLOCK: "block", ERROR: "error" });
  });
});
