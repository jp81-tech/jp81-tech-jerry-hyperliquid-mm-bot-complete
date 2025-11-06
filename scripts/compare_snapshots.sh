#!/usr/bin/env bash
set -e
A="$1"; B="$2"
echo "=== BEFORE: ${A} ==="
grep -E "Turnover:|Fills:" "${A}.alerts.txt" || true
echo
echo "=== AFTER:  ${B} ==="
grep -E "Turnover:|Fills:" "${B}.alerts.txt" || true
echo
echo "=== LAYERS delta (per pair) ==="
paste -d" " <(grep -o "pair=[A-Z0-9_]\+" "${A}.pairs.txt" | sed "s/pair=//") <(grep -o "layers=[0-9]\+" "${A}.pairs.txt" | sed "s/layers=//") | sort > /tmp/a_layers.txt
paste -d" " <(grep -o "pair=[A-Z0-9_]\+" "${B}.pairs.txt" | sed "s/pair=//") <(grep -o "layers=[0-9]\+" "${B}.pairs.txt" | sed "s/layers=//") | sort > /tmp/b_layers.txt
join -a1 -a2 -e 0 -o 0,1.2,2.2 /tmp/a_layers.txt /tmp/b_layers.txt | awk '{printf "%-12s  before=%2d  after=%2d  diff=%+d\n",$1,$2,$3,$3-$2}'
echo
echo "=== ORDERS count (per pair) ==="
grep "|" "${A}.orders.txt" | awk '{print $1}' | sort | uniq -c | awk '{printf "before  %-10s %d\n",$2,$1}' | sort > /tmp/a_orders.txt || true
grep "|" "${B}.orders.txt" | awk '{print $1}' | sort | uniq -c | awk '{printf "after   %-10s %d\n",$2,$1}' | sort > /tmp/b_orders.txt || true
join -a1 -a2 -e 0 -o 0,1.2,2.2 -j1 <(awk '{print $2,$3}' /tmp/a_orders.txt | sort) <(awk '{print $2,$3}' /tmp/b_orders.txt | sort) | awk '{printf "%-12s  before=%2d  after=%2d  diff=%+d\n",$1,$2,$3,$3-$2}'
