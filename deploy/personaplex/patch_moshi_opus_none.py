#!/usr/bin/env python3
"""Moshi opus_loop crashes when sphn returns None instead of an empty array."""
from __future__ import annotations

import sys
from pathlib import Path

NEEDLE = """                pcm = opus_reader.read_pcm()
                if pcm.shape[-1] == 0:
                    continue
"""
PATCH = """                pcm = opus_reader.read_pcm()
                if pcm is None or getattr(pcm, "shape", None) is None or pcm.shape[-1] == 0:
                    continue
"""


def main() -> int:
    roots = [Path(p) for p in sys.argv[1:]] or [
        Path("/workspace/.venv/lib/python3.11/site-packages/moshi/server.py"),
    ]
    patched = 0
    for path in roots:
        if not path.is_file():
            continue
        text = path.read_text()
        if "pcm is None or getattr(pcm" in text:
            print(f"already patched {path}")
            patched += 1
            continue
        if NEEDLE not in text:
            print(f"pattern not found in {path}", file=sys.stderr)
            continue
        path.write_text(text.replace(NEEDLE, PATCH, 1))
        print(f"patched {path}")
        patched += 1
    return 0 if patched else 1


if __name__ == "__main__":
    raise SystemExit(main())
