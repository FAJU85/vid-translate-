"""Translation memory: learned sentences and glossary terms decide before the model does."""
import pytest

from app.modules.translation import Memory, core
from app.modules.translation.memory import norm

PAYLOAD = {
    "sentences": [
        {"src": "en", "source": "Welcome back to the channel!", "translation": "أهلاً بعودتكم إلى القناة!"},
        {"src": "ar", "source": "السلام عليكم", "translation": "Peace be upon you"},
    ],
    "terms": [
        {"src": "en", "source": "KAVOX", "translation": "كافوكس"},
        {"src": "en", "source": "KAVOX Pro", "translation": "كافوكس برو"},
        {"src": "en", "source": "Riyadh", "translation": "الرياض"},
    ],
}


@pytest.fixture
def model(monkeypatch):
    """The local model, replaced by a recorder that 'translates' by tagging the text."""
    seen = []

    def fake(texts, src, tgt, progress):
        seen.append(list(texts))
        return [f"<{t}>" for t in texts]

    monkeypatch.setattr(core, "_nllb_translate", fake)
    return seen


def test_texts_are_compared_without_case_punctuation_or_diacritics():
    assert norm("Welcome back, to the CHANNEL!!") == norm("welcome back to the channel")
    assert norm("السَّلامُ عَلَيْكُم") == norm("السلام عليكم") == norm("الســلام عليكم")


def test_a_remembered_sentence_is_not_sent_to_the_model(model):
    memory = Memory.from_payload(PAYLOAD, "en")
    out, engine = core.translate_texts(["welcome back to the channel", "Something new."], "en", "ar", lambda f: None, memory)
    assert out == ["أهلاً بعودتكم إلى القناة!", "<Something new.>"]
    assert model == [["Something new."]] and engine == "memory+nllb"


def test_entries_of_another_source_language_are_ignored():
    assert Memory.from_payload(PAYLOAD, "fr").sentence("السلام عليكم") is None
    assert Memory.from_payload(PAYLOAD, "ar").sentence("السلام عليكم") == "Peace be upon you"


def test_glossary_terms_keep_their_fixed_translation(model):
    memory = Memory.from_payload(PAYLOAD, "en")
    out, _ = core.translate_texts(["Try kavox pro in Riyadh today."], "en", "ar", lambda f: None, memory)
    # The longest term wins ("KAVOX Pro", not "KAVOX"), any letter case, whole words only.
    assert model == [["Try ZQX1 in ZQX2 today."]]
    assert out == ["<Try كافوكس برو in الرياض today.>"]
    assert memory.protect("KAVOXIAN news")[1] == []  # not inside another word


def test_a_lost_placeholder_falls_back_to_the_plain_text(monkeypatch):
    calls = []

    def lossy(texts, src, tgt, progress):
        calls.append(list(texts))
        return ["translated without the placeholder" if "ZQX" in t else f"<{t}>" for t in texts]

    monkeypatch.setattr(core, "_nllb_translate", lossy)
    memory = Memory.from_payload(PAYLOAD, "en")
    out, _ = core.translate_texts(["Hello from Riyadh."], "en", "ar", lambda f: None, memory)
    assert calls == [["Hello from ZQX1."], ["Hello from Riyadh."]]
    assert out == ["<Hello from Riyadh.>"]


def test_no_memory_means_the_model_translates_everything(model):
    out, engine = core.translate_texts(["One.", "Two."], "en", "ar", lambda f: None)
    assert out == ["<One.>", "<Two.>"] and engine == "nllb"


@pytest.mark.parametrize("bad", [None, {}, {"sentences": [{"source": "x"}], "terms": [{"translation": "y"}, "z"]}])
def test_a_missing_or_broken_payload_is_an_empty_memory(bad):
    assert not Memory.from_payload(bad, "en")


def test_a_glossary_term_matches_with_or_without_arabic_diacritics():
    memory = Memory.from_payload({"terms": [{"src": "ar", "source": "الرياض", "translation": "Riyadh"}]}, "ar")
    for text in ["زرت الرِّياض اليوم", "زرت الرياض اليوم", "زرت الريـاض اليوم"]:
        protected, slots = memory.protect(text)
        assert protected == "زرت ZQX1 اليوم" and slots == ["Riyadh"], text


def test_only_the_exact_placeholders_are_accepted():
    memory = Memory()
    assert memory.restore("Hello ZQX1", ["X"]) == "Hello X"
    assert memory.restore("Hello ZQX10", ["X"]) is None  # not ZQX1
    assert memory.restore("ZQX1 and ZQX1", ["X"]) is None  # doubled
    assert memory.restore("ZQX2 then ZQX1", ["A", "B"]) == "B then A"


def test_a_rule_learned_from_the_text_as_recognised_still_matches_after_clean_up(model):
    payload = {"sentences": [{"src": "ar", "source": "ألف كيلو متر", "translation": "a thousand kilometres"}]}
    out, engine = core.translate_texts(["ألف كيلو متر"], "ar", "en", lambda f: None, Memory.from_payload(payload, "ar"))
    assert out == ["a thousand kilometres"] and engine == "memory"


def test_spacing_vowel_signs_keep_words_apart():
    # Devanagari: कल (tomorrow) and काल (time) differ only by a spacing vowel sign (Mc), kept.
    assert norm("कल") != norm("काल")


def test_a_dub_says_what_the_corrected_subtitles_say():
    from app.modules.jobs import pipeline
    from app.modules.subtitles import Cue

    segments = [(0.0, 4.0, "a b"), (5.0, 8.0, "c")]
    cues = [Cue(1, 0.0, 2.0, "a", "ONE"), Cue(2, 2.0, 4.0, "b", "TWO fixed"), Cue(3, 5.0, 8.0, "c", "THREE")]
    assert pipeline._sentences_from_cues(segments, cues, ["old", "old"]) == ["ONE TWO fixed", "THREE"]
