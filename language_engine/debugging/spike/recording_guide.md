# Phase 3.2B-7 — Recording Guide

For whoever is recording the Kannada and Hindi corpus. Read this once
before you start; it takes about 20 minutes to record 30 utterances.

**You do not need a studio.** We want realistic student and customer
speech, not laboratory speech. A quiet room and a normal laptop or phone
microphone is exactly right. A recording that sounds too perfect is less
useful to us than one that sounds like someone standing in a bank.

## What you need

- A quiet room. Close the window, turn off the fan if it is loud.
- A laptop or phone microphone. Headset mics are fine. No studio gear.
- The utterance list for your language from `corpus_metadata.json` —
  the `reference_transcript` field of each entry.

## Settings

| Setting | Value | Why |
|---|---|---|
| Format | **WAV** | No lossy compression before the ASR sees it |
| Sample rate | **16000 Hz** | What Whisper wants, and what `recorder.py:117` already captures |
| Channels | **Mono** | Stereo is discarded downstream anyway |
| Bit depth | 16-bit PCM | Ordinary; float32 also fine |

If your recorder cannot do 16 kHz, record at 44.1 or 48 kHz and say so —
the benchmark resamples, and it is better to have the recording than to
spend an hour fighting settings.

## How to speak

- **One utterance per file.** Not one file with all thirty.
- **Speak naturally, at your normal speed.** Do not slow down for the
  microphone, do not over-enunciate, do not "read aloud" in a
  presentation voice.
- **Use your natural pronunciation.** Your regional accent is the point.
  Do not imitate a news reader.
- **Leave about half a second of silence** at the start and end. Do not
  clip the first syllable — a cut-off "ತೆ" is how "ತೆಗೆಯಬೇಕು" becomes
  something else entirely.
- **Do not shout.** If the waveform looks flat-topped, you are clipping;
  move back from the mic and redo it.
- **Redo a fluffed take.** A stumble, a cough, a laugh — just record it
  again. Do not edit files.

## Two things that need specific care

**1. Read identifier digits AS DIGITS.**

For `kn_011`, `kn_012`, `hi_011`, `hi_012` — the account and phone
numbers — read each digit separately:

> "one two three four five six seven eight nine zero"
> or "ಒಂದು ಎರಡು ಮೂರು..." / "एक दो तीन..."

whichever is natural for you. Do **not** say "one billion two hundred
thirty-four million...".

If you read them as number words rather than digits, say so in the
`notes` field. The evaluator folds Kannada and Devanagari numerals to
ASCII but does not convert spoken number *words*, and it will report
that case as `spoken_digit_words` rather than scoring it as a silent
failure.

**2. Code-mix naturally.**

For `kn_028`–`kn_030` and `hi_028`–`hi_030`, the English banking terms
are written in English on purpose:

> ನನಗೆ **account number** fill ಮಾಡಬೇಕು
> मुझे **cheque book** चाहिए

Say those terms the way you actually say them in conversation — with
your normal Indian-English pronunciation, embedded in the regional
sentence. **Do not translate them into Kannada or Hindi**, and do not
switch to a British or American accent for the English words. This
category exists precisely to measure what happens to real code-switched
speech, so an artificially "clean" version measures nothing.

Honestly: if any of the other sentences feel stiff or unnatural to you
as a native speaker, say it the way you would really say it and record
what you actually said in the `notes` field. A natural utterance with a
corrected reference is worth more than a stilted one that matches the
script.

## Naming and saving

Save each file as its utterance id:

```
language_engine/debugging/spike/corpus/audio/kn/kn_001.wav
language_engine/debugging/spike/corpus/audio/hi/hi_001.wav
```

The directories already exist.

## After recording

For each utterance you recorded, edit `corpus_metadata.json`:

- `audio_status` → `"recorded"`
- `speaker_id` → e.g. `"speaker_01"` (a label, **not** a real name)
- `duration_seconds` → the file's length, e.g. `2.4`
- `notes` → anything unusual: a different wording you used, digits read
  as words, background noise you could not avoid

Then run:

```powershell
cd language_engine
$env:PYTHONIOENCODING = "utf-8"
.\venv\Scripts\python.exe -m debugging.spike.benchmark_asr
```

The runner picks up whatever is present. You do not need all 60 before
it is useful — 10 per language already produces per-category numbers,
and partial results are reported as partial rather than extrapolated.

## Privacy

- **Never record a real account number, phone number, or customer name.**
  The corpus uses synthetic placeholders (`1234567890`, `9876543210`,
  and invented names) for exactly this reason.
- `speaker_id` is a label like `speaker_01`. Do not put a real name in it.
- These recordings are voice data. Keep them inside the repository
  working tree, do not upload them to a third-party transcription or
  storage service, and check with the team before committing audio —
  `.gitignore` currently ignores `*.wav` at both levels, so recordings
  will not be committed by accident.

## How many speakers

More than one, if you can. Two or three speakers per language tells us
whether a result is about the language or about one person's voice. One
speaker per language is still a usable starting point — note the limit
rather than skipping the corpus.
