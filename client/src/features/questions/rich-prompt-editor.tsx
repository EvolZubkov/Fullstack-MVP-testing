/**
 * @module features/questions/rich-prompt-editor
 *
 * Визуальный ввод текста задания — режим «Форматированный» (PRD-57 §4.3, FR-09b).
 *
 * `contenteditable` + `execCommand`, тем же приёмом, каким в продукте уже сделан редактор
 * обратной связи: внешней библиотеки RTE здесь нет и не заводится. Панель — жирный, курсив,
 * список, ссылка; кнопки вставки механик стоят снаружи, общие с остальными режимами.
 *
 * Механики живут в поле АТОМАРНЫМИ узлами ({@link module:shared/text/rich-atoms}): курсор
 * внутрь не попадает, форматирование их не рвёт, удаление уносит узел целиком. Это гарантия
 * по построению — ровно то, чего требует FR-09b.
 *
 * Разметка поля НЕ перепривязывается на каждый набранный символ: `innerHTML` ставится один
 * раз при открытии и при внешней замене текста (переключение режима, вставка кнопкой), а
 * дальше поле живёт само и сообщает наружу результат. Перепривязка на каждый ввод уводила
 * бы курсор в начало строки — тем же способом, которым это уже было починено в редакторе
 * обратной связи.
 *
 * ВИД механик — как у участника: подсвеченный листинг и картинка формулы. И то и другое
 * считается только на сервере, поэтому вид приходит оттуда (`POST /api/questions/preview` —
 * тот же маршрут, которым живёт предпросмотр). Стоит это ровно столько запросов, сколько
 * раз текст заменили НЕ набором: атом неразрывен, внутри него не печатают. Пока ответ не
 * пришёл, поле показывает записи — так автор видит содержимое сразу, а не пустоту.
 */
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link as LinkIcon, List } from "lucide-react";
import { Cluster, IconButton, Label, Stack } from "@skillum/ui-kit";
import { toAtoms, fromAtoms, atomsFromRendered } from "@shared/text/rich-atoms";

export interface RichPromptEditorProps {
  label: string;
  /** Текст задания разметкой — таким, каким он хранится. */
  value: string;
  /** Новый текст разметкой; атомы уже развёрнуты. */
  onChange: (next: string) => void;
  /** Внешний ключ перепривязки: меняется, когда текст заменили не набором. */
  syncKey?: string | number;
  "data-testid"?: string;
}

/**
 * Поле визуального ввода.
 *
 * @param props Подпись, текст, обработчик и ключ перепривязки.
 */
export function RichPromptEditor(props: RichPromptEditorProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  /** Текст на момент последней перепривязки — по нему запрашивается вид. */
  const [pinned, setPinned] = useState("");
  /**
   * Печатал ли автор с момента перепривязки.
   *
   * Флаг, а не сравнение разметки поля со строкой: браузер нормализует `innerHTML` по-своему
   * (порядок атрибутов, пробелы), и сравнение строк отвечало бы «текст изменился» там, где
   * никто ничего не трогал — вид с сервера не подставлялся бы никогда.
   */
  const typedRef = useRef(false);

  // Разметка ставится ОДИН раз на открытие и на внешнюю замену текста: иначе каждый
  // набранный символ перерисовывал бы поле и уводил курсор в начало.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const text = props.value ?? "";
    area.innerHTML = toAtoms(text);
    typedRef.current = false;
    setPinned(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.syncKey]);

  // Вид механик приходит с сервера и ЗАМЕНЯЕТ записи на месте. Замена идёт только пока
  // автор не начал печатать: подменять разметку под курсором значит терять и курсор, и
  // набранное.
  useEffect(() => {
    if (pinned.trim() === "") return;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/questions/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: pinned, promptFormat: "richText" }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { promptHtml?: string };
        const area = areaRef.current;
        // Поле могло измениться, пока ответ шёл: тогда вид уже не про этот текст.
        const view = data.promptHtml ?? "";
        // Пустой ответ полем не считается: затереть им поле значило бы стереть текст,
        // который автор видит перед собой. Печатающего автора тоже не трогаем: подмена
        // разметки под курсором теряет и курсор, и набранное.
        if (!alive || !area || view === "" || typedRef.current) return;
        area.innerHTML = atomsFromRendered(view);
      } catch {
        // Сервер не ответил — поле остаётся с записями. Это рабочее состояние: править
        // текст можно, а картинку автор увидит в предпросмотре.
      }
    })();
    return () => { alive = false; };
  }, [pinned]);

  const emit = () => {
    const area = areaRef.current;
    if (area) props.onChange(fromAtoms(area.innerHTML));
  };

  /** Набор в поле: с этого мгновения вид с сервера уже не подставляется. */
  const onType = () => {
    typedRef.current = true;
    emit();
  };

  /** Выполнить команду форматирования над выделением. */
  const run = (command: string, value?: string) => {
    areaRef.current?.focus();
    // `execCommand` объявлен устаревшим, но остаётся единственным способом форматировать
    // `contenteditable` без внешней библиотеки — тот же выбор, что у редактора обратной связи.
    document.execCommand(command, false, value);
    emit();
  };

  const addLink = () => {
    const url = window.prompt("Адрес ссылки");
    if (!url) return;
    run("createLink", url);
  };

  return (
    <Stack gap={2}>
      <Label>{props.label}</Label>
      <Cluster gap={1} wrap data-testid="rich-prompt-toolbar">
        <IconButton
          aria-label="Жирный"
          variant="ghost"
          size="s"
          icon={<Bold size={16} aria-hidden="true" />}
          onClick={() => run("bold")}
          data-testid="rich-bold"
        />
        <IconButton
          aria-label="Курсив"
          variant="ghost"
          size="s"
          icon={<Italic size={16} aria-hidden="true" />}
          onClick={() => run("italic")}
          data-testid="rich-italic"
        />
        <IconButton
          aria-label="Список"
          variant="ghost"
          size="s"
          icon={<List size={16} aria-hidden="true" />}
          onClick={() => run("insertUnorderedList")}
          data-testid="rich-list"
        />
        <IconButton
          aria-label="Ссылка"
          variant="ghost"
          size="s"
          icon={<LinkIcon size={16} aria-hidden="true" />}
          onClick={addLink}
          data-testid="rich-link"
        />
      </Cluster>
      <div
        ref={areaRef}
        className="tb-rich-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={props.label}
        onInput={onType}
        onBlur={emit}
        data-testid={props["data-testid"] ?? "input-question-prompt-rich"}
      />
    </Stack>
  );
}
