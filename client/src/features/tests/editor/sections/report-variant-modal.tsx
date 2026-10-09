/**
 * @module features/tests/editor/sections/report-variant-modal
 * @description Выбор ВАРИАНТА блока документа отчёта (PRD-51 §5.4).
 *
 * Шаблон вправе объявить блоку несколько раскладок: «Разделы» у «Сертификации» печатаются
 * либо карточками со счётчиком, либо строкой в две колонки. Состав документа при этом не
 * меняется — меняется то, КАК блок печатается.
 *
 * Действие «Сменить вариант» существовало в меню строки с самого PRD-51, но обработчика ему
 * никто не передавал: до 2026-09-21 ни один шаблон второго варианта не объявлял, и пункт
 * стоял погашенным — выглядел живым, а был декорацией.
 *
 * Вариант, объявленный умолчанием, записывается как `templateKey: null`, а не своим ключом:
 * `null` означает «умолчание блока для этого вида отчёта», и тест, выбравший его явно,
 * перестал бы следовать за шаблоном, если тот однажды назначит умолчанием другую раскладку.
 */
import { useEffect, useState } from "react";
import type * as React from "react";
import { Button, ModalDialog } from "@skillum/ui-kit";
import { reportBlockLabel } from "@shared/report/report-blocks";
import type { ReportBlockVariantOption } from "./report-document-list";

export type ReportVariantModalProps = {
  open: boolean;
  /** Ключ блока, у которого меняют вариант (`topics`, `summary`, …). */
  block: string;
  /** Нынешний вариант блока; `null` — умолчание шаблона. */
  current: string | null;
  /** Все варианты активного шаблона; модалка отбирает свои. */
  variants: ReportBlockVariantOption[];
  onClose: () => void;
  onPick: (templateKey: string | null) => void;
};

/** @public */
export function ReportVariantModal(props: ReportVariantModalProps): React.JSX.Element {
  const options = props.variants.filter((v) => v.block === props.block);
  // Выбор держится СВОИМ ключом варианта, даже когда в документе лежит `null`: строка
  // умолчания должна подсвечиваться как выбранная, иначе окно открывается «ни на чём».
  const currentKey = props.current ?? options.find((v) => v.isDefault)?.key ?? null;
  const [selected, setSelected] = useState<string | null>(currentKey);
  // Окно переживает смену строки: без сброса второй блок открывался бы с выбором первого.
  useEffect(() => {
    if (props.open) setSelected(currentKey);
  }, [props.open, currentKey]);

  const pick = () => {
    if (!selected) return;
    const chosen = options.find((v) => v.key === selected);
    props.onPick(chosen?.isDefault ? null : selected);
    props.onClose();
  };

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onClose}
      size="l"
      title={`Вариант блока «${reportBlockLabel(props.block) || props.block}»`}
      description="Состав документа не меняется — меняется раскладка, которой блок печатается."
      footer={
        <>
          <Button variant="ghost" size="m" onClick={props.onClose} data-testid="report-variant-cancel">
            Отмена
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={!selected || selected === currentKey}
            onClick={pick}
            data-testid="report-variant-apply"
          >
            Применить
          </Button>
        </>
      }
    >
      <ul className="variant-list" role="listbox" aria-label="Варианты блока">
        {options.map((v) => (
          <li
            key={v.key}
            className={"variant-list__item" + (selected === v.key ? " is-selected" : "")}
            role="option"
            aria-selected={selected === v.key ? "true" : "false"}
            tabIndex={0}
            onClick={() => setSelected(v.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(v.key);
              }
            }}
            data-testid={`report-variant-option-${v.key}`}
          >
            <div>
              <div className="variant-list__name">{v.label ?? v.key}</div>
              {/* Описание объявляет ШАБЛОН: чем эта раскладка отличается от соседней,
                  знает только он. Без него строка называет вариант, но не объясняет. */}
              {v.description && <div className="variant-list__desc">{v.description}</div>}
            </div>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}
