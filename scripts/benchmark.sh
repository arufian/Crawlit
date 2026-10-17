#!/usr/bin/env bash
# Reproduce the README benchmark numbers against a running Crawlit.
# Usage: scripts/benchmark.sh            (defaults to http://localhost:3000)
#        CRAWLIT_BASE_URL=http://host:3000 scripts/benchmark.sh
# Needs: curl, jq. Uses ~20 requests (fits the default 60 req/min rate limit).
set -euo pipefail

B="${CRAWLIT_BASE_URL:-http://localhost:3000}"
now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
since() { perl -e "printf '%.2fs', $(now) - $1"; }
post() { curl -sf -m 180 -X POST "$B$1" -H 'content-type: application/json' -d "$2"; }

curl -sf -m 3 "$B/health" >/dev/null || { echo "Crawlit not reachable at $B" >&2; exit 1; }
echo "Crawlit $(curl -s "$B/health" | jq -r .version) at $B"
echo

for u in https://nodejs.org/docs/latest/api/fs.html https://en.wikipedia.org/wiki/Web_crawler; do
  s=$(now); post /v1/scrape "{\"url\":\"$u\",\"skipCache\":true}" >/dev/null
  printf '%-48s %s\n' "scrape ${u#https://}" "$(since "$s")"
done

s=$(now)
for p in HTTP Web_browser Search_engine Web_scraping Hyperlink URL HTML Markdown Robots.txt Sitemaps; do
  post /v1/scrape "{\"url\":\"https://en.wikipedia.org/wiki/$p\",\"skipCache\":true}" >/dev/null &
done
wait
printf '%-48s %s\n' "10 parallel scrapes (Wikipedia)" "$(since "$s")"

s=$(now); post /v1/map '{"url":"https://fastify.dev"}' >/dev/null
printf '%-48s %s\n' "map fastify.dev" "$(since "$s")"

s=$(now); res=$(post /v1/search '{"query":"fastify rate limit plugin","limit":5,"skipCache":true}')
printf '%-48s %s  (%s, %s results)\n' "search \"fastify rate limit plugin\"" "$(since "$s")" \
  "$(jq -r .data.engine <<<"$res")" "$(jq -r .data.total <<<"$res")"

id=$(post /v1/crawl '{"url":"https://books.toscrape.com/","limit":40,"maxDepth":2}' | jq -r .id)
s=$(now)
status=""
for _ in $(seq 1 150); do
  status=$(curl -s "$B/v1/crawl/$id?limit=1" | jq -r '"\(.status) \(.completed)/\(.total)"' 2>/dev/null || echo "poll-error")
  [[ "$status" == completed* ]] && break
  sleep 2
done
printf '%-48s %s  (%s)\n' "crawl books.toscrape.com, 40 pages" "$(since "$s")" "$status"
