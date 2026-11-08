"""Verified campus places and routes (domain integration, Phase 5).

Campus navigation answers ONLY from this data: a place the student can be
directed to must be in the institution's map, and directions exist only as
route steps written into the map by the institution. Nothing here composes,
infers, reverses or chains directions, and nothing guesses a room number or
a building. A place or a route that is not in the map is "not available",
never improvised.

WHERE THE DATA COMES FROM

A collection is a manifest (manifest.json) naming one map file per
institution under maps/ next to it -- the same discipline as the knowledge
collection (app/knowledge/collection.py), with the same verification rules:

  - a verified map needs source_reference, verified_by, verified_on and the
    file's sha256, and a file changed after verification is refused;
  - a synthetic test fixture can never be verified;
  - production uses verified maps only.

A map file:

    {
      "institution_id": "...",
      "places": [{"id": "<area slug>", "names": {"en": "...", "kn": "..."},
                  "aliases": ["...", "..."]}],
      "routes": [{"from": "<place id>", "to": "<place id>",
                  "steps": [{"en": "...", "kn": "..."}, ...]}]
    }

Place ids use the QR area-slug format (campusguide:college/<id>?area=<slug>),
so the location a QR code identifies is a place id directly. The QR code only
tells the engine WHERE THE STUDENT IS; it is resolved and re-checked by the
College backend (ContextService), never here.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.dialogue.text_normalization import word_tokens
from app.knowledge.collection import SYNTHETIC_SOURCE, ManifestError, file_sha256

PLACE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
_MAP_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_INSTITUTION = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

MAP_DOCUMENT_TYPES = frozenset({"campus_map", "synthetic_fixture"})
MAX_TEXT = 300
MAX_STEPS = 20
#: A name's LAST word matches a longer spoken word only from this length on
#: (so Kannada case endings match: ಗ್ರಂಥಾಲಯಕ್ಕೆ), never for short words.
MIN_PREFIX = 3


@dataclass(frozen=True)
class CampusPlace:
    id: str
    names: Dict[str, str]
    aliases: Tuple[str, ...] = ()

    @property
    def name(self) -> str:
        return self.names["en"]


@dataclass(frozen=True)
class CampusRoute:
    origin: str
    destination: str
    #: Each step: {language: text}, English always present.
    steps: Tuple[Dict[str, str], ...]


@dataclass
class DestinationMatch:
    """What a sentence says about where to go."""

    #: Places named, best (longest) matches only, in the order spoken.
    places: List[str] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return len(self.places) == 1

    @property
    def ambiguous(self) -> bool:
        return len(self.places) > 1


@dataclass(frozen=True)
class InstitutionCampus:
    """One institution's map. Read-only."""

    map_id: str
    institution_id: str
    verified: bool
    version: str
    source_reference: Optional[str]
    places: Dict[str, CampusPlace]
    routes: Dict[Tuple[str, str], CampusRoute]

    def place(self, place_id: Optional[str]) -> Optional[CampusPlace]:
        return self.places.get(place_id) if place_id else None

    def route(self, origin: str, destination: str) -> Optional[CampusRoute]:
        """The route written for exactly this pair. Never reversed or chained."""
        return self.routes.get((origin, destination))

    def _spellings(self):
        for place in self.places.values():
            for text in (*place.names.values(), *place.aliases):
                tokens = word_tokens(text)
                if tokens:
                    yield place.id, tokens

    def find_places(self, text: str) -> DestinationMatch:
        """
        Places a sentence names, by name or alias in any language.

        A name matches the same words in sequence, its last word by prefix
        (inflection). When one place's match lies inside a longer match of
        another ("hall" inside "seminar hall"), only the longer one counts.
        """
        spoken = word_tokens(text or "")
        spans = []
        for place_id, tokens in self._spellings():
            n = len(tokens)
            for start in range(len(spoken) - n + 1):
                window = spoken[start:start + n]
                last, said = tokens[-1], window[-1]
                last_ok = said == last or (len(last) >= MIN_PREFIX and said.startswith(last))
                if window[:-1] == tokens[:-1] and last_ok:
                    spans.append((start, start + n, place_id))

        def inside(a, b):
            return b[0] <= a[0] and a[1] <= b[1] and (b[1] - b[0]) > (a[1] - a[0]) and a[2] != b[2]

        kept = [s for s in spans if not any(inside(s, other) for other in spans)]
        ordered: List[str] = []
        for _, _, place_id in sorted(kept):
            if place_id not in ordered:
                ordered.append(place_id)
        return DestinationMatch(places=ordered)


