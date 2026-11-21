"""Phase 3.2B-9 step 3: extract the 200 frozen banking clips.

Same methodology as the Phase 3.2B-8 general-track extraction: only the parquet
data pages that hold manifest rows are range-read from the pinned revision, no
source parquet is written to disk, and HF_TOKEN is read from the environment by
huggingface_hub and never printed.

The frozen manifest is opened READ-ONLY and its sha256 is checked first. Because
the manifest may not be modified, the extraction record is written to a separate
file, indicvoices_banking_audio_index.json.

Input : indicvoices_banking_manifest.json (read-only)
Output: corpus/indicvoices_banking/{kn,hi}/<id>.wav (16 kHz, mono, PCM16)
        indicvoices_banking_audio_index.json

Per clip, all of these must pass before the WAV is written:
  0. the row group holding row_in_file == the manifest's row_group
  1. parquet audio_filepath.path == manifest audio_name_in_parquet
  2. parquet samples == manifest samples == FLAC STREAMINFO total_samples
  3. FLAC header: magic fLaC, STREAMINFO 16000 Hz / 1 ch / 16 bit
  4. full decode: frames == samples, and decoded-PCM MD5 == STREAMINFO MD5
  5. samples / 16000 within 1 ms of manifest duration_seconds

Run with an interpreter that has pyarrow, soundfile and huggingface_hub:
  python extract_banking_audio.py
"""
import hashlib
import io
import json
import os
import struct
import sys
import threading
import wave
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import HfFileSystem

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ivpq

SPIKE = Path(__file__).resolve().parent
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
FROZEN_SHA = "02a773066224781dc9db08ed0049cc09ec7fa2de9f99d29b12aabe0799979427"
INDEX_FILE = SPIKE / "indicvoices_banking_audio_index.json"
OUT_ROOT = SPIKE / "corpus" / "indicvoices_banking"
REV = "c96f9088f138cf89d419da7e8e643e1f05c00a87"
BASE = f"datasets/ai4bharat/IndicVoices@{REV}/"
SR, CH, BITS = 16000, 1, 16

sha = hashlib.sha256(MANIFEST.read_bytes()).hexdigest()
if sha != FROZEN_SHA:
    sys.exit(f"frozen manifest sha256 changed: {sha}")
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
if manifest["dataset"]["revision"] != REV:
    sys.exit("manifest revision does not match the pinned revision")

for lang in ("kn", "hi"):
    d = OUT_ROOT / lang
    if d.is_dir() and any(d.iterdir()):
        sys.exit(f"refusing to run: {d} is not empty")
    d.mkdir(parents=True, exist_ok=True)

fs = HfFileSystem()
lock = threading.Lock()
fetched = {"page_bytes": 0, "pages": 0, "index_bytes": 0}
log = {}

by_file = defaultdict(dict)
for u in manifest["utterances"]:
    by_file[u["source_file"]][u["row_in_file"]] = u


def fail(u, msg):
    log[u["id"]] = {"id": u["id"], "status": "failed", "error": msg}


def page_plan(rel, rows):
    """Footer + OffsetIndex of the audio column; returns (groups, needed pages)."""
    path = BASE + rel
    size = fs.info(path)["size"]
    tail = fs.cat_file(path, start=size - 8, end=size)
    flen = ivpq.footer_length(tail)
    footer = fs.cat_file(path, start=size - 8 - flen, end=size - 8)
    meta = ivpq.Reader(footer).struct()
    groups, row_base, idx_bytes = [], 0, 8 + len(footer)
    for g, nrows, cc in ivpq.audio_chunks(meta):
        oi_off, oi_len = cc[4], cc[5]
        oi = fs.cat_file(path, start=oi_off, end=oi_off + oi_len)
        idx_bytes += len(oi)
        groups.append({"rg": g, "row_base": row_base, "rows": nrows,
                       "pages": ivpq.page_locations(ivpq.Reader(oi).struct())})
        row_base += nrows
    need = set()
    for r, u in rows.items():
        grp = next((x for x in groups if x["row_base"] <= r < x["row_base"] + x["rows"]), None)
        if grp is None:
            fail(u, f"row {r} outside every row group")
            continue
        if grp["rg"] != u["row_group"]:
            fail(u, f"row group {grp['rg']} != manifest row_group {u['row_group']}")
            continue
        local = r - grp["row_base"]
        if local != u["row_in_row_group"]:
            fail(u, f"row_in_row_group {local} != manifest {u['row_in_row_group']}")
            continue
        need.add((grp["rg"], max(i for i, p in enumerate(grp["pages"]) if p["first_row"] <= local)))
    with lock:
        fetched["index_bytes"] += idx_bytes
    return {g["rg"]: g for g in groups}, sorted(need)


