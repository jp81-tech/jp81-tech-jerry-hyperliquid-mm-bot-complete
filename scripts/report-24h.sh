#!/usr/bin/env bash
set -euo pipefail

: "${LOKI_URL:?LOKI_URL not set}"
: "${LOKI_LABEL_SELECTOR:=}{app=\"mm-bot\"}"
: "${PAIR_FILTER:=}"

SINCE="24h"
NOW_MS=$(($(date +%s%3N)))
AGO_MS=$(($(date +%s -d "-${SINCE}")*1000))

q_err="{${LOKI_LABEL_SELECTOR}} |= \"E_TICK\""
q_attempt="{${LOKI_LABEL_SELECTOR}} |= \"quant_evt=attempt\""
q_pairs="{${LOKI_LABEL_SELECTOR}} |= \"quant_evt=attempt\""
if [ -n "${PAIR_FILTER}" ]; then
  q_err="$q_err |~ \"pair=(${PAIR_FILTER})\""
  q_attempt="$q_attempt |~ \"pair=(${PAIR_FILTER})\""
  q_pairs="$q_pairs |~ \"pair=(${PAIR_FILTER})\""
fi

curl -sG "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode "query=sum(count_over_time(($q_err)[$SINCE]))" \
  --data-urlencode "start=${AGO_MS}" --data-urlencode "end=${NOW_MS}" \
  --data-urlencode "step=60s" | jq -r '.data.result[0].values[-1][1]' \
  | awk '{print "E_TICK_total_last_24h=" $1}'

curl -sG "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode "query=sum by (pair) (count_over_time(($q_err)[$SINCE]))" \
  --data-urlencode "start=${AGO_MS}" --data-urlencode "end=${NOW_MS}" \
  --data-urlencode "step=60s" \
  | jq -r '.data.result[]? | (.metric.pair + "=" + (.values[-1][1]))' \
  | sed 's/^/E_TICK_by_pair_last_24h: /'

curl -sG "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode "query=sum by (pair) (count_over_time(($q_attempt)[$SINCE]))" \
  --data-urlencode "start=${AGO_MS}" --data-urlencode "end=${NOW_MS}" \
  --data-urlencode "step=60s" \
  | jq -r '.data.result[]? | (.metric.pair + "=" + (.values[-1][1]))' \
  | sed 's/^/attempts_by_pair_last_24h: /'
