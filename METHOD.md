# Method and sources

RBNT Quarterly On-Chain Holder Report. This note explains how every figure in the report is produced, where it comes from, and how to make the next edition. It is written so that someone who did not work on this edition can repeat it.

## 1. What the report measures

- **Who holds RBNT and how spread out it is.** Holder counts, balance bands and the share held by the largest holders, at the start and end of the quarter and at each month end in between.
- **Accumulation and selling among the largest holders.** Holders are ranked by holdings at the start of the quarter and put into groups (ranks 1 to 10, 11 to 100, 101 to 1,000, 1,001 to 10,000). For each group the report counts how many added more than 1%, how many reduced more than 1%, and the group's combined change.
- **Staking.** The two Reddex RBNT staking pools (no lock and 365 day lock): their RBNT balance at each snapshot, how much of that is stakes and how much is reward funds, the number of stakers, and the stake, unstake and reward claim activity during the quarter.
- **Flows in and out of publicly named wallets.** Redbelly's nine reserved wallets from the DAO treasury page, the Wrapped RBNT (WRBNT) contract, the two staking pools, and any exchange wallet labelled on Routescan.

The report is about trends, not people. It names only wallets that are already publicly named (section 6). Every other address appears only inside group totals. The public data files contain no unlabelled addresses.

## 2. Time window and snapshot blocks

All times are UTC. The quarter is 1 July 2026 00:00:00 to 30 September 2026 23:59:59.

A snapshot is the chain state after the last block mined at or before a cut-off second:

| Snapshot | Cut-off (UTC) | Block |
|---|---|---|
| Start of quarter | 30 June 2026 23:59:59 | 3,025,809 |
| End of July | 31 July 2026 23:59:59 | 3,104,242 |
| End of August | 31 August 2026 23:59:59 | 3,161,410 |
| End of quarter | 30 September 2026 23:59:59 | 3,209,414 |

Blocks are found by binary search over block timestamps on the Redbelly RPC and cross-checked against Routescan's `getblocknobytime`. All four matched.

## 3. Data sources

| Source | Used for | Address |
|---|---|---|
| Redbelly mainnet RPC (chain ID 151) | Balances at a block (`eth_getBalance`), contract reads at a block (`eth_call`), blocks and transactions, receipts, contract code | `https://governors.mainnet.redbelly.network` |
| Routescan Etherscan-compatible API | Internal transfers (`txlistinternal`), event logs (`getLogs`), block by time, verified contract source | `https://api.routescan.io/v2/network/mainnet/evm/151/etherscan/api` |
| Routescan v2 API | Routescan's native holder list, used only as an extra source of addresses | `https://api.routescan.io/v2/network/mainnet/evm/151/addresses` |
| Routescan explorer pages | Address labels (exchange and contract name tags) | `https://redbelly.routescan.io` |
| DAO treasury page | Names and addresses of the nine reserved wallets, original allocations | `https://redbellydao.network/treasury/` |

Balances always come from the RPC, never from an explorer. Routescan's own holder list showed stale balances for about 2,200 addresses when checked on 27 October 2026, so it is used only to find addresses, not to read amounts. The treasury page table lists original allocations, not current balances, so it is used only for names and allocations.

## 4. Building the full list of addresses

There is no endpoint that lists every RBNT holder at a past block, so the scripts build the list themselves. An address can only hold RBNT if it received some, so the list is the union of:

1. every sender and receiver of every transaction from block 1 to the closing block (a full scan of about 3.2 million blocks),
2. every contract created by a transaction (from receipts) or by another contract,
3. every sender and receiver of an internal transfer (value moved by a contract) up to the closing block,
4. every address in a WRBNT or staking pool event,
5. the publicly named wallets,
6. Routescan's native holder list, to catch any address funded at genesis that never moved,
7. validator addresses listed in block headers (`extraData`), read every 250 blocks. The protocol pays network fees out to some addresses directly, without a transaction, so a transaction scan alone cannot find them.

In this edition the list held 745,579 addresses. 165,263 of them (not counting the 12 named wallets) held some RBNT, WRBNT or staked RBNT at the end of the quarter.

Each address on the list then has its balance read at every snapshot block. The list is checked by adding up every balance. Block 0 held exactly 10,000,000,000 RBNT at a single address, so that is the total to match. If an address with RBNT were missing, the sum would fall short.

**Network fees are not burned.** Redbelly charges exactly the base fee (`gasUsed x baseFeePerGas`) and blocks have no fee recipient, which looks like a burn at first sight. The data shows otherwise: during the quarter 1,999,924 RBNT was paid in fees, yet the sum of all balances changed by only 11 RBNT, because the protocol credited the fees to network participants (66 addresses received 1.52 million RBNT during the quarter without sending or receiving any transaction). This matches Redbelly's published [fee distribution](https://vine.redbelly.network/network-fees/distribution/), which only burns a share of fees above 1 million transactions a day.

## 5. Counting each RBNT once

Two contracts hold RBNT on behalf of other addresses:

