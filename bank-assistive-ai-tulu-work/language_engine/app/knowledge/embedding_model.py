"""The shared sentence-embedding model (knowledge retrieval and intent detection).

Phase 3A: loaded from the local Hugging Face cache first. Without that, every
start contacted huggingface.co to check for a newer revision -- 22 connection
attempts, measured with the network blocked -- before falling back to the
cache, so an offline start waited on those attempts. When the model is not
cached yet (first run on a new machine), the original load runs and downloads
it, exactly as before.
"""

from functools import lru_cache

from sentence_transformers import SentenceTransformer

#: The one sentence encoder the engine uses, shared by intent detection and
#: every domain's knowledge retrieval. Named so embedding caches can record
#: which model produced their vectors.
EMBEDDING_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
#: The name the knowledge modules restored from the 6 November stash use.
MODEL_NAME = EMBEDDING_MODEL_NAME


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    try:
        return SentenceTransformer(EMBEDDING_MODEL_NAME, local_files_only=True)
    except Exception:   # not cached (or an incomplete cache): the original behaviour
        return SentenceTransformer(EMBEDDING_MODEL_NAME)
