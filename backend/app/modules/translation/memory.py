"""Translation memory: rules learned from people's corrections, applied before the model.

Mechanical and deterministic: no model is involved. The Worker keeps the memory (it learns a
correction once three different people made the same one, or an admin approved it) and sends the
entries for a job's target language with the job:

    {"sentences": [{"src": "en", "source": "...", "translation": "..."}, ...],
     "terms":     [{"src": "en", "source": "KAVOX", "translation": "كافوكس"}, ...],
     "fixes":     [{"src": "ar", "source": "واشنطر", "translation": "واشنطن"}, ...],
     "say":       [{"src": "ar", "source": "علم", "translation": "عَلَم"}, ...]}

- a pronunciation rule tells the dubbing voice how to say a word of the target language (with
  diacritics, or spelled as it sounds); only what is spoken changes, never the subtitles;

- a speech fix replaces words the speech recognition keeps getting wrong, right after recognition
  (keeping the words' timing), before anything is translated;

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
    fixes: list[tuple[list[str], str]] = field(default_factory=list)  # (wrong words normalised, right text), longest first
    says: list[tuple[re.Pattern, str]] = field(default_factory=list)  # pronunciations, longest first

    @classmethod
    def from_payload(cls, payload: dict | None, src: str, tgt: str | None = None) -> "Memory":
        """The entries for one source language (the Worker sends those of every source), and the
        pronunciation rules of the target language."""
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
        # A speech fix belongs to one spoken language only.
        fixes = [e for e in payload.get("fixes") or [] if _usable(e, src) and e.get("src") == src]
        for entry in sorted(fixes, key=lambda e: -len(e["source"].split())):
            wrong = [norm(w) for w in entry["source"].split()]
            if wrong and all(wrong) and len(wrong) <= 6:
                memory.fixes.append((wrong, entry["translation"].strip()))
        says = [e for e in payload.get("say") or [] if tgt and _usable(e, tgt) and e.get("src") == tgt]
        for entry in sorted(says, key=lambda e: -len(e["source"])):
            if len(entry["source"]) <= 100:
                memory.says.append((_term_pattern(entry["source"].strip()), entry["translation"].strip()))
        return memory

    def pronounce(self, text: str) -> str:
        """What the dubbing voice is given to say: the text with the pronunciation rules applied."""
        if not self.says:
            return text
        # One pass over the text, so what one rule wrote is never changed again by another.
        combined = re.compile("|".join(f"({p.pattern})" for p, _s in self.says), re.IGNORECASE)
        return combined.sub(lambda m: self.says[m.lastindex - 1][1] if m.lastindex else m.group(0), text)

    def __bool__(self) -> bool:
        return bool(self.sentences or self.terms or self.fixes or self.says)

    def hotwords(self, limit: int = 40) -> str | None:
        """The right words of the speech fixes, as hints for the speech recognition."""
        words: list[str] = []
        for _wrong, right in self.fixes:
            for w in right.split():
                if w not in words:
                    words.append(w)
        return " ".join(words[:limit]) or None

    def fix_text(self, text: str) -> tuple[str, int]:
        """A text with the speech fixes applied (whole words); returns (text, how many)."""
        words = text.split()
        fixed, n = self._fix_tokens([(0.0, 0.0, " " + w) for w in words])
        return (" ".join(w[2].strip() for w in fixed), n) if n else (text, 0)

    def fix_segments(self, segments: list[tuple]) -> tuple[list[tuple], int]:
        """Recognised segments with the speech fixes applied, to their words (timing kept) and text."""
        if not self.fixes:
            return segments, 0
        out, total = [], 0
        for seg in segments:
            if len(seg) > 3 and seg[3]:
                words, n = self._fix_tokens(seg[3])
                if n:
                    text = " ".join("".join(w[2] for w in words).split())
                    out.append((seg[0], seg[1], text, words))
                    total += n
                    continue
            elif len(seg) > 2:
                text, n = self.fix_text(seg[2])
                if n:
                    out.append((seg[0], seg[1], text, *seg[3:]))
                    total += n
                    continue
            out.append(seg)
        return out, total

    def _fix_tokens(self, words: list[tuple]) -> tuple[list[tuple], int]:
        """Replace runs of words matching a fix; the right words share the run's time evenly."""
        out: list[tuple] = []
        n, i = 0, 0
        keys = [norm(w[2]) for w in words]
        while i < len(words):
            for wrong, right in self.fixes:
                if keys[i : i + len(wrong)] == wrong:
                    run = words[i : i + len(wrong)]
                    start, end = run[0][0], run[-1][1]
                    new = right.split()
                    step = (end - start) / len(new) if new else 0
                    lead = " " if run[0][2].startswith(" ") else ""
                    trail = _trailing_marks(run[-1][2])  # "Cavox." -> "KAVOX." keeps its full stop
                    for k, w in enumerate(new):
                        end_mark = trail if k == len(new) - 1 and not w.endswith(trail) else ""
                        out.append((start + k * step, start + (k + 1) * step, (lead if k == 0 else " ") + w + end_mark))
                    i += len(wrong)
                    n += 1
                    break
            else:
                out.append(words[i])
                i += 1
        return out, n

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


def _trailing_marks(word: str) -> str:
    word = word.rstrip()
    i = len(word)
    while i and unicodedata.category(word[i - 1])[0] in "PS":
        i -= 1
    return word[i:]


def _usable(entry: dict, src: str) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("source"), str)
        and isinstance(entry.get("translation"), str)
        and entry["source"].strip() != ""
        and entry["translation"].strip() != ""
        and entry.get("src") in (src, None, "", "auto")
    )
