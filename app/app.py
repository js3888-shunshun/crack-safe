"""Flask app for the crack_safe full-stack take-home."""

from __future__ import annotations

import json
import queue
import threading
import time
from collections import OrderedDict
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

# Support both `python app.py` (run from app/) and `from app.app import app`
# (imported from the project root by the test suite).
try:
    from crack_safe import crack_safe, validate_combination
except ModuleNotFoundError:  # pragma: no cover - import shim
    from app.crack_safe import crack_safe, validate_combination

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
CORS(app)

# crack_safe is deterministic, so results can be safely memoized. Small bounded
# LRU cache keyed by the combination; oldest entries are evicted first.
_CACHE_MAX = 1024
_result_cache: "OrderedDict[str, dict]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(key: str):
    with _cache_lock:
        if key in _result_cache:
            _result_cache.move_to_end(key)
            return dict(_result_cache[key])
        return None


def _cache_put(key: str, value: dict) -> None:
    with _cache_lock:
        _result_cache[key] = value
        _result_cache.move_to_end(key)
        while len(_result_cache) > _CACHE_MAX:
            _result_cache.popitem(last=False)


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.post("/api/crack_safe/")
def crack_safe_endpoint():
    data = request.get_json(silent=True) or {}
    actual_combination = data.get("actual_combination")

    # Validate before touching the cache so bad input never gets stored.
    try:
        validate_combination(actual_combination)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    cached = _cache_get(actual_combination)
    if cached is not None:
        return jsonify({**cached, "cached": True})

    try:
        attempts, time_taken = crack_safe(actual_combination)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    result = {"attempts": attempts, "time_taken": round(time_taken, 6)}
    _cache_put(actual_combination, result)
    return jsonify({**result, "cached": False})


@app.post("/api/crack_safe_stream/")
def crack_safe_stream_endpoint():
    """Stream crack_safe progress as newline-delimited JSON.

    The required endpoint above returns the final result. This endpoint powers the
    bonus real-time frontend counter without changing the required API contract.
    """
    data = request.get_json(silent=True) or {}
    actual_combination = data.get("actual_combination")

    try:
        validate_combination(actual_combination)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    updates: queue.Queue[dict | None] = queue.Queue()

    def progress_callback(update: dict) -> None:
        updates.put(update)
        # Small delay so the live counter is visible in the UI; the cracking
        # itself runs in well under a millisecond.
        time.sleep(0.015)

    def worker() -> None:
        try:
            attempts, time_taken = crack_safe(actual_combination, progress_callback)
            updates.put({
                "status": "done",
                "attempts": attempts,
                "time_taken": round(time_taken, 6),
            })
        except Exception as exc:  # pragma: no cover - defensive for streaming
            updates.put({"status": "error", "error": str(exc)})
        finally:
            updates.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def generate():
        while True:
            item = updates.get()
            if item is None:
                break
            yield json.dumps(item) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
