from app.translation.translator import Translator


translator = Translator()


print("\n==============================")
print("Translation Test")
print("==============================")


text = "I want to withdraw money."

result = translator.translate(
    text=text,
    source_language="en",
    target_language="en"
)


print("Input:", text)
print("Output:", result)