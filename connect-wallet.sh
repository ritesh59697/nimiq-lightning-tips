#!/usr/bin/env bash
# Connects this app to your LNbits wallet so it can receive tips.
#
# You need one thing: the "Invoice/read key" from your LNbits wallet.
# Run this, paste the key when asked, and it does the rest.

set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  Connecting your Lightning wallet"
echo "  ---------------------------------"
echo
echo "  Paste your LNbits Invoice/read key and press Enter."
echo "  (It will not appear on screen as you paste. That's normal.)"
echo
printf "  Key: "
read -rs INVOICE_KEY
echo
echo

if [ -z "${INVOICE_KEY}" ]; then
  echo "  No key entered. Nothing changed. Run this again when you have it."
  exit 1
fi

# An LNbits key is 32 hex characters. Catch a wrong paste before deploying.
if ! printf '%s' "${INVOICE_KEY}" | grep -qE '^[0-9a-fA-F]{32}$'; then
  echo "  That doesn't look like an LNbits key."
  echo "  It should be 32 letters and numbers, like a1b2c3d4e5f6..."
  echo "  Nothing changed. Check you copied the Invoice/read key and try again."
  exit 1
fi

echo "  Saving the key..."
printf '%s' "${INVOICE_KEY}" \
  | npx --yes vercel env add LNBITS_INVOICE_KEY --environment production --force >/dev/null 2>&1

echo "  Publishing the app..."
npx --yes vercel deploy --prod >/dev/null 2>&1

echo "  Checking it works..."
sleep 3
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -m 30 \
  -X POST -H 'content-type: application/json' \
  -d '{"amountSats":1000}' \
  https://nimiq-lightning-tips.vercel.app/api/invoice || echo "000")

echo
if [ "${STATUS}" = "200" ]; then
  echo "  Done. Your app can now receive tips."
  echo "  https://nimiq-lightning-tips.vercel.app"
  echo
  echo "  Next: open that link inside Nimiq Pay, under Mini Apps."
elif [ "${STATUS}" = "500" ]; then
  echo "  The key was saved but the wallet rejected it."
  echo "  Check you copied the Invoice/read key (not the Admin key) and run this again."
else
  echo "  Saved and published, but the check returned ${STATUS}."
  echo "  Tell Claude that number and it can look into it."
fi
echo
