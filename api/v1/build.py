#!/usr/bin/env python3
"""입결 CSV와 설정을 빈 양식에 넣어 파일 하나로 동작하는 사이트를 만든다.

    python3 build.py --rows rows.csv --config config.json --out site.html
    (선택) --links links.json --grade grade.json --shell shell.html

표준 라이브러리만 쓴다. 오류가 있으면 파일을 만들지 않고 종료 코드 1로 끝난다.
"""
import argparse
import csv
import json
import math
import re
import sys
from html import escape
from pathlib import Path

DICT_COLS = ["지역", "대학", "교과/종합", "전형", "학과", "인문/자연", "소계열"]
NUM_COLS = ["모집인원", "경쟁률", "추합", "변환50", "변환70", "만점", "등급50", "등급70",
            "총지원지원", "합격인원", "실경쟁률"]
REQUIRED = ["대학", "연도", "전형", "학과"]
ALL_COLS = DICT_COLS + ["연도"] + NUM_COLS
BLANKS = {"", "-", "–", "—", "n/a", "na", "null", "none", "nan", "미공개", "비공개"}
MAX_BYTES = 30 * 1024 * 1024


def parse_num(text):
    """숫자로 바꾼다. 결측은 None, 숫자가 아니면 ValueError."""
    s = text.strip().replace(",", "")
    if s.lower() in BLANKS:
        return None
    v = float(s)
    if not math.isfinite(v):
        raise ValueError(text)
    return int(v) if v.is_integer() else v


def row_list(numbers, limit=5):
    more = f" 외 {len(numbers) - limit}행" if len(numbers) > limit else ""
    return ", ".join(map(str, numbers[:limit])) + more


def load_rows(path, errors, warnings):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = [h.strip() for h in (reader.fieldnames or [])]
        reader.fieldnames = header
        missing = [c for c in REQUIRED if c not in header]
        if missing:
            errors.append(f"필수 열이 없습니다: {', '.join(missing)}")
            return []
        absent = [c for c in ALL_COLS if c not in header]
        extra = [c for c in header if c and c not in ALL_COLS]
        if absent:
            warnings.append(f"자료에 없어 비워 둔 열: {', '.join(absent)}")
        if extra:
            warnings.append(f"사이트에서 쓰지 않아 무시한 열: {', '.join(extra)}")
        rows = list(reader)

    blank, bad_year, bad_num, off_grade = {}, [], {}, {}
    out = []
    for line, raw in enumerate(rows, start=2):
        rec = {}
        for c in DICT_COLS:
            rec[c] = (raw.get(c) or "").strip()
        for c in ["대학", "전형", "학과"]:
            if not rec[c]:
                blank.setdefault(c, []).append(line)
        try:
            year = parse_num(raw.get("연도") or "")
            if year is None or int(year) != year or not 2000 <= year <= 2100:
                raise ValueError
            rec["연도"] = int(year)
        except ValueError:
            bad_year.append(line)
        for c in NUM_COLS:
            try:
                rec[c] = parse_num(raw.get(c) or "")
            except ValueError:
                bad_num.setdefault(c, []).append(line)
                rec[c] = None
        for c in ["등급50", "등급70"]:
            v = rec[c]
            if v not in (None, 0) and not 1 <= v <= 9:
                off_grade.setdefault(c, []).append(line)
                rec[c] = None
        out.append(rec)

    if not out:
        errors.append("데이터 행이 없습니다")
    for c, lines in blank.items():
        errors.append(f"'{c}'이(가) 비어 있는 행: {row_list(lines)}")
    if bad_year:
        errors.append(f"연도가 2000~2100 사이의 정수가 아닌 행: {row_list(bad_year)}")
    for c, lines in bad_num.items():
        errors.append(f"'{c}'에 숫자가 아닌 값이 있는 행: {row_list(lines)}")
    for c, lines in off_grade.items():
        warnings.append(f"'{c}'이 1~9를 벗어나 비운 행: {row_list(lines)}")
    if errors:
        return out

    for c in ["등급50", "등급70"]:
        if all(r[c] in (None, 0) for r in out):
            warnings.append(f"'{c}' 값이 하나도 없습니다. 이 값을 쓰는 판정·그래프가 비어 보입니다")
    seen, dups = set(), []
    for line, r in enumerate(out, start=2):
        key = (r["연도"], r["대학"], r["교과/종합"], r["전형"], r["학과"], r["인문/자연"])
        if key in seen:
            dups.append(line)
        seen.add(key)
    if dups:
        warnings.append(f"연도·대학·전형·학과가 겹치는 행 {len(dups)}개: {row_list(dups)}")
    return out


