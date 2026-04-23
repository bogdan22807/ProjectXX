#!/usr/bin/env python3
"""
Fox runner: Camoufox launch (same stack as camoufox.server) + optional bridge for Node executor.

CLI for Node bridge (used by backend foxRunner.js):
  python3 CreateBrowse.py --bridge-node
  stdin: one JSON line { "username", "headless", "proxy", "actions" }
  → asyncio.run(CreateBrowser(...)) → stdout: one JSON line { "wsEndpoint", "camoufoxServerPid", ... }
  (Node connects via playwright.firefox.connect.)

Otherwise CreateBrowser(UserName, actions) runs Camoufox with AsyncCamoufox (no bridge).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

# launchServer prints ANSI between label and URL: "endpoint:\x1b[93m ws://..."
_WS_LINE_RE = re.compile(r"Websocket endpoint:.*?(ws://[^\s\x1b]+)", re.I | re.DOTALL)

_DIR = Path(__file__).resolve().parent
_BRIDGE_SCRIPT = _DIR / "camoufox_bridge.py"


def _python() -> str:
    return sys.executable


def _get_launch_paths() -> dict:
    out = subprocess.check_output([_python(), str(_BRIDGE_SCRIPT), "paths"], text=True)
    return json.loads(out.strip())


def _emit_ws_bridge_from_data(data: dict) -> None:
    username = str(data.get("username") or "")
    headless = bool(data.get("headless", True))
    proxy = data.get("proxy")
    actions = data.get("actions", None)

    if proxy is not None and isinstance(proxy, dict) and not proxy.get("server"):
        proxy = None

    from camoufox_bridge import build_launch_config_b64

    config_b64 = build_launch_config_b64(
        {"headless": headless, "humanize": 0.4, "geoip": False, "os": "windows", "proxy": proxy}
    )

    paths = _get_launch_paths()
    nodejs = paths["nodejs"]
    launch_script = paths["launchScript"]
    package_cwd = paths["packageCwd"]

    proc = subprocess.Popen(
        [nodejs, launch_script],
        cwd=package_cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdin
    proc.stdin.write(config_b64)
    proc.stdin.close()

    buf = ""
    ws_endpoint = None
    assert proc.stdout

    def _reader():
        nonlocal buf
        try:
            for line in iter(proc.stdout.readline, ""):
                buf += line
        except Exception:
            pass

    wait_s = float(os.environ.get("FOX_BRIDGE_SERVER_WAIT_S", "600"))
    th = threading.Thread(target=_reader, daemon=True)
    th.start()
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        m = _WS_LINE_RE.search(buf)
        if m:
            ws_endpoint = m.group(1).strip()
            break
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    th.join(timeout=0.5)

    if not ws_endpoint:
        try:
            proc.terminate()
        except Exception:
            pass
        print(
            json.dumps({"error": "no websocket url from camoufox server", "output": buf[:4000]}),
            flush=True,
        )
        sys.exit(1)

    print(
        json.dumps(
            {
                "wsEndpoint": ws_endpoint,
                "camoufoxServerPid": proc.pid,
                "username": username,
                "actionsPassed": actions is not None,
            }
        ),
        flush=True,
    )
    # Leave server process running for Node to connect; do not wait() here.
    # Parent (Node) owns lifecycle via closing Playwright + killing process if needed.


async def CreateBrowser(UserName: str, actions=None):
    """
    Launch Camoufox browser. When FOX_BRIDGE_STDOUT=1 (Node fox runner), emit ws URL JSON only
    (payload in env FOX_BRIDGE_PAYLOAD set by main before asyncio.run).
    Otherwise launch AsyncCamoufox locally (same options as original integration).
    """
    if os.environ.get("FOX_BRIDGE_STDOUT") == "1":
        raw = os.environ.get("FOX_BRIDGE_PAYLOAD", "").strip()
        if not raw:
            print(json.dumps({"error": "missing FOX_BRIDGE_PAYLOAD"}), flush=True)
            sys.exit(1)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"invalid JSON: {e}"}), flush=True)
            sys.exit(1)
        _emit_ws_bridge_from_data(data)
        return None

    from camoufox import AsyncCamoufox

    headless = os.environ.get("FOX_HEADLESS", "1").strip() not in ("0", "false", "False")
    proxy = None
    raw_proxy = os.environ.get("FOX_PROXY_JSON", "").strip()
    if raw_proxy:
        try:
            proxy = json.loads(raw_proxy)
        except json.JSONDecodeError:
            proxy = None
        if isinstance(proxy, dict) and not proxy.get("server"):
            proxy = None

    options = {
        "headless": headless,
        "humanize": 0.4,
        "geoip": False,
        "os": "windows",
        "enable_cache": True,
        "block_webrtc": True,
        "i_know_what_im_doing": True,
        "debug": False,
    }
    if proxy:
        options["proxy"] = proxy

    async with AsyncCamoufox(**options) as browser:
        page = await browser.new_page()
        await page.goto("https://www.google.com", wait_until="commit", timeout=60_000)

        if actions is None:
            while not page.is_closed():
                await asyncio.sleep(3)
        else:
            if callable(actions):
                await actions(UserName, page)
            else:
                await asyncio.sleep(1)

    return True


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--bridge-node":
        line = sys.stdin.readline()
        if not line.strip():
            print(json.dumps({"error": "empty stdin"}), flush=True)
            sys.exit(1)
        os.environ["FOX_BRIDGE_STDOUT"] = "1"
        os.environ["FOX_BRIDGE_PAYLOAD"] = line.strip()
        asyncio.run(CreateBrowser("", None))
        return
    if len(sys.argv) < 2:
        print("usage: CreateBrowse.py <UserName> [actions_json_path]", file=sys.stderr)
        sys.exit(2)
    user = sys.argv[1]
    actions = None
    if len(sys.argv) > 2:
        p = Path(sys.argv[2])
        if p.is_file():
            actions = json.loads(p.read_text(encoding="utf-8"))
    asyncio.run(CreateBrowser(user, actions))


if __name__ == "__main__":
    main()
