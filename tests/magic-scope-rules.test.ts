/**
 * @module tests/magic-scope-rules
 * @description Unit tests for the magic-link scope rule table and its path matcher:
 * exact matches, parameter capture, method sensitivity, and the deny-by-default
 * behaviour for anything absent from the table.
 */
import { describe, it, expect } from "vitest";
import { matchMagicScopeRule } from "../server/middleware/magic-scope-rules";

describe("matchMagicScopeRule", () => {
  it("matches a static allowed path", () => {
    const m = matchMagicScopeRule("GET", "/api/auth/me");
    expect(m?.rule.bind).toBe("none");
  });

  it("captures the test id and asks for a test binding", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/resume");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
  });

  it("captures the attempt id and asks for an attempt binding", () => {
    const m = matchMagicScopeRule("POST", "/api/attempts/a1/finish");
    expect(m?.rule.bind).toBe("attempt");
    expect(m?.params.attemptId).toBe("a1");
  });

  it("captures both segments of the screen-template path", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/screen-template/question");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
    expect(m?.params.screen).toBe("question");
  });

  it("is method sensitive", () => {
    expect(matchMagicScopeRule("DELETE", "/api/auth/me")).toBeNull();
  });

  // The exits from a link. Losing any of these locks a person inside the link:
  // the login form is where the client sends them, and answering 403 there reads
  // as a wrong password, leaving no way out but deleting the cookie by hand.
  it("keeps the ways out of a link reachable from inside it", () => {
    expect(matchMagicScopeRule("POST", "/api/auth/login")?.rule.bind).toBe("none");
    expect(matchMagicScopeRule("POST", "/api/auth/forgot-password")?.rule.bind).toBe("none");
    expect(matchMagicScopeRule("GET", "/api/auth/verify-reset-token")?.rule.bind).toBe("none");
    expect(matchMagicScopeRule("POST", "/api/auth/reset-password")?.rule.bind).toBe("none");
    expect(matchMagicScopeRule("POST", "/api/auth/logout")?.rule.bind).toBe("none");
  });

  it("denies anything absent from the table", () => {
    expect(matchMagicScopeRule("GET", "/api/learner/attempts")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/home")).toBeNull();
    expect(matchMagicScopeRule("POST", "/api/auth/change-password")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/tests")).toBeNull();
  });

  it("does not let a longer path slip through a shorter rule", () => {
    expect(matchMagicScopeRule("GET", "/api/tests/t1/resume/extra")).toBeNull();
  });

  it("returns null instead of throwing on malformed percent-encoding in a parameter segment", () => {
    expect(matchMagicScopeRule("GET", "/api/tests/%/resume")).toBeNull();
  });

  it("still matches the same rule when the path has a trailing slash", () => {
    const m = matchMagicScopeRule("GET", "/api/auth/me/");
    expect(m?.rule.bind).toBe("none");
  });

  it("denies a path with a doubled slash", () => {
    expect(matchMagicScopeRule("GET", "/api/tests//resume")).toBeNull();
  });

  it("matches a cased path (Express 5 routes case-insensitively) while keeping the captured parameter's original case", () => {
    const m = matchMagicScopeRule("GET", "/API/Tests/T1/Resume");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("T1");
  });

  describe("файлы шаблона для отчёта (PRD-27 FR-05)", () => {
    it("пропускает вложенный путь ассета: подложка отчёта лежит в подкаталоге шаблона", () => {
      const m = matchMagicScopeRule("GET", "/api/templates/default/assets/assets/report/bg.png");
      expect(m?.rule.bind).toBe("none");
      expect(m?.params.templateId).toBe("default");
    });

    it("пропускает и одиночный файл", () => {
      expect(matchMagicScopeRule("GET", "/api/templates/default/assets/preview.svg")).not.toBeNull();
    });

    it("хвост обязателен: сам каталог ассетов правилом не покрыт", () => {
      expect(matchMagicScopeRule("GET", "/api/templates/default/assets")).toBeNull();
    });

    it("не открывает шаблон целиком: манифест и прочие роуты остаются вне области", () => {
      expect(matchMagicScopeRule("GET", "/api/templates/default")).toBeNull();
      expect(matchMagicScopeRule("GET", "/api/templates/default/bundle")).toBeNull();
      expect(matchMagicScopeRule("GET", "/api/templates")).toBeNull();
    });

    it("метод по-прежнему значим", () => {
      expect(matchMagicScopeRule("POST", "/api/templates/default/assets/x.png")).toBeNull();
    });
  });

  describe('PRD-52: ревью-пути рецензента', () => {
    it('сессия комментариев привязана к тесту ссылки', () => {
      expect(matchMagicScopeRule('GET', '/api/tests/t1/review/comments')?.rule.bind).toBe('test');
      expect(matchMagicScopeRule('POST', '/api/tests/t1/review/comments')?.rule.bind).toBe('test');
    });

    it('прогон рецензирования открыт: сессия, раздача пакета и ассеты плеера', () => {
      expect(matchMagicScopeRule('POST', '/api/tests/t1/review/session')?.rule.bind).toBe('test');
      expect(matchMagicScopeRule('GET', '/api/tests/t1/review/play/tok/index.html')?.rule.bind).toBe('test');
      expect(matchMagicScopeRule('GET', '/api/tests/t1/review/shim.js')?.rule.bind).toBe('test');
      expect(matchMagicScopeRule('GET', '/api/tests/t1/review/inspector-compute.js')?.rule.bind).toBe('test');
    });

    it('ничего сверх рецензирования: отладчик и экспорт остаются закрытыми', () => {
      expect(matchMagicScopeRule('POST', '/api/tests/t1/debug/session')).toBeNull();
      expect(matchMagicScopeRule('GET', '/api/tests/t1/export/scorm')).toBeNull();
      expect(matchMagicScopeRule('DELETE', '/api/tests/t1/review/comments/c1')).toBeNull();
    });
  });
});