def to_columns(rows):
    dicts, cols = {}, {}
    for c in DICT_COLS:
        dicts[c] = sorted({r[c] for r in rows})
        index = {v: i for i, v in enumerate(dicts[c])}
        cols[c] = [index[r[c]] for r in rows]
    for c in ["연도"] + NUM_COLS:
        cols[c] = [r[c] for r in rows]
    return {"n": len(rows), "dicts": dicts, "cols": cols}


def js(value):
    """<script> 안에 안전하게 넣을 JSON. '<'를 막아 자료가 태그를 닫지 못하게 한다."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def put_script(html, script_id, body):
    pattern = re.compile(rf'<script id="{script_id}">.*?</script>', re.S)
    html, count = pattern.subn(lambda _: f'<script id="{script_id}">{body}</script>', html, count=1)
    if count != 1:
        raise SystemExit(f"양식에서 {script_id} 자리를 찾지 못했습니다")
    return html


def put_meta(html, config):
    title = escape(config["site_title"])
    desc = escape(config.get("description") or f"{config['site_title']} 수시 입결 검색")
    html = re.sub(r"<title>.*?</title>", lambda _: f"<title>{title}</title>", html, count=1)
    html = re.sub(r'(<meta (?:name="description"|property="og:description") content=")[^"]*',
                  lambda m: m.group(1) + desc, html)
    html = re.sub(r'(<meta property="og:title" content=")[^"]*',
                  lambda m: m.group(1) + title, html)
    return html


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rows", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--links")
    ap.add_argument("--grade")
    ap.add_argument("--shell", default=str(here / "shell.html"))
    args = ap.parse_args()

    errors, warnings = [], []
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    for key in ["site_title", "source"]:
        if not str(config.get(key) or "").strip():
            errors.append(f"config.json에 '{key}'가 없습니다")
    rows = load_rows(args.rows, errors, warnings)

    for w in warnings:
        print("주의:", w)
    if errors:
        for e in errors:
            print("오류:", e)
        print("사이트를 만들지 않았습니다. 위 오류를 고친 뒤 다시 실행하세요.")
        sys.exit(1)

    data = to_columns(rows)
    html = Path(args.shell).read_text(encoding="utf-8")
    html = put_meta(html, config)
    html = put_script(html, "susi-config", "window.SITE_CONFIG=" + js(
        {k: config.get(k, "") for k in ["site_title", "source", "note"]}) + ";")
    html = put_script(html, "susi-data", "window.ADIGA_DATA=" + js(data) + ";")
    if args.links:
        links = json.loads(Path(args.links).read_text(encoding="utf-8"))
        html = put_script(html, "susi-links", "window.ADIGA_LINKS=" + js(links) + ";")
    if args.grade:
        grade = json.loads(Path(args.grade).read_text(encoding="utf-8"))
        html = put_script(html, "susi-grade", "window.ADIGA_GRADE=" + js(grade) + ";")

    out = Path(args.out)
    out.write_text(html, encoding="utf-8")
    size = out.stat().st_size
    years = sorted({r["연도"] for r in rows})
    print(f"완료: {out} ({size / 1024 / 1024:.1f}MB)")
    print(f"행 {len(rows):,}개, 대학 {len(data['dicts']['대학'])}개, 학년도 {years[0]}~{years[-1]}")
    if size > MAX_BYTES:
        print("주의: 30MB를 넘어 Claude 앱에서 내려받지 못할 수 있습니다. 오래된 학년도를 줄여 주세요.")


if __name__ == "__main__":
    main()
