# Design: Location API Caching Solution

## Overview

This document presents the recommended solution for fixing the single-slot caching bug in the location service.

---

## Solution: Per-User Cache

### Description

Replace the single-slot cache with a Map keyed by user/session ID. Each user gets their own independent cache entry.

### Current (Broken)

```typescript
// ONE cache slot for ALL users - gets constantly overwritten
let geocodingCache: GeocodingCache | null = null;
let timezoneCache: TimezoneCache | null = null;
```

### Proposed Fix

```typescript
// One cache slot PER user - no collisions
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

### Cache Invalidation (Keep Existing Logic)

The current invalidation logic is good and should be preserved:

- **Geocoding cache:** 10 minute TTL, invalidates if user moves >100m
- **Timezone cache:** 12 hour TTL, invalidates if user moves >10km

### Eviction Strategy

- Delete cache entry when session ends (in `onStop` callback)
- Optional: Add max size limit with LRU eviction if needed later

### Why This Works

| Scenario | Before (Single-Slot) | After (Per-User) |
|----------|---------------------|------------------|
| User A updates location | Cache = A | Cache[A] = A |
| User B updates location | Cache = B (overwrites A!) | Cache[B] = B |
| User A updates again | Cache = A (API call!) | Cache[A] still valid ✓ |

### Memory Estimate

- ~500 bytes per cache entry × 2 caches × 1,000 users = ~1 MB
- Negligible memory impact

---

## Implementation Checklist

- [ ] Replace `let geocodingCache` with `Map<string, GeocodingCache>`
- [ ] Replace `let timezoneCache` with `Map<string, TimezoneCache>`
- [ ] Update `isGeocodingCacheValid()` to take sessionId and look up from Map
- [ ] Update `isTimezoneCacheValid()` to take sessionId and look up from Map
- [ ] Update cache writes to use `map.set(sessionId, cache)`
- [ ] Add cache cleanup when session ends
- [ ] Update `getApiCallStats()` to include cache size: `geocodingCacheByUser.size`
- [ ] Test with multiple concurrent users

---

## Reference: Dashboard Weather Service

The Dashboard app has a production-tested caching implementation in `apps/Dashboard/src/services/weather.service.ts` that demonstrates similar patterns:

```typescript
export class WeatherService {
  // Per-user cache
  private perUserCache = new Map<string, CacheEntry>();

  public async getWeather(session: AppSession, lat: number, long: number) {
    const userId = session.userId;
    
    // Check per-user cache first
    const userEntry = this.perUserCache.get(userId);
    if (userEntry && userEntry.expiresAt > Date.now()) {
      if (this.withinKm(userEntry, { lat, lon: long }, PROXIMITY_KM)) {
        return userEntry.weatherSummary; // Cache hit!
      }
    }

    // Cache miss: fetch from API
    const summary = await this.fetchFromApi(lat, long);
    this.perUserCache.set(userId, entry);
    return summary;
  }

  // Cleanup when user disconnects
  public clearUser(userId: string) {
    this.perUserCache.delete(userId);
  }
}
```

### Key Patterns

| Feature | Implementation |
|---------|----------------|
| Per-user isolation | `Map<userId, CacheEntry>` |
| TTL expiration | `expiresAt` timestamp check |
| Distance validation | Haversine formula for proximity |
| Session cleanup | `clearUser(userId)` on disconnect |

The location service fix follows this same proven pattern.