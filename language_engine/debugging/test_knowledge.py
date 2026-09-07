from app.knowledge.loader import KnowledgeLoader


loader = KnowledgeLoader()

documents = loader.load_documents()

print(f"Loaded documents: {len(documents)}")

for document in documents:

    print("\n-----------------------------")
    print("SOURCE:", document["source"])
    print(document["content"][:300])