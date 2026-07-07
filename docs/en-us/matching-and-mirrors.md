# Matching, mirrors, and domain normalization

This area defines when a new URL should be considered already visited, partially similar, or belonging to a group of aliases.

## Central normalization

Domain helpers are in `src/shared/domains.js`.

Current rules:

- remove protocol, path, query, fragment, and port for manual domain inputs;
- convert host to lowercase;
- remove only the exact initial `www.` prefix;
- keep subdomains distinct: `site.com`, `app.site.com`, and `blog.site.com` are different;
- mirrors do not distinguish HTTP and HTTPS.

Files that depend on these rules:

- `src/worker/background.utils.js`
- `src/worker/background.match.js`
- `src/worker/background.mirrors.js`
- `src/panel/domain-tags.js`

## Fingerprint

`computeFingerprint` is in `src/worker/background.match.js`.

It:

1. normalizes the URL;
2. resolves mirror/canonical, if any;
3. builds readable and hashed keys;
4. creates candidate IDs for canonical and aliases;
5. returns enough data for full match, partial match, and writing.

The ID has this form:

```text
hostKey|pathKey|queryKey|fragmentKey
```

In readable mode, `hostKey/pathKey/queryKey/fragmentKey` are readable. In anonymized mode, they are hashes.

## Full match

Full match looks for candidate IDs in the database. The search considers:

- main ID;
- hash ID;
- readable ID;
- alias candidate IDs;
- alternative representation when necessary.

Full match exceptions can block this step.

## Partial match

Partial match compares records from the same host/path and considers fragment difference or partial intersection of parameters.

The list displayed in the main popup is limited by the background, currently with limit 5 in `GET_PARTIAL_MATCHES`.

Partial match exceptions block this search.

## Site mirrors

Mirrors are in `src/worker/background.mirrors.js`.

A group has:

- `canonical`: first registered site;
- `aliases`: remaining sites in the group.

Example:

```json
{
  "canonical": "site-a.com",
  "aliases": ["site-b.com"]
}
```

With pure canonical, access to `site-b.com/p` is saved as `site-a.com/p`.

## Alias search

History displays the canonical, but textual search expands the searchable surface:

- record saved as `site-a.com/produto`;
- group includes `site-b.com`;
- search for `e-b.com/pro` finds the canonical record.

This is implemented by creating virtual addresses by alias for readable records.

## Exceptions and mirrors

When checking exceptions, the domain is normalized and, when applicable, expanded to hosts in the mirror group.

This allows an exception registered for a non-canonical alias to work for the canonical and other aliases, without turning different subdomains into equivalents.