- **WRBNT.** The WRBNT contract holds RBNT that backs WRBNT one to one. A wallet holding WRBNT and the contract holding the RBNT behind it are the same tokens. The contract follows the common WETH9 design, where `totalSupply()` simply returns the contract's own RBNT balance.
- **Reddex staking pools.** A pool holds the RBNT people staked, plus RBNT set aside to pay rewards. Rewards are paid in RBNT, so a pool's balance includes reward funds as well as stakes.

The report uses two views:

- **Where RBNT sits** (the supply map). Each RBNT is counted at the address that holds it. The WRBNT contract and the pools appear as their own rows. Nothing else is added, so the rows sum to total supply.
- **Holdings** (used for holder counts, bands, concentration and the largest holder groups). An address's holdings are its own RBNT, plus the WRBNT it holds, plus the RBNT it has staked in either pool (`userInfo(address).amount`). The WRBNT contract then keeps only RBNT above the WRBNT that addresses hold (normally zero), and each pool keeps only its balance minus `totalStake()`, which is the reward funds. This moves wrapped and staked RBNT to its owner without counting it twice. A check confirms the holdings view still adds up to total supply.

Staking a balance or wrapping it is therefore not counted as selling. WRBNT sitting inside a trading pool is counted with the trading pool contract, because the pool's own records, not the chain's balances, say who owns a share of it.

## 6. Who is named and who is grouped

Named in the report (with address):

- The nine reserved wallets on the DAO treasury page: Team (Locked), Governance (Locked), Governance (Unlocked), USYD/CSIRO (Locked), Investors, Reserve, Ecosystem (Locked), Ecosystem 2 (Unlocked), Ecosystem (Unlocked).
- The Wrapped RBNT contract.
- The two Reddex RBNT staking pools.
- Any exchange or contract that carries a public name tag on Routescan. On 27 October 2026 the explorer pages of the 30 largest holders outside the named wallets were opened one by one. None carried a public name tag. Routescan does tag Redbelly's own wallets (for example "Redbelly Network: Wrapped RBNT"), so the check works; there is simply no labelled exchange on Redbelly mainnet yet. The check and its date are recorded in `LABEL_CHECK` in `scripts/common.py`.

Everything else is grouped. Addresses are described only by type (regular wallet or smart contract, read from whether the address has contract code at the closing block) and by size group. User-chosen names that an explorer may show for an address are not used. No attempt is made to link an address to a person or organisation, and none should be made with this data.

## 7. Definitions

- **Holder:** an address, other than a named wallet, whose holdings are 1 RBNT or more. Addresses with less than 1 RBNT are counted separately as dust. A single network fee is several RBNT, so smaller amounts cannot be moved on their own.
- **Balance bands:** 1 to 999; 1,000 to 9,999; 10,000 to 99,999; 100,000 to 999,999; 1 million to 9.99 million; 10 million to 99.9 million; 100 million or more.
- **Concentration:** the share of RBNT held outside named wallets that sits with the largest 10, 100 and 1,000 holders, and the smallest number of holders that together hold half of it.
- **Largest holder groups:** holders ranked by holdings at the start of the quarter. Group membership is fixed for the whole quarter, so a holder that drops out of the top ranks still counts in its starting group.
- **Added / reduced / steady:** holdings at the end of the quarter more than 1% above, more than 1% below, or within 1% of the start. **Emptied** means less than 1 RBNT at the end.
- **Reduced is not the same as sold.** A drop in holdings can be a sale, a move to another wallet of the same owner, a payment, or a deposit to an exchange. On-chain data cannot tell these apart, so the report says "reduced", not "sold".
- **Newcomers to the largest 1,000:** holders in the largest 1,000 at the end of the quarter that were not in it at the start.
- **Regular wallet / smart contract:** an address with no contract code is a regular wallet. An address with an EIP-7702 delegation is also counted as a regular wallet. Any other address with code is a smart contract.
- **Reward funds:** a pool's RBNT balance minus its `totalStake()`.
- **Reward funding:** RBNT that entered a pool during the quarter through a transfer that was not a `stake()` call.
- **Flows of named wallets:** successful native RBNT transactions, internal transfers (excluding delegate calls and failed calls) and WRBNT transfers, wraps and unwraps into or out of each named wallet during the quarter. Counterparties that are not named are grouped as "Other addresses, not named", without counts. For a regular wallet, network fees paid are read from the receipt of every transaction it sent. Whatever is left after flows and fees is shown as unexplained; it was zero for every reserved wallet this quarter.

## 8. Steps to reproduce

Requirements: Python 3.10 or newer with `requests` and `openpyxl` (`pip install -r scripts/requirements.txt`), and Node 18 or newer with Playwright and Chromium for the PDF (`npm i -g playwright && npx playwright install chromium`).