def decode_levels(buf, pos, bit_width, count):
    """RLE / bit-packed hybrid decoder; returns (levels, end_pos)."""
    out = []
    r = ivpq.Reader(buf, pos)
    byte_w = (bit_width + 7) // 8
    while len(out) < count:
        header = r.varint()
        if header & 1:
            groups = header >> 1
            nbytes = groups * bit_width
            chunk = int.from_bytes(buf[r.pos:r.pos + nbytes], "little")
            r.pos += nbytes
            mask = (1 << bit_width) - 1
            for i in range(groups * 8):
                out.append((chunk >> (i * bit_width)) & mask)
        else:
            run = header >> 1
            val = int.from_bytes(buf[r.pos:r.pos + byte_w], "little")
            r.pos += byte_w
            out.extend([val] * run)
    return out[:count], r.pos


def values_in_page(page):
    """Return list of (index_in_page, bytes-or-None) from an uncompressed PLAIN page."""
    r = ivpq.Reader(page)
    h = r.struct()
    body = r.pos
    if body + h[3] != len(page):
        raise ValueError("page size mismatch")
    if h[1] == 0:
        dph = h[5]
        n, enc = dph[1], dph[2]
        def_len = struct.unpack_from("<I", page, body)[0]
        levels, _ = decode_levels(page, body + 4, 2, n)
        pos = body + 4 + def_len
    elif h[1] == 3:
        v2 = h[8]
        n, enc = v2[1], v2[4]
        levels, _ = decode_levels(page, body + v2.get(6, 0), 2, n)
        pos = body + v2.get(6, 0) + v2[5]
    else:
        raise ValueError(f"unexpected page type {h[1]}")
    if enc != 0:
        raise ValueError(f"unexpected encoding {enc}")
    out = []
    for i, lvl in enumerate(levels):
        if lvl < 2:
            out.append((i, None))
            continue
        ln = struct.unpack_from("<I", page, pos)[0]
        out.append((i, bytes(page[pos + 4:pos + 4 + ln])))
        pos += 4 + ln
    if pos != len(page):
        raise ValueError("values did not end at page boundary")
    return out


def streaminfo(flac):
    if flac[:4] != b"fLaC":
        raise ValueError("missing fLaC magic")
    if flac[4] & 0x7F != 0 or int.from_bytes(flac[5:8], "big") != 34:
        raise ValueError("first metadata block is not STREAMINFO")
    si = flac[8:42]
    x = int.from_bytes(si[10:18], "big")
    return {"rate": x >> 44, "ch": ((x >> 41) & 7) + 1, "bits": ((x >> 36) & 31) + 1,
            "total": x & ((1 << 36) - 1), "md5": si[18:34].hex()}


