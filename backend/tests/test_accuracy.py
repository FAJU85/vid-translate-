"""Accuracy: invented speech is dropped, the translator gets context, dubbed lines fit their time."""
import json

import pytest

from app.modules import voice
from app.modules.jobs import pipeline
from app.modules.speech.whisper import is_invented
from app.modules.translation.core import _gemini_prompt
from test_api import AUTH, JOB, client, fake_models, make_clip, signed, wait_done  # noqa: F401
from test_dub import tone

np = pytest.importorskip("numpy")

SURE = dict(no_speech_prob=0.05, avg_logprob=-0.2, compression_ratio=1.4)
UNSURE = dict(no_speech_prob=0.5, avg_logprob=-0.9, compression_ratio=1.4)


@pytest.mark.parametrize("text", ["ترجمة نانسي قنقر", "  ترجمةُ نانسي قنقر.", "Sous-titrage ST' 501", "Untertitel im Auftrag des ZDF, 2021"])
def test_lines_whisper_always_invents_are_dropped(text):
    assert is_invented(text, **SURE)


@pytest.mark.parametrize("text", ["Thanks for watching!", "شكراً للمشاهدة", "اشتركوا في القناة"])
def test_often_invented_lines_are_dropped_only_when_whisper_was_unsure(text):
    assert is_invented(text, **UNSURE)
    assert not is_invented(text, **SURE)


def test_real_speech_is_kept_even_when_it_mentions_watching():
    assert not is_invented("Thanks for watching my brother's wedding video, it means a lot to us", **UNSURE)
    assert not is_invented("الحكومة أعلنت اليوم عن خطة جديدة", **UNSURE)


def test_loops_and_silence_are_dropped():
    assert is_invented("the the the the the", no_speech_prob=0.1, avg_logprob=-0.3, compression_ratio=3.1)
    assert is_invented("Hmm.", no_speech_prob=0.8, avg_logprob=-1.4, compression_ratio=1.0)


def test_the_translator_gets_the_title_the_lines_before_and_for_a_dub_their_time():
    prompt = _gemini_prompt(
        ["Hello.", "We went to the market."], "English", "Arabic", title="Market day",
        before=[("Good morning.", "صباح الخير.")], seconds=[1.0, 4.0],
    )
    assert '"Market day"' in prompt and "Modern Standard Arabic" in prompt
    assert json.dumps([{"source": "Good morning.", "translation": "صباح الخير."}], ensure_ascii=False) in prompt
    assert "[3, 10]" in prompt  # word limits from 2.6 words a second
    plain = _gemini_prompt(["Hello."], "English", "French")
    assert "dub" not in plain and "context only" not in plain and "Arabic" not in plain


def test_speaking_time_runs_until_the_next_sentence():
    times = pipeline._speaking_time([(0.0, 1.0, "a"), (3.0, 4.0, "b")], 10.0)
    assert times[0] == pytest.approx(3.0 - pipeline.DUB_GAP)
    assert times[1] == pytest.approx(7.0 - pipeline.DUB_GAP)


def test_a_line_too_long_for_its_time_is_spoken_again_faster(client, tmp_path, monkeypatch):
    calls = []

    def fake_synthesize(texts, lang, gender, out_dir, cancelled, progress, rates=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        calls.append(rates)
        # At normal speed the line takes 4 s (its time is about 2 s); faster, it takes 1.5 s.
        return [tone(out_dir / f"{i}.wav", 1.5 if rates and rates[i] else 4.0) if t else None for i, t in enumerate(texts)]

    monkeypatch.setattr(voice, "synthesize", fake_synthesize)
    job = JOB.format("f")
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=make_clip(tmp_path))
    r = client.post("/invoke", json={"job_id": job, "source_kind": "upload", "tgt_lang": "ar", "subtitle_mode": "dub"}, headers=AUTH)
    assert r.status_code == 202
    assert wait_done(client, job)["status"] == "done"
    assert calls[0] is None  # first every line at normal speed
    assert len(calls) == 2 and calls[1] == [pipeline.DUB_MAX_RATE]  # then the long one, as fast as allowed
