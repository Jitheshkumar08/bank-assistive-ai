from functools import lru_cache

from sentence_transformers import SentenceTransformer

#: The one sentence encoder the engine uses, shared by intent detection and
#: every domain's knowledge retrieval. Named so embedding caches can record
#: which model produced their vectors.
EMBEDDING_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    return SentenceTransformer(EMBEDDING_MODEL_NAME)
