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
    tatweel or punctuation, single spaces. "Hello, World!" and "hello world" are the same."""
    text = unicodedata.normalize("NFKD", text.lower()).replace("ـ", "")
    text = "".join(c for c in text if not unicodedata.combining(c) and unicodedata.category(c)[0] not in "PS")
    return re.sub(r"\s+", " ", text).strip()


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
            # Whole words only, any letter case ("kavox", "KAVOX"); Arabic has no case, \b still works.
            pattern = re.compile(rf"(?<!\w){re.escape(source)}(?!\w)", re.IGNORECASE)
            memory.terms.append((pattern, entry["translation"].strip()))
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
        # Highest numbers first, so "ZQX1" is never replaced inside "ZQX10".
        for n in range(len(slots), 0, -1):
            token = PLACEHOLDER.format(n)
            if translated.count(token) != 1:
                return None
            translated = translated.replace(token, slots[n - 1])
        return None if re.search(r"ZQX\d", translated) else translated


def _usable(entry: dict, src: str) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("source"), str)
        and isinstance(entry.get("translation"), str)
        and entry["source"].strip() != ""
        and entry["translation"].strip() != ""
        and entry.get("src") in (src, None, "", "auto")
    )
