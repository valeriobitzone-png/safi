#!/usr/bin/env python3
"""Capture the REAL Safi widget window, occlusion-free.

`CGWindowListCopyWindowInfo` gives the widget's own window number, and
`screencapture -l<number>` captures THAT window's own contents even while
another app overlaps it on screen. A plain region capture cannot: the
region belongs to the screen, not to the window, so whatever is stacked
above Safi ends up in the picture.

    python3 tools/macos-window-capture.py out.png [ownerSubstring]

Prints a JSON line: {"ok":bool,"windowId":n,"bounds":{...},"out":path}.
"""
import json
import subprocess
import sys

import Quartz


def find_window(owner_substring: str, layer_min: int = 0):
    options = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
    for w in Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID):
        owner = w.get("kCGWindowOwnerName", "") or ""
        if owner_substring.lower() not in owner.lower():
            continue
        layer = w.get("kCGWindowLayer", -1)
        if layer < layer_min:
            continue
        bounds = w.get("kCGWindowBounds") or {}
        if bounds.get("Width", 0) < 20 or bounds.get("Height", 0) < 20:
            continue
        return {
            "windowId": w.get("kCGWindowNumber"),
            "owner": owner,
            "layer": layer,
            "name": w.get("kCGWindowName"),
            "bounds": {
                "x": bounds.get("X"), "y": bounds.get("Y"),
                "w": bounds.get("Width"), "h": bounds.get("Height"),
            },
        }
    return None


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/safi-window.png"
    owner = sys.argv[2] if len(sys.argv) > 2 else "safi"
    found = find_window(owner)
    if not found:
        print(json.dumps({"ok": False, "error": f"no on-screen window owned by {owner!r}"}))
        return 1
    # -l <windowid> captures the window itself; -o drops the shadow so the
    # frame is exactly the widget.
    r = subprocess.run(["screencapture", "-x", "-o", "-l", str(found["windowId"]), out], timeout=30)
    ok = r.returncode == 0
    print(json.dumps({"ok": ok, "out": out, **found}))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
