# 010 -- Sign up for Splunk Observability Cloud free edition and get realm/token

Status: backlog
Priority: high
Assignee: @tom
Epic: 002
Theme: splunk-observability
Tags: non-code
Blocked by:
Blocked:

## Description

Sign up for the Splunk Observability Cloud free edition, obtain the realm
and access token, and configure them in the local `.env` file.

## Acceptance criteria

- [ ] Splunk Observability Cloud account created (free edition)
- [ ] Realm identified (e.g. `us1`, `eu0`)
- [ ] Access token generated with ingest permissions
- [ ] `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` set in local `.env`
- [ ] Can access the Splunk Observability Cloud UI

## Notes

Sign up at https://www.splunk.com/en_us/products/observability-cloud.html
Free edition: full features, limited by number of hosts.
Do NOT commit the access token -- it goes in `.env` which is gitignored.
