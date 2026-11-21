"""Tulu (tcy) language capability for the shared language engine.

Modules
  data/           verified native-speaker dataset (read-only copy of the docx tables)
  normalization/  script detection, Romanized/Kannada-script handling, transliteration
  intent/         verified-utterance matching -> English pivot for the existing engine
  translation/    mapping-based rendering of workflow replies into verified Tulu
  tts/            new speech from Tulu text (Kannada-trained voice; not native Tulu TTS)
  asr/            Tulu speech recognition (existing acoustic model + closed-set matching)
  evaluation/     ASR, translation, TTS and end-to-end evaluation scripts
  tests/          offline tests

Banking and College reach Tulu only through the language engine's existing
interfaces (session language "tcy") and the additive /tulu routes.
"""

TULU = "tcy"
