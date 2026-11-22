"""Accuracy: invented speech is dropped, dubbed lines follow the speaker's timing, text is cleaned by rules."""
import pytest

from app.modules import voice
from app.modules.jobs import pipeline
from app.modules.speech.whisper import is_invented
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


# ----------------------------------------------------------------------------- lip-sync timing

from app.modules.subtitles import spoken_phrases  # noqa: E402

WORDS = [(0.0, 0.4, " So"), (0.45, 0.9, " we"), (0.95, 1.4, " went"),  # pause of 1.1 s
         (2.5, 2.9, " to"), (2.95, 3.4, " the"), (3.45, 4.0, " market.")]


def test_a_dub_pauses_where_the_speaker_pauses():
    phrases = spoken_phrases(WORDS, "فذهبنا إذن إلى السوق القريب")
    assert len(phrases) == 2
    assert phrases[0][:2] == (0.0, 1.4) and phrases[1][:2] == (2.5, 4.0)
    assert " ".join(p[2] for p in phrases) == "فذهبنا إذن إلى السوق القريب"


def test_a_translation_too_short_to_cut_stays_one_phrase():
    assert spoken_phrases(WORDS, "ذهبنا") == [(0.0, 4.0, "ذهبنا")]


def test_without_word_timing_the_sentence_is_one_phrase():
    spoken = pipeline._lip_sync([(1.0, 3.0, "Hello there.")], ["مرحبا"])
    assert spoken == [(1.0, 3.0, "مرحبا")]


@pytest.mark.parametrize(
    "length,speech,room,expected",
    [
        (2.0, 2.0, 3.0, 0),  # fits: left alone
        (2.1, 2.0, 3.0, 0),  # a little long but within the room and the speech: left alone
        (4.0, 2.0, 2.5, pipeline.DUB_MAX_RATE),  # far too long: as fast as allowed
        (2.8, 2.0, 2.5, 27),  # too long for the room: faster until it fits a little before the next line
        (2.0, 3.0, 4.0, pipeline.DUB_MIN_RATE),  # far too short: as slow as allowed
        (2.4, 3.0, 4.0, -20 if pipeline.DUB_MIN_RATE <= -20 else pipeline.DUB_MIN_RATE),  # too short: slower
        (1.0, 1.1, 2.0, 0),
    ],
)
def test_the_voice_speed_follows_the_speakers_timing(length, speech, room, expected):
    assert pipeline._fit_rate(length, speech, room) == expected


# ------------------------------------------------------------------- rule-based text clean-up

from app.modules.translation.core import normalize_source, tidy  # noqa: E402


@pytest.mark.parametrize(
    "spoken,joined",
    [
        ("لأحد عشر ألف كيلو متر للوصول", "لأحد عشر ألف كيلومتر للوصول"),
        ("وزنه خمسة كيلو غرام", "وزنه خمسة كيلوغرام"),
        ("سعة عشرين ميغا بايت", "سعة عشرين ميغابايت"),
        ("كيلو واحد من التفاح", "كيلو واحد من التفاح"),  # "kilo" alone stays
    ],
)
def test_arabic_unit_names_split_by_speech_recognition_are_joined(spoken, joined):
    assert normalize_source(spoken, "ar") == joined
    assert normalize_source(spoken, "en") == spoken  # only Arabic is touched


@pytest.mark.parametrize(
    "raw,clean",
    [
        ("Good Lord , I didn 't know it was that hard .", "Good Lord, I didn't know it was that hard."),
        ("It 's 20 % off !", "It's 20% off!"),
        ("( really )", "(really)"),
        ("مرحبا ، كيف حالك ؟", "مرحبا، كيف حالك؟"),
    ],
)
def test_the_local_models_stray_spaces_are_removed(raw, clean):
    assert tidy(raw) == clean