1. Edit `QUARTER` in `scripts/common.py` (id, label, start and end in UTC). Add any newly labelled exchange or contract to `ROUTESCAN_LABELS`.
2. `python3 scripts/step1_snapshot_blocks.py` finds the snapshot blocks.
3. `python3 scripts/step2_scan_blocks.py` scans every block up to the closing block. About 3.2 million blocks took about 45 minutes with 12 workers. Chunks are cached in `data/raw/scan`, so a rerun only scans new blocks.
4. `python3 scripts/step3_internal_transfers.py` reads internal transfers from Routescan.
5. `python3 scripts/step4_contract_logs.py` reads WRBNT and staking pool events from Routescan. Routescan's log index can miss a block, so the script compares the running total of WRBNT wraps and unwraps with `totalSupply()` on the RPC, finds any block where they part, and reads that block's logs from the RPC. In this edition one block (2,817,687, before the quarter) was missing two WRBNT logs and was filled in this way.
6. `python3 scripts/step5_balances.py` reads every balance at every snapshot from the RPC. This took about 35 minutes with 12 workers. Results are cached per address in `data/raw/bal_cache`, so a rerun only reads new addresses. The public RPC rate limits heavy use, so keep `WORKERS` at 12 or below.
7. Check Routescan name tags for the largest holders by hand (open each address page) and add any exchange or contract labels to `ROUTESCAN_LABELS`. Ignore user-chosen names.
8. `python3 scripts/step6_analyse.py` builds `public/data/report.json` and the CSV files, and prints every verification check. Do not publish if any check fails.
9. `python3 scripts/step7_write_docs.py` writes the spreadsheet and the community summary from the same figures.
10. `node scripts/step8_build_pdf.js` prints the PDF and the social card from the site.
11. `python3 scripts/verify_outputs.py` checks the published files: no unlabelled address, no dashes the brand kit forbids, no emoji, no price language, every verification check passed, and every figure in the community summary traces back to `report.json`.

Raw per-address data stays in `data/raw/`, which is not published. It can be rebuilt at any time from the steps above.

## 9. Verification

Every run of step 6 checks that:

- the snapshot blocks match Routescan's block-by-time lookup,
- the sum of all balances accounts for the 10 billion RBNT at launch to within 0.001% (the remainder is explained in section 10),
- the sum of all balances held steady through the quarter (fees are paid back out, not burned),
- WRBNT balances add up to WRBNT total supply at every snapshot, and the WRBNT contract holds at least that much RBNT,
- all wraps minus all unwraps up to the closing block equal WRBNT total supply (so no WRBNT event was missed),
- staker positions add up to each pool's `totalStake()`, and all stakes minus all unstakes equal it (so no staking event was missed),
- the holdings view adds up to total supply,
- for each reserved wallet, the opening balance plus inflows, minus outflows and network fees paid, equals the closing balance exactly, for both RBNT and WRBNT.

The results are listed in the report and in `public/data/10_verification_checks.csv`.

## 10. Known limits

- **36,841 RBNT (0.0004% of supply) could not be placed.** The balances found add up to 9,999,963,159 RBNT at the end of the quarter. The remainder most likely sits at addresses that the protocol paid directly and that never sent or received a transaction, so neither the block scan nor the block headers list them. It changed by only 12 RBNT during the quarter, and it is too small to move any figure in the report by more than 0.001 percentage points.
- Routescan's internal transfer index is the only source for value moved by contracts, because the public RPC has no tracing. Internal transfers are used for named wallet flows and for finding addresses, never for balances. The reserved wallet flow checks confirm the flows used in the report are complete.
- Routescan's log index missed one block of WRBNT logs. Staking events matched each pool's `totalStake()` exactly, and WRBNT events matched after the repair described in step 5 of section 8.
- The report cannot tell a sale from a transfer between wallets of the same owner, or from a deposit to an exchange wallet that is not labelled.
- WRBNT inside trading pools is not split between the people who supplied it.
- Holder counts count addresses, not people. One person can control many addresses, and one address (for example an exchange) can hold RBNT for many people.

## 11. Rounding

Balances are read in wei (10^-18 RBNT) and rounded to whole RBNT only when published. Shares are rounded to one decimal place. Because each figure is rounded on its own, a total or a difference can differ by 1 RBNT from the sum of the rounded parts.

## 12. Files

| File | Contents |
|---|---|
| `public/data/report.json` | Every figure used in the report, with snapshot blocks |
| `public/data/01_where_rbnt_sits.csv` | Supply map by type of address |
| `public/data/02_holders_by_balance_band.csv` | Holders and RBNT per balance band |
| `public/data/03_concentration.csv` | Share held by the largest 10, 100 and 1,000 holders, also for regular wallets only |
| `public/data/04_largest_holder_groups.csv` | Added, reduced and steady counts per group |
| `public/data/05_staking_pools.csv` | Pool balance, stakes, reward funds and stakers at each snapshot |
| `public/data/06_staking_flows_in_quarter.csv` | Stake, unstake, claim and funding totals in the quarter |
| `public/data/07_named_wallets.csv` | Named wallet balances at each snapshot and quarter flows |
| `public/data/08_named_wallet_flows_in_quarter.csv` | Named wallet flows by counterparty group |
| `public/data/09_wrbnt.csv` | WRBNT supply, backing and holders |
| `public/data/10_verification_checks.csv` | Results of every verification check |
| `public/data/RBNT-Holder-Report-Q3-2026-data.xlsx` | All of the above in one workbook, with a sources sheet |
