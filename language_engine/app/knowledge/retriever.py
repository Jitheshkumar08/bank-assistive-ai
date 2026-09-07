from sentence_transformers import SentenceTransformer
from app.knowledge.loader import KnowledgeLoader


class KnowledgeRetriever:

    def __init__(self):

        print("Loading knowledge retrieval model...")

        self.model = SentenceTransformer(
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        )

        self.loader = KnowledgeLoader()

        self.documents = self.loader.load_documents()

        self.document_embeddings = self.model.encode(
            [
                document["content"]
                for document in self.documents
            ],
            normalize_embeddings=True
        )

        print(
            f"Knowledge Retriever Ready ✅ "
            f"({len(self.documents)} documents)"
        )

    def search(self, query, top_k=2):

        query_embedding = self.model.encode(
            query,
            normalize_embeddings=True
        )

        scores = self.document_embeddings @ query_embedding

        ranked_indices = scores.argsort()[::-1][:top_k]

        results = []

        for index in ranked_indices:

            results.append({
                "source": self.documents[index]["source"],
                "content": self.documents[index]["content"],
                "score": float(scores[index])
            })

        return results