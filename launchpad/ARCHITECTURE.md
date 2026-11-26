# PIXORUN Launchpad — Testnet Build Specification

## Product scope

PIXORUN is a token launchpad for Robinhood Chain Testnet. This specification is for the private development branch only. Nothing in this document means the contracts are deployed or that the public website is live.

## Confirmed launch parameters

| Parameter | Value |
|---|---:|
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 (`0xb626`) |
| Native currency | Testnet ETH |
| Token total supply | 10,000,000 |
| Bonding-curve allocation | 8,000,000 (80%) |
| Treasury / reserve allocation | 2,000,000 (20%) |
| Per-token curve raise target | 0.1 Testnet ETH |
| Completion threshold | 100% of the 0.1 ETH target |

The 0.1 ETH target is the aggregate amount raised by a token, not a minimum purchase amount.

## User journey

1. User connects an EVM wallet and switches to Robinhood Chain Testnet.
2. The app shows the connected address and native testnet ETH balance, with a link to the official faucet.
3. User creates a token by entering name, symbol, description, logo, banner, website, X profile, and community link.
4. The factory deploys a token and its curve instance; metadata is stored separately and referenced by the token record.
5. Buyers purchase curve tokens with testnet ETH. Sellers return curve tokens for testnet ETH, subject to the curve's pricing and available reserve.
6. The token page and user dashboard show ETH raised, curve progress, token details, and transaction history.
7. At 0.1 ETH raised, the curve closes to further buys and sells according to the final contract rules; the token is marked Completed.
8. A separate graduation step handles DEX liquidity. This must not be represented as automatic until the target DEX, router, pool pair, liquidity amount, and LP-token custody/lock design are selected and tested.

## Contract architecture (proposed)

- `PixorunTokenFactory`: creates tokens and curve instances; enforces the fixed supply and allocation split.
- `PixorunBondingCurve`: records per-token ETH raised, quotes buy/sell amounts, receives buys, and pays sells from its ETH reserve.
- ERC-20 token: 10,000,000 fixed initial supply; 8,000,000 allocated to the curve mechanism and 2,000,000 held by the designated treasury/reserve address.
- No owner-controlled mint function after deployment. Any emergency pause must be narrowly scoped, observable, and documented.

## Safety and implementation constraints

- Testnet only; do not add mainnet addresses or enable real-asset trading.
- Never claim a token is deployed, tradable, or graduated until a confirmed on-chain transaction and contract state prove it.
- Validate token name/symbol lengths, image type/size, and metadata URLs. Treat uploaded files and external URLs as untrusted.
- Use integer arithmetic and explicit rounding rules in curve calculations. Add reentrancy protection and checks-effects-interactions to ETH transfers.
- A sell must never promise more ETH than the curve contract can pay.
- Prevent buys after the curve target is reached; handle the final partial buy so it cannot exceed the 0.1 ETH target.
- Verify all contract bytecode, addresses, and events on the Robinhood Chain Testnet explorer.
- Do not deploy contracts, publish the frontend, or modify `main` without explicit approval.

## Decisions still required before implementing the curve and graduation contracts

1. **Curve pricing formula:** linear, exponential, or another explicitly defined curve. This determines the price path and the exact token amount received for each ETH amount.
2. **Trading fee:** buy/sell fee percentage and destination.
3. **Sell policy:** whether selling is allowed while the curve is live, and the exact reserve/quote rules.
4. **Graduation DEX:** the supported testnet DEX/router and pool pair.
5. **Graduation liquidity:** how much of the raised ETH and remaining tokens are supplied, and how LP tokens are held or locked.
6. **Treasury authority:** the treasury wallet/multisig address that receives the 2,000,000-token allocation.

These are security- and economics-critical. They must be explicit before writing deployable contracts; the UI must not invent or silently assume them.
