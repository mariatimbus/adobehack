"""Natural-language instruction interpretation (Developer B).

Converts a compound marketing instruction into a typed RepairConstraints
object. This build ships a deterministic rule-based interpreter labeled
``provider_mode="fixture"`` — no AI credentials exist in this environment and
we never pretend otherwise. The provider adapter interface (BaseInterpreter)
is ready for a live LLM with structured output validation; unsupported or
ambiguous requirements are surfaced explicitly instead of guessed.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod

from ..schemas import FormatTarget, NodeLock, ProviderMode, RepairConstraints

# Small labeled fixture phrasebook for offline translation demos.
# Clearly NOT machine translation — a static dictionary over known demo copy.
FIXTURE_PHRASEBOOK = {
    ("fr", "Hydration, made simple."): "Une hydratation, en toute simplicité.",
    ("fr", "Lightweight everyday hydration."): "Une hydratation légère au quotidien.",
    ("fr", "Hydration that adapts to your skin barrier all day"): "Une hydratation qui s'adapte à votre peau toute la journée",
    ("fr", "Discover now"): "Découvrir",
    ("fr", "LUMA SKIN"): "LUMA SKIN",
}

ROLE_ALIASES = {
    "headline": "headline", "head line": "headline", "title": "headline",
    "subhead": "subhead", "sub-headline": "subhead", "subtitle": "subhead",
    "brand": "brand", "logo": "brand", "brand name": "brand",
    "product": "hero", "hero": "hero", "product image": "hero",
    "serum": "hero", "packshot": "hero", "image": "hero", "picture": "hero",
    "cta": "cta", "call to action": "cta", "button": "cta", "cta text": "cta",
    "cta background": "cta_bg", "button background": "cta_bg", "pill": "cta_bg",
    "decoration": "deco_arch", "deco": "deco_arch", "arch": "deco_arch",
    "background": "bg", "hero size": "hero",
}

FORMATS = {
    "instagram story": FormatTarget(name="instagram_story", width=1080, height=1920),
    "instagram stories": FormatTarget(name="instagram_story", width=1080, height=1920),
    "story": FormatTarget(name="instagram_story", width=1080, height=1920),
    "stories": FormatTarget(name="instagram_story", width=1080, height=1920),
    "instagram feed": FormatTarget(name="instagram_feed", width=1080, height=1080),
    "feed": FormatTarget(name="instagram_feed", width=1080, height=1080),
    "square": FormatTarget(name="instagram_feed", width=1080, height=1080),
    "landscape banner": FormatTarget(name="landscape_banner", width=1200, height=628),
    "banner": FormatTarget(name="landscape_banner", width=1200, height=628),
    "landscape": FormatTarget(name="landscape_banner", width=1200, height=628),
}

_LANGS = {"french": "fr", "fr": "fr", "german": "de", "spanish": "es", "english": "en", "romanian": "ro"}


class InterpretationIssue(Exception):
    pass


class BaseInterpreter(ABC):
    provider_mode: ProviderMode = "fixture"

    @abstractmethod
    def interpret(self, instruction: str, *, known_node_ids: list[str],
                  role_of: dict[str, str] | None = None,
                  headline_text: str | None = None,
                  current_texts: dict[str, str] | None = None) -> RepairConstraints:
        ...


def _resolve_role(fragment: str, role_of: dict[str, str]) -> str | None:
    f = fragment.strip().lower()
    if f in ROLE_ALIASES:
        return ROLE_ALIASES[f]
    return role_of.get(f)


class RuleInterpreter(BaseInterpreter):
    """Deterministic keyword/regex interpreter — labeled fixture mode."""

    provider_mode: ProviderMode = "fixture"

    def interpret(self, instruction: str, *, known_node_ids: list[str],
                  role_of: dict[str, str] | None = None,
                  headline_text: str | None = None,
                  current_texts: dict[str, str] | None = None) -> RepairConstraints:
        role_of = role_of or {}
        current_texts = current_texts or {}
        text = instruction.strip()
        low = text.lower()
        ambiguities: list[str] = []
        unsupported: list[str] = []
        issues: list[str] = []
        changes: dict[str, str] = {}
        translation: dict[str, str] = {}
        locks: list[NodeLock] = []
        keep_visible: list[str] = []
        top_reserved = 0.0
        bottom_reserved = 0.0
        format_target: FormatTarget | None = None

        # --- format adaptation ------------------------------------------------
        for phrase, target in FORMATS.items():
            if re.search(rf"\b{re.escape(phrase)}\b", low):
                format_target = target
                break

        # --- translation ------------------------------------------------------
        m = re.search(r"translat\w+ (?:the )?([\w \-]+?) into (\w+)", low)
        if m:
            role = _resolve_role(m.group(1), role_of) or "headline"
            lang = _LANGS.get(m.group(2))
            if lang is None:
                unsupported.append(f"translation target language '{m.group(2)}' not in fixture phrasebook")
            elif lang != "en":
                translation[role] = lang

        # --- headline text changes -------------------------------------------
        # quoted copy anywhere in the instruction: attribute to the role whose
        # mention most closely PRECEDES the opening quote ("use the headline 'X'")
        for qm in re.finditer(r"[\"'“‘](.+?)[\"'”’]", text):
            before = low[:qm.start()]
            roles = re.findall(r"\b(headline|title|subhead\w*|subtitle|brand|logo|cta|call to action|button)\b", before)
            if roles:
                target_role = _resolve_role(roles[-1], role_of) or "headline"
            else:
                target_role = "headline"
                ambiguities.append("quoted copy found with no preceding element name; assumed headline")
            changes[target_role] = qm.group(1).strip()
        if not changes and re.search(r"\b(longer|bigger|more prominent)\b[^.]*\b(headline|title)\b|\b(headline|title)\b[^.]*\b(longer|bigger)\b", low):
            if headline_text:
                changes["headline"] = headline_text
            else:
                ambiguities.append(
                    "instruction asks for a longer headline but provides no replacement copy; "
                    "pass headline_text or quoted copy to apply a text change")

        # --- locks -------------------------------------------------------------
        # Clause-based: split on commas and conjunctions so "preserve hero size
        # and brand position" yields two clean lock clauses.
        seen_locks: dict[str, set[str]] = {}
        segments = [s.strip().strip(".") for s in re.split(r",|;|\band\b|\bwhile\b|\bwith\b", low) if s.strip()]
        for seg in segments:
            if not re.search(r"preserv|keep|maintain|protect|lock|unchanged|do not|don't|\bposition\b|\bsize\b", seg):
                continue
            m = re.search(r"(?:the |its )?([\w \-]+?)\s*(?:position|size|unchanged|visible)\b", seg)
            role = None
            if m:
                role = _resolve_role(m.group(1), role_of)
            if not role:
                cleaned = re.sub(r"^(?:please\s+)?(?:preserve|keep|maintain|protect|lock|do not|don't)\s+(?:the\s+|its\s+)?",
                                 "", seg).strip()
                cleaned = re.sub(r"\s*(?:position|size|unchanged|visible)\b.*$", "", cleaned).strip()
                role = _resolve_role(cleaned, role_of)
            if not role:
                if "position" in seg or "size" in seg or "unchanged" in seg:
                    ambiguities.append(f"could not map locked element in '{seg}' to a node id")
                continue
            if role not in known_node_ids:
                ambiguities.append(f"locked node '{role}' (from '{seg}') not present in the design")
                continue
            kinds = seen_locks.setdefault(role, set())
            if "visible" in seg and not re.search(r"\bposition\b|\bsize\b|unchanged|move|resize", seg):
                continue  # pure visibility request — handled by keep_visible below
            if "unchanged" in seg:
                kinds.add("position"), kinds.add("size")
            if "position" in seg or "move" in seg:
                kinds.add("position")
            if re.search(r"\bsize\b", seg) or "resize" in seg:
                kinds.add("size")
            if not kinds:
                ambiguities.append(f"no lock kind recognized in '{seg}'")
                seen_locks.pop(role, None)
        for nid, kinds in seen_locks.items():
            if not kinds:
                continue
            locks.append(NodeLock(
                node_id=nid,
                position="position" in kinds,
                size="size" in kinds,
            ))

        # --- keep visible ------------------------------------------------------
        for m3 in re.finditer(r"keep (?:the )?([\w \-]+?) visible", low):
            role = _resolve_role(m3.group(1), role_of)
            if role and role in known_node_ids:
                keep_visible.append(role)
            elif role:
                ambiguities.append(f"keep-visible node '{role}' not present in the design")

        # --- explicit font floors ----------------------------------------------
        min_font: dict[str, float] = {}
        for m5 in re.finditer(r"([\w \-]+?) font[^\d]{0,20}(?:above|at least|>=)\s*(\d+)", low):
            role = _resolve_role(m5.group(1), role_of)
            if role and role in known_node_ids:
                min_font[role] = float(m5.group(2))
            elif role:
                ambiguities.append(f"font floor set on unknown node '{role}'")

        # --- reserved zones ----------------------------------------------------
        m4 = re.search(
            r"reserve[sd]?\s+(?:a\s+|an\s+|the\s+)?(\d+)\s*(?:px|pixels?)?\s*"
            r"(?:at\s+|of\s+)?(?:the\s+)?(top|bottom)", low)
        if m4:
            px = float(m4.group(1))
            if m4.group(2) == "top":
                top_reserved = px
            else:
                bottom_reserved = px
        elif re.search(r"\b(top|bottom)\b[^.]*\b(?:reserve|exclude|promo|zone)\b|\b(?:reserve|exclude)\b[^.]*\b(top|bottom)\b", low):
            ambiguities.append("a top/bottom zone was mentioned but no pixel size could be parsed")

        # --- document exemption rule (spec §3) ---------------------------------
        top_zone_exempt: list[str] = []
        if top_reserved > 0:
            locked_top = [l.node_id for l in locks if l.position]
            for nid in locked_top:
                top_zone_exempt.append(nid)
            if locked_top:
                ambiguities.append(
                    f"DEMO RULE (spec §3): nodes with locked position ({', '.join(locked_top)}) are explicitly "
                    f"exempt from the reserved top zone. Without this exemption the request would be infeasible.")

        # --- fixture translation application -----------------------------------
        if translation:
            for role, lang in list(translation.items()):
                src = changes.get(role) or current_texts.get(role)
                if src is None:
                    unsupported.append(
                        f"fixture translation for '{role}' needs the source text; pass current_texts "
                        f"(live AI would read it from the document)")
                    del translation[role]
                    continue
                translated = FIXTURE_PHRASEBOOK.get((lang, src))
                if translated is None:
                    unsupported.append(
                        f"fixture phrasebook has no {lang} entry for that {role} copy; live AI translation unavailable")
                    del translation[role]
                else:
                    changes[role] = translated

        # --- guard: nothing parsed ---------------------------------------------
        if not (changes or locks or top_reserved or bottom_reserved or format_target
                or keep_visible or translation):
            ambiguities.append(
                "no actionable constraint recognized; supported: text changes (quoted copy), "
                "locks, reserved top/bottom zones with pixel sizes, format adaptation, "
                "fixture translation of known demo copy, keep-visible requests")

        return RepairConstraints(
            instruction=instruction,
            changes=changes,
            top_reserved_px=top_reserved,
            top_zone_exempt_node_ids=top_zone_exempt,
            bottom_reserved_px=bottom_reserved,
            locks=locks,
            keep_visible=keep_visible,
            min_font_size=min_font,
            format_target=format_target,
            translation=translation or None,
            ambiguities=ambiguities,
            unsupported=unsupported,
        )


class LiveInterpreter(BaseInterpreter):
    """Adapter seam for a live LLM. Raises when no credentials are configured —
    callers must fall back to RuleInterpreter and label the result truthfully."""

    provider_mode: ProviderMode = "live"

    def __init__(self, api_key: str | None = None, model: str = "gpt-4o-mini"):
        self.api_key = api_key
        self.model = model

    def available(self) -> bool:
        return bool(self.api_key)

    def interpret(self, instruction: str, *, known_node_ids: list[str],
                  role_of: dict[str, str] | None = None,
                  headline_text: str | None = None,
                  current_texts: dict[str, str] | None = None) -> RepairConstraints:
        if not self.available():
            raise InterpretationIssue(
                "LiveInterpreter has no API credentials; refusing to fabricate AI output. "
                "Use RuleInterpreter (provider_mode='fixture').")
        raise NotImplementedError(
            "Wire the provider SDK here with structured-output validation against "
            "RepairConstraints; keep the fixture fallback labeled.")


def get_interpreter(api_key: str | None = None) -> BaseInterpreter:
    """Return a live interpreter when credentialed, else the fixture one."""
    if api_key:
        live = LiveInterpreter(api_key)
        if live.available():
            return live
    return RuleInterpreter()
