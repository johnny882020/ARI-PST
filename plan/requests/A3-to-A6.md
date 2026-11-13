# A3 to A6 (Frontend)
1. Entry screen spec: `05-ingestion.md` section 1. No free-text fields on the sample form.
2. Search UI: suggest-as-you-type from `/search/suggest`, facets from `/search/facets`, labels from `/diagnoses` and i18n keys `search.filters.<facet>.<value>`. Show `suppressed` buckets as "fewer than k" text, and `other` as "other (merged)". Explain merging in plain words.
3. Hebrew search: input may be Hebrew or Latin abbreviations. Do not strip letters on the client.
4. Import screen: dry run first, show counters, row list by outcome, report download, then commit. The report has no cell values. Say so in the UI.