class CampusMapCollection:
    """A validated set of campus maps for exactly one domain."""

    def __init__(self, manifest_path: Path, domain: str) -> None:
        self.manifest_path = Path(manifest_path).resolve()
        self.root = self.manifest_path.parent / "maps"
        self.domain = domain
        self.maps: Dict[str, InstitutionCampus] = self._load()

    @classmethod
    def for_domain(cls, config) -> "CampusMapCollection":
        if config.navigation is None:
            raise ValueError(f"Domain {config.id!r} has no campus map collection.")
        return cls(config.navigation.manifest, config.id)

    # -----------------------------------------------------------------
    # Selection
    # -----------------------------------------------------------------

    def for_institution(self, institution_id: str, *, include_unverified: bool = False) -> Optional[InstitutionCampus]:
        """The institution's own map, or None. There is no shared or default map."""
        campus = self.maps.get(institution_id)
        if campus is None or (not campus.verified and not include_unverified):
            return None
        return campus

    # -----------------------------------------------------------------
    # Loading and validation
    # -----------------------------------------------------------------

    def _load(self) -> Dict[str, InstitutionCampus]:
        try:
            manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ManifestError([f"campus manifest unreadable ({type(error).__name__})"]) from error

        problems: List[str] = []
        if manifest.get("domain") != self.domain:
            problems.append(f"campus manifest domain must be {self.domain!r}")
        entries = manifest.get("maps")
        if not isinstance(entries, list):
            raise ManifestError(problems + ["'maps' must be a list"])

        maps: Dict[str, InstitutionCampus] = {}
        seen = set()
        for index, entry in enumerate(entries):
            label = f"maps[{index}]"
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not _MAP_ID.match(entry["id"]):
                problems.append(f"{label}: invalid id")
                continue
            label = entry["id"]
            if label in seen:
                problems.append(f"{label}: duplicate id")
                continue
            seen.add(label)
            campus = self._entry(entry, label, problems)
            if campus is None:
                continue
            if campus.institution_id in maps:
                problems.append(f"{label}: a second map for {campus.institution_id}")
                continue
            maps[campus.institution_id] = campus

        if problems:
            raise ManifestError(problems)
        return maps

    def _entry(self, entry: dict, label: str, problems: List[str]) -> Optional[InstitutionCampus]:
        before = len(problems)

        def text(name, required=True):
            value = entry.get(name)
            if value is None and not required:
                return None
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{label}: '{name}' is required")
                return None
            return value.strip()

        if entry.get("domain") != self.domain:
            problems.append(f"{label}: belongs to domain {entry.get('domain')!r}, not {self.domain!r}")
        institution = text("institution_id")
        if institution and not _INSTITUTION.match(institution):
            problems.append(f"{label}: invalid institution_id")
        document_type = text("document_type")
        if document_type and document_type not in MAP_DOCUMENT_TYPES:
            problems.append(f"{label}: unknown document_type")
        source, version = text("source"), text("version")
        reference = text("source_reference", required=False)
        verified_by = text("verified_by", required=False)
        verified_on = text("verified_on", required=False)
        recorded_sha = text("sha256", required=False)
        verified = entry.get("verified")
        if not isinstance(verified, bool):
            problems.append(f"{label}: 'verified' must be true or false")
            verified = False

        path = self._path(text("path"), label, problems)
        data, actual_sha = None, ""
        if path is not None:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                actual_sha = file_sha256(path)
            except OSError:
                problems.append(f"{label}: file not found")
            except ValueError:
                problems.append(f"{label}: file is not valid JSON")

        synthetic = document_type == "synthetic_fixture" or source == SYNTHETIC_SOURCE
        if synthetic and (document_type != "synthetic_fixture" or source != SYNTHETIC_SOURCE):
            problems.append(f"{label}: synthetic fixtures need document_type synthetic_fixture "
                            f"and source {SYNTHETIC_SOURCE}")
        if verified:
            if synthetic:
                problems.append(f"{label}: a synthetic fixture can never be verified")
            if not reference:
                problems.append(f"{label}: verified maps need source_reference")
            if not verified_by:
                problems.append(f"{label}: verified maps need verified_by")
            if not verified_on or not _DATE.match(verified_on):
                problems.append(f"{label}: verified maps need verified_on (YYYY-MM-DD)")
            if not recorded_sha or not _SHA256.match(recorded_sha):
                problems.append(f"{label}: verified maps need the file's sha256")
            elif actual_sha and recorded_sha != actual_sha:
                problems.append(f"{label}: file changed since it was verified (sha256 mismatch)")
        elif recorded_sha and actual_sha and recorded_sha != actual_sha:
            problems.append(f"{label}: sha256 does not match the file")

        places, routes = {}, {}
        if isinstance(data, dict):
            if data.get("institution_id") != institution:
                problems.append(f"{label}: the map file is for another institution")
            places = self._places(data.get("places"), label, problems)
            routes = self._routes(data.get("routes"), places, label, problems)
        elif data is not None:
            problems.append(f"{label}: the map file must be an object")

        if len(problems) != before:
            return None
        return InstitutionCampus(map_id=label, institution_id=institution, verified=verified, version=version,
                                 source_reference=reference, places=places, routes=routes)

    @staticmethod
    def _texts(value, where, problems) -> Optional[Dict[str, str]]:
        """{language: text} with English, each non-empty and bounded."""
        if not isinstance(value, dict) or not isinstance(value.get("en"), str) or not value["en"].strip():
            problems.append(f"{where}: needs English text")
            return None
        out = {}
        for language, text in value.items():
            if not isinstance(language, str) or not re.match(r"^[a-z]{2,3}$", language) \
                    or not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                problems.append(f"{where}: invalid {language!r} text")
                return None
            out[language] = " ".join(text.split())
        return out

    def _places(self, value, label, problems) -> Dict[str, CampusPlace]:
        if not isinstance(value, list) or not value:
            problems.append(f"{label}: 'places' must be a non-empty list")
            return {}
        places = {}
        for index, item in enumerate(value):
            where = f"{label}.places[{index}]"
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not PLACE_ID.match(item["id"]):
                problems.append(f"{where}: invalid id")
                continue
            if item["id"] in places:
                problems.append(f"{where}: duplicate place {item['id']}")
                continue
            names = self._texts(item.get("names"), where, problems)
            aliases = item.get("aliases", [])
            if not isinstance(aliases, list) or not all(isinstance(a, str) and a.strip() for a in aliases):
                problems.append(f"{where}: aliases must be non-empty strings")
                continue
            if names is not None:
                places[item["id"]] = CampusPlace(item["id"], names, tuple(a.strip() for a in aliases))
        return places

    def _routes(self, value, places, label, problems) -> Dict[Tuple[str, str], CampusRoute]:
        if not isinstance(value, list):
            problems.append(f"{label}: 'routes' must be a list")
            return {}
        routes = {}
        for index, item in enumerate(value):
            where = f"{label}.routes[{index}]"
            if not isinstance(item, dict):
                problems.append(f"{where}: must be an object")
                continue
            origin, destination = item.get("from"), item.get("to")
            if origin not in places or destination not in places:
                problems.append(f"{where}: both ends must be places of this map")
                continue
            if origin == destination:
                problems.append(f"{where}: a route needs two different places")
                continue
            if (origin, destination) in routes:
                problems.append(f"{where}: duplicate route")
                continue
            steps = item.get("steps")
            if not isinstance(steps, list) or not steps or len(steps) > MAX_STEPS:
                problems.append(f"{where}: needs 1..{MAX_STEPS} steps")
                continue
            parsed = [self._texts(step, f"{where}.steps[{n}]", problems) for n, step in enumerate(steps)]
            if any(step is None for step in parsed):
                continue
            routes[(origin, destination)] = CampusRoute(origin, destination, tuple(parsed))
        return routes

    def _path(self, relative: Optional[str], label: str, problems: List[str]) -> Optional[Path]:
        if relative is None:
            return None
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or candidate.suffix != ".json":
            problems.append(f"{label}: path must be a relative .json path inside maps/")
            return None
        resolved = (self.root / candidate).resolve()
        if self.root.resolve() not in resolved.parents:
            problems.append(f"{label}: path escapes maps/")
            return None
        return resolved
