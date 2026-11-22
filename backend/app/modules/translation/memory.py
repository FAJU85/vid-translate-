"""Translation memory: rules learned from people's corrections, applied before the model.

Mechanical and deterministic: no model is involved. The Worker keeps the memory (it learns a
correction once three different people made the same one, or an admin approved it) and sends the
entries for a job's target language with the job:

    {"sentences": [{"src": "en", "source": "...", "translation": "..."}, ...],
     "terms":     [{"src": "en", "source": "KAVOX", "translation": "كافوكس"}, ...]}

- a sentence (or subtitle) whose normalised text is in the memory takes its translation as is;
- a glossary term is replaced by a placeholder the model copies unchanged ("ZQX1"), and the
  placeholder by the term's fixed translation afterwards.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

PLACEHOLDER = "ZQX{}"
MAX_TERMS_PER_LINE = 9


def norm(text: str) -> str:
    """The form texts are compared in: lower case, without accents, diacritics (tashkeel),
    tatweel or punctuation, single spaces. "Hello, World!" and "hello world" are the same.

    Exactly the Worker's rule (learning brick norm): non-spacing marks (Mn) go, spacing vowel
    signs (Mc, e.g. Devanagari) stay, punctuation (P*) and symbols (S*) go.
    """
    text = unicodedata.normalize("NFKD", text.lower()).replace("\u0640", "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn" and unicodedata.category(c)[0] not in "PS")
    return re.sub(r"\s+", " ", text).strip()


# Arabic diacritics (tashkeel) and tatweel, allowed between the letters of a glossary term.
_MARKS = "[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]*"


def _term_pattern(term: str) -> re.Pattern:
    """A glossary term as a whole word, any letter case, with or without Arabic diacritics."""
    body = _MARKS.join(re.escape(ch) for ch in term)
    return re.compile(rf"(?<!\w){body}{_MARKS}(?!\w)", re.IGNORECASE)


@dataclass
class Memory:
    sentences: dict[str, str] = field(default_factory=dict)  # norm(source) -> translation
    terms: list[tuple[re.Pattern, str]] = field(default_factory=list)  # longest first

    @classmethod
    def from_payload(cls, payload: dict | None, src: str) -> "Memory":
        """The entries for one source language (the Worker sends those of every source)."""
        memory = cls()
        if not payload:
            return memory
        for entry in payload.get("sentences") or []:
            if _usable(entry, src):
                memory.sentences[norm(entry["source"])] = entry["translation"].strip()
        terms = sorted((e for e in payload.get("terms") or [] if _usable(e, src)), key=lambda e: -len(e["source"]))
        for entry in terms:
            source = entry["source"].strip()
            if len(source) <= 100:  # a term, not a passage (keeps the pattern small)
                memory.terms.append((_term_pattern(source), entry["translation"].strip()))
        return memory

    def __bool__(self) -> bool:
        return bool(self.sentences or self.terms)

    def sentence(self, text: str) -> str | None:
        """The remembered translation of this exact sentence (normalised), if any."""
        key = norm(text)
        return self.sentences.get(key) if key else None

    def protect(self, text: str) -> tuple[str, list[str]]:
        """The text with glossary terms swapped for placeholders, and what each placeholder stands for."""
        slots: list[str] = []
        for pattern, target in self.terms:
            if len(slots) >= MAX_TERMS_PER_LINE:
                break

            def swap(_match: re.Match) -> str:
                slots.append(target)
                return PLACEHOLDER.format(len(slots))

            text = pattern.sub(swap, text, count=MAX_TERMS_PER_LINE - len(slots))
        return text, slots

    def restore(self, translated: str, slots: list[str]) -> str | None:
        """Put the terms' translations back; None when the model lost or doubled a placeholder."""
        # Whole placeholders only: each expected one exactly once, and no other ("ZQX10" is not "ZQX1").
        found = [int(n) for n in re.findall(r"ZQX(\d+)", translated)]
        if sorted(found) != list(range(1, len(slots) + 1)):
            return None
        return re.sub(r"ZQX(\d+)", lambda m: slots[int(m.group(1)) - 1], translated)


def _usable(entry: dict, src: str) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("source"), str)
        and isinstance(entry.get("translation"), str)
        and entry["source"].strip() != ""
        and entry["translation"].strip() != ""
        and entry.get("src") in (src, None, "", "auto")
    )
