/**
 * @module components/truncated-label
 * @description A single-line label that reveals its full text as a native tooltip
 * ONLY when the text is actually clipped by the column.
 *
 * List cells clamp long values with `text-overflow: ellipsis`, and a question's
 * prompt is routinely longer than its column — the row then shows a sentence that
 * breaks off mid-word with no way to read the rest without opening the editor.
 * A `title` set unconditionally is the other extreme: on a label that fits it
 * pops up a tooltip repeating text already on screen, over the row the pointer is
 * about to click. So the attribute is attached only while the element overflows,
 * re-measured when the text or the column width changes.
 */
import { useEffect, useRef, useState } from "react";

export interface TruncatedLabelProps {
  /** The full value — rendered inside, and shown as the tooltip when clipped. */
  text: string;
  /** Class of the clamping cell (the caller owns the ellipsis styling). */
  className?: string;
  "data-testid"?: string;
}

export function TruncatedLabel({ text, className, ...rest }: TruncatedLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px tolerance: sub-pixel text metrics make scrollWidth exceed clientWidth
    // by a fraction on labels that visually fit exactly.
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={className} title={clipped ? text : undefined} {...rest}>
      {text}
    </span>
  );
}
