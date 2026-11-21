"""Validate a domain's knowledge collection and pre-build its embeddings.

    python -m app.knowledge.ingest --domain college
    python -m app.knowledge.ingest --domain college --hash nmamit/fees.md
    python -m app.knowledge.ingest --domain college --check

Default: validates the manifest, then builds each institution's retriever
through the embedding cache -- only new or edited text is encoded -- and
reports what was encoded and reused. Only verified documents are built;
production never serves anything else.

--hash  prints the SHA-256 to record in a verified entry, after someone has
        compared the file with the official source.
--check validates only; no model is loaded.

Exit status: 0 ok, 1 invalid manifest, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import sys

from app.domains import UnknownDomainError, get_domain
from app.knowledge.collection import KnowledgeCollection, ManifestError, file_sha256
from app.knowledge.domain_retrieval import DomainKnowledgeBase
from app.knowledge.unanswered_log import UnansweredLog


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--hash", metavar="PATH", help="path relative to the collection's documents/")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    try:
        config = get_domain(args.domain)
    except UnknownDomainError:
        print(f"Unknown domain: {args.domain}")
        return 2

    if config.knowledge is None:
        print(f"Domain {config.id!r} uses the built-in knowledge base; nothing to ingest.")
        return 2

    if args.hash:
        root = config.knowledge.manifest.parent / "documents"
        target = (root / args.hash).resolve()
        if root.resolve() not in target.parents or not target.is_file():
            print("File not found inside the collection's documents/ directory.")
            return 2
        print(file_sha256(target))
        return 0

    try:
        collection = KnowledgeCollection(config.knowledge.manifest, config.id)
    except ManifestError as error:
        print("Manifest invalid:")
        for problem in error.problems:
            print(f"  - {problem}")
        return 1

    verified = [d for d in collection.documents if d.verified]
    print(f"{config.id}: {len(collection.documents)} documents listed, {len(verified)} verified, "
          f"institutions: {', '.join(collection.institutions()) or 'none'}")

    if args.check or not verified:
        return 0

    base = DomainKnowledgeBase.for_domain(config, unanswered_log=UnansweredLog(enabled=False))
    for institution in sorted({d.institution_id for d in verified}):
        base.retriever_for(institution)
        cache = base.cache_for(institution)
        print(f"  {institution}: encoded {cache.total_encoded} new texts, reused {cache.total_reused} "
              f"-> {cache.path.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
