# Delivery-based escrow simulator

Production status on 2026-11-13 is pending. Concordium targets January 2027 for Simple PLL and March 2027 for Enhanced PLL. The October update targets January 27, 2027 for the first release. Confirm release and tooling availability independently before activation. [Concordium roadmap](https://www.concordium.com/roadmap) · [October registry update](https://www.concordium.com/article/agent-registry-update-october-2026)

| Capability | Simulation | Evidence required for activation |
| --- | --- | --- |
| Funding | Buyer approval pins an agreement ID, version and digest, testnet PLT, atomic amount, payer, beneficiary, expiry and authorities. | Released protocol, compatible SDK and wallet, supported asset, finalized lock matching those fields. |
| Simple release | Release authority requests release for an explicitly approved submission and finalized lock reference. | Verify exact authority, destination, lock expiry, finality and duplicate rejection on testnet. |
| Return | Explicit simulated return authority handles expiry, cancellation or rejection. | Verify whether return is automatic, when funds become available and which accounts can cancel or recover the lock. |
| Enhanced rules | An application dispute blocks simulated settlement requests until independent review. | Verify released contract-authenticated rules and demonstrate that a hold prevents on-chain release. |
| Recovery | An uncertain operation keeps its reservation and operation ID after snapshot restore. A new attempt requires authoritative absence. | Verify the chain observation used to establish finality or absence, including a lost response and signer rotation. |

Run npm run verify-commerce for lock, release, return, restart and conflict fixtures. The pure simulator accepts a prior snapshot and event and returns a new snapshot. Persist with a version check when exploring concurrent sequences. Production services have no simulator route or signer. Zero-price marketplace work and immediate x402 use separate state.

Before activation, pin released capability and tooling versions, verify the chosen asset and authorities on testnet, retain scrubbed finalized references, test replay and rollback, and obtain separate approval for any capped mainnet pilot.
