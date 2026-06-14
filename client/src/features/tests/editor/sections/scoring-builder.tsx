/**
 * @module features/tests/editor/sections/scoring-builder
 * @description PRD-10 Stage 4 / PRD-15 block D (FR-35): the "Цена ответа"
 * (graded answer scoring) constructor. Originally part of the question editor
 * (questions.tsx); relocated UNCHANGED into the test editor — scoring is a
 * property of the test, the config is serialized into the per-(test, question)
 * override (`test_question_scoring.scoring_json`, scoring-model §11). Built
 * with the design-system `@universityrt/ui-kit` components (the approved DS
 * wireframe is the layout/behaviour spec, not a literal render).
 *
 * Modes by type (engine support, scoring-model §11.3-11.5):
 * - single                       — exact | weighted (option weights)
 * - multiple / matching / ranking — exact | tiered (step table over counters)
 *
 * The tier predicate is a conjunction over the answer counters: `c` correctly
 * selected units, `x` wrongly selected; the right side is a number or the
 * per-type total token (T options / P pairs / N items). A non-matching answer
 * scores 0 (FR-07), so the implicit "иначе → 0" row is shown read-only.
 */
import { Plus, Trash2, X } from "lucide-react";
import {
  Button,
  Cluster,
  IconButton,
  Input,
  Label,
  SegmentedControl,
  Select,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";

export type ScoringMode = "exact" | "weighted" | "tiered";
export type CondLhs = "c" | "x";
export type CondOp = "==" | ">=" | "<=" | "<" | ">";

export interface CondDraft {
  lhs: CondLhs;
  op: CondOp;
  rhs: string;
}
export interface TierDraft {
  conds: CondDraft[];
  score: string;
}

type QuestionType = "single" | "multiple" | "matching" | "ranking";

const OPS: { value: CondOp; label: string }[] = [
  { value: "==", label: "=" },
  { value: ">=", label: "≥" },
  { value: "<=", label: "≤" },
  { value: "<", label: "<" },
  { value: ">", label: ">" },
];

/** Per-type total token (rhs) and a label for the counter. */
function totalToken(type: QuestionType): string {
  if (type === "matching") return "P";
  if (type === "ranking") return "N";
  return "T";
}

/** Numeric value of a draft (NaN-safe). */
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Derived maximum score (sMax) for the current config. */
export function deriveSMax(mode: ScoringMode, weights: string[], tiers: TierDraft[]): number {
  if (mode === "weighted") return weights.reduce((m, w) => Math.max(m, num(w)), 0);
  if (mode === "tiered") return tiers.reduce((m, t) => Math.max(m, num(t.score)), 0);
  return 1;
}

export interface ScoringBuilderProps {
  type: QuestionType;
  /** Current answer options (single/multiple) — labels for the weights table. */
  options: string[];
  mode: ScoringMode;
  setMode: (m: ScoringMode) => void;
  weights: string[];
  setWeights: (w: string[]) => void;
  tiers: TierDraft[];
  setTiers: (t: TierDraft[]) => void;
}

export function ScoringBuilder({
  type,
  options,
  mode,
  setMode,
  weights,
  setWeights,
  tiers,
  setTiers,
}: ScoringBuilderProps) {
  const token = totalToken(type);
  const modes: { value: ScoringMode; label: string }[] = [
    { value: "exact", label: "Точное совпадение" },
    ...(type === "single"
      ? ([{ value: "weighted", label: "Веса опций" }] as const)
      : ([{ value: "tiered", label: "Ступенчато" }] as const)),
  ];
  const sMax = deriveSMax(mode, weights, tiers);

  // ── weighted helpers ──
  const setWeight = (i: number, value: string) => {
    const next = options.map((_, idx) => weights[idx] ?? "0");
    next[i] = value;
    setWeights(next);
  };

  // ── tiered helpers ──
  const emptyCond = (): CondDraft => ({ lhs: "c", op: ">=", rhs: "1" });
  const addTier = () => setTiers([...tiers, { conds: [emptyCond()], score: "1" }]);
  const removeTier = (ti: number) => setTiers(tiers.filter((_, i) => i !== ti));
  const setTierScore = (ti: number, score: string) =>
    setTiers(tiers.map((t, i) => (i === ti ? { ...t, score } : t)));
  const addCond = (ti: number) =>
    setTiers(tiers.map((t, i) => (i === ti ? { ...t, conds: [...t.conds, emptyCond()] } : t)));
  const removeCond = (ti: number, ci: number) =>
    setTiers(
      tiers.map((t, i) =>
        i === ti ? { ...t, conds: t.conds.filter((_, j) => j !== ci) } : t,
      ),
    );
  const setCond = (ti: number, ci: number, patch: Partial<CondDraft>) =>
    setTiers(
      tiers.map((t, i) =>
        i === ti
          ? { ...t, conds: t.conds.map((c, j) => (j === ci ? { ...c, ...patch } : c)) }
          : t,
      ),
    );

  return (
    <Stack gap={4} data-testid="scoring-builder">
      <Cluster justify="between" gap={2} wrap={false}>
        <Label className="mb-0">Цена ответа</Label>
        <Tag variant="outline" data-testid="scoring-smax">
          Макс. балл sMax = {sMax}
        </Tag>
      </Cluster>

      {/* Mode selector (segmented). */}
      <SegmentedControl
        size="s"
        aria-label="Цена ответа"
        items={modes}
        value={mode}
        onChange={setMode}
      />

      {/* exact — informational. */}
      {mode === "exact" && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="scoring-exact-hint">
          Вопрос оценивается точным совпадением (0/1) — как все существующие тесты. Чтобы дать
          частичный балл, переключите способ{type === "single" ? " на «Веса опций»" : " на «Ступенчато»"}.
        </div>
      )}

      {/* weighted (single) — option weights. */}
      {mode === "weighted" && type === "single" && (
        <Stack gap={2} data-testid="scoring-weights">
          <div className="grid grid-cols-[1fr_6rem] gap-2 text-xs font-medium text-muted-foreground">
            <div>Вариант ответа</div>
            <div>Балл</div>
          </div>
          {options.map((opt, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem] items-center gap-2">
              <div className="text-sm">{opt.trim() || `Вариант ${i + 1}`}</div>
              <Input
                type="number"
                min={0}
                fullWidth
                value={weights[i] ?? ""}
                onChange={(e) => setWeight(i, e.target.value)}
                placeholder="0"
                data-testid={`scoring-weight-${i}`}
              />
            </div>
          ))}
          <Text as="p" variant="body-s" tone="muted">Балл = вес выбранного варианта; sMax = наибольший вес.</Text>
        </Stack>
      )}

      {/* tiered (multiple/matching/ranking) — step-table constructor. */}
      {mode === "tiered" && type !== "single" && (
        <Stack gap={3} data-testid="scoring-tiers">
          <Text as="p" variant="body-s" tone="muted">
            Ступени проверяются сверху вниз, засчитывается первая подходящая. Счётчики: <b>c</b> — верных
            выбрано, <b>x</b> — лишних; <b>{token}</b> — всего {type === "matching" ? "пар" : type === "ranking" ? "элементов" : "верных"}.
          </Text>

          {tiers.map((tier, ti) => (
            <div key={ti} className="rounded-md border p-3 space-y-2" data-testid={`scoring-tier-${ti}`}>
              <Cluster align="start" justify="between" gap={3} wrap={false}>
                <Stack gap={2} grow>
                  {tier.conds.map((cond, ci) => (
                    <Cluster key={ci} gap={2}>
                      <Select
                        className="w-36"
                        value={cond.lhs}
                        onChange={(v) => setCond(ti, ci, { lhs: v as CondLhs })}
                        options={[
                          { value: "c", label: "Верных (c)" },
                          { value: "x", label: "Лишних (x)" },
                        ]}
                        data-testid={`scoring-cond-lhs-${ti}-${ci}`}
                      />
                      <Select
                        className="w-20"
                        value={cond.op}
                        onChange={(v) => setCond(ti, ci, { op: v as CondOp })}
                        options={OPS.map((o) => ({ value: o.value, label: o.label }))}
                        data-testid={`scoring-cond-op-${ti}-${ci}`}
                      />
                      <Input
                        className="w-24"
                        value={cond.rhs}
                        onChange={(e) => setCond(ti, ci, { rhs: e.target.value })}
                        placeholder={`число или ${token}`}
                        data-testid={`scoring-cond-rhs-${ti}-${ci}`}
                      />
                      {tier.conds.length > 1 && (
                        <IconButton
                          variant="ghost"
                          size="s"
                          icon={<X size={16} />}
                          onClick={() => removeCond(ti, ci)}
                          aria-label="Удалить условие"
                        />
                      )}
                    </Cluster>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="s"
                    leadingIcon={<Plus size={16} />}
                    onClick={() => addCond(ti)}
                    data-testid={`scoring-add-cond-${ti}`}
                  >
                    И условие
                  </Button>
                </Stack>
                <Cluster gap={2} wrap={false}>
                  <Input
                    type="number"
                    min={0}
                    className="w-20"
                    value={tier.score}
                    onChange={(e) => setTierScore(ti, e.target.value)}
                    placeholder="0"
                    aria-label="Балл ступени"
                    data-testid={`scoring-tier-score-${ti}`}
                  />
                  <IconButton
                    variant="ghost"
                    size="s"
                    icon={<Trash2 size={16} />}
                    onClick={() => removeTier(ti)}
                    aria-label="Удалить строку"
                  />
                </Cluster>
              </Cluster>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            <em>Иначе — во всех остальных случаях</em>
            <span>0</span>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="s"
            leadingIcon={<Plus size={16} />}
            onClick={addTier}
            data-testid="scoring-add-tier"
          >
            Добавить строку
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Parse a stored `scoring_json` value into the builder's draft state. The
 * inverse of {@link buildScoringJson}; used to initialise the constructor from
 * an existing override (or, transitionally, the question's own config).
 */
export function parseScoringJson(raw: unknown): {
  mode: ScoringMode;
  weights: string[];
  tiers: TierDraft[];
} {
  const scoring = raw as { kind?: string; weights?: number[]; tiers?: unknown[] } | null;
  const mode: ScoringMode =
    scoring?.kind === "weighted" || scoring?.kind === "tiered" ? scoring.kind : "exact";
  const weights =
    scoring?.kind === "weighted" && Array.isArray(scoring.weights)
      ? scoring.weights.map(String)
      : [];
  const tiers: TierDraft[] =
    scoring?.kind === "tiered" && Array.isArray(scoring.tiers)
      ? (scoring.tiers as Array<{ when?: { all?: Array<{ lhs: string; op: string; rhs: unknown }> }; score?: number }>).map(
          (tier) => ({
            conds: (tier.when?.all ?? []).map((c) => ({
              lhs: c.lhs as CondLhs,
              op: c.op as CondOp,
              rhs: String(c.rhs),
            })),
            score: String(tier.score ?? 0),
          }),
        )
      : [];
  return { mode, weights, tiers };
}

/**
 * Serialize the draft scoring state to `question.scoringJson`. Returns null for
 * exact mode (absence = exact, keeps packages byte-identical, FR-02).
 */
export function buildScoringJson(
  type: QuestionType,
  options: string[],
  mode: ScoringMode,
  weights: string[],
  tiers: TierDraft[],
): unknown {
  if (mode === "weighted" && type === "single") {
    return { kind: "weighted", weights: options.map((_, i) => num(weights[i] ?? "0")) };
  }
  if (mode === "tiered" && type !== "single") {
    const parseRhs = (s: string): number | string => {
      const t = s.trim().toUpperCase();
      if (t === "T" || t === "P" || t === "N") return t;
      return num(s);
    };
    const cleaned = tiers
      .filter((t) => t.conds.length > 0)
      .map((t) => ({
        when: { all: t.conds.map((c) => ({ lhs: c.lhs, op: c.op, rhs: parseRhs(c.rhs) })) },
        score: num(t.score),
      }));
    if (cleaned.length === 0) return null;
    return { kind: "tiered", tiers: cleaned };
  }
  return null; // exact
}
