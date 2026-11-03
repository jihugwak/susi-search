#!/usr/bin/env python3
"""index.html과 app.js로 빈 양식(api/v1/shell.html)과 키트 zip을 만든다.

사이트 코드를 고친 뒤 실행하면 공개 양식도 같은 코드로 갱신된다.
    python3 scripts/make_shell.py
"""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api" / "v1"
KIT_FILES = ["INSTRUCTIONS.md", "build.py", "shell.html", "sample.csv", "manifest.json"]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def inline(body):
    assert "</script" not in body.lower()
    return body


html = read("index.html")
scripts = re.search(r'<script src="loader\.js"></script>', html)
assert scripts, "index.html의 script 태그를 찾지 못했습니다"
block = "\n".join([
    '<script id="susi-config">window.SITE_CONFIG=null;</script>',
    '<script id="susi-data">window.ADIGA_DATA=null;</script>',
    f'<script id="susi-links">{inline(read("links.js"))}</script>',
    f'<script id="susi-grade">{inline(read("grade.js"))}</script>',
    f'<script>{inline(read("app.js"))}</script>',
])
shell = html[:scripts.start()] + block + html[scripts.end():]
shell = re.sub(r'<meta property="og:url"[^>]*>\n?', "", shell)
(API / "shell.html").write_text(shell, encoding="utf-8")

with zipfile.ZipFile(API / "susi-site-kit.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name in KIT_FILES:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, (API / name).read_bytes())
print(f"shell.html {len(shell.encode()):,} bytes, kit {(API / 'susi-site-kit.zip').stat().st_size:,} bytes")