def handle_clip(u, flac):
    if flac is None:
        return fail(u, "null audio value")
    try:
        info = streaminfo(flac)
    except ValueError as e:
        return fail(u, f"FLAC header: {e}")
    if (info["rate"], info["ch"], info["bits"]) != (SR, CH, BITS):
        return fail(u, f"FLAC format {info['rate']}Hz/{info['ch']}ch/{info['bits']}bit")
    if info["total"] != u["samples"]:
        return fail(u, f"STREAMINFO samples {info['total']} != manifest {u['samples']}")
    pcm, rate = sf.read(io.BytesIO(flac), dtype="int16", always_2d=False)
    if rate != SR or pcm.ndim != 1 or len(pcm) != u["samples"]:
        return fail(u, f"decode: rate={rate} ndim={pcm.ndim} frames={len(pcm)}")
    raw = pcm.astype("<i2").tobytes()
    md5_ok = None
    if info["md5"] != "0" * 32:
        md5_ok = hashlib.md5(raw).hexdigest() == info["md5"]
        if not md5_ok:
            return fail(u, "decoded PCM MD5 != STREAMINFO MD5")
    if abs(u["samples"] / SR - u["duration_seconds"]) > 0.001:
        return fail(u, f"duration {u['samples'] / SR:.4f}s vs manifest {u['duration_seconds']}")
    dest = OUT_ROOT / u["language"] / (u["id"] + ".wav")
    tmp = dest.with_suffix(".wav.part")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(CH)
        w.setsampwidth(BITS // 8)
        w.setframerate(SR)
        w.writeframes(raw)
    os.replace(tmp, dest)
    log[u["id"]] = {
        "id": u["id"], "status": "extracted", "language": u["language"],
        "audio_file": str(dest.relative_to(SPIKE)).replace("\\", "/"),
        "samples": u["samples"], "duration_seconds": u["duration_seconds"],
        "flac_bytes": len(flac), "wav_bytes": dest.stat().st_size, "md5_verified": md5_ok,
        "wav_sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
    }


def process_page(rel, grp, page_idx):
    loc = grp["pages"][page_idx]
    page = fs.cat_file(BASE + rel, start=loc["offset"], end=loc["offset"] + loc["size"])
    with lock:
        fetched["page_bytes"] += len(page)
        fetched["pages"] += 1
    nxt = grp["pages"][page_idx + 1]["first_row"] if page_idx + 1 < len(grp["pages"]) else grp["rows"]
    vals = values_in_page(page)
    if len(vals) != nxt - loc["first_row"]:
        raise ValueError(f"{rel} rg{grp['rg']} page{page_idx}: {len(vals)} values vs {nxt - loc['first_row']} rows")
    for i, flac in vals:
        row = grp["row_base"] + loc["first_row"] + i
        u = by_file[rel].get(row)
        if u is not None and u.get("_pq_ok"):
            with lock:
                handle_clip(u, flac)


def verify_parquet(rel, rows):
    """Checks 1 and the parquet half of 2, read from the official file."""
    with fs.open(BASE + rel, "rb", block_size=256 * 1024) as fh:
        t = pq.ParquetFile(fh).read(columns=["audio_filepath.path", "samples"])
    paths = [a["path"] for a in t.column("audio_filepath").to_pylist()]
    samples = t.column("samples").to_pylist()
    for r, u in rows.items():
        u["_pq_ok"] = (paths[r] == u["audio_name_in_parquet"] and samples[r] == u["samples"])
        if not u["_pq_ok"]:
            fail(u, f"parquet mismatch: path={paths[r]!r} samples={samples[r]}")


def run_file(rel):
    rows = by_file[rel]
    verify_parquet(rel, rows)
    groups, need = page_plan(rel, rows)
    for g, pi in need:
        process_page(rel, groups[g], pi)


errors = []
with ThreadPoolExecutor(max_workers=8) as ex:
    futures = {ex.submit(run_file, rel): rel for rel in by_file}
    for fut in as_completed(futures):
        try:
            fut.result()
        except Exception as e:
            errors.append(f"{futures[fut]}: {e!r}")

for u in manifest["utterances"]:
    if u["id"] not in log:
        fail(u, "row not reached in any fetched page")

extracted = [v for v in log.values() if v["status"] == "extracted"]
summary = {
    "manifest": MANIFEST.name, "manifest_sha256": FROZEN_SHA, "revision": REV,
    "source_files": len(by_file), "pages_fetched": fetched["pages"],
    "page_bytes_fetched": fetched["page_bytes"], "index_bytes_fetched": fetched["index_bytes"],
    "file_errors": errors,
    "requested": len(manifest["utterances"]),
    "extracted": len(extracted),
    "failed": sum(v["status"] == "failed" for v in log.values()),
    "md5_verified": sum(v.get("md5_verified") is True for v in extracted),
    "md5_absent": sum(v.get("md5_verified") is None for v in extracted),
    "by_language": {l: sum(v["language"] == l for v in extracted) for l in ("kn", "hi")},
    "audio_seconds": round(sum(v["duration_seconds"] for v in extracted), 1),
    "failures": [v for v in log.values() if v["status"] == "failed"],
    "output_format": "WAV, RIFF PCM 16-bit little-endian, 16000 Hz, mono",
    "method": "page-level HTTP range reads of the audio_filepath.bytes column using the parquet "
              "OffsetIndex; no source parquet file written to disk",
}
order = [u["id"] for u in manifest["utterances"]]
with open(INDEX_FILE, "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"summary": summary, "clips": [log[i] for i in order]}, fh, ensure_ascii=False, indent=1)
    fh.write("\n")
print(json.dumps({k: v for k, v in summary.items() if k != "failures"}, indent=1))
print("failures:", json.dumps(summary["failures"], indent=1)[:2000])
print("manifest sha256 unchanged:", hashlib.sha256(MANIFEST.read_bytes()).hexdigest() == FROZEN_SHA)
