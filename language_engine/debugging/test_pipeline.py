from app.pipeline.voice_pipeline import VoiceAssistantPipeline

assistant = VoiceAssistantPipeline()

result = assistant.run()

print("\n🎯 FINAL OUTPUT:", result)


