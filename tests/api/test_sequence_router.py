"""The sequence routes return a problem without its answer order."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deeptutor.api.routers import sequence
from deeptutor.learning.sequence.schema import SequenceError


def _client():
    app = FastAPI()
    app.include_router(sequence.router, prefix="/api/solution-sequence")
    return TestClient(app)


def test_create_returns_the_service_payload(monkeypatch):
    async def fake_generate(knowledge_base, topic, _store, mode="practice"):
        assert knowledge_base == "calculus"
        assert topic == "chain rule"
        assert mode == "practice"
        return {
            "problem_id": "problem-000000000001",
            "question": "Differentiate.",
            "formulas": [],
            "steps": [],
            "placed_ids": [],
            "solved": False,
            "mode": mode,
            "explanation": None,
            "progress": {"solved": 0, "goal": 5},
            "sources": [],
        }

    monkeypatch.setattr(sequence, "generate_problem", fake_generate)
    response = _client().post(
        "/api/solution-sequence/problems",
        json={"knowledge_base": "calculus", "topic": "chain rule"},
    )
    assert response.status_code == 200
    assert response.json()["explanation"] is None
    assert "correct_ids" not in response.json()


def test_create_passes_the_chosen_mode_to_the_service(monkeypatch):
    async def fake_generate(_knowledge_base, _topic, _store, mode="practice"):
        assert mode == "quest"
        return {
            "problem_id": "problem-000000000001",
            "question": "Differentiate.",
            "formulas": [],
            "steps": [],
            "placed_ids": [],
            "solved": False,
            "mode": mode,
            "explanation": None,
            "progress": {"solved": 0, "goal": 5},
            "sources": [],
        }

    monkeypatch.setattr(sequence, "generate_problem", fake_generate)
    response = _client().post(
        "/api/solution-sequence/problems",
        json={"knowledge_base": "calculus", "topic": "chain rule", "mode": "quest"},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "quest"

    rejected = _client().post(
        "/api/solution-sequence/problems",
        json={"knowledge_base": "calculus", "topic": "chain rule", "mode": "marathon"},
    )
    assert rejected.status_code == 422


def test_create_accepts_guided_mode(monkeypatch):
    async def fake_generate(_knowledge_base, _topic, _store, mode="practice"):
        assert mode == "guided"
        return {
            "problem_id": "problem-000000000001",
            "question": "Differentiate.",
            "formulas": [],
            "steps": [],
            "placed_ids": [],
            "solved": False,
            "mode": mode,
            "explanation": None,
            "progress": {"solved": 0, "goal": 5},
            "sources": [],
        }

    monkeypatch.setattr(sequence, "generate_problem", fake_generate)
    response = _client().post(
        "/api/solution-sequence/problems",
        json={"knowledge_base": "calculus", "topic": "chain rule", "mode": "guided"},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "guided"


def test_walkthrough_intro_delegates_and_maps_the_mode_lock(monkeypatch):
    async def fake_intro(_store, problem_id):
        assert problem_id == "problem-000000000001"
        return {"intro": "Identify the outer and inner functions first.", "total": 3}

    monkeypatch.setattr(sequence, "walkthrough_intro", fake_intro)
    response = _client().post(
        "/api/solution-sequence/problems/problem-000000000001/walkthrough/intro"
    )
    assert response.status_code == 200
    assert response.json()["intro"].startswith("Identify")

    async def locked_intro(_store, _problem_id):
        raise SequenceError(409, "Only a guided problem has a walkthrough.")

    monkeypatch.setattr(sequence, "walkthrough_intro", locked_intro)
    rejected = _client().post(
        "/api/solution-sequence/problems/problem-000000000001/walkthrough/intro"
    )
    assert rejected.status_code == 409
    assert "Only a guided problem" in rejected.json()["detail"]


def test_walkthrough_reveal_passes_the_index_and_validates_the_body(monkeypatch):
    async def fake_reveal(_store, problem_id, index):
        assert problem_id == "problem-000000000001"
        assert index == 1
        return {
            "index": 1,
            "step_id": "s_two",
            "math": "$\\cos(x^2)$",
            "explanation": "Differentiate the outer function.",
            "done": False,
            "total": 3,
        }

    monkeypatch.setattr(sequence, "walkthrough_reveal", fake_reveal)
    response = _client().post(
        "/api/solution-sequence/problems/problem-000000000001/walkthrough/reveal",
        json={"index": 1},
    )
    assert response.status_code == 200
    assert response.json()["step_id"] == "s_two"

    for bad in (-1, 12):
        rejected = _client().post(
            "/api/solution-sequence/problems/problem-000000000001/walkthrough/reveal",
            json={"index": bad},
        )
        assert rejected.status_code == 422


def test_create_maps_a_grounding_failure(monkeypatch):
    async def fake_generate(_knowledge_base, _topic, _store, mode="practice"):
        raise SequenceError(
            422, "That knowledge base did not return enough material for this topic."
        )

    monkeypatch.setattr(sequence, "generate_problem", fake_generate)
    response = _client().post(
        "/api/solution-sequence/problems",
        json={"knowledge_base": "calculus", "topic": "chain rule"},
    )
    assert response.status_code == 422
    assert "enough material" in response.json()["detail"]


def test_place_rejects_without_revealing_the_expected_step(monkeypatch):
    def fake_place(_store, problem_id, step_id, index):
        assert problem_id == "problem-000000000001"
        assert step_id == "s_wrong"
        assert index == 0
        return {
            "accepted": False,
            "problem": {"problem_id": problem_id, "placed_ids": [], "solved": False},
        }

    monkeypatch.setattr(sequence, "place_step", fake_place)
    response = _client().post(
        "/api/solution-sequence/problems/problem-000000000001/place",
        json={"step_id": "s_wrong", "index": 0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] is False
    assert "correct" not in body


def test_missing_outline_uses_the_not_read_message(monkeypatch):
    def fake_read(_store, knowledge_base):
        assert knowledge_base == "calculus"
        raise SequenceError(404, "This knowledge base has not been read yet.")

    monkeypatch.setattr(sequence, "read_outline", fake_read)
    response = _client().get(
        "/api/solution-sequence/outlines",
        params={"knowledge_base": "calculus"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "This knowledge base has not been read yet."


def test_create_outline_returns_the_service_payload(monkeypatch):
    async def fake_build(knowledge_base, _store):
        assert knowledge_base == "calculus"
        return {
            "knowledge_base": "calculus",
            "source": "files",
            "modules": [
                {
                    "id": "m_abc",
                    "category": "",
                    "name": "Chain rule",
                    "topic": "chain rule",
                    "solved": 0,
                    "goal": 5,
                }
            ],
        }

    monkeypatch.setattr(sequence, "build_outline", fake_build)
    response = _client().post(
        "/api/solution-sequence/outlines",
        json={"knowledge_base": "calculus"},
    )
    assert response.status_code == 200
    assert response.json()["source"] == "files"
    # The outline leaves an empty category empty; the client names it, so the
    # label reaches the learner in their own language.
    assert response.json()["modules"][0]["category"] == ""
    assert "correct_ids" not in response.json()


def test_check_returns_marks_without_the_answer_key(monkeypatch):
    def fake_check(_store, problem_id, step_ids):
        assert problem_id == "problem-000000000001"
        assert step_ids == ["s_wrong"]
        return {
            "solved": False,
            "marks": ["incorrect"],
            "problem": {
                "problem_id": problem_id,
                "placed_ids": [],
                "solved": False,
                "explanation": None,
            },
        }

    monkeypatch.setattr(sequence, "check_answer", fake_check)
    response = _client().post(
        "/api/solution-sequence/problems/problem-000000000001/check",
        json={"step_ids": ["s_wrong"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["marks"] == ["incorrect"]
    assert "correct_ids" not in body


def test_hint_body_is_optional(monkeypatch):
    seen = {}

    async def fake_hint(_store, problem_id, step_ids=None):
        seen["problem_id"] = problem_id
        seen["step_ids"] = step_ids
        return {"hint": "Look at the outer function."}

    monkeypatch.setattr(sequence, "hint", fake_hint)
    client = _client()
    empty = client.post("/api/solution-sequence/problems/problem-000000000001/hint")
    assert empty.status_code == 200
    assert seen["step_ids"] is None
    sent = client.post(
        "/api/solution-sequence/problems/problem-000000000001/hint",
        json={"step_ids": ["s_one"]},
    )
    assert sent.status_code == 200
    assert seen["step_ids"] == ["s_one"]
