#!/usr/bin/env python3
"""Cross-source list deduplication for the dashboard merge step.

Multiple agents (Granola meeting notes, Slack incidents, Gmail threads) often
surface the SAME business item with slightly different wording — "Wise agreement
unsigned" from Granola, "Wise contract unsigned" from Slack. This module collapses
those near-duplicates at merge time so the dashboard doesn't show the same thing
twice.

Design constraint: **never merge two genuinely-different items**. The cost of a
false positive (hiding a real distinct item) is higher than the cost of a missed
dupe (showing two near-twins). So we only collapse when the evidence is strong:

  - Identical normalized title, OR
  - One normalized token set is a SUBSET of the other (and both ≥2 tokens), OR
  - Jaccard similarity ≥ 0.7 over significant tokens.

We deliberately do NOT do fuzzy phonetic matching on proper nouns — "Pioneer"
and "Payoneer" look similar to a phonetic algorithm but are different companies
in practice. When the user thinks two genuinely-different-looking items are the
same, they can hand-dismiss one.

Merged items get a `_dedupedFrom` list capturing the sources they came from
(`granola`, `slack`, `gmail`, `manual`) so the UI can show "from N sources".
"""
import re
from typing import Iterable

# Words that don't carry meaning when comparing dashboard titles. Includes both
# generic English stopwords and dashboard-status filler ("closed", "pending"…)
# so two items that differ only in connecting words still match.
_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "to", "for", "of", "in", "on",
    "at", "by", "with", "from", "into", "is", "are", "was", "be", "been", "been",
    "this", "that", "these", "those", "it", "its", "as", "than", "then", "no",
    "not", "yet", "still", "all", "any", "some", "one", "two", "three",
    # status/filler nouns common in dashboard titles
    "status", "open", "closed", "close", "pending", "waiting", "need", "needs",
    "review", "approve", "approved", "blocking", "blocker", "blockers",
    "stuck", "stalled", "queued", "owed", "tbd", "update",
    "sign", "signed", "unsigned", "signoff",
    "stalled", "delayed", "late", "overdue",
}

# Words that mean the same thing in dashboard context — collapsed to a canonical
# form before comparison so "Wise agreement unsigned" and "Wise contract unsigned"
# normalize to the same token set and dedupe. Keep this list small and obviously-
# safe: only synonyms where treating them as equivalent would always be correct
# in a work-dashboard context.
_SYNONYMS = {
    "agreement": "contract",
    "deal": "contract",
    "msa": "contract",
    "paperwork": "contract",
    "sow": "contract",
    "meeting": "sync",
    "call": "sync",
    "checkin": "sync",
    "standup": "sync",
    "decision": "decide",
    "decisions": "decide",
    "approval": "decide",
    "signoff": "decide",
}


def _normalize(text: str) -> list:
    """Lowercase, strip punctuation, drop stopwords, map synonyms to a canonical
    form, return remaining tokens (>=3 chars)."""
    s = (text or "").lower()
    # Replace dashes/bullets/middledots with spaces so "rev-share" → "rev share".
    s = re.sub(r"[\-—–:·•/]+", " ", s)
    # Strip the rest of non-alphanumeric
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    out = []
    for t in s.split():
        if len(t) < 3 or t in _STOPWORDS:
            continue
        out.append(_SYNONYMS.get(t, t))
    return out


def _similar(a_text: str, b_text: str) -> bool:
    """Conservative similarity — returns True only when evidence is strong."""
    ta = _normalize(a_text)
    tb = _normalize(b_text)
    if not ta or not tb:
        return False
    sa, sb = set(ta), set(tb)
    if sa == sb:
        return True
    # Strict-subset (one is contained in the other) AND both have ≥2 tokens.
    if len(sa) >= 2 and len(sb) >= 2 and (sa <= sb or sb <= sa):
        return True
    # High Jaccard similarity over significant tokens.
    overlap = len(sa & sb)
    union = len(sa | sb)
    if union and overlap / union >= 0.7:
        return True
    return False


def _title_of(item: dict) -> str:
    """Pull the comparable text out of an item — the dashboard uses different
    fields across lists (title for blockers/decisions, label for tasks, etc.)."""
    return (item.get("title") or item.get("label") or "").strip()


def _is_better(a: dict, b: dict) -> bool:
    """Pick the more-detailed of two duplicates as the survivor: longer title or
    longer meta usually means the entry has more context."""
    a_score = len(_title_of(a)) + len((a.get("meta") or ""))
    b_score = len(_title_of(b)) + len((b.get("meta") or ""))
    return a_score >= b_score


def dedupe(items: Iterable[dict], source_tags: list = None) -> list:
    """Return items with near-duplicates collapsed. `source_tags`, if given, is a
    parallel list of source names (one per item) so the survivor records which
    sources its dupes came from in `_dedupedFrom`."""
    items = list(items or [])
    tags = list(source_tags or [None] * len(items))
    if len(items) != len(tags):
        tags = [None] * len(items)
    # Greedy O(N²) — N is at most ~30 per list, so this is fine.
    survivors = []
    sv_tags = []
    sv_extra = []  # parallel: list[set[str]] of source tags merged in
    for it, tag in zip(items, tags):
        merged = False
        for j, su in enumerate(survivors):
            if _similar(_title_of(it), _title_of(su)):
                # Decide which to keep — the more-detailed one.
                if _is_better(it, su):
                    survivors[j] = it
                    sv_tags[j] = tag
                if tag:
                    sv_extra[j].add(tag)
                if sv_tags[j]:
                    sv_extra[j].add(sv_tags[j])
                merged = True
                break
        if not merged:
            survivors.append(it)
            sv_tags.append(tag)
            sv_extra.append({tag} if tag else set())
    # Stamp `_dedupedFrom` when the survivor absorbed dupes from a different source.
    out = []
    for su, extras in zip(survivors, sv_extra):
        srcs = sorted(s for s in extras if s)
        if len(srcs) > 1:
            su = dict(su, _dedupedFrom=srcs)
        out.append(su)
    return out


def dedupe_tagged(*lists_with_tags) -> list:
    """Combine multiple (list, tag) pairs into one deduped list.

    Example:
        dedupe_tagged((granola_blockers, "granola"), (slack_blockers, "slack"))
    """
    combined_items = []
    combined_tags = []
    for lst, tag in lists_with_tags:
        for it in (lst or []):
            combined_items.append(it)
            combined_tags.append(tag)
    return dedupe(combined_items, combined_tags)


if __name__ == "__main__":
    # Quick smoke-test demonstrating the conservative bias.
    cases = [
        # Should merge: synonym (agreement↔contract), same proper noun.
        [{"title": "Wise agreement unsigned"}, {"title": "Wise contract unsigned"}],
        # Should merge: one is a subset of the other.
        [{"title": "Sign the vendor contract"}, {"title": "Sign vendor contract"}],
        # Should merge: same proper noun, status filler stripped.
        [{"title": "Payoneer contract unsigned"}, {"title": "Payoneer agreement pending"}],
        # Should NOT merge: different proper nouns (Pioneer vs Payoneer are
        # different companies; the user can hand-dismiss if they want).
        [{"title": "Pioneer rev-share not closed"}, {"title": "Payoneer not closed"}],
        # Should NOT merge: same status word, different topics.
        [{"title": "Pricing v3 stalled"}, {"title": "Brand mark stalled"}],
    ]
    for c in cases:
        out = dedupe(c, ["a", "b"])
        kept = [_title_of(x) for x in out]
        print(f"{[_title_of(x) for x in c]}  →  {kept}")
