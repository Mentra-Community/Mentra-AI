# Issue 001: Location API Caching Bug

## Problem Statement

The Mentra AI (Mira) app is incurring excessive Google Cloud Platform costs (~$1000/day vs expected ~$5/day) due to inefficient caching of geocoding and timezone API calls.

### Root Cause

The current implementation uses **module-level single-value caching**, meaning only ONE geocoding result and ONE timezone result can be cached at a time for the entire server process.

```typescript
// Current implementation - only stores ONE value
let geocodingCache: GeocodingCache | null = null;
let timezoneCache: TimezoneCache | null = null;
```

### Impact

With multiple concurrent users in different locations:

1. User A (San Francisco) triggers location update → API call → cache stores SF
2. User B (New York) triggers location update → cache miss (NY ≠ SF) → API call → cache stores NY, **overwrites SF**
3. User A gets another update → cache miss (SF ≠ NY) → API call → **overwrites NY**
4. Repeat infinitely...

**Result:** Every user constantly overwrites each other's cache, causing near-zero cache hit rate with multiple active users.

### Cost Analysis

| Scenario | API Calls/Hour | Daily Cost (8hr active) |
|----------|---------------|------------------------|
| 1 user, no cache | ~120/user | ~$5 |
| 100 users, no cache | ~12,000 | ~$480 |
| 100 users, current "cache" | ~10,000+ | ~$400+ |
| 100 users, proper cache | ~600 | ~$24 |

The current cache only helps when a single user makes rapid consecutive requests before anyone else triggers a location update.

## APIs Affected

1. **Google Maps Geocoding API** - $5 per 1,000 requests
   - Converts lat/lng → street address, neighborhood
   
2. **Google Maps TimeZone API** - $5 per 1,000 requests
   - Converts lat/lng → timezone info
   
3. **LocationIQ API** - Free tier available, used as primary/fallback
   - Geocoding: lat/lng → city, state, country
   - Timezone: lat/lng → timezone info

## Current Caching Logic

The existing implementation does have good cache invalidation logic:

- **Geocoding cache:** 10 minute TTL, invalidates if user moves >100m
- **Timezone cache:** 12 hour TTL, invalidates if user moves >10km

The problem is purely the single-slot storage, not the invalidation strategy.

## Goals

An adequate solution must:

1. **Support multiple concurrent users** - Cache should work independently for different users/locations
2. **Maintain cache invalidation logic** - Keep the existing TTL and distance-based invalidation
3. **Be memory-efficient** - Not grow unbounded; have eviction strategy
4. **Be thread-safe** - Handle concurrent requests without race conditions
5. **Provide observability** - Track cache hit/miss rates for monitoring
6. **Minimize API costs** - Target 90%+ cache hit rate for typical usage patterns

## Non-Goals

- Persistent caching across server restarts (in-memory is acceptable)
- Sub-millisecond cache lookup performance (current latency is fine)
- Caching for offline use

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Cache hit rate (single user) | ~80% | ~95% |
| Cache hit rate (100 users) | ~5% | ~90% |
| Daily API cost (100 users) | ~$400+ | <$50 |
| Memory usage | O(1) | O(n) where n = active users |

## Related Files

- `src/server/manager/location.service.ts` - Main location processing and caching
- `src/server/utils/map.util.ts` - Google Maps API wrapper
- `src/server/utils/weather.util.ts` - Weather API (also location-based)

## References

- [Google Maps Pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [LocationIQ Pricing](https://locationiq.com/pricing)