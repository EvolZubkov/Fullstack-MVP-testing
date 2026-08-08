/**
 * @module features/tests/editor/sections/icon-picker-modal
 * @description The pictogram picker for a scale (PRD-46 §7): the whole lucide set with a
 * search by name, opened from a row of «Оформление шкал».
 *
 * The whole set and not a shortlist. Methods differ wildly — a burnout inventory, a sales
 * typology, a competence profile — and guessing a dozen glyphs on the author's behalf would
 * mean the one they need is exactly the one missing.
 *
 * The grid draws from the SAME generated table the chart resolves names against
 * (`shared/template/lucide-icons.generated.json`), not from `lucide-react` components: it is
 * the table that decides what the results screen can draw, so picking from anything else could
 * offer a glyph the chart would silently skip. The table is fetched lazily — it is a quarter of
 * a megabyte, and an author who never opens this modal must not pay for it.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Input, ModalDialog, Spinner } from "@universityrt/ui-kit";

/** Glyph table: name → contours. */
export type GlyphTable = Record<string, string[]>;

/** Loaded once per session, on first use. */
let cache: GlyphTable | null = null;

/** How many glyphs the grid renders before the search narrows it down. */
const PAGE = 300;

export function IconGlyph(props: { paths: string[]; size: number }) {
  return (
    <svg
      className="tb-icon"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {props.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/**
 * The glyph table, fetched on demand.
 *
 * `enabled` is what keeps the quarter-megabyte off the wire for the common case: a test with no
 * pictograms set never needs the table until the author opens the picker, and the settings form
 * of every results page would otherwise pull it in.
 */
export function useGlyphTable(enabled: boolean): GlyphTable | null {
  const [table, setTable] = useState<GlyphTable | null>(cache);
  useEffect(() => {
    if (!enabled || table) return;
    let alive = true;
    void loadGlyphs().then((t) => {
      if (alive) setTable(t);
    });
    return () => {
      alive = false;
    };
  }, [enabled, table]);
  return table;
}

async function loadGlyphs(): Promise<GlyphTable> {
  if (cache) return cache;
  const module = await import("@shared/template/lucide-icons.generated.json");
  cache = (module.default ?? module) as Record<string, string[]>;
  return cache;
}

export function IconPickerModal(props: {
  /** Scale being dressed — its name goes into the title, so the author knows what they edit. */
  scaleLabel: string;
  value: string | undefined;
  onPick: (name: string | undefined) => void;
  onClose: () => void;
}) {
  const { scaleLabel, value, onPick, onClose } = props;
  const table = useGlyphTable(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | undefined>(value);

  const names = useMemo(() => {
    if (!table) return [];
    const all = Object.keys(table);
    const needle = query.trim().toLowerCase();
    const found = needle === "" ? all : all.filter((n) => n.includes(needle));
    // The selected glyph stays reachable even when the search excludes it — otherwise the grid
    // shows no selection and the author cannot tell what is currently set.
    const head = selected && !found.includes(selected) ? [selected] : [];
    return [...head, ...found].slice(0, PAGE);
  }, [table, query, selected]);

  const total = table ? Object.keys(table).length : 0;
  const matched = table
    ? query.trim() === ""
      ? total
      : Object.keys(table).filter((n) => n.includes(query.trim().toLowerCase())).length
    : 0;

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="m"
      title={`Пиктограмма шкалы «${scaleLabel}»`}
      description="Появится в подписи шкалы на диаграмме итогов."
      footer={
        <>
          <Button
            className="tb-qscoring__foot-left"
            variant="ghost"
            onClick={() => onPick(undefined)}
            data-testid="icon-picker-clear"
          >
            Без пиктограммы
          </Button>
          <Button variant="ghost" onClick={onClose} data-testid="icon-picker-cancel">
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => onPick(selected)}
            disabled={!selected}
            data-testid="icon-picker-apply"
          >
            Выбрать
          </Button>
        </>
      }
      data-testid="icon-picker"
    >
      <Input
        label="Поиск по имени"
        type="search"
        size="m"
        fullWidth
        placeholder="target, users, shield…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="icon-picker-search"
      />
      {!table ? (
        <Spinner aria-label="Загрузка пиктограмм" />
      ) : (
        <>
          <div className="tb-icon-grid" role="listbox" aria-label="Пиктограммы">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                className={`tb-icon-cell${name === selected ? " is-selected" : ""}`}
                aria-pressed={name === selected}
                title={name}
                onClick={() => setSelected(name)}
                data-testid={`icon-picker-cell-${name}`}
              >
                <IconGlyph paths={table[name]} size={22} />
              </button>
            ))}
          </div>
          {/* The grid is capped, so it has to SAY it is capped: a silently truncated list reads
              as «the set ends here» and the author stops searching for what is there. */}
          <p className="tb-appearance__note" data-testid="icon-picker-count">
            {matched > names.length
              ? `Показаны первые ${names.length} из ${matched}. Уточните поиск.`
              : `Найдено: ${matched} из ${total}.`}
          </p>
        </>
      )}
    </ModalDialog>
  );
}
