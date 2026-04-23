#!/usr/bin/env python3
"""
Fox / Camoufox browser bootstrap (subprocess from foxRunner.js).
On failure: full traceback to stderr and stdout, plus one-line JSON on stdout for the parent.
"""

from __future__ import annotations

import json
import sys
import traceback


def CreateBrowser() -> None:
    """
    Wire Camoufox / Playwright connection here. Until implemented, this raises so
    Node logs FOX_PYTHON_ERROR with full stderr/stdout.
    """
    raise RuntimeError(
        "FOX_BROWSER_NOT_IMPLEMENTED: Camoufox/Python runner is not fully wired. "
        "Implement CreateBrowser() or set account browser_engine to chromium."
    )


def main() -> None:
    try:
        CreateBrowser()
        print(json.dumps({"ok": True}), flush=True)
    except BaseException as exc:  # noqa: BLE001 — intentional: log everything
        trace = traceback.format_exc()
        print(trace, file=sys.stderr, flush=True)
        print(trace, flush=True)
        payload = {"error": str(exc), "trace": trace}
        print(json.dumps(payload), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
