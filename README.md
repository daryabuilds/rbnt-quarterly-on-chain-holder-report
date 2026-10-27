# RBNT Quarterly On-Chain Holder Report

A regular, sourced report on how RBNT holders behave on Redbelly mainnet: accumulation, selling, staking and how concentrated holdings are. This first edition covers **Q3 2026 (1 July to 30 September 2026)** and sets the method so the next edition can repeat it.

**Live report:** https://rbnt-quarterly-on-chain-holder-report.vercel.app

The report is about trends, not people. It names only wallets that are already public: Redbelly's reserved wallets from the [DAO treasury page](https://redbellydao.network/treasury/), the Wrapped RBNT contract, the two Reddex RBNT staking pools, and any exchange or contract labelled on Routescan. Every other address is reported only inside group totals, and no published file lists an unlabelled address.

## Deliverables

| Deliverable | Where |
|---|---|
| Report with charts (web) | [`public/index.html`](public/index.html), served at the live link above |
| Report with charts (PDF) | [`public/downloads/RBNT-Holder-Report-Q3-2026.pdf`](public/downloads/RBNT-Holder-Report-Q3-2026.pdf) |
| Community summary (X thread and short version) | [`COMMUNITY_SUMMARY.md`](COMMUNITY_SUMMARY.md) |
| Data behind the charts (spreadsheet) | [`public/data/RBNT-Holder-Report-Q3-2026-data.xlsx`](public/data/RBNT-Holder-Report-Q3-2026-data.xlsx) |
| Data behind the charts (CSV) | [`public/data/`](public/data/) (ten CSV files, also zipped) |
| All figures, machine readable | [`public/data/report.json`](public/data/report.json) |
| Method and sources | [`METHOD.md`](METHOD.md) |

## How the numbers are made

Every balance is read from the Redbelly mainnet RPC at fixed snapshot blocks (start of quarter, each month end, end of quarter). The list of addresses comes from a full scan of every block, plus internal transfers, WRBNT and staking events. Wrapped RBNT and staked RBNT are counted toward the address that owns them, so each RBNT is counted once. The scripts check that all balances add up to the 10 billion RBNT created at launch, that WRBNT and staking totals match their contracts, and that reserved wallet transfers explain their balance changes. See [METHOD.md](METHOD.md).

## Repository layout

```
public/                 the static site deployed to Vercel
  index.html            the report
  assets/               styles, charts, brand logos
  data/                 report.json, CSV files, spreadsheet
  downloads/            PDF, community summary, method
scripts/                the pipeline, steps 1 to 8, plus verify_outputs.py
data/raw/               per-address caches (not committed, rebuilt by the scripts)
METHOD.md               method and sources
COMMUNITY_SUMMARY.md    X thread and short summary
```

## Making the next edition

```bash
pip install -r scripts/requirements.txt
# 1. set QUARTER in scripts/common.py
cd scripts
python3 step1_snapshot_blocks.py
python3 step2_scan_blocks.py
python3 step3_internal_transfers.py
python3 step4_contract_logs.py
python3 step5_balances.py
python3 step6_analyse.py        # prints every verification check
python3 step7_write_docs.py
node step8_build_pdf.js          # needs Playwright with Chromium
python3 verify_outputs.py
```

Details, definitions and known limits are in [METHOD.md](METHOD.md).

## Deploying

The site is plain static files in `public/`. On Vercel, import this repository with the project name `rbnt-quarterly-on-chain-holder-report`; `vercel.json` sets `public` as the output directory with no build step. Any static host works the same way.

## Design

Built on the Redbelly DAO Task Board brand kit (Kinetic Consensus): slate surfaces, one red accent, Be Vietnam Pro for text and JetBrains Mono for machine values. Animations respect the reader's reduced motion setting, and every chart has a table view. The logo and favicon are transparent SVGs traced from the brand kit's master files; the favicon switches to light ink when the browser uses a dark theme.

## Disclaimer

This report describes past on-chain activity. It does not predict prices and is not financial advice.
