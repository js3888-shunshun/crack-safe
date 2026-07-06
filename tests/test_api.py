import pytest

from app.app import app


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    return app.test_client()


def test_crack_safe_endpoint_ok(client):
    resp = client.post("/api/crack_safe/", json={"actual_combination": "0800666666"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["attempts"] == 49
    assert "time_taken" in data


def test_crack_safe_endpoint_caches(client):
    # Use a combination unlikely to be touched by other tests.
    payload = {"actual_combination": "1357913579"}
    first = client.post("/api/crack_safe/", json=payload).get_json()
    second = client.post("/api/crack_safe/", json=payload).get_json()

    assert first["cached"] is False
    assert second["cached"] is True
    assert first["attempts"] == second["attempts"]


@pytest.mark.parametrize("bad", ["123", "abcdefghij", "12345678901", ""])
def test_crack_safe_endpoint_rejects_bad_input(client, bad):
    resp = client.post("/api/crack_safe/", json={"actual_combination": bad})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_stream_rejects_bad_input(client):
    resp = client.post("/api/crack_safe_stream/", json={"actual_combination": "nope"})
    assert resp.status_code == 400
