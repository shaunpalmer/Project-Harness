---
name: seo-directory-qualifier
description: "Use when evaluating directory/citation opportunities before submission: score local and industry relevance, trust, listing quality, duplicate risk, crawlability and likely SEO/business value, then separate worthwhile targets from noise."
whenToUse: "Use when a business has a large list of directories, citation sites, chambers, associations, community listings or backlink opportunities and needs a prioritized submission queue rather than blanket submission."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [seo, local-search, directory-submission, source-qualification]
    tags: [seo, citations, directories, backlinks, local-seo]
    stack: []
---
# SEO Directory Qualifier

Qualify citation/backlink opportunities before any browser form is filled.

## Goal

Produce a clean, prioritized queue of useful listing opportunities. Do not optimize for raw backlink count.

## Evaluate each source

Consider:
- geographic relevance to the business/service area;
- industry/service relevance;
- whether the site is a genuine directory, chamber, association, community, supplier, partner or trusted listing surface;
- whether an existing listing already exists;
- whether the listing exposes business name, address/service area, phone, website, category, description or social/profile links;
- whether the site appears maintained and usable;
- whether submission is free, paid, claim-only, invite-only, login-gated or unavailable;
- obvious spam/link-farm characteristics;
- duplicate-domain/network risk;
- evidence needed for a later submission.

## Suggested outcomes

Use deterministic states:
- `HIGH_VALUE`
- `USEFUL`
- `LOW_VALUE`
- `EXISTING_LISTING`
- `PAID_REVIEW_REQUIRED`
- `LOGIN_REQUIRED`
- `NOT_RELEVANT`
- `DUPLICATE_SOURCE`
- `BLOCKED`

## Priority rule

Prefer, in order:
1. strong local/regional directories and chambers;
2. relevant industry associations and trusted niche directories;
3. meaningful national business directories;
4. relevant community/partner/supplier surfaces;
5. low-authority generic directories only when there is a clear citation/business reason.

Do not submit merely because a site promises a backlink.

## Duplicate handling

Canonicalise obvious URL/domain variants and treat one directory network as one source family when appropriate. If a business listing already exists, route it to claim/update/audit work instead of creating a second listing.

## Output contract

For each qualified target record:
- canonical URL/domain;
- source type;
- relevance reason;
- existing listing status;
- submission/claim route if visible;
- login/payment requirement;
- priority/outcome;
- short evidence note.

Hand only approved targets to `seo-directory-submission`.
