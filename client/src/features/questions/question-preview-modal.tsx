/**
 * @module features/questions/question-preview-modal
 *
 * Предпросмотр задания (PRD-57 FR-24g): модальное окно поверх ящика, в котором задание
 * показано ГЛАЗАМИ УЧАСТНИКА.
 *
 * Рисует его тот же компонент, которым идёт прогон ({@link TemplateQuestionScreen}), а не
 * второй рендер: иначе однажды предпросмотр покажет не то, что увидит человек, и разойдутся
 * они молча. Приём взят у предпросмотра страницы (`page-preview-modal`) — модальное окно по
 * кнопке, а не постоянный блок в ящике: смотреть на него нужно в момент проверки, а не всё
 * время правки.
 *
 * Разметка текста приходит С СЕРВЕРА (`POST /api/questions/preview`), и это свойство
 * обязательное: подсветка листинга и картинка формулы считаются только там, а без них
 * предпросмотр показал бы сырые кавычки и доллары вместо того, ради чего его открыли.
 *
 * Поля демонстрационные: ответ живёт в состоянии окна и никуда не уходит.
 */
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, ModalDialog, Text } from "@skillum/ui-kit";
import type { Question } from "@shared/schema";
import { TemplateQuestionScreen } from "@/pages/learner/template-question-screen";
import { useTemplateBundle } from "@/features/tests/editor/sections/use-template-bundle";

/** Встроенный шаблон предпросмотра: задание живёт в банке и попадает в разные тесты. */
const PREVIEW_TEMPLATE_ID = "default";

export interface QuestionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Задание в том виде, в каком оно набрано в ящике — ещё не сохранённое. */
  question: Pick<Question, "type" | "prompt" | "dataJson" | "correctJson"> & Partial<Question>;
  /** Название темы — подпись раздела на экране участника. */
  topicName?: string;
}

/**
 * Окно предпросмотра задания.
 *
 * @param props Задание, тема и управление открытием.
 */
export function QuestionPreviewModal({ open, onClose, question, topicName }: QuestionPreviewModalProps) {
  const [answer, setAnswer] = useState<unknown>(undefined);
  const [promptHtml, setPromptHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const bundle = useTemplateBundle(PREVIEW_TEMPLATE_ID, open);

  // Разметка пересчитывается на КАЖДОЕ открытие: текст в ящике за это время менялся, и
  // показать вчерашнюю картинку — ровно та ошибка, ради которой окно и заводится.
  useEffect(() => {
    if (!open) {
      setPromptHtml(null);
      setAnswer(undefined);
      setFailed(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/questions/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: question.prompt,
            dataJson: question.dataJson,
            // PRD-57 §4.3: предпросмотр считает текст по ТОМУ ЖЕ формату, в каком он набран.
            promptFormat: (question as { promptFormat?: unknown }).promptFormat,
          }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { promptHtml?: string };
        if (alive) setPromptHtml(data.promptHtml ?? "");
      } catch {
        // Молча показать сырой текст нельзя: автор решил бы, что так увидит и участник.
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [open, question.prompt, question.dataJson, (question as { promptFormat?: unknown }).promptFormat]);

  const tpl = useMemo(() => {
    const layouts = bundle.data?.layouts ?? {};
    return {
      layout: layouts["question"] ?? layouts["question.html"] ?? "",
      css: bundle.data?.css ?? "",
    };
  }, [bundle.data]);

  const previewQuestion = useMemo(() => ({
    ...question,
    id: question.id ?? "preview",
    promptHtml: promptHtml ?? undefined,
  }) as Question & { promptHtml?: string }, [question, promptHtml]);

  const ready = open && promptHtml !== null && tpl.layout !== "";

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="l"
      title="Предпросмотр вопроса"
      description="Так задание увидит участник. Поля демонстрационные: ответ никуда не сохраняется."
      footer={<Button variant="primary" size="m" onClick={onClose}>Закрыть</Button>}
      data-testid="question-preview-modal"
    >
      {failed ? (
        <Banner tone="error" variant="subtle" title="Предпросмотр не собрался">
          <Text variant="body-s">
            Разметку задания считает сервер — подсветка листинга и формулы живут там.
            Повторите позже.
          </Text>
        </Banner>
      ) : !ready ? (
        <Text tone="muted" data-testid="question-preview-loading">Собираем задание…</Text>
      ) : (
        <TemplateQuestionScreen
          tpl={tpl}
          testTitle="Предпросмотр"
          counterLabel="Вопрос 1 из 1"
          sectionName={topicName}
          progressPercent={100}
          question={previewQuestion}
          answer={answer}
          onAnswer={setAnswer}
          // Ряд навигации печатает сама сцена, и в предпросмотре он нужен только для
          // полноты вида: идти отсюда некуда, поэтому ни «Назад», ни «К обзору» нет.
          nav={{
            flexible: false,
            quickAdvance: true,
            committed: false,
            canPrev: false,
            answerReady: false,
            hasNext: false,
            showAccept: false,
            showReview: false,
          }}
        />
      )}
    </ModalDialog>
  );
}
