# Design: Location API Caching Solutions

## Overview

This document presents multiple design approaches to fix the single-slot caching bug in the location service. Each approach has different trade-offs in complexity, memory usage, and effectiveness.

---

## Option A: Per-User Cache (Map by User ID)

### Description

Replace single-slot cache with a Map keyed by user/session ID. Each user gets their own independent cache entry.

### Implementation

```typescript
const geocodingCacheByUser = new Map<string, GeocodingCache>();
const timezoneCacheByUser = new Map<string, TimezoneCache>();

class LocationService {
  constructor(private sessionId: string) {}

  private getGeocodingCache(): GeocodingCache | null {
    return geocodingCacheByUser.get(this.sessionId) || null;
  }

  private setGeocodingCache(cache: GeocodingCache): void {
    geocodingCacheByUser.set(this.sessionId, cache);
  }
}
```

### Eviction Strategy

- Delete cache entry when session ends (onStop callback)
- Optional: LRU eviction if map exceeds max size (e.g., 10,000 entries)

### Pros

- Simple to implement
- Perfect cache isolation between users
- Cache persists across location updates for same user
- Easy to reason about

### Cons

- Memory scales with active users (O(n))
- Need to clean up when sessions end
- Doesn't benefit from geographic locality (User A and User B in same building both make API calls)

### Memory Estimate

- ~500 bytes per cache entry × 2 caches × 1,000 users = ~1 MB

---

## Option B: Geographic Grid Cache (Map by Location Grid Cell)

### Description

Cache by geographic grid cell rather than by user. Multiple users in the same area share cache entries.

### Implementation

```typescript
interface GridCacheEntry extends GeocodingCache {
  hits: number;
  lastAccess: number;
}

const geocodingCacheByGrid = new Map<string, GridCacheEntry>();

// Grid cell size: 0.01° ≈ 1.1km at equator
function getGridKey(lat: number, lng: number): string {
  const gridLat = Math.floor(lat * 100) / 100;
  const gridLng = Math.floor(lng * 100) / 100;
  return `${gridLat.toFixed(2)},${gridLng.toFixed(2)}`;
}

function getCachedGeocoding(lat: number, lng: number): GeocodingCache | null {
  const key = getGridKey(lat, lng);
  const entry = geocodingCacheByGrid.get(key);
  
  if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
    entry.hits++;
    entry.lastAccess = Date.now();
    return entry;
  }
  return null;
}
```

### Eviction Strategy

- LRU eviction when map exceeds max size
- TTL-based expiration on access

### Pros

- Multiple users in same area share cache (conferences, offices, cities)
- Memory bounded by geography, not users
- Better cache hit rate in high-density areas
- No need to track session lifecycle

### Cons

- Slightly more complex key generation
- Edge cases at grid cell boundaries (user at 37.999 vs 38.001)
- Less predictable memory usage

### Memory Estimate

- Earth surface ≈ 510 million km² → 510 million potential grid cells
- In practice: only populated areas cached, ~10,000-100,000 active cells max
- ~500 bytes × 100,000 = ~50 MB worst case (typically much less)

---

## Option C: Two-Tier Cache (User + Geographic)

### Description

Combine both approaches: check user cache first (fast, personalized), fall back to geographic cache (shared benefit).

### Implementation

```typescript
// Tier 1: Per-user cache (small, fast)
const userCache = new Map<string, GeocodingCache>();

// Tier 2: Geographic grid cache (shared, larger)
const gridCache = new Map<string, GeocodingCache>();

async function getGeocoding(sessionId: string, lat: number, lng: number): Promise<GeocodingCache> {
  // Tier 1: Check user's personal cache
  const userEntry = userCache.get(sessionId);
  if (userEntry && isValidForLocation(userEntry, lat, lng)) {
    stats.userCacheHits++;
    return userEntry;
  }

  // Tier 2: Check geographic grid cache
  const gridKey = getGridKey(lat, lng);
  const gridEntry = gridCache.get(gridKey);
  if (gridEntry && !isExpired(gridEntry)) {
    stats.gridCacheHits++;
    // Also store in user cache for faster subsequent lookups
    userCache.set(sessionId, gridEntry);
    return gridEntry;
  }

  // Cache miss: fetch from API
  stats.cacheMisses++;
  const result = await fetchFromApi(lat, lng);
  
  // Store in both caches
  userCache.set(sessionId, result);
  gridCache.set(gridKey, result);
  
  return result;
}
```

### Pros

- Best of both worlds
- Excellent cache hit rate
- Users benefit from nearby users' API calls
- Fast lookups for repeat requests from same user

### Cons

- Most complex implementation
- Two caches to manage and evict
- Potential consistency issues between tiers

---

## Option D: Current Implementation (Single-Slot) - Baseline

### Description

The existing implementation with one global cache slot.

```typescript
let geocodingCache: GeocodingCache | null = null;
let timezoneCache: TimezoneCache | null = null;
```

### Pros

- Simplest possible implementation
- Zero memory growth
- Works well for single-user testing

### Cons

- **Fundamentally broken for multi-user production use**
- Near-zero cache hit rate with concurrent users
- Causes the $1000/day API cost problem

### Verdict

**Not acceptable for production.** Only included for comparison.

---

## Option E: External Cache (Redis)

### Description

Use Redis for distributed caching across multiple server instances.

