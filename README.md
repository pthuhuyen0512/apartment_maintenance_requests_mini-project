# Apartment Maintenance Requests

**Course:** DS441 A - Blockchain: Theory & Practices  

**Student:** Pham Thu Huyen  

**Student ID:** 29201139715

A Web3 application for coordinating apartment maintenance. Residents create requests, the building manager assigns workers, and only the assigned worker can mark a request as completed.

## Contract rules

- The deploying account becomes the building manager.
- Any account can create a request with a non-empty description.
- Only the manager can assign a non-zero worker address to a pending request.
- Only the assigned worker can complete an assigned request.
- Requests follow `Pending -> Assigned -> Completed`. Reassignment and repeated completion are rejected.
- Permissions are enforced in Solidity. The contract emits `RequestCreated`, `WorkerAssigned`, and `RequestCompleted` events.

The interface displays the connected account, request descriptions, assigned workers, statuses, transaction results, errors, and contract events.

## Ganache network

| Setting | Value |
| --- | --- |
| RPC URL | `http://127.0.0.1:7545` |
| Chain ID | `1337` |
| Network ID | `5777` |
| Currency symbol | `ETH` |

Chain ID and Network ID are separate values. Use `1337` as the MetaMask Chain ID for this configuration. Keep Ganache running while deploying, testing, and using the application.

Hardhat uses these defaults. For a different local Ganache configuration, copy `.env.example` to `.env` and update `GANACHE_RPC_URL` and `GANACHE_CHAIN_ID`.

## Install, deploy, and run

Run the following commands from the repository root in Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run compile
npm.cmd run deploy
npm.cmd run dev
```

Open **http://127.0.0.1:8080**.

Hardhat compiles Solidity 0.8.28 with the Paris EVM target. `scripts/deploy.js` deploys to Ganache using its first unlocked account and writes the contract address and ABI to `frontend/contract.json`. Deploy again when using a new or reset Ganache blockchain; the submitted address is specific to the original local chain.

Add the Ganache network to MetaMask and import the first three Ganache test accounts:

| Ganache account index | Role | Browser demonstration address |
| --- | --- | --- |
| 0 | Manager | `0x29F9BcfCB23Cec8d15E76c0d4C660755AEE89606` |
| 1 | Resident | `0xaCa85b850C23A15fC0Dfe3DA675b9aaCb96A7E89` |
| 2 | Worker | `0xEB4Db5237Bd078642AC3Bcfeb54008a6fAe22C05` |

Select an account and click **Connect wallet** on the website. After switching accounts, grant the selected account access if requested and click the wallet button again. Verify **CONNECTED ACCOUNT** before submitting an action.

## Demonstration

Use the same request throughout these steps:

| Step | Account | Action | Result |
| --- | --- | --- | --- |
| 1 | Resident | Create a request describing a leaking kitchen tap in apartment A101. | Transaction succeeds; status is Pending. |
| 2 | Manager | Assign the Worker account to that request. | Transaction succeeds; status is Assigned. |
| 3 | Resident | Open **Test unauthorized completion** and attempt to complete it. | Action is rejected; status remains Assigned. |
| 4 | Worker | Click **Mark as completed** and confirm in MetaMask. | Transaction succeeds; status is Completed. |

This workflow uses three Ganache accounts. The Resident cannot complete the assigned request because its address differs from the stored worker address. The Worker succeeds because it satisfies the contract's address and status checks.

In the browser demonstration, the unauthorized action was rejected during gas estimation with `CALL_EXCEPTION` / `missing revert data`. It was not submitted as a mined transaction. The Python demonstration below additionally verifies a mined unauthorized transaction with receipt status `0`.

### Recorded browser evidence

Screenshots 01-04 document request **#1** at contract `0x1eaD876D8a61733BDf05FF5B521788d256191D29`, matching the submitted `frontend/contract.json`. The successful transaction receipts have status `1`:

| Action | Block | Transaction hash |
| --- | --- | --- |
| Create request | 2 | `0x289b63e053c8d50b91b2a9f106ed6e82036a6cba3f91aaa79dae1b6d3119fcd2` |
| Assign worker | 3 | `0x73996e2bfbc2ed9867dd22ebfe71661106ec038dfb4c65870db90be620229308` |
| Complete request | 4 | `0x21f561bfd46db48c368cf2bd835d48bdce0236fc8cbaa10f84696fa27089b391` |

The rejected browser action has no mined transaction hash: it failed during estimation, and request #1 remained Assigned until the Worker completed it.

## Tests and results

```powershell
npm.cmd test
npm.cmd run test:ganache
```

Both runs passed **16 tests**: the first on the Hardhat simulated network and the second on Ganache. Recorded summary for each run:

```text
16 passing
```

Tests cover stored request data, independent IDs, events, authorized assignment and completion, invalid addresses and IDs, unauthorized callers, and invalid state transitions.

To run the Python demonstration after compiling:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts/demo.py
```

For another RPC endpoint, pass `--rpc <RPC_URL>`.

The Python demonstration passed **8 checks**: deployment and manager verification, request creation, rejection of unauthorized assignment, assignment by the manager, a mined unauthorized completion with status `0`, completion by the worker, rejection of repeated completion, and rejection of a nonexistent request. It also verifies the corresponding successful transaction receipts and events.

Excerpt from the actual Python output in screenshot 05 (transaction lines omitted):

```text
[PASS 05] Wrong account completion REVERTED; state stays Assigned
[PASS 06] Assigned worker completes -> Completed (2)
RESULT: 8/8 PASS | 0 FAIL
```

**Separate test run:** screenshot 05 records a Python deployment at `0x71BC846237e3D13e84CF17248371cAf137005dF9` with a different set of Ganache test accounts. It verifies the same contract workflow independently; it is not the request or deployment shown in screenshots 01-04.

Each Python run deploys a new contract and updates `frontend/contract.json`. Finish capturing a browser workflow before running it again.

## Screenshots

| Evidence | Screenshot |
| --- | --- |
| Resident creates a pending request | [01_create-request.png](screenshots/01_create-request.png) |
| Manager assigns the worker | [02_assign-worker.png](screenshots/02_assign-worker.png) |
| Resident's unauthorized completion is rejected | [03_rejected-complete.png](screenshots/03_rejected-complete.png) |
| Assigned worker completes the request | [04_complete-success.png](screenshots/04_complete-success.png) |
| Python demonstration: 8 checks passed, including a mined revert | [05_test-results.png](screenshots/05_test-results.png) |

## Individual explanation

The `Status` enum defines the three stages of a request and makes the permitted transitions explicit. A `MaintenanceRequest` struct keeps the description, resident, worker, and status together. A mapping stores requests by ID, while `requestCount` supplies sequential IDs and lets the interface enumerate them.

The manager is fixed at deployment. The `onlyManager` modifier restricts assignment, and `completeRequest` checks both the Assigned state and `msg.sender` against the stored worker. These checks protect the data even when someone calls the contract directly instead of using the website. Hiding a button would not provide that protection.

The demonstration compares a Resident's rejected attempt with the assigned Worker's successful completion of the same request. A failed gas estimate prevents submission; a mined revert has receipt status `0`. Neither changes the request state. Waiting for transaction receipts and reading the contract again ensures the interface shows confirmed results.
