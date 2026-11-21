from sentence_transformers import SentenceTransformer, util

class ActionDetector:

    def __init__(self):
        print("Loading Action Detection Model...")
        self.model = SentenceTransformer('all-MiniLM-L6-v2')

        # Define action categories
        self.actions = {
            "next_step": [
                "next",
                "continue",
                "go ahead",
                "move forward",
                "what next",
                "proceed"
            ],
            "repeat": [
                "repeat",
                "say again",
                "come again",
                "what",
                "repeat that"
            ],
            "help": [
                "help",
                "explain",
                "what does this mean",
                "i dont understand"
            ],
            "complete": [
                "done",
                "finished",
                "filled",
                "completed",
                "i have done it",
                "i finished it"
            ]
        }

        # Precompute embeddings
        self.action_embeddings = {}
        for action, phrases in self.actions.items():
            self.action_embeddings[action] = self.model.encode(
                phrases, convert_to_tensor=True
            )

        print("Action Detector Ready ✅")

    def detect(self, text):
        text_embedding = self.model.encode(text, convert_to_tensor=True)

        best_action = None
        best_score = 0

        for action, embeddings in self.action_embeddings.items():
            scores = util.cos_sim(text_embedding, embeddings)
            max_score = scores.max().item()

            if max_score > best_score:
                best_score = max_score
                best_action = action

        # Threshold (important)
        if best_score > 0.55:
            return best_action

        return None