import os
import time
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING, MongoClient, ReturnDocument

MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "KorczakControl").strip() or "KorczakControl"
COLLECTION_NAME = os.getenv("MONGODB_RATE_COLLECTION", "RateLimits").strip() or "RateLimits"
WINDOW = max(60, int(os.getenv("RATE_WINDOW", "60")))

_client = None
_collection = None
_fallback = {}


def _get_collection():
    global _client, _collection
    if not MONGODB_URI:
        return None
    if _collection is None:
        _client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=2000,
            connectTimeoutMS=2000,
            socketTimeoutMS=3000,
            appname="KorczakAI-RateLimit",
        )
        _collection = _client[MONGODB_DATABASE][COLLECTION_NAME]
        _collection.create_index("expires_at", expireAfterSeconds=0)
        _collection.create_index([("key", ASCENDING), ("window", ASCENDING)], unique=True)
    return _collection


def allow(key, limit):
    limit = max(1, int(limit))
    window = int(time.time() // WINDOW)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=WINDOW * 2)
    collection = _get_collection()
    if collection is not None:
        doc = collection.find_one_and_update(
            {"key": str(key)[:300], "window": window},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": expires_at}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
            projection={"count": 1},
        )
        return int(doc.get("count", limit + 1)) <= limit

    # Development fallback only; production always supplies MongoDB.
    now = time.monotonic()
    bucket = _fallback.setdefault(str(key)[:300], [])
    cutoff = now - WINDOW
    bucket[:] = [stamp for stamp in bucket if stamp > cutoff]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    if len(_fallback) > 10_000:
        for stale in list(_fallback)[:1_000]:
            if not _fallback[stale]:
                _fallback.pop(stale, None)
    return True
