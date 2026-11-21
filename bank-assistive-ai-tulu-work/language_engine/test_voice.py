import pyttsx3

engine = pyttsx3.init()

print("\nAvailable voices:\n")

for i, voice in enumerate(engine.getProperty("voices")):
    print(f"[{i}]")
    print("Name:", voice.name)
    print("ID:", voice.id)
    print("Languages:", voice.languages)
    print("-" * 50)