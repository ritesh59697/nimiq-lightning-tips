# Lightning Tips

A Nimiq Pay Mini App that lets anyone tip a creator over Bitcoin Lightning,
paid from their NIM or USDT balance via a self-custodial atomic swap.

Submitted to the [Nimiq Mini Apps Competition](https://miniappscompetition.com)
Cycle III.

## How it works

1. The Mini App asks its backend for a fixed-amount BOLT11 invoice.
2. It calls `payLightningInvoice({ invoice })` on the Nimiq provider.
3. Nimiq Pay asks the user to pick NIM or USDT, shows the swap amount and fees,
   and takes approval. Keys never leave the wallet.
4. Nimiq Pay runs the atomic swap and submits the spending transaction.
5. The app polls its backend until the Lightning invoice actually settles.

### Settlement is confirmed, not assumed

A resolved `payLightningInvoice` call means the spending transaction was
*submitted* — not that the creator received Bitcoin. The UI never claims success
on that promise alone; it waits for the Lightning backend to report the invoice
as paid.

### Double-payment safety

Nimiq Pay refuses to re-submit an invoice while an earlier attempt is on record.
When `DUPLICATE_PAYMENT` or `TRANSACTION_OUTCOME_UNKNOWN` comes back, the app
does **not** offer a retry — money may already have moved. It checks settlement
against the backend first, reports success if the tip landed, and otherwise
shows an explicit "do not pay again" warning. Unrecognised errors are treated as
unsafe to retry for the same reason.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev -- --host
```

Open the printed **Network** URL (e.g. `http://192.168.1.2:5173`) in Nimiq Pay
under Mini Apps, with your phone on the same Wi-Fi.

### Configuration

No values are hardcoded. Creator details and tip presets come from `VITE_*` env
vars; the LNbits URL and invoice key stay server-side in the deployed
functions and never enter the client bundle.

See `.env.example` for the full list.

### Lightning backend

`api/invoice.ts` and `api/status.ts` talk to an [LNbits](https://lnbits.com)
instance. Only the **invoice key** is used — it cannot send payments, so a leak
could not drain the wallet.

## Constraints

- **Mainnet only.** Lightning swaps fail on testnet with "Cannot create swap".
  The app detects testnet via `getHostNetwork()` and says so up front.
- **Fixed-amount invoices only.** Amounts are always set server-side.
- Secure-context APIs are unavailable over a plain-HTTP local network URL, so
  `randomId()` falls back when `crypto.randomUUID` is missing.

## Stack

Vite + React + TypeScript, `@nimiq/mini-app-sdk` 0.2.4.

## Licence

MIT — see [LICENSE](LICENSE).
