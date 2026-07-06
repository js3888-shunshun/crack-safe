"""Flask app for the crack_safe full-stack take-home."""

from __future__ import annotations

import json
import queue
import threading
import time
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

from crack_safe import crack_safe, validate_combination

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
CORS(app)


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.post("/api/crack_safe/")
def crack_safe_endpoint():
    data = request.get_json(silent=True) or {}
    actual_combination = data.get("actual_combination")

    try:
        attempts, time_taken = crack_safe(actual_combination)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({
        "attempts": attempts,
        "time_taken": round(time_taken, 6),
    })


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
