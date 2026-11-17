# Disposable Email Domains

`disposable-email-domains.json` is generated from the normal (not strict/greylist)
list at https://github.com/disposable/disposable-email-domains. The upstream
project updates it daily and distributes it under the included MIT license.

The backend loads this bundled snapshot synchronously, refreshes on startup,
then refreshes daily. Failed or malformed updates retain the last usable list
and retry after one hour. Signup validation never depends on a live download.

From `server`, run `npm run update:disposable-domains` to update the bundled
snapshot before deployment. Commit the generated JSON alongside code changes.
Runtime refreshes update memory; the bundled snapshot remains the restart fallback.

Known major providers and `sti.edu` (including its subdomains) override list
entries. Other custom domains are rejected only for an explicit known disposable
domain or its subdomain, never by keywords, DNS heuristics, or institutional TLD.
