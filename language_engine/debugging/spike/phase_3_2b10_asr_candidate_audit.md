# Phase 3.2B-10 — Free Indian-language ASR candidate audit

Date: 2026-09-24
Status: **audit only**. Nothing was installed, no model was downloaded, no production file was
touched, and no benchmark was run. All existing benchmark data and the frozen manifests are
unchanged.

Every factual claim below is sourced from the linked model card, dataset card or paper. Anything
that could not be verified from a primary source is written as **Not verified** rather than
guessed.

---

## 1. Executive summary

**The headline finding is not about accuracy — it is about contamination.**

The two strongest free Indian-language ASR candidates (AI4Bharat IndicConformer and IISc
SraVaani) were both trained on **IndicVoices**, which is the dataset our frozen 200-clip banking
evaluation set is drawn from — and specifically from its **train** split. The IndicVoices paper
states: *"we train a multilingual 130M conformer based model (IndicASR) … using only the
IndicVoices train set."* SraVaani's paper names IndicVoices among its fine-tuning corpora.

Consequence: **our current banking set cannot be used to compare these models against
Whisper-small.** Any win they show could be memorisation of the exact recordings. This does not
disqualify the models — it disqualifies that particular comparison.

Beyond that:

- **Whisper-small is not merely weak on Kannada, it is unusable.** All 100 Kannada banking clips
  scored WER ≥ 100%, 76% came out in the wrong script, and only 4 of 81 spoken amounts survived
  anywhere in the output. This is not a tuning problem; it needs a different model.
- **Best free general candidate: SraVaani-1.0 (IISc/ARTPARK)** — 65 Indian languages, reported
  Kannada WER 27.4% and Hindi 14.0%, and the only audited model that covers **Tulu**.
- **Strong second: IndicConformer-600M-multilingual (AI4Bharat)** — MIT, all 22 scheduled
  languages, with official ONNX and quantised exports, which is the most practical CPU path.
- **Recording our own banking speech is justified** — but for a specific, evidence-based reason.
  Our frozen IndicVoices set contains only 3 negations, 1 control command and 1 completion
  signal in 200 clips, so it is structurally incapable of measuring three of the seven
  banking-safety fields. Custom recordings are the only way to test those, and they are also the
  only contamination-free ground we have.

---

## 2. Current Whisper-small baseline (measured, not estimated)

From `indicvoices_banking_asr_results.json` (200 clips, manifest sha256 `02a77306…9427`,
openai-whisper 20250625, torch 2.11.0+cpu, AMD Ryzen 5 5600H, 6 threads, CPU only).

| Metric | Kannada | Hindi | Overall |
|---|---|---|---|
| WER | **118.1%** | 70.2% | 90.7% |
| CER | 108.3% | 41.5% | 77.1% |
| Clips with WER ≥ 100% | **100 / 100** | 7 / 100 | 107 / 200 |
| Clips with WER = 0 | 0 | 0 | 0 |
| Wrong script | **76 (76%)** | 5 (5%) | 81 |
| Empty output | 1 | 0 | 1 |
| Latency median / max | 68.3s / 522.6s | 9.2s / 990.9s | — |
| RTF median | **8.70×** | 1.17× | — |

Banking-safety metrics against the frozen first-pass annotations:

| Check | Result |
|---|---|
| Amount preserved | **4 exact / 81** (19 incorrect, 58 missing). Kannada: 0 of 38. |
| Identifier digits preserved | **2 exact / 34 measurable** (13 incorrect, 19 missing) |
| Intent cue survived | **16 / 76** (Kannada 0 of 33, Hindi 16 of 43) |
| Negation (n=3) | 1 of 3 negation tokens survived |
| Control (n=1) | `ivb_kn_024`, WER 100% |
| Completion (n=1) | `ivb_hi_097`, WER 75% |

For context, the 400-clip general set (IndicVoices *valid* split) gave Kannada WER 117.2% and
Hindi 74.2% — so the banking numbers are consistent with the general result, not an artefact of
the banking material.

