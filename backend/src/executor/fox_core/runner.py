"""
Fox / Camoufox runner core (bridge-node).

Mirrors the structure described for the in-house runner:
- get_profile_dir / _load_saved_data / saved["proxy"]
- _build_browser_options(saved, profile_dir) → Playwright-Camoufox launch dict
- AsyncCamoufox path for local in-process use
- Bridge: same options dict is sent to Camoufox's Node launchServer (see camoufox.server),
  which prints the Playwright CDP WebSocket URL — consumed by Node `firefox.connect`.
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
import traceback
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional, Tuple

_WS_RE = re.compile(r"(ws://[^\s\x1b]+)")


def _data_root() -> Path:
    raw = (os.environ.get("FOX_DATA_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(os.path.expanduser("~/.projectxx/fox_profiles")).resolve()


def get_profile_dir(username: str) -> Path:
    """Per-user persistent profile directory (user_data_dir)."""
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in username.strip()) or "default"
    return (_data_root() / safe).resolve()


def _load_saved_data(profile_dir: Path) -> Dict[str, Any]:
    """Load optional JSON sidecar next to the Firefox profile."""
    path = profile_dir / "saved.json"
    if not path.is_file():
        return {"proxy": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"proxy": None}
        data.setdefault("proxy", None)
        return data
    except Exception:
        return {"proxy": None}


def _persist_saved(profile_dir: Path, saved: Dict[str, Any]) -> None:
    profile_dir.mkdir(parents=True, exist_ok=True)
    (profile_dir / "saved.json").write_text(
        json.dumps(saved, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _playwright_proxy_from_dict(proxy: Any) -> Optional[Dict[str, str]]:
    if proxy is None:
        return None
    if not isinstance(proxy, dict):
        return None
    server = str(proxy.get("server") or "").strip()
    if not server:
        return None
    out: Dict[str, str] = {"server": server}
    u = proxy.get("username")
    p = proxy.get("password")
    if u is not None and str(u).strip():
        out["username"] = str(u)
    if p is not None and str(p).strip():
        out["password"] = str(p)
    return out


def _merge_payload_into_saved(saved: Dict[str, Any], payload: Dict[str, Any]) -> None:
    """Apply bridge payload onto saved (proxy, user agent hints, actions)."""
    pxy = payload.get("proxy")
    if pxy is not None:
        saved["proxy"] = _playwright_proxy_from_dict(pxy)

    ua = payload.get("userAgent")
    if ua and str(ua).strip():
        cfg = saved.get("config")
        if not isinstance(cfg, dict):
            cfg = {}
        cfg["headers.User-Agent"] = str(ua).strip()
        saved["config"] = cfg

    actions = payload.get("actions")
    if actions is not None:
        saved["actions"] = actions


def _fox_display_launch_kwargs() -> Dict[str, Any]:
    """
    Stable Camoufox window + screen so fingerprint matches real window (no 1920x1080 screen vs tiny window).
    Env: FOX_WINDOW_WIDTH, FOX_WINDOW_HEIGHT (default 1366x768). Screen is pinned to the same rectangle.
    """
    from browserforge.fingerprints import Screen

    w = int((os.environ.get("FOX_WINDOW_WIDTH") or "1366").strip() or "1366")
    h = int((os.environ.get("FOX_WINDOW_HEIGHT") or "768").strip() or "768")
    w = max(800, min(w, 3840))
    h = max(600, min(h, 2160))
    screen = Screen(min_width=w, max_width=w, min_height=h, max_height=h)
    return {"window": (w, h), "screen": screen}


def _build_browser_options(
    saved: Dict[str, Any],
    profile_dir: Path,
    *,
    headless: bool,
) -> Dict[str, Any]:
    """
    Build Camoufox `from_options` for firefox.launch / launch_persistent_context.
    Uses camoufox.utils.launch_options (same pipeline as AsyncCamoufox).
    """
    from camoufox.utils import launch_options

    profile_dir.mkdir(parents=True, exist_ok=True)

    proxy = _playwright_proxy_from_dict(saved.get("proxy"))
    config = saved.get("config") if isinstance(saved.get("config"), dict) else None

    user_lk = saved.get("launch_kwargs") if isinstance(saved.get("launch_kwargs"), dict) else {}
    display_kw = _fox_display_launch_kwargs()
    # Pin window/screen last so old saved.json cannot force e.g. 1920×1080 fingerprint vs small window.
    launch_kw = {**user_lk, **display_kw}

    opts = launch_options(
        headless=headless,
        proxy=proxy,
        config=config,
        **launch_kw,
    )
    opts = dict(opts)
    opts["user_data_dir"] = str(profile_dir)
    return opts


def _camel_case(snake_str: str) -> str:
    if len(snake_str) < 2:
        return snake_str
    parts = snake_str.lower().split("_")
    return parts[0] + "".join(x.capitalize() for x in parts[1:])


def _to_camel_case_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    return {_camel_case(k): v for k, v in data.items()}


def _camoufox_launch_server_js() -> Path:
    import camoufox

    p = Path(camoufox.__file__).resolve().parent / "launchServer.js"
    if not p.is_file():
        raise FileNotFoundError(f"Camoufox launchServer.js not found at {p}")
    return p


def _nodejs_from_playwright() -> str:
    from playwright._impl._driver import compute_driver_executable

    nodejs = compute_driver_executable()[0]
    if isinstance(nodejs, tuple):
        return str(nodejs[0])
    return str(nodejs)


def _spawn_ws_server(from_options: Dict[str, Any]) -> Tuple[str, int]:
    """
    Spawn Camoufox Node bridge (same stdin/base64 contract as camoufox.server.launch_server).
    Returns (ws_endpoint, child_pid).
    """
    import orjson
    from pathlib import Path as P

    nodejs = _nodejs_from_playwright()
    launch_script = _camoufox_launch_server_js()
    cwd = P(nodejs).parent / "package"
    if not cwd.is_dir():
        raise FileNotFoundError(f"Playwright driver package dir missing: {cwd}")

    data = orjson.dumps(_to_camel_case_dict(from_options))
    b64 = base64.b64encode(data).decode("ascii")

    proc = subprocess.Popen(  # noqa: S603
        [nodejs, str(launch_script)],
        cwd=str(cwd),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    if proc.stdin:
        proc.stdin.write(b64)
        proc.stdin.close()

    ws: Optional[str] = None
    buf_err: list[str] = []

    def drain_stderr() -> None:
        if not proc.stderr:
            return
        for line in proc.stderr:
            buf_err.append(line)
            print(line, file=sys.stderr, end="")

    t_err = threading.Thread(target=drain_stderr, daemon=True)
    t_err.start()

    if proc.stdout is None:
        raise RuntimeError("server stdout not available")

    for _ in range(600):  # ~60s if time.sleep 0.1
        line = proc.stdout.readline()
        if not line:
            break
        m = _WS_RE.search(line)
        if m:
            ws = m.group(1)
            break

    if not ws:
        proc.kill()
        err_tail = "".join(buf_err[-40:])
        raise RuntimeError(
            "Camoufox server did not print ws endpoint in time.\n" + err_tail,
        )

    def _drain_stdout() -> None:
        try:
            for _ in proc.stdout:
                pass
        except Exception:
            pass

    threading.Thread(target=_drain_stdout, daemon=True).start()

    return ws, int(proc.pid)


@asynccontextmanager
async def CreateBrowser(  # noqa: N802 — external API name
    username: str,
    actions: Optional[Dict[str, Any]] = None,
    *,
    headless: bool = True,
    proxy: Optional[Dict[str, Any]] = None,
    user_agent: Optional[str] = None,
) -> AsyncIterator[Any]:
    """
    In-process Camoufox session (AsyncCamoufox + persistent_context).

    Usage::

        async with CreateBrowser("user1", actions={...}, headless=True) as context:
            page = await context.new_page()
            ...
    """
    from camoufox.async_api import AsyncCamoufox

    profile_dir = get_profile_dir(username)
    saved = _load_saved_data(profile_dir)
    if proxy is not None:
        saved["proxy"] = _playwright_proxy_from_dict(proxy)
    if actions is not None:
        saved["actions"] = actions
    if user_agent and str(user_agent).strip():
        cfg = saved.get("config") if isinstance(saved.get("config"), dict) else {}
        cfg["headers.User-Agent"] = str(user_agent).strip()
        saved["config"] = cfg

    from_opts = _build_browser_options(saved, profile_dir, headless=headless)
    _persist_saved(profile_dir, saved)

    async with AsyncCamoufox(
        headless=headless,
        from_options=from_opts,
        persistent_context=True,
    ) as ctx:
        yield ctx


def _read_bridge_payload() -> Dict[str, Any]:
    """JSON from stdin (one object) or FOX_BRIDGE_JSON / piecemeal env."""
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            return json.loads(raw)

    env_json = (os.environ.get("FOX_BRIDGE_JSON") or "").strip()
    if env_json:
        return json.loads(env_json)

    username = (os.environ.get("FOX_USERNAME") or os.environ.get("USERNAME") or "").strip()
    if not username:
        raise ValueError("bridge payload missing: set stdin JSON or FOX_BRIDGE_JSON or FOX_USERNAME")

    headless = (os.environ.get("FOX_HEADLESS") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )

    proxy = None
    pjson = (os.environ.get("FOX_PROXY_JSON") or "").strip()
    if pjson:
        proxy = json.loads(pjson)

    actions = None
    aj = (os.environ.get("FOX_ACTIONS_JSON") or "").strip()
    if aj:
        actions = json.loads(aj)

    ua = (os.environ.get("FOX_USER_AGENT") or "").strip() or None

    return {
        "username": username,
        "headless": headless,
        "proxy": proxy,
        "actions": actions,
        "userAgent": ua,
    }


def run_bridge_sync() -> Dict[str, Any]:
    """
    Synchronous bridge: profile → launch_options → Camoufox WS server → return dict for stdout.
    """
    payload = _read_bridge_payload()
    username = str(payload.get("username") or "").strip()
    if not username:
        raise ValueError("payload.username is required")

    headless = bool(payload.get("headless", True))
    profile_dir = get_profile_dir(username)
    saved = _load_saved_data(profile_dir)
    _merge_payload_into_saved(saved, payload)
    from_opts = _build_browser_options(saved, profile_dir, headless=headless)
    _persist_saved(profile_dir, saved)

    ws, pid = _spawn_ws_server(from_opts)
    return {"wsEndpoint": ws, "camoufoxServerPid": pid}


async def main_bridge_async() -> Dict[str, Any]:
    """Async entry (runs launch_options in executor like AsyncCamoufox)."""
    payload = _read_bridge_payload()
    username = str(payload.get("username") or "").strip()
    if not username:
        raise ValueError("payload.username is required")

    headless = bool(payload.get("headless", True))
    profile_dir = get_profile_dir(username)
    saved = _load_saved_data(profile_dir)
    _merge_payload_into_saved(saved, payload)

    loop = asyncio.get_event_loop()
    from_opts = await loop.run_in_executor(
        None,
        partial(_build_browser_options, saved, profile_dir, headless=headless),
    )
    _persist_saved(profile_dir, saved)

    ws, pid = await loop.run_in_executor(None, partial(_spawn_ws_server, from_opts))
    return {"wsEndpoint": ws, "camoufoxServerPid": pid}


def main_bridge() -> None:
    """CLI: print one JSON line to stdout; errors → stderr + JSON error line."""
    try:
        # Prefer async path so launch_options CPU work matches AsyncCamoufox style
        result = asyncio.run(main_bridge_async())
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except BaseException as exc:  # noqa: BLE001
        trace = traceback.format_exc()
        print(trace, file=sys.stderr, flush=True)
        print(json.dumps({"error": str(exc), "trace": trace}, ensure_ascii=False), flush=True)
        sys.exit(1)
