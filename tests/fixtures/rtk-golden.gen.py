# PRD-10 Stage 6 — generator for tests/fixtures/rtk-golden.json (one-off, auditable).
#
# Reads the RTK manager-certification reference and emits a golden fixture that
# tests/rtk-golden.test.ts replays through shared/scoring/engine.ts:
#   - key:    docs/references/.../Обработка серт теста/key_NEW_15-08-25.xlsx
#   - report: docs/references/.../report_processed_pandas_2026-03-12_11-36-05.xlsx
#   - rules:  docs/references/main/main.py (the pandas post-processor)
#
# For each of the 63 answered questions it reconstructs the learner's answer from
# the report text, builds the engine config (RTK-standard rules below) and the
# expected score/sMax from the report, then SELF-VALIDATES that the RTK rule
# reproduces the report score before writing. Run from the repo root with
# openpyxl installed: `python tests/fixtures/rtk-golden.gen.py`.
#
# RTK scoring rules (main.py):
#   weighted single   : score = weight of the chosen option (key "%A2B1C1D0").
#   exact single      : 1 if chosen == key else 0.
#   multiple (c,x,T)  : c==T&x==0 -> 2; (c==1&x==0)|(c==1&x==1)|(c==T&x==1) -> 1; else 0. sMax 2.
#   matching (c,P)    : P==3 -> c==P:2, c>=1:1, else 0 (sMax 2);
#                       P in {4,5} -> c==P:3, c>=2:2, c==1:1, else 0 (sMax 3).
import glob, openpyxl, re, json, os


def find(n):
    return glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "references", "**", n), recursive=True)[0]


def rows(n):
    wb = openpyxl.load_workbook(find(n), data_only=True, read_only=True)
    return list(wb.worksheets[0].iter_rows(values_only=True))


# Engine config templates (RTK-standard tier tables, expressed in the PRD-10 schema).
MULT = [
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": "T"}, {"lhs": "x", "op": "==", "rhs": 0}]}, "score": 2},
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": 1}, {"lhs": "x", "op": "==", "rhs": 0}]}, "score": 1},
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": 1}, {"lhs": "x", "op": "==", "rhs": 1}]}, "score": 1},
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": "T"}, {"lhs": "x", "op": "==", "rhs": 1}]}, "score": 1},
]
M3 = [
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": "P"}]}, "score": 2},
    {"when": {"all": [{"lhs": "c", "op": ">=", "rhs": 1}]}, "score": 1},
]
M45 = [
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": "P"}]}, "score": 3},
    {"when": {"all": [{"lhs": "c", "op": ">=", "rhs": 2}]}, "score": 2},
    {"when": {"all": [{"lhs": "c", "op": "==", "rhs": 1}]}, "score": 1},
]


def li(ch):
    return ord(ch) - 65


def chosen_letters(a):
    return re.findall(r'(?:^|[\n,])\s*([A-E])\.\s', a)


def rtk_mult(c, x, T):
    if c == T and x == 0:
        return 2
    if (c == 1 and x in (0, 1)) or (c == T and x == 1):
        return 1
    return 0


def rtk_match(c, P):
    if P == 3:
        return 2 if c == P else (1 if c >= 1 else 0)
    if P in (4, 5):
        return 3 if c == P else (2 if c >= 2 else (1 if c == 1 else 0))
    return None


def main():
    kr = rows("key_NEW_15-08-25.xlsx")
    KEY = {r[1]: r for r in kr[1:] if r[1]}
    rr = rows("report_processed_pandas_2026-03-12_11-36-05.xlsx")
    fix, bad, counts = [], [], {}
    for r in rr[1:]:
        code, k = r[9], KEY.get(r[9])
        if not k:
            continue
        key, ans, rep_score, rep_max = str(k[11]).strip(), str(r[11]), r[12], r[13]
        if key.startswith('%'):
            cls = "weighted"
        elif re.search(r'[A-Za-z]\d', key):
            cls = "matching"
        elif rep_max == 1:
            cls = "exact"
        else:
            cls = "multiple"
        counts[cls] = counts.get(cls, 0) + 1
        if cls in ("exact", "weighted"):
            ch = chosen_letters(ans)
            chosen = li(ch[0]) if ch else -1
            if cls == "exact":
                ci = li(re.sub(r'[^A-E]', '', key)[0])
                entry = {"type": "single", "correct": {"correctIndex": ci}, "answer": chosen, "scoring": None}
                calc, sMax = (1 if chosen == ci else 0), 1
            else:
                w = {m.group(1): int(m.group(2)) for m in re.finditer(r'([A-E])(\d)', key)}
                n = max(li(x) for x in w) + 1
                weights = [w.get(chr(65 + i), 0) for i in range(n)]
                entry = {"type": "single", "correct": {"correctIndex": weights.index(max(weights))},
                         "answer": chosen, "scoring": {"kind": "weighted", "weights": weights}}
                calc, sMax = (weights[chosen] if 0 <= chosen < n else 0), max(weights)
        elif cls == "multiple":
            correct = sorted(li(x) for x in set(re.sub(r'[^A-E]', '', key)))
            sel = sorted(set(li(x) for x in chosen_letters(ans)))
            c, x, T = len(set(sel) & set(correct)), len(set(sel) - set(correct)), len(correct)
            calc, sMax = rtk_mult(c, x, T), 2
            entry = {"type": "multiple", "correct": {"correctIndices": correct}, "answer": sel,
                     "scoring": {"kind": "tiered", "tiers": MULT}}
        else:  # matching
            kp = {m.group(1): int(m.group(2)) for m in re.finditer(r'([A-E])(\d)', key)}
            pairs = [{"left": li(L), "right": kp[L] - 1} for L in kp]
            P = len(kp)
            amap = {}
            for line in ans.split('\n'):
                m = re.match(r'\s*([A-E])\.', line)
                nums = re.findall(r'(\d)\.', line)
                if m and nums:
                    amap[li(m.group(1))] = int(nums[-1]) - 1
            c = sum(1 for p in pairs if amap.get(p["left"]) == p["right"])
            calc, sMax = rtk_match(c, P), (3 if P in (4, 5) else 2)
            entry = {"type": "matching", "correct": {"pairs": pairs},
                     "answer": {str(kk): vv for kk, vv in amap.items()},
                     "scoring": {"kind": "tiered", "tiers": (M45 if P in (4, 5) else M3)}}
        entry.update({"code": code, "expectedScore": rep_score, "expectedSMax": rep_max})
        if calc != rep_score or sMax != rep_max:
            bad.append((code, cls, calc, rep_score, sMax, rep_max))
        fix.append(entry)
    print("counts:", counts, "total:", len(fix), "mismatches:", len(bad))
    for b in bad[:20]:
        print("  MISMATCH:", b)
    assert not bad, "RTK rule does not reproduce the report; fix reconstruction before writing."
    out = os.path.join(os.path.dirname(__file__), "rtk-golden.json")
    json.dump(fix, open(out, "w", encoding="ascii"), ensure_ascii=True, indent=1)
    print("WROTE", out, "entries=", len(fix))


if __name__ == "__main__":
    main()
