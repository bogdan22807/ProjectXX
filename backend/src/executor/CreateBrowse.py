#!/usr/bin/env python3
"""
Fox / Camoufox bridge entrypoint (spawned from foxRunner.js).

Reads bridge JSON from stdin, or FOX_BRIDGE_JSON / FOX_USERNAME + related env vars.
On success prints one stdout line: {"wsEndpoint":"ws://...","camoufoxServerPid":<int>}
On failure prints one stdout line: {"error":"...","trace":"..."} and exits 1.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from fox_core.runner import main_bridge  # noqa: E402

if __name__ == "__main__":
    main_bridge()
