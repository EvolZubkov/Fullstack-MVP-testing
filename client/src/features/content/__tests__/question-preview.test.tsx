/**
 * @module features/content/__tests__/question-preview.test
 * @description Branch coverage for the read-only {@link QuestionPreview}: the
 * four question types (single/multiple/matching/ranking), the correct-answer
 * marking (correctIndex vs correctIndices), the three media notes and the
 * sub-topic tag chips, plus the empty/absent fallbacks. Pure presentational —
 * no providers or network needed.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Question } from "@shared/schema";
import { QuestionPreview } from "../question-preview";

/** Build a minimal Question fixture of the given shape. */
function q(over: Partial<Question>): Question {
  return {
    id: "q1", topicId: "t1", type: "single", prompt: "P",
    dataJson: {}, correctJson: {}, difficulty: null, tags: null,
    mediaUrl: null, mediaType: null,
    ...over,
  } as unknown as Question;
}

describe("<QuestionPreview />", () => {
  it("single: marks the correct option (correctIndex)", () => {
    render(<QuestionPreview question={q({
      type: "single",
      dataJson: { options: ["Alpha", "Beta", "Gamma"] } as never,
      correctJson: { correctIndex: 1 } as never,
    })} />);
    ["Alpha", "Beta", "Gamma"].forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
  });

  it("multiple: marks several correct options (correctIndices)", () => {
    render(<QuestionPreview question={q({
      type: "multiple",
      dataJson: { options: ["A", "B", "C"] } as never,
      correctJson: { correctIndices: [0, 2] } as never,
    })} />);
    ["A", "B", "C"].forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
  });

  it("scale: lists the graduations in the authored order", () => {
    const grades = ["Никогда", "Редко", "Часто", "Постоянно"];
    render(<QuestionPreview question={q({
      type: "scale",
      dataJson: { options: grades } as never,
      correctJson: {} as never,
    })} />);
    grades.forEach((g) => expect(screen.getByText(g)).toBeInTheDocument());
  });

  it("scale in measurement mode marks NOTHING as correct", () => {
    // PRD-26: an inventory item has no right answer, so a green mark here would be
    // a plain lie to the author.
    const { container } = render(<QuestionPreview question={q({
      type: "scale",
      dataJson: { options: ["Никогда", "Постоянно"] } as never,
      correctJson: {} as never,
    })} />);
    expect(container.querySelector(".ou-text--tone-success")).toBeNull();
  });

  it("scale with a correct graduation marks exactly that one", () => {
    const { container } = render(<QuestionPreview question={q({
      type: "scale",
      dataJson: { options: ["Никогда", "Редко", "Часто"] } as never,
      correctJson: { correctIndex: 2 } as never,
    })} />);
    const marked = container.querySelectorAll(".ou-text--tone-success");
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe("Часто");
  });

  it("single with no options renders without crashing (empty fallback)", () => {
    const { container } = render(<QuestionPreview question={q({ type: "single", dataJson: {} as never })} />);
    expect(container.querySelector(".ct-qpreview")).toBeInTheDocument();
  });

  it("matching: renders left (1.) and right (A.) columns", () => {
    render(<QuestionPreview question={q({
      type: "matching",
      dataJson: { left: ["Cat", "Dog"], right: ["Meow", "Woof"] } as never,
    })} />);
    expect(screen.getByText(/1\. Cat/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Dog/)).toBeInTheDocument();
    expect(screen.getByText(/A\. Meow/)).toBeInTheDocument();
    expect(screen.getByText(/B\. Woof/)).toBeInTheDocument();
  });

  it("ranking: renders the ordered items", () => {
    render(<QuestionPreview question={q({
      type: "ranking",
      dataJson: { items: ["First", "Second"] } as never,
    })} />);
    expect(screen.getByText(/1\. First/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Second/)).toBeInTheDocument();
  });

  it("shows the image media note", () => {
    render(<QuestionPreview question={q({ mediaUrl: "/m.png", mediaType: "image" as never })} />);
    expect(screen.getByText("Изображение")).toBeInTheDocument();
  });

  it("shows the audio media note", () => {
    render(<QuestionPreview question={q({ mediaUrl: "/m.mp3", mediaType: "audio" as never })} />);
    expect(screen.getByText("Аудио")).toBeInTheDocument();
  });

  it("shows the video media note", () => {
    render(<QuestionPreview question={q({ mediaUrl: "/m.mp4", mediaType: "video" as never })} />);
    expect(screen.getByText("Видео")).toBeInTheDocument();
  });

  it("omits the media note when no media is attached", () => {
    render(<QuestionPreview question={q({ mediaUrl: null, mediaType: null })} />);
    expect(screen.queryByText("Изображение")).not.toBeInTheDocument();
    expect(screen.queryByText("Аудио")).not.toBeInTheDocument();
  });

  it("renders sub-topic tag chips", () => {
    render(<QuestionPreview question={q({ tags: ["налоги", "бюджет"] as never })} />);
    expect(screen.getByText("налоги")).toBeInTheDocument();
    expect(screen.getByText("бюджет")).toBeInTheDocument();
  });

  it("renders no chips when tags are absent or not an array", () => {
    const { container } = render(<QuestionPreview question={q({ tags: null as never })} />);
    // No chip elements when there are no tags.
    expect(container.textContent).not.toContain("налоги");
  });
});
