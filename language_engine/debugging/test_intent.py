from app.intent.detector import IntentDetector

detector = IntentDetector()

tests = [
    "nanage hana hakbeku",             # Kannada
    "mujhe paise jama karna hai",     # Hindi
    "I want to deposit money",        # English
    "nanage balance check madbeku"    # Mixed
]

for t in tests:
    result = detector.detect_intent(t)
    print(f"\nInput: {t}")
    print("Output:", result)