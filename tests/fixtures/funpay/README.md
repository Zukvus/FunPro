# FunPay fixtures

Hand-written, **sanitized** HTML fragments that reproduce the markup structure FunPay is documented
to use (see `docs/research-notes-raw.md` §B.2 and §D for the evidence behind every class name).
They contain no real user names, ids, tokens or prices.

They have **not** been captured from the live site by FunPro maintainers. When a live capture
becomes available, sanitize it (replace names, ids, csrf tokens, avatars, prices) and add it next
to these files with a `live-YYYY-MM-DD-` prefix; the parser tests run against every fixture.
