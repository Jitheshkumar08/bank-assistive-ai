from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

from .intents import INTENTS

class IntentDetector:
    def __init__(self):
        print("Loading multilingual model... (first time will take time)")
        
        self.model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
        
        # Precompute intent embeddings
        self.intent_embeddings = self.model.encode(INTENTS)

        print("Model loaded successfully ✅")

    def detect_intent(self, text: str):
        user_embedding = self.model.encode([text])

        scores = cosine_similarity(user_embedding, self.intent_embeddings)[0]

        best_idx = int(np.argmax(scores))
        confidence = float(scores[best_idx])

        return {
            "intent": INTENTS[best_idx],
            "confidence": round(confidence, 3)
        }