# Issue 001: Location API Caching Bug

**Status:** Open  
**Priority:** Critical (Cost Impact)  
**Discovered:** 2025-01-27

## Summary

The location service uses single-slot caching that gets overwritten by concurrent users, causing near-zero cache hit rates and ~$1000/day in unnecessary GCP API costs.

## Documents

| Document | Description |
|----------|-------------|
| [spec.md](./spec.md) | Problem statement, impact analysis, and success criteria |
| [design.md](./design.md) | Solution proposals with trade-offs and recommendations |

## Quick Context

**The Bug:**
```typescript
// Current: ONE cache slot for ALL users
let geocodingCache: GeocodingCache | null = null;
```

**The Impact:**
- 100 users in different locations constantly overwrite each other's cache
- Cache hit rate drops from expected 90% to actual ~5%
- API costs: ~$1000/day instead of ~$50/day

**The Fix (Recommended):**
```typescript
// Proposed: One cache slot PER user
const geocodingCacheByUser = new Map<string, GeocodingCache>();
```

## Affected Files

- `src/server/manager/location.service.ts`

## Cost Analysis

| Scenario | Daily API Cost |
|----------|---------------|
| Current (broken cache) | ~$400-1000 |
| With proper per-user cache | ~$25-50 |
| **Savings** | **~$350-950/day** |

## Recommendation

Implement **Option A: Per-User Cache** from the design doc as an immediate fix. It's the simplest solution that solves the core problem with minimal risk.

## Related

- GCP Billing Dashboard
- Google Maps API Console