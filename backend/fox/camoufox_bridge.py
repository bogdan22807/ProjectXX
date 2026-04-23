#!/usr/bin/env python3
"""
Bridge for Node executor: same Camoufox launch payload as `camoufox.server.launch_server`
(Python camoufox.utils.launch_options + to_camel_case_dict), without blocking on process.wait().

Usage:
  python3 camoufox_bridge.py paths
    → stdout: one JSON line { "nodejs", "launchScript", "packageCwd" }

  python3 camoufox_bridge.py config  < stdin JSON
    → stdout: base64 string for launchServer.js stdin (same encoding as camoufox.server)
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path


def cmd_paths() -> None:
    from playwright._impl._driver import compute_driver_executable

    import camoufox

    nodejs = compute_driver_executable()[0]
    if isinstance(nodejs, tuple):
        nodejs = nodejs[0]
    nodejs = str(nodejs)
    pkg = str(Path(nodejs).parent / "package")
    launch = str(Path(camoufox.__file__).resolve().parent / "launchServer.js")
    print(json.dumps({"nodejs": nodejs, "launchScript": launch, "packageCwd": pkg}), flush=True)


def build_launch_config_b64(inp: dict) -> str:
    """Same payload as camoufox.server stdin for launchServer.js (reused by CreateBrowse)."""
    from camoufox.server import to_camel_case_dict
    from camoufox.utils import launch_options

    headless = bool(inp.get("headless", True))
    proxy = inp.get("proxy")
    if proxy is not None and isinstance(proxy, dict) and not proxy.get("server"):
        proxy = None
    humanize = inp.get("humanize", 0.4)
    # Default False: geoip=True requires `pip install camoufox[geoip]` (MaxMind DB).
    geoip = inp.get("geoip", False)
    os_name = inp.get("os", "windows")

    launch_kw = dict(
        headless=headless,
        humanize=humanize,
        geoip=geoip,
        os=os_name,
        enable_cache=True,
        block_webrtc=True,
        i_know_what_im_doing=True,
    )
    if proxy is not None:
        launch_kw["proxy"] = proxy
    opts = launch_options(**launch_kw)
    # launchServer rejects JSON null for proxy — omit key when unset
    if opts.get("proxy") is None:
        opts.pop("proxy", None)
    data = __import__("orjson").dumps(to_camel_case_dict(opts))
    return base64.b64encode(data).decode()


def cmd_config() -> None:
    raw = sys.stdin.read() or "{}"
    inp = json.loads(raw)
    sys.stdout.write(build_launch_config_b64(inp))
    sys.stdout.flush()


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: camoufox_bridge.py paths|config", file=sys.stderr)
        sys.exit(2)
    cmd = sys.argv[1].strip().lower()
    if cmd == "paths":
        cmd_paths()
    elif cmd == "config":
        cmd_config()
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
