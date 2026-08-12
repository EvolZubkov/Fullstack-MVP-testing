/**
 * @module shared/template/__tests__/feedback-banner
 * @description The after-answer feedback banner is one DS `.ou-banner` for both hosts and
 * both delivery modes. Guards the tone → variant/icon mapping, the marker class the dedup
 * hook relies on, escaping of the verdict title, and pass-through of the pre-built body.
 */
import { describe, it, expect } from "vitest";
import { feedbackBanner, feedbackDesc } from "../feedback-banner";

describe("feedbackBanner", () => {
  it("maps each tone to its DS variant and keeps the dedup marker class", () => {
    for (const tone of ["success", "warning", "error"] as const) {
      const html = feedbackBanner(tone, "Заголовок");
      expect(html).toContain(`ou-banner ou-banner--${tone} ou-banner--sm feedback-block`);
      expect(html).toContain('<span class="ou-banner__ico"');
      expect(html).toMatch(/<svg[\s\S]*<\/svg>/); // verdict icon present
    }
  });

  it("escapes the verdict title", () => {
    const html = feedbackBanner("error", '<b>"Неверно"</b>');
    expect(html).toContain('<div class="ou-banner__title">&lt;b&gt;&quot;Неверно&quot;&lt;/b&gt;</div>');
    expect(html).not.toContain("<b>");
  });

  it("passes the pre-built body through under the title, or omits it", () => {
    const withBody = feedbackBanner("success", "Правильно!", feedbackDesc("Пояснение"));
    expect(withBody).toContain('<div class="ou-banner__body">');
    expect(withBody).toContain('<div class="ou-banner__desc">Пояснение</div>');
    const noBody = feedbackBanner("success", "Правильно!");
    expect(noBody).toContain("</div></div>");
    expect(noBody).not.toContain("ou-banner__desc");
  });
});

describe("feedbackDesc", () => {
  it("wraps escaped text in a desc line", () => {
    expect(feedbackDesc('a & <b>')).toBe('<div class="ou-banner__desc">a &amp; &lt;b&gt;</div>');
  });
});
