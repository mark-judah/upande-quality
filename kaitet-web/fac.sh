#!/usr/bin/env bash
# Usage: fac.sh <tool> <json-args>
TOKEN="${FAC_TOKEN:?export FAC_TOKEN=key:secret}"
URL="https://kaitet-group.upande.com/api/method/frappe_assistant_core.api.fac_endpoint.handle_mcp"
printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" > /tmp/fac_q.json
curl -s -m 90 -X POST "$URL" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/fac_q.json