### Implementation

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function getCachedGeocoding(lat: number, lng: number): Promise<GeocodingCache | null> {
  const key = `geocode:${getGridKey(lat, lng)}`;
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

async function setCachedGeocoding(lat: number, lng: number, data: GeocodingCache): Promise<void> {
  const key = `geocode:${getGridKey(lat, lng)}`;
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}
```

### Pros

- Works across multiple server instances (horizontal scaling)
- Automatic TTL expiration built-in
- Persistent across server restarts
- Can set memory limits at Redis level

### Cons

- External dependency (Redis)
- Network latency for cache lookups (~1-5ms)
- Additional infrastructure cost
- Overkill for single-server deployment

### When to Use

Only if Mentra AI runs on multiple server instances that need to share cache.

---

## Comparison Matrix

| Criteria | A: Per-User | B: Grid | C: Two-Tier | D: Current | E: Redis |
|----------|-------------|---------|-------------|------------|----------|
| Implementation complexity | Low | Medium | High | Trivial | Medium |
| Multi-user support | ✅ | ✅ | ✅ | ❌ | ✅ |
| Geographic sharing | ❌ | ✅ | ✅ | ❌ | ✅ |
| Memory efficiency | Medium | High | Medium | Best | N/A |
| Multi-server support | ❌ | ❌ | ❌ | ❌ | ✅ |
| Requires cleanup | Yes | No | Yes | No | No |
| Expected hit rate | 90% | 85% | 95% | 5% | 95% |

---

## Recommendation

### For Immediate Fix: **Option A (Per-User Cache)**

**Rationale:**
- Simplest fix that solves the core problem
- Low risk of introducing bugs
- Can be implemented in <30 minutes
- Memory usage is acceptable for expected user count

### For Future Enhancement: **Option B (Geographic Grid Cache)**

**Rationale:**
- Better long-term solution as user base grows
- Users at conferences/events benefit from shared cache
- No session lifecycle management needed

### Implementation Priority

1. **Phase 1 (Now):** Implement Option A to stop the bleeding
2. **Phase 2 (Later):** Consider Option B or C if:
   - User base grows significantly
   - Analytics show many users in same geographic areas
   - Memory becomes a concern

---

## Implementation Checklist (Option A)

- [ ] Replace `let geocodingCache` with `Map<string, GeocodingCache>`
- [ ] Replace `let timezoneCache` with `Map<string, TimezoneCache>`
- [ ] Update `isGeocodingCacheValid()` to take sessionId parameter
- [ ] Update `isTimezoneCacheValid()` to take sessionId parameter
- [ ] Pass sessionId through all cache access methods
- [ ] Add cache cleanup in session termination handler
- [ ] Add cache size monitoring/logging
- [ ] Optional: Add LRU eviction if map exceeds 10,000 entries
- [ ] Update `getApiCallStats()` to include cache size metrics
- [ ] Test with multiple concurrent simulated users

---

## Appendix: Reference Implementation

The Dashboard app has a well-implemented weather caching system that demonstrates **Option C (Two-Tier Cache)** in production. This can serve as a reference for implementing location caching in Mentra AI.

### Dashboard Weather Service (`apps/Dashboard/src/services/weather.service.ts`)

```typescript
// Two-tier caching: per-user + shared geographic
export class WeatherService {
  // Tier 1: Per-user cache (fast, personalized)
  private perUserCache = new Map<string, CacheEntry>();

  // Tier 2: Shared cross-user proximity cache with LRU eviction
  private sharedCache = new Map<BucketKey, CacheEntry>();
  private sharedLRU: BucketKey[] = [];

  public async getWeather(session: AppSession, lat: number, long: number) {
    // 1) Check per-user cache first
    const userEntry = this.perUserCache.get(session.userId);
    if (userEntry && userEntry.expiresAt > currentTime) {
      if (this.withinKm(userEntry, { lat, lon: long }, PROXIMITY_KM)) {
        return userEntry.weatherSummary; // Cache hit!
      }
    }

    // 2) Check shared geographic cache (bucket-based using geohash)
    const bucketKey = geohash.encode(lat, long, 5); // ~5km precision
    let sharedEntry = this.sharedCache.get(bucketKey);
    if (sharedEntry && sharedEntry.expiresAt > currentTime) {
      // Also check neighbor buckets to reduce boundary misses
      this.perUserCache.set(session.userId, sharedEntry); // Hydrate user cache
      return sharedEntry.weatherSummary;
    }

    // 3) API call, then store in both caches
    const summary = await this.fetchFromApi(lat, long);
    this.upsertSharedCache(entry);
    this.perUserCache.set(session.userId, entry);
    return summary;
  }

  // LRU eviction for shared cache (max 1000 entries)
  private upsertSharedCache(entry: CacheEntry) {
    this.sharedCache.set(entry.bucketKey, entry);
    // Move to end of LRU list
    const idx = this.sharedLRU.indexOf(entry.bucketKey);
    if (idx >= 0) this.sharedLRU.splice(idx, 1);
    this.sharedLRU.push(entry.bucketKey);
    // Evict oldest if over limit
    while (this.sharedLRU.length > MAX_SHARED_CACHE_ENTRIES) {
      const evict = this.sharedLRU.shift()!;
      this.sharedCache.delete(evict);
    }
  }
}
```

### Key Design Patterns from Dashboard

| Feature | Implementation |
|---------|----------------|
| Per-user cache | `Map<userId, CacheEntry>` |
| Geographic bucketing | `geohash.encode(lat, lng, 5)` (~5km cells) |
| Neighbor checking | `geohash.neighbors(bucketKey)` to reduce boundary misses |
| Distance validation | Haversine formula with 5km threshold |
| LRU eviction | Array-based tracking, max 1000 entries |
| TTL | 10 minute expiration (`expiresAt` timestamp) |
| Cache hydration | Shared cache hits populate user cache |

This is essentially **Option C** implemented well. For Mentra AI's location caching, we can start with the simpler **Option A** (per-user only) and evolve to this pattern if needed.