"""Phase 3.2B-9: freeze the banking-domain ASR evaluation selection.

Source: IndicVoices "Digital Payment Commands" (exact task_name match), Kannada
and Hindi, TRAIN split, at the revision pinned by indicvoices_general_manifest.json.
The validation split cannot supply this set: after the Phase 3.2B-8 quality rules
and the general-set speaker exclusion it has 0 Kannada and 18 Hindi eligible
Digital Payment Commands speakers (recorded in the manifest).

Two stages:
  fetch   network. Reads task_name for every kn/hi train shard, then the metadata
          and transcript columns only for row groups that contain Digital Payment
          Commands rows. The audio_filepath.bytes column is never requested; every
          fetched byte range is checked against the audio column-chunk ranges.
          HF_TOKEN is read by huggingface_hub from the environment and is never
          printed or written.
  select  offline and deterministic. Applies the Phase 3.2B-8 quality rules,
          excludes every speaker in indicvoices_general_manifest.json, and takes
          exactly one row per speaker, 100 speakers per language.

Usage:
  python select_indicvoices_banking.py fetch  <snapshot.json>
  python select_indicvoices_banking.py select <snapshot.json> <manifest_out.json>
"""
import ast
import hashlib
import json
import os
import platform
import random
import re
import sys
import threading
from collections import Counter, defaultdict
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
GENERAL_MANIFEST = SPIKE_DIR / "indicvoices_general_manifest.json"

REPO = "ai4bharat/IndicVoices"
REVISION = "c96f9088f138cf89d419da7e8e643e1f05c00a87"
SPLIT = "train"
CONFIGS = {"kn": "kannada", "hi": "hindi"}
DPC = "Digital Payment Commands"
FROZEN_ON = "2026-09-22"

SEED = 3208
RNG_KEY = "{seed}-banking-{lang}"
PER_LANGUAGE = 100
ROWS_PER_SPEAKER = 1

# Phase 3.2B-8 quality rules, unchanged.
MIN_DUR, MAX_DUR = 2.0, 30.0
EXCLUDE_FLAGS = ["unclear_audio", "skipping_words", "mispronunciation",
                 "incorrect_text_prompt", "wrong_language"]
TAGGED_FLAGS = ["noise_persistent", "noise_intermittent", "chatter_persistent",
                "chatter_intermittent", "echo_present", "low_volume", "long_pauses", "off_topic"]

META_COLUMNS = ["audio_filepath.path", "text", "normalized", "verbatim", "duration", "samples",
                "lang", "speaker_id", "scenario", "task_name", "gender", "age_group",
                "verification_report"]
AUDIO_COLUMN = "audio_filepath.bytes"
SHARD_RE = re.compile(r"^train-(\d{5})-of-(\d{5})\.parquet$")

PROJECT_ANNOTATION_FIELDS = ["intent", "amount", "identifier", "negation",
                             "control_type", "completion_signal", "notes"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def sha256_json(obj):
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def write_json(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write("\n")


# --------------------------------------------------------------------------- fetch

def fetch(snapshot_path):
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from concurrent.futures import ThreadPoolExecutor

    import huggingface_hub
    import pyarrow
    import pyarrow.parquet as pq
    from huggingface_hub import HfApi, HfFileSystem
    from huggingface_hub.hf_file_system import HfFileSystemFile

    lock = threading.Lock()
    ranges = defaultdict(list)
    orig = HfFileSystemFile._fetch_range

    def counting_fetch(self, start, end):
        data = orig(self, start, end)
        with lock:
            ranges[self.path].append((start, start + len(data)))
        return data

    HfFileSystemFile._fetch_range = counting_fetch

    resolved = HfApi().dataset_info(REPO, revision=REVISION).sha
    if resolved != REVISION:
        sys.exit(f"revision resolved to {resolved}, expected {REVISION}")

    fs = HfFileSystem()
    base = f"datasets/{REPO}@{REVISION}"

    def list_shards(cfg):
        entries = fs.ls(f"{base}/{cfg}", detail=True)
        shards = {}
        for e in entries:
            name = e["name"].rsplit("/", 1)[-1]
            m = SHARD_RE.match(name)
            if m:
                shards[f"{cfg}/{name}"] = (int(m.group(1)), int(m.group(2)), e["size"])
        totals = {t for _, t, _ in shards.values()}
        if len(totals) != 1 or sorted(i for i, _, _ in shards.values()) != list(range(totals.pop())):
            sys.exit(f"{cfg}: train shard listing is not a complete train-XXXXX-of-NNNNN set")
        return {rel: size for rel, (_, _, size) in sorted(shards.items())}

    def read_shard(rel):
        path = f"{base}/{rel}"
        with fs.open(path, "rb", block_size=16 * 1024, cache_type="none") as fh:
            pf = pq.ParquetFile(fh)
            md = pf.metadata
            bounds, audio_ranges, b = [], [], 0
            for g in range(md.num_row_groups):
                rg = md.row_group(g)
                bounds.append((b, b + rg.num_rows))
                b += rg.num_rows
                for c in range(rg.num_columns):
                    col = rg.column(c)
                    if col.path_in_schema == AUDIO_COLUMN:
                        start = col.dictionary_page_offset or col.data_page_offset
                        audio_ranges.append((start, start + col.total_compressed_size))
            tasks = pf.read(columns=["task_name"]).column(0).to_pylist()
            dpc_idx = [i for i, t in enumerate(tasks) if t == DPC]
            groups = sorted({g for i in dpc_idx for g, (lo, hi) in enumerate(bounds) if lo <= i < hi})
            rows = []
            for g in groups:
                lo = bounds[g][0]
                part = pf.read_row_group(g, columns=META_COLUMNS).to_pylist()
                for j, x in enumerate(part):
                    if x["task_name"] != DPC:
                        continue
                    rows.append({
                        "source_file": rel,
                        "row_in_file": lo + j,
                        "row_group": g,
                        "row_in_row_group": j,
                        "audio_name_in_parquet": x["audio_filepath"]["path"],
                        "samples": x["samples"],
                        "duration": x["duration"],
                        "lang": x["lang"],
                        "speaker_id": x["speaker_id"],
                        "scenario": x["scenario"],
                        "task_name": x["task_name"],
                        "gender": x["gender"],
                        "age_group": x["age_group"],
                        "text": x["text"],
                        "normalized": x["normalized"],
                        "verbatim": x["verbatim"],
                        "verification_report": x["verification_report"],
                    })
            if [r["row_in_file"] for r in rows] != dpc_idx:
                raise RuntimeError(f"{rel}: DPC rows from task_name pass and row-group pass disagree")
        return rel, md.num_rows, Counter(tasks), rows, path, audio_ranges

    snapshot = {
        "repo": REPO, "revision": REVISION, "revision_resolved_sha": resolved, "split": SPLIT,
        "task_name": DPC, "columns_read": list(dict.fromkeys(["task_name"] + META_COLUMNS)),
        "tools": {"python": platform.python_version(), "pyarrow": pyarrow.__version__,
                  "huggingface_hub": huggingface_hub.__version__},
        "languages": {},
    }
    for lang, cfg in CONFIGS.items():
        files = list_shards(cfg)
        with ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(read_shard, list(files)))
        task_counts, rows_total, dpc_rows = Counter(), 0, []
        fetched = audio_overlap = 0
        for rel, n, tasks, rows, path, audio_ranges in results:
            rows_total += n
            task_counts.update(tasks)
            dpc_rows.extend(rows)
            for s, e in ranges[path]:
                fetched += e - s
                audio_overlap += sum(max(0, min(e, ae) - max(s, as_)) for as_, ae in audio_ranges)
        dpc_rows.sort(key=lambda r: (r["source_file"], r["row_in_file"]))
        snapshot["languages"][lang] = {
            "config_dir": cfg,
            "files": files,
            "train_rows_read": rows_total,
            "task_name_counts": dict(sorted(task_counts.items())),
            "dpc_rows": dpc_rows,
            "dpc_rows_sha256": sha256_json(dpc_rows),
            "bytes_fetched": fetched,
            "audio_column_bytes_fetched": audio_overlap,
            "audio_column_bytes_in_split": sum(ae - as_ for *_, audio_ranges in results
                                               for as_, ae in audio_ranges),
        }
        print(f"{lang}: shards={len(files)} train_rows={rows_total} dpc_rows={len(dpc_rows)} "
              f"bytes_fetched={fetched:,} audio_column_bytes_fetched={audio_overlap:,}")
    write_json(snapshot_path, snapshot)
    print("wrote", snapshot_path)


# --------------------------------------------------------------------------- select

def eligible(r, vr):
    if "<unintelligible>" in r["text"] or "<unintelligible>" in r["normalized"]:
        return False
    if not (MIN_DUR <= r["duration"] <= MAX_DUR):
        return False
    return not any(vr.get(f) for f in EXCLUDE_FLAGS)


def fail(msg):
    sys.exit(f"SELECTION STOPPED: {msg}")


def select(snapshot_path, out_path):
    with open(GENERAL_MANIFEST, encoding="utf-8") as fh:
        general = json.load(fh)
    with open(snapshot_path, encoding="utf-8") as fh:
        snap = json.load(fh)

    # G. revision pinned by the general manifest == revision used here == snapshot revision.
    if general["dataset"]["revision"] != REVISION:
        fail(f"general manifest revision {general['dataset']['revision']} != {REVISION}")
    if snap["revision"] != REVISION or snap["revision_resolved_sha"] != REVISION:
        fail("snapshot revision does not match the pinned revision")
    for lang, s in snap["languages"].items():
        if sha256_json(s["dpc_rows"]) != s["dpc_rows_sha256"]:
            fail(f"{lang}: snapshot dpc_rows hash mismatch")

    general_ids = {u["id"] for u in general["utterances"]}
    general_speakers = {u["speaker_id"] for u in general["utterances"]}
    general_by_lang = {l: {u["speaker_id"] for u in general["utterances"] if u["language"] == l}
                       for l in CONFIGS}
    general_rows = {(u["source_file"], u["row_in_file"]) for u in general["utterances"]}
    general_audio_names = {u["audio_name_in_parquet"] for u in general["utterances"]}
    if len(general["utterances"]) != 400:
        fail(f"general manifest has {len(general['utterances'])} utterances, expected 400")

    languages, utterances = {}, []
    for lang, cfg in CONFIGS.items():
        s = snap["languages"][lang]
        rows = sorted(s["dpc_rows"], key=lambda r: (r["source_file"], r["row_in_file"]))
        for r in rows:
            if r["task_name"] != DPC or r["lang"] != lang or not r["source_file"].startswith(f"{cfg}/train-"):
                fail(f"{lang}: snapshot row {r['source_file']}#{r['row_in_file']} is not {cfg} train {DPC}")
            r["_vr"] = ast.literal_eval(r["verification_report"])

        quality = [r for r in rows if eligible(r, r["_vr"])]
        pool = [r for r in quality if r["speaker_id"] not in general_speakers]
        by_spk = defaultdict(list)
        for r in pool:
            by_spk[r["speaker_id"]].append(r)

        # A/B. enough eligible speakers after the general-set exclusion; never relaxed.
        if len(by_spk) < PER_LANGUAGE:
            fail(f"{lang}: only {len(by_spk)} eligible speakers after excluding general-set speakers "
                 f"(need {PER_LANGUAGE})")

        rng = random.Random(RNG_KEY.format(seed=SEED, lang=lang))
        speakers = sorted(by_spk)
        rng.shuffle(speakers)
        for sp in speakers:
            rng.shuffle(by_spk[sp])
        chosen = [by_spk[sp][0] for sp in speakers[:PER_LANGUAGE]]
        chosen.sort(key=lambda r: (r["source_file"], r["row_in_file"]))

        spk_all = {r["speaker_id"] for r in rows}
        spk_quality = {r["speaker_id"] for r in quality}
        languages[lang] = {
            "config_dir": cfg,
            "train_shards": len(s["files"]),
            "train_rows_read": s["train_rows_read"],
            "dpc_rows": len(rows),
            "dpc_speakers": len(spk_all),
            "dpc_scenarios": dict(sorted(Counter(r["scenario"] for r in rows).items())),
            "dropped_by_rule": {
                "unintelligible": sum("<unintelligible>" in r["text"] or "<unintelligible>" in r["normalized"]
                                      for r in rows),
                "duration_outside_2_30s": sum(not (MIN_DUR <= r["duration"] <= MAX_DUR) for r in rows),
                "excluded_flags": sum(any(r["_vr"].get(f) for f in EXCLUDE_FLAGS) for r in rows),
            },
            "after_quality_rules": {"rows": len(quality), "speakers": len(spk_quality)},
            "general_set_speakers_in_dpc": len(spk_all & general_speakers),
            "general_set_speakers_removed_after_quality": {
                "rows": len(quality) - len(pool),
                "speakers": len(spk_quality & general_speakers)},
            "eligible_pool": {"rows": len(pool), "speakers": len(by_spk),
                              "hours": round(sum(r["duration"] for r in pool) / 3600, 3)},
            "selected_total": len(chosen),
            "selected_speakers": len({r["speaker_id"] for r in chosen}),
            "selected_by_gender": dict(sorted(Counter(r["gender"] for r in chosen).items())),
            "selected_verifier_decision": dict(sorted(Counter(str(r["_vr"].get("decision"))
                                                              for r in chosen).items())),
            "selected_with_duplicate_speaker_flag": sum(bool(r["_vr"].get("duplicate_speaker"))
                                                        for r in chosen),
            "selected_with_tagged_flags": dict(sorted(Counter(f for r in chosen for f in TAGGED_FLAGS
                                                              if r["_vr"].get(f)).items())),
            "selected_audio_seconds": round(sum(r["duration"] for r in chosen), 1),
            "selected_duration_seconds_min_median_max": [
                round(min(r["duration"] for r in chosen), 3),
                round(sorted(r["duration"] for r in chosen)[len(chosen) // 2], 3),
                round(max(r["duration"] for r in chosen), 3)],
            "snapshot_dpc_rows_sha256": s["dpc_rows_sha256"],
            "fetch_bytes": s["bytes_fetched"],
            "fetch_audio_column_bytes": s["audio_column_bytes_fetched"],
        }
        for i, r in enumerate(chosen, 1):
            utterances.append({
                "id": f"ivb_{lang}_{i:03d}",
                "language": lang,
                "split": SPLIT,
                "source_file": r["source_file"],
                "row_in_file": r["row_in_file"],
                "row_group": r["row_group"],
                "row_in_row_group": r["row_in_row_group"],
                "audio_name_in_parquet": r["audio_name_in_parquet"],
                "samples": r["samples"],
                "duration_seconds": round(r["duration"], 3),
                "speaker_id": r["speaker_id"],
                "scenario": r["scenario"],
                "task_name": r["task_name"],
                "gender": r["gender"],
                "age_group": r["age_group"],
                "quality_flags": [f for f in TAGGED_FLAGS if r["_vr"].get(f)],
                "verification_report": r["_vr"],
                "reference_transcript": r["normalized"],
                "verbatim_transcript": r["verbatim"],
                "audio_status": "not_downloaded",
                "project_annotations": {k: None for k in PROJECT_ANNOTATION_FIELDS},
            })

    # C-F. post-selection checks; any failure stops the run before the manifest is written.
    ids = [u["id"] for u in utterances]
    keys = [(u["source_file"], u["row_in_file"]) for u in utterances]
    names = [u["audio_name_in_parquet"] for u in utterances]
    spk = Counter(u["speaker_id"] for u in utterances)
    per_lang = Counter(u["language"] for u in utterances)
    cross_lang = {sp for sp in spk if len({u["language"] for u in utterances if u["speaker_id"] == sp}) > 1}
    checks = {
        "A_B_eligible_speakers_ge_100": {l: languages[l]["eligible_pool"]["speakers"] for l in CONFIGS},
        "C_rows_per_selected_speaker_max": max(spk.values()),
        "C_rows_per_selected_speaker_min": min(spk.values()),
        "D_overlap_with_general_speakers": len(set(spk) & general_speakers),
        "D_overlap_with_general_speakers_same_language": {
            l: len({u["speaker_id"] for u in utterances if u["language"] == l} & general_by_lang[l])
            for l in CONFIGS},
        "D_speakers_in_both_banking_languages": len(cross_lang),
        "E_duplicate_manifest_ids": len(ids) - len(set(ids)),
        "E_duplicate_source_rows": len(keys) - len(set(keys)),
        "E_duplicate_audio_names": len(names) - len(set(names)),
        "E_id_collisions_with_general_manifest": len(set(ids) & general_ids),
        "E_row_collisions_with_general_manifest": len(set(keys) & general_rows),
        "E_audio_name_collisions_with_general_manifest": len(set(names) & general_audio_names),
        "F_task_name_counts": dict(Counter(u["task_name"] for u in utterances)),
        "F_all_rows_train_split_shards": all(
            SHARD_RE.match(u["source_file"].split("/", 1)[1]) and
            u["source_file"].split("/", 1)[0] == CONFIGS[u["language"]] for u in utterances),
        "G_revision": {"general_manifest": general["dataset"]["revision"], "snapshot": snap["revision"],
                       "hub_resolved": snap["revision_resolved_sha"], "this_manifest": REVISION},
    }
    ok = (all(v >= PER_LANGUAGE for v in checks["A_B_eligible_speakers_ge_100"].values())
          and checks["C_rows_per_selected_speaker_max"] == ROWS_PER_SPEAKER
          and checks["D_overlap_with_general_speakers"] == 0
          and checks["D_speakers_in_both_banking_languages"] == 0
          and checks["E_duplicate_manifest_ids"] == 0
          and checks["E_duplicate_source_rows"] == 0
          and checks["E_duplicate_audio_names"] == 0
          and checks["E_id_collisions_with_general_manifest"] == 0
          and checks["E_row_collisions_with_general_manifest"] == 0
          and checks["E_audio_name_collisions_with_general_manifest"] == 0
          and checks["F_task_name_counts"] == {DPC: 2 * PER_LANGUAGE}
          and checks["F_all_rows_train_split_shards"]
          and len(set(checks["G_revision"].values())) == 1
          and per_lang == {l: PER_LANGUAGE for l in CONFIGS})
    if not ok:
        fail("post-selection checks failed: " + json.dumps(checks, ensure_ascii=False))

    refs = [u["reference_transcript"] for u in utterances]
    selected_keys = set(keys)
    selected_raw = [r for l in CONFIGS for r in snap["languages"][l]["dpc_rows"]
                    if (r["source_file"], r["row_in_file"]) in selected_keys]

    manifest = {
        "schema_version": "3.2b9.1",
        "phase": "3.2B-9",
        "track": "BANKING_ASR (IndicVoices Digital Payment Commands; project annotations pending)",
        "status": "SELECTION_FROZEN_AUDIO_NOT_DOWNLOADED",
        "frozen_on": FROZEN_ON,
        "dataset": {
            "repo": REPO,
            "revision": REVISION,
            "split": SPLIT,
            "files": {l: snap["languages"][l]["files"] for l in CONFIGS},
            "license": general["dataset"]["license"],
            "citation": general["dataset"]["citation"],
        },
        "source_subset": {
            "task_name": DPC,
            "match": "exact equality on the IndicVoices task_name column",
            "not_used": ["DOI - Banking And Insurance", "any other task_name",
                         "manually created recordings", "synthetic speech"],
            "task_name_counts_in_train_split": {
                l: {t: c for t, c in snap["languages"][l]["task_name_counts"].items()
                    if t in (DPC, "DOI - Banking And Insurance")} for l in CONFIGS},
        },
        "split_rationale": {
            "general_manifest_split": general["dataset"]["split"],
            "why_train": "The valid split has too few Digital Payment Commands speakers once the "
                         "Phase 3.2B-8 quality rules and the general-set speaker exclusion are applied "
                         "(Kannada 6 DPC speakers -> 5 eligible -> 0 not in the general set; Hindi 26 -> "
                         "24 -> 18). The train split at the same revision is the only in-dataset source "
                         "large enough for 100 speakers per language.",
        },
        "known_limitations": [
            "Train-split clips: ASR models trained on IndicVoices train (for example AI4Bharat "
            "IndicVoices-trained models) may have seen these exact recordings. Check each candidate "
            "model's training data before comparing it with Whisper-small on this set.",
            "IndicVoices train and valid are not speaker-disjoint. Only the speakers in the frozen "
            "general manifest are excluded here, as specified; other valid-split speakers may appear.",
            "Every Digital Payment Commands row is scenario 'Read' (prompted read speech), not "
            "spontaneous speech.",
            "References write numbers as words, so amounts and identifiers in reference_transcript "
            "are word sequences, not digit strings.",
        ],
        "selection_rules": {
            "seed": SEED,
            "rng": "random.Random(f'{seed}-banking-{lang}')",
            "python": platform.python_version(),
            "per_language": PER_LANGUAGE,
            "rows_per_speaker": ROWS_PER_SPEAKER,
            "duration_seconds": [MIN_DUR, MAX_DUR],
            "exclude_if_text_contains": "<unintelligible>",
            "exclude_if_flag_true": EXCLUDE_FLAGS,
            "kept_but_tagged_flags": TAGGED_FLAGS,
            "exclude_speakers": "every speaker_id in indicvoices_general_manifest.json, both languages",
            "procedure": "rows sorted by (source_file, row_in_file); quality rules applied; general-set "
                         "speakers removed; eligible speakers sorted then shuffled with the seeded RNG; "
                         "each speaker's rows shuffled with the same RNG in that order; the first row of "
                         "each of the first 100 speakers is selected; output ordered by (source_file, "
                         "row_in_file)",
            "not_used_for_selection": ["ASR output of any model", "transcript content",
                                       "project annotations"],
            "script": "select_indicvoices_banking.py",
        },
        "general_manifest": {
            "file": GENERAL_MANIFEST.name,
            "sha256": sha256_file(GENERAL_MANIFEST),
            "revision": general["dataset"]["revision"],
            "split": general["dataset"]["split"],
            "utterances": len(general["utterances"]),
            "speakers_excluded": len(general_speakers),
        },
        "reference_conventions": [
            "reference_transcript is the IndicVoices 'normalized' field; "
            f"{sum(r['normalized'] == r['text'] for r in selected_raw)}/{len(selected_raw)} selected "
            "rows have normalized identical to text.",
            f"{sum(bool(re.search(r'[0-9]', t)) for t in refs)}/{len(refs)} selected references "
            "contain an ASCII digit.",
            f"{sum(bool(re.search(r'[A-Za-z]', t)) for t in refs)}/{len(refs)} selected references "
            "contain a Latin letter.",
            "verbatim_transcript is kept for audit only; score against reference_transcript.",
        ],
        "row_identity": general["row_identity"],
        "fetch": {
            "method": "HfFileSystem range reads at the pinned revision: task_name for every train "
                      "shard, then metadata/transcript columns for row groups containing Digital "
                      "Payment Commands rows. audio_filepath.bytes never requested.",
            "columns_read": list(dict.fromkeys(snap["columns_read"])),
            "tools": snap["tools"],
            "snapshot": "not stored; re-run `fetch` and compare each language's "
                        "snapshot_dpc_rows_sha256 before re-running `select`",
        },
        "project_annotations": {
            "schema": "banking_annotation_schema.md",
            "status": "pending; every value is null until annotated",
            "fields": PROJECT_ANNOTATION_FIELDS,
        },
        "languages": languages,
        "validation": checks,
        "utterances": utterances,
    }
    write_json(out_path, manifest)
    print("wrote", out_path, "utterances", len(utterances))
    print(json.dumps({"languages": languages, "validation": checks}, ensure_ascii=False, indent=1))


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "fetch":
        fetch(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "select":
        select(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
