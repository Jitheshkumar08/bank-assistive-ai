from pathlib import Path


class KnowledgeLoader:

    def __init__(self):
        self.documents_path = (
            Path(__file__).parent / "documents"
        )

    def load_documents(self):
        documents = []

        for file_path in self.documents_path.glob("*.md"):

            content = file_path.read_text(
                encoding="utf-8"
            )

            documents.append({
                "source": file_path.name,
                "content": content
            })

        return documents