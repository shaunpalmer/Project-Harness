---
name: browser-research
description: "Use when research needs live browser exploration rather than static search alone: inspect rendered pages, follow relevant links, compare sources, capture evidence URLs, and stop when the research question is answered rather than browsing endlessly."
whenToUse: "Use when the task requires browser-assisted research across live websites, directories, rendered pages, authenticated sources, or link structures that search snippets cannot answer reliably."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [browser-automation, research, source-discovery, evidence]
    tags: [browser, research, discovery, evidence, playwright]
    stack: []
---
# Browser Research

Use the browser as an evidence-gathering instrument, not as an unbounded surfing loop.

## Research contract

Start with:
- the question to answer;
- target geography/domain/topic if supplied;
- what counts as sufficient evidence;
- any source or cost constraints.

## Loop

1. **Plan a small search family** — identify a few source/surface patterns likely to answer the question.
2. **Open and inspect** — verify the actual rendered page rather than trusting snippets alone.
3. **Capture evidence** — retain canonical URL, page/source type, relevant finding, and confidence/status.
4. **Follow structure** — prefer directories, indexes, member lists, pagination, category filters and relationship surfaces that expose many relevant entities.
5. **Deduplicate** — canonicalise obvious URL variants before adding a new source.
6. **Learn from yield** — expand productive source patterns; cool down repeated low-yield/noisy patterns.
7. **Stop deliberately** — finish when the requested evidence threshold is met, the search space is exhausted, or a real blocker is reached.

## Search-discovered vs verified

Never represent a search result as browser-verified evidence. Useful statuses include:
- `SEARCH_DISCOVERED`
- `BROWSER_VERIFIED`
- `BLOCKED`
- `NOT_RELEVANT`
- `DUPLICATE`
- `RETRYABLE_ERROR`

## Evidence quality

Prefer first-party pages, authoritative registries, member/tenant/sponsor directories and directly published evidence. Treat link counts and keyword matches as proxies until the page content is actually inspected.

## Browser discipline

- Re-inspect after navigation or major DOM changes.
- Use pagination/filter controls rather than blind scrolling when a stable structure exists.
- Respect robots/site rules and task-level request limits.
- Do not bypass authentication, CAPTCHA or anti-bot controls.
- Do not submit forms as part of research unless the task explicitly requires a separate form-operation step.

## Output

Return concise findings plus evidence URLs/statuses, and identify promising repeatable source classes separately from one-off pages.
