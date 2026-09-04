# Parser fixtures

These files are compact structural contracts, not cleaned-up representations of a complete server
response.

When adding a parser regression fixture:

- Start from the smallest relevant subtree in a real ignored `examples/*.html` response.
- Preserve the nesting, attributes, whitespace oddities, and irrelevant siblings that affected
  extraction.
- Replace usernames, post content, and remote URLs with inert test values.
- Remove unrelated document sections instead of making the retained markup more regular.

The ignored full responses remain useful for manual investigation. These tracked fragments keep
automated tests reproducible without checking in the server's large, unstable HTML pages.