**Read this plainly:** for Kannada, Whisper-small produces output that is on average longer in
errors than the reference itself, usually in the wrong script, at nearly 9× slower than real
time. It cannot support an interactive banking assistant in Kannada.

---

## 3. Free ASR candidate table

Fields marked **Not verified** were not stated on the primary source consulted.

### 3.1 SraVaani-1.0 — IISc SPIRE Lab / ARTPARK

| Field | Value |
|---|---|
| Repository | [`ARTPARK-IISc/SraVaani-1.0`](https://huggingface.co/ARTPARK-IISc/SraVaani-1.0) · [paper](https://arxiv.org/html/2608.08235v1) |
| Languages | **65 Indian languages and dialects** |
| Multilingual / specific | Multilingual (single model) |
| Kannada / Hindi | Yes / Yes — reported WER **27.4% / 14.0%** |
| Other Indian languages | Scheduled languages plus many non-scheduled; **includes Tulu** (57.3% WER on the VAANI eval set) |
| License | **Conflicting**: paper says "CC BY 4.0", HF card says "MIT". Both permit commercial use with attribution, but **verify before relying on it** |
| Model size | ~430M parameters, ~900 MB FP16 |
| Architecture | FastConformer encoder, 17 layers, dim 1024, 8 heads |
| RAM | Not verified |
| CPU feasibility | Not verified — paper does not discuss RTF or CPU inference |
| GPU requirement | GPU recommended in the usage example; CPU device selectable |
| ONNX / quantized | ONNX version stated to exist; 4 quantized derivatives |
| Python / deps | `transformers` with `trust_remote_code=True`, `torch`; training pipeline used NVIDIA NeMo |
| Gated | **Yes** — must accept conditions; HF token required |
| Training data | VAANI (31,255h pretraining, 105 languages), ~31,270h fine-tuning from 24 public datasets |
| **IndicVoices used?** | **Yes — named among the fine-tuning corpora** |
| Digital Payment Commands used? | Not stated separately, but IndicVoices includes that task, so **assume yes** |
| Banking-specific training | None claimed |
| Integration complexity | Medium — `transformers` + remote code; gated download |
| Limitations | Gated; license conflict; parameter/RTF details thin; reported Tulu WER 57.3% is poor in absolute terms |

### 3.2 IndicConformer-600M-multilingual — AI4Bharat

| Field | Value |
|---|---|
| Repository | [`ai4bharat/indic-conformer-600m-multilingual`](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual) |
| Languages | **All 22 scheduled languages** (as, bn, brx, doi, gu, hi, kn, kok, ks, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur) |
| Multilingual / specific | Multilingual; per-language models also exist (§3.3) |
| Kannada / Hindi | Yes / Yes — Hindi WER 13.2 reported on Vaani-Benchmark-V1.0 |
| License | **MIT** |
| Model size | 600M parameters |
| Architecture | Hybrid CTC + RNNT Conformer; both decoders selectable |
| RAM | Not verified |
| CPU feasibility | Plausible via ONNX; not explicitly stated |
| GPU requirement | Not stated |
| ONNX / quantized | **Yes — ONNX supported, 9 quantizations listed**. Best CPU story of the audit |
| Python / deps | `transformers`, `torchaudio`, `onnxruntime==1.20.1` |
| Gated | **Yes** — must accept conditions; HF token required |
| Training data | **Not stated on the model card** |
| **IndicVoices used?** | **Not stated on the card**, but AI4Bharat's own paper says IndicASR was trained on the IndicVoices train set, and AI4Bharat presents IndicConformer as that line of work → **treat as contaminated for IndicVoices-derived test sets** |
| Banking-specific training | None claimed |
| Integration complexity | Low-medium via ONNX runtime |
| Limitations | Gated; training data undocumented on the card; per-language WER not published on the card |

### 3.3 IndicConformer per-language (e.g. Kannada, Hindi)

| Field | Value |
|---|---|
| Repository | [`ai4bharat/indicconformer_stt_kn_hybrid_ctc_rnnt_large`](https://huggingface.co/ai4bharat/indicconformer_stt_kn_hybrid_ctc_rnnt_large) and `_hi_`, `_ta_`, `_te_`, `_ml_`, `_mr_`, `_or_`, `_pa_`, `_as_`, `_ks_` … |
| Languages | One per repo; the family spans the 22 scheduled languages |
| License | MIT |
| Model size | 120M encoder, 17 conformer blocks, dim 512 |
| Gated | **Yes** |
| Python / deps | **Requires AI4Bharat's NeMo fork**: `git clone https://github.com/AI4Bharat/NeMo.git && git checkout nemo-v2 && bash reinstall.sh` |
| ONNX | Not on the official repo; see §3.4 |
| Training data | Not stated |
| Integration complexity | **High** — a source-installed NeMo fork is a heavy, fragile dependency for a college project |
| Limitations | The fork requirement is the main blocker; smaller than the 600M multilingual model |

### 3.4 IndicConformer ONNX / sherpa export (third-party)

| Field | Value |
|---|---|
| Repository | [`meetsync/indic-conformer-onnx-sherpa`](https://huggingface.co/meetsync/indic-conformer-onnx-sherpa) |
| What it is | ONNX conversion of `ai4bharat/indicconformer_stt_hi_hybrid_ctc_rnnt_large` for mobile/CPU |
| License | MIT |
| Model size | FP32 470 MB; **INT8 188 MB** |
| CPU feasibility | **Runs with sherpa-onnx on CPU without NeMo or NVIDIA dependencies** |
| Languages | Card claims 8 languages while also describing itself as an export of the Hindi checkpoint — **internally inconsistent, Not verified** |
| Gated | Not stated |
| Integration complexity | Low — 16 kHz mono PCM in, UTF-8 text out |
| Limitations | Third-party, unofficial; language claim unverified; must be validated before trusting |

### 3.5 Whisper fine-tunes for Indian languages (vasista22 / IIT Madras)

| Field | Value |
|---|---|
| Repository | [`vasista22/whisper-kannada-medium`](https://huggingface.co/vasista22/whisper-kannada-medium), `whisper-kannada-base`, [`whisper-hindi-large-v2`](https://huggingface.co/vasista22/whisper-hindi-large-v2) |
| Languages | Language-specific (one model per language) |
| Kannada | Yes — **WER 7.65 on the Google/FLEURS test set** |
| License | **Apache 2.0** |
| Model size | Whisper-medium class (base/medium/large-v2 variants) |
| Gated | No |
| Python / deps | `transformers`, torch; optional whisper-jax |
| Training data | IISc-MILE Kannada corpus, ULCA, Shrutilipi, FLEURS train+dev |
| **IndicVoices used?** | **Not mentioned** → the most plausible *contamination-free* candidate for our IndicVoices sets |
| Banking-specific training | None claimed |
| Integration complexity | **Lowest** — same `transformers`/Whisper API shape our code already uses |
| Limitations | One model per language (does not scale to 22 by itself); the 7.65 WER is FLEURS read speech, **not** spontaneous banking speech, so it will not transfer directly |

### 3.6 IndicWhisper (AI4Bharat / Vistaar)

| Field | Value |
|---|---|
| Repository | Project: [AI4Bharat/vistaar](https://github.com/AI4Bharat/vistaar). Official single HF repo **Not verified**; several third-party re-uploads exist (`parthiv11/indic_whisper_nodcil`, `kavyamanohar/AI4B-Indicwhisper-or`) |
| Languages | 12 Indian languages (Vistaar training sets, >10,700h) |
| License | MIT (stated for IndicWhisper and the Vistaar benchmark) |
| Model size | Whisper-medium based — **Not verified** per repo |
| Training data | Vistaar train sets; whether IndicVoices is included — **Not verified** |
| Integration complexity | Low if a trustworthy checkpoint is identified |
| Limitations | Distribution is unclear; provenance of third-party re-uploads unverified. Do not adopt without confirming the checkpoint source |

### 3.7 IndicWav2Vec — AI4Bharat

| Field | Value |
|---|---|
| Repository | [`ai4bharat/indicwav2vec-hindi`](https://huggingface.co/ai4bharat/indicwav2vec-hindi), `indicwav2vec_v1_bengali`, `indicwav2vec-odia`, … |
| Languages | Language-specific, ~9 languages |
| License | Apache-2.0 reported on model cards; repo MIT — **not independently verified per repo** |
| Architecture | wav2vec2 + CTC (`AutoModelForCTC`) |
| CPU feasibility | Good — CTC greedy decoding is cheap |
| Gated | No |
| Training data | See IndicWav2Vec repo — **Not verified** |
| Limitations | Older generation than IndicConformer/SraVaani; per-language; likely weaker than the 2025-26 models |

### 3.8 Meta MMS (`facebook/mms-1b-all`)

| Field | Value |
|---|---|
| Repository | [`facebook/mms-1b-all`](https://huggingface.co/facebook/mms-1b-all) |
| Languages | 1,162 languages via per-language adapters |
| Kannada / Hindi | **Yes** (`kan`, `hin`) |
| Tulu | **`tcy` not found in the model card list** |
| License | **CC-BY-NC 4.0 — non-commercial only** |
| Model size | 1B parameters |
| Deps | `transformers >= 4.30`, torch, torchaudio |
| Integration complexity | Medium — adapter must be loaded per language |
| Limitations | **The non-commercial licence is the problem.** Fine for a college demo, but it forecloses any later commercial path, and it conflicts with priority 7 if the project is ever published |

### 3.9 Whisper large-v3 (baseline family)

| Field | Value |
|---|---|
| Repository | [`openai/whisper-large-v3`](https://huggingface.co/openai/whisper-large-v3) |
| Languages | 99; of the 22 scheduled languages Whisper covers **14** (as, bn, gu, hi, kn, ml, mr, ne, pa, sa, sd, ta, te, ur) and **omits** Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri, **Odia**, Santali |
| License | Apache 2.0 |
| Model size | 1.55B parameters |
| Gated | No |
| CPU feasibility | **Poor for our hardware.** Whisper-*small* already runs at RTF 8.7 on Kannada; large-v3 is ~10× the parameters |
| Limitations | The card itself notes lower accuracy on low-resource languages. Our measurements confirm this for Kannada |

Not audited in depth (worth a later look): `whisper-large-v3-turbo`, `faster-whisper`/CTranslate2,
`whisper.cpp`, Seamless M4T v2 (believed CC-BY-NC — **Not verified**), NVIDIA NeMo non-Indic
models. Sarvam and Google Cloud are excluded per the project constraint.

---

## 4. Indian-language coverage matrix

IC = IndicConformer-600M (22 scheduled). SV = SraVaani-1.0 (65 languages). W = Whisper.
"Eval data" = a public evaluation corpus verified in this audit (FLEURS / IndicVoices / VAANI).

| Language | IC | SV | Whisper | Best free candidate | Public eval data | Track |
|---|---|---|---|---|---|---|
| Assamese | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Bengali | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Bodo | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Dogri | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Gujarati | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| **Hindi** | ✅ | ✅ (14.0%) | ✅ | **SV / IC** | FLEURS, IndicVoices, VAANI | **Priority** |
| **Kannada** | ✅ | ✅ (27.4%) | ✅ (fails) | **SV / IC / vasista22** | FLEURS, IndicVoices, VAANI | **Priority** |
| Kashmiri | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Konkani | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Maithili | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Malayalam | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Manipuri | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Marathi | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Nepali | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Odia | ✅ | ✅ | **❌** | IC / SV | FLEURS, IndicVoices, VAANI | General — Whisper cannot do this at all |
| Punjabi | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Sanskrit | ✅ | ✅ | ✅ | IC | IndicVoices, VAANI | General |
| Santali | ✅ | ✅ | ❌ | IC | IndicVoices, VAANI | General |
| Sindhi | ✅ | ✅ | ✅ | IC | FLEURS, IndicVoices, VAANI | General |
| Tamil | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Telugu | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| Urdu | ✅ | ✅ | ✅ | IC / SV | FLEURS, IndicVoices, VAANI | General |
| **Tulu** | **❌** | **✅ (57.3%)** | **❌** | **SraVaani only** | **VAANI (has Tulu audio); our own dataset** | **Separate research track** |

Notes that matter:

- **Tulu is genuinely unsolved and stays a separate track**, exactly as you specified.
  IndicConformer does not cover it (22 scheduled languages only), Whisper does not, and MMS does
  not list `tcy`. SraVaani is the **single** audited model that covers it, at 57.3% WER — usable
  for research, not for a banking assistant. Our own Tulu dataset therefore retains its value,
  and VAANI provides additional Tulu audio under CC-BY-4.0.
- **Odia is the clearest argument against staying on Whisper**: Whisper cannot transcribe it at
  all, while both Indic models cover it.
- IndicVoices covers all 22 languages, but see §7 — it is training data for both leading
  candidates, so it is weak evaluation ground for them.

---

## 5. Model / license / dependency comparison

| Model | License | Commercial use | Gated | Size | Key dependency | Integration |
|---|---|---|---|---|---|---|
| SraVaani-1.0 | MIT *or* CC BY 4.0 (conflict) | Yes (either way) | Yes | ~430M / 900 MB | `transformers` + remote code | Medium |
| IndicConformer-600M | MIT | Yes | Yes | 600M | `transformers` + `onnxruntime` | Medium |
| IndicConformer per-lang | MIT | Yes | Yes | 120M | **AI4Bharat NeMo fork** | **High** |
| IndicConformer ONNX (3rd party) | MIT | Yes | Not stated | 188 MB int8 | `sherpa-onnx` | **Low** |
| vasista22 Whisper fine-tunes | Apache 2.0 | Yes | No | medium/large | `transformers` | **Lowest** |
| IndicWhisper (Vistaar) | MIT | Yes | Not verified | Not verified | `transformers` | Low |
| IndicWav2Vec | Apache-2.0 (reported) | Yes | No | base/large | `transformers` | Low |
| MMS-1B-all | **CC-BY-NC 4.0** | **No** | No | 1B | `transformers` | Medium |
| Whisper large-v3 | Apache 2.0 | Yes | No | 1.55B | `transformers` | Low |

Licence verdict: everything except MMS is fine for a college project *and* a future commercial
path. MMS should be treated as research-only. SraVaani's licence conflict must be resolved before
it is relied on.

---

## 6. CPU / offline feasibility

Our target machine is the one already measured: AMD Ryzen 5 5600H, CPU-only, 6 torch threads.

| Option | Parameters | Expected CPU viability |
|---|---|---|
| IndicConformer ONNX int8 (sherpa) | 120M encoder, 188 MB | **Best** — int8, no NeMo, purpose-built for mobile/CPU |
| IndicConformer-600M ONNX / quantized | 600M | Good — official quantizations exist |
| SraVaani-1.0 | ~430M | Probably workable; **RTF not documented — must be measured** |
| IndicWav2Vec | wav2vec2 + CTC | Good — cheap greedy CTC decoding |
| vasista22 whisper-medium | ~769M | Similar or worse than whisper-small's measured RTF |
| Whisper large-v3 | 1.55B | **Not viable** on this hardware |
| MMS-1B | 1B | Heavy; licence blocks it anyway |

A structural point in the Indic models' favour: **CTC/RNNT conformers do not hallucinate or loop
the way autoregressive Whisper does.** Our worst Kannada clip took 522s and one Hindi clip 991s —
that is Whisper's decoder looping, a failure mode CTC does not share. Both the accuracy and the
latency problems may improve together.

All candidates run fully offline after a one-time download. Nothing here requires a paid API.

---

## 7. Training data / provenance findings (the contamination problem)

| Model | IndicVoices in training? | Evidence |
|---|---|---|
| IndicASR / IndicConformer (AI4Bharat) | **Yes** | IndicVoices paper: *"we train a multilingual 130M conformer based model (IndicASR) … using only the IndicVoices train set"* |
| `indic-conformer-600m-multilingual` | **Not stated on the card** — assume yes | Card omits training data; same lab and model line |
| SraVaani-1.0 | **Yes** | Paper names IndicVoices among fine-tuning corpora |
| vasista22 Whisper fine-tunes | **Not mentioned** | Card names IISc-MILE, ULCA, Shrutilipi, FLEURS only |
| Whisper (OpenAI) | **Unknown/unverifiable** | 680k h of undisclosed web audio; cannot be verified either way |

Why this is decisive for us:

1. Our **banking set (200 clips) is from the IndicVoices `train` split**. That is precisely the
   data IndicASR was trained on. Testing IndicConformer or SraVaani on it would flatter them by
   an unknown margin.
2. Our **general set (400 clips) is from the `valid` split.** The paper says training used *only*
   the train set, so valid is *probably* held out — but the released 600M card documents no
   training data, so this is **Not verified**.
3. The pinned dataset revision ships **only `train` and `valid`** for Kannada and Hindi (88+2 and
   82+1 parquet shards) — **there is no public test split to fall back on.**

So there is no clean, in-dataset way to run the comparison you want. That is the finding that
should drive the next phase.

---

## 8. Public dataset availability

| Dataset | Licence | Languages | Banking content? | Use for us |
|---|---|---|---|---|
| IndicVoices | CC BY 4.0 | 22 | **Yes** — "Digital Payment Commands", 9.4K instructions per language | Already used; **contaminated** for IC/SV |
| VAANI (ARTPARK-IISc) | CC BY 4.0, gated | 105 incl. **Tulu** | Not verified | Best source for Tulu and rare languages; 2,122h transcribed of 31,278h |
| FLEURS | see card | 14 South Asian incl. Odia | No | Clean general-domain check; read speech only |
| Common Voice | CC0 | several Indian | No | Not verified in this audit |
| Shrutilipi / Kathbath / IndicSUPERB | — | 12 | No | Used in candidate training; weak eval ground |

**No public dataset provides banking speech that is clean of our candidates' training data.**
IndicVoices is the only one with genuine payments material, and both leading candidates trained
on it.

---

## 9. Custom recording requirements

Recording is justified — but not for the reason one might assume. The strongest argument is a
measurement from our own frozen set:

| Field | Coverage in the 200-clip IndicVoices banking set |
|---|---|
| negation | **3 of 200** |
| control_type | **1 of 200** (one `cancel`) |
| completion_signal | **1 of 200** (one `not_completed`) |
| amount | 81 of 200 |
| identifier | 35 rows / 40 entries |

Three of the seven banking-safety fields are **structurally unmeasurable** on the public data.
No amount of extra IndicVoices sampling fixes this, because Digital Payment Commands are
first-person requests that rarely negate, rarely issue control commands, and rarely report
completion. Our workflow depends on all three (`app/dialogue/manager.py` routes pause / resume /
cancel / repeat / next; `completion_semantics.py` resolves step completion).

So custom recordings buy us two things at once: **the only contamination-free banking evaluation**,
and **the only coverage of negation, control and completion**.

### Recommended scope (deliberately small)

| Parameter | Recommendation | Why |
|---|---|---|
| Languages, phase 1 | **Kannada + Hindi only** | Matches the existing frozen baseline so results are comparable; they are the project's demo languages |
| Utterances per language | **100–120** | Enough that each safety category has ~15–20 instances; with preservation rates as far apart as 5% vs 60%, this easily separates candidates. Hundreds per language are not justified |
| Speakers per language | **8–10** (gender-balanced, 2–3 age bands) | Speaker diversity matters more than utterance count for ASR variance; 8–10 is defensible for a college evaluation and avoids over-fitting to one voice |
| Utterances per speaker | 12–15 | Keeps any single speaker from dominating |
| Tulu | **Separate track**, reuse the existing Tulu dataset | Different research question; do not mix into the banking comparison |
| Total phase-1 effort | ~200–240 recordings | A few sessions, not a data-collection project |

### Category quotas per language (target ~110)

| Category | Count | Note |
|---|---|---|
| Amounts (round, decimal, lakh/crore, digit-by-digit) | 20 | The field Whisper fails hardest on |
| Identifiers (account, UPI, phone; incl. leading zeros, double/triple) | 20 | Digit-exactness is the core banking risk |
| Negation | 15 | **Unmeasurable today** |
| Control: pause / resume / repeat / next / cancel / exit | 18 (3 each) | **Unmeasurable today**; must match the manager's vocabulary |
| Completion / not-completed | 12 | **Unmeasurable today** |
| Code-mixed (English banking terms in regional speech) | 15 | Real users say "balance", "transfer", "UPI" in English |
| Natural conversational requests | 10 | Guards against over-fitting to command phrasing |

Record 16 kHz mono WAV to match the existing pipeline, annotate with the **existing frozen
schema** (`banking_annotation_schema.md`) so the same scoring code runs unchanged, and freeze it
the same way (manifest + SHA-256 + determinism check).

---

## 10. Recommended evaluation strategy

1. **Do not** re-use the 200-clip banking set to rank IndicConformer or SraVaani against Whisper.
   Keep it as the frozen Whisper-small baseline record and as a *contaminated-condition*
   reference point.
2. **Stage 1 — smoke test (cheap, decisive).** Run IndicConformer-600M and SraVaani on ~20
   Kannada clips. If Kannada wrong-script drops from 76% toward zero and RTF falls below ~2×, the
   direction is settled without a full run.
3. **Stage 2 — comparable general run.** Score the candidates on the frozen 400-clip *valid*-split
   set. Label results "possibly contaminated — IndicVoices provenance not verified for the 600M
   checkpoint". Still the best public comparison available.
4. **Stage 3 — clean banking run.** Score all candidates on the new custom corpus. **This is the
   number that should decide the architecture**, because it is contamination-free and covers
   negation/control/completion.
5. **Cross-check.** Include `vasista22/whisper-kannada-medium` in stage 2 — it is the one credible
   candidate with no IndicVoices in its documented training data, so it acts as a contamination
   control.
6. Reuse the frozen evaluator (`benchmark_indicvoices_banking_asr.py` scoring imports) unchanged
   so all numbers stay comparable.

---

## 11. Recommended next experiment

**One experiment, in a disposable environment, before any integration work:**

Create `language_engine/debugging/spike/asr_candidates/` with its own venv (never the project
venv). Install `transformers` + `onnxruntime` (+ `sherpa-onnx` if testing the int8 export).
Download **IndicConformer-600M (ONNX)** and **SraVaani-1.0**, both of which need an HF token and
terms acceptance. Transcribe the same 20 Kannada + 10 Hindi banking clips already on disk and
report: wrong-script rate, RTF, and whether amounts/identifiers survive.

Decision rule agreed in advance: if IndicConformer or SraVaani gets Kannada wrong-script below
~10% at RTF < 2, adopt it as the primary recogniser and demote Whisper to fallback. Success
criteria set before seeing results, so we cannot rationalise afterwards.

---

## 12. Risks and limitations

- **Contamination is unresolved and partly unresolvable.** IndicConformer's card documents no
  training data. We can reason about it, but we cannot verify it. Every IndicVoices-based number
  for these models must carry that caveat.
- **Both leading models are gated** — an HF token and manual terms acceptance are required, which
  affects reproducibility for anyone marking the project.
- **SraVaani's licence is contradictory** between paper (CC BY 4.0) and model card (MIT).
- **Reported WERs are not comparable across sources.** SraVaani's 27.4% Kannada is on its own
  evaluation mix; vasista22's 7.65% is FLEURS read speech; our 118% is spontaneous IndicVoices
  banking speech. **Only our own runs are comparable to each other.**
- **The third-party ONNX export is unverified** and its language claim is internally inconsistent.
- **The annotations remain a first-pass**, not human-verified, and the four flagged rows
  (`ivb_kn_001`, `ivb_kn_016`, `ivb_kn_072`, `ivb_hi_097`) stay flagged.
- Nothing here has been executed: no candidate has been run on our data yet.

---

## 13. Final recommendation

| Question | Answer |
|---|---|
| 1. Best free general Indian-language ASR | **SraVaani-1.0** on reported accuracy and coverage (65 languages incl. Tulu, Kannada 27.4%), with **IndicConformer-600M (MIT, ONNX/int8)** as the better-engineered, better-licensed option. **Test both in stage 1 and let our own numbers decide** |
| 2. Best free fallback | **Whisper-small via the existing `SpeechToText`** — keep it, unchanged, as the fallback and as the regression baseline. For Kannada specifically, `vasista22/whisper-kannada-medium` (Apache 2.0, ungated) is a better fallback and doubles as a contamination control |
| 3. Languages using the general model | All 22 scheduled languages via IndicConformer or SraVaani. Whisper alone cannot serve 8 of them, including Odia |
| 4. Languages needing specific models | None initially. Only adopt a language-specific model where the multilingual one measurably fails on our data — likely Kannada if the multilingual models disappoint |
| 5. Languages needing custom data | **Kannada and Hindi** for banking safety; **Tulu** for its separate track |
| 6. Should we record ourselves? | **Yes** — justified by two verified facts: no public banking corpus is clean of the candidates' training data, and our current set cannot measure negation, control or completion at all |
| 7. How many recordings? | **~110 utterances × 2 languages (Kannada, Hindi), 8–10 speakers each ≈ 220 recordings total.** Not hundreds per language |
| 8. Is fine-tuning necessary? | **No, not now.** Off-the-shelf Indic models must be measured first. Fine-tuning would also need far more data than we plan to record, and would re-introduce the contamination problem we are trying to escape |
| 9. Can the English AI core stay unchanged? | **Yes.** The proposed pipeline (regional speech → Indic ASR → regional text → translation → existing English core → translation → regional TTS) leaves `app/dialogue`, intent logic, workflows and the QR module untouched. Only the ASR layer gains a provider abstraction |

### Proposed ASR abstraction (design only — no code written)

```
SpeechRecognizer (protocol: transcribe(path, language) -> {text, language, meta})
├── WhisperRecognizer            # wraps today's SpeechToText, unchanged behaviour
├── IndicConformerRecognizer     # ONNX / sherpa-onnx, CPU
├── SraVaaniRecognizer           # transformers + remote code
└── CloudRecognizer              # later, optional, never required
```

Selection is driven by a **config table**, not by hardcoded per-language branches:
`{language: [primary, fallback]}` with a default route, so adding a language is a config edit.
Kannada and Hindi get explicit routes; everything else falls through to the multilingual model;
Tulu is unrouted until its track produces something. The recogniser returns the same dict shape
`SpeechToText.transcribe` returns today, so nothing downstream changes.

---

## Sources

- [ai4bharat/indic-conformer-600m-multilingual](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual)
- [ai4bharat/indicconformer_stt_kn_hybrid_ctc_rnnt_large](https://huggingface.co/ai4bharat/indicconformer_stt_kn_hybrid_ctc_rnnt_large)
- [IndicVoices paper (arXiv 2403.01926)](https://arxiv.org/html/2403.01926)
- [SraVaani 1.0 paper (arXiv 2608.08235)](https://arxiv.org/html/2608.08235v1) · [ARTPARK-IISc/SraVaani-1.0](https://huggingface.co/ARTPARK-IISc/SraVaani-1.0)
- [ARTPARK-IISc/Vaani dataset](https://huggingface.co/datasets/ARTPARK-IISc/Vaani)
- [meetsync/indic-conformer-onnx-sherpa](https://huggingface.co/meetsync/indic-conformer-onnx-sherpa)
- [vasista22/whisper-kannada-medium](https://huggingface.co/vasista22/whisper-kannada-medium) · [vasista22/whisper-hindi-large-v2](https://huggingface.co/vasista22/whisper-hindi-large-v2)
- [AI4Bharat/vistaar (IndicWhisper)](https://github.com/AI4Bharat/vistaar)
- [ai4bharat/indicwav2vec-hindi](https://huggingface.co/ai4bharat/indicwav2vec-hindi)
- [facebook/mms-1b-all](https://huggingface.co/facebook/mms-1b-all)
- [openai/whisper-large-v3](https://huggingface.co/openai/whisper-large-v3) · [Whisper language list](https://raw.githubusercontent.com/openai/whisper/main/whisper/tokenizer.py)
- [google/fleurs](https://huggingface.co/datasets/google/fleurs)
