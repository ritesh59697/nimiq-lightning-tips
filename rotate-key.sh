#!/usr/bin/env bash
# Replaces the stored LNbits invoice key with a new one.
#
# Use this if the current key was ever shown somewhere it shouldn't be.
# In LNbits: wallet page -> API info -> the reset/regenerate option next to
# the Invoice/read key. Copy the new key, then run this.

set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  Replacing your Lightning wallet key"
echo "  -----------------------------------"
echo
printf "  Paste the NEW Invoice/read key: "
read -rs KEY
echo
echo

if ! printf '%s' "${KEY}" | grep -qE '^[0-9a-fA-F]{32}$'; then
  echo "  That doesn't look like an LNbits key (needs 32 letters/numbers)."
  echo "  Nothing changed."
  exit 1
fi

echo "  Checking the key works..."
WALLET=$(curl -s -m 25 -H "X-Api-Key: ${KEY}" https://demo.lnbits.com/api/v1/wallet || true)
if printf '%s' "${WALLET}" | grep -q '"detail"'; then
  echo "  LNbits rejected that key. Nothing changed."
  exit 1
fi
if printf '%s' "${WALLET}" | grep -q '"adminkey"'; then
  echo "  That is the ADMIN key, which can spend your money."
  echo "  Use the Invoice/read key instead. Nothing changed."
  exit 1
fi

echo "  Saving and publishing..."
printf '%s' "${KEY}" \
  | npx --yes vercel env add LNBITS_INVOICE_KEY --environment production --force >/dev/null 2>&1
npx --yes vercel deploy --prod >/dev/null 2>&1

sleep 3
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -m 30 \
  -X POST -H 'content-type: application/json' -d '{"amountSats":1000}' \
  https://nimiq-lightning-tips.vercel.app/api/invoice || echo "000")

echo
if [ "${STATUS}" = "200" ]; then
  echo "  Done. The old key no longer works with your app."
else
  echo "  Saved, but the check returned ${STATUS}. Tell Claude that number."
fi
echo
