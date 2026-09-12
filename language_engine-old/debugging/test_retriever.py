from app.knowledge.retriever import KnowledgeRetriever


retriever = KnowledgeRetriever()


queries = [
    "Where do I submit my withdrawal slip?",
    "I want to know about getting a loan",
    "How can I open a new account?",
    "Where do I give my deposit form?"
]


for query in queries:

    print("\n=============================")
    print("QUERY:", query)

    results = retriever.search(
        query,
        top_k=2
    )

    for result in results:

        print("\nSOURCE:", result["source"])
        print("SCORE:", round(result["score"], 3))
        print("CONTENT:")
        print(result["content"][:250])