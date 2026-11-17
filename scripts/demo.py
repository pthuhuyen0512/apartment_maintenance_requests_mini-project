import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "artifacts/contracts/MaintenanceRequests.sol/MaintenanceRequests.json"


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description="Deploy + test on Ganache (test Ether only)")
    parser.add_argument("--rpc", default="http://127.0.0.1:7545")
    args = parser.parse_args()
    w3 = Web3(Web3.HTTPProvider(args.rpc, request_kwargs={"timeout": 30}))
    check(w3.is_connected(), f"Cannot connect to Ganache: {args.rpc}")
    check("ganache" in w3.client_version.lower(), "Use Ganache test blockchain only")
    check(ARTIFACT.exists(), "Artifact missing. Run: npm.cmd run compile")
    artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    accounts = w3.eth.accounts
    check(len(accounts) >= 3, "Ganache must have at least 3 unlocked test accounts")
    manager, resident, worker = accounts[:3]
    results = []

    def passed(name, receipt=None, **extra):
        entry = {"test": name, "result": "PASS", **extra}
        if receipt is not None:
            entry.update(tx=Web3.to_hex(receipt.transactionHash), block=receipt.blockNumber,
                         receipt_status=receipt.status)
        results.append(entry)
        print(f"[PASS {len(results):02d}] {name}")
        if receipt is not None:
            print(f"          tx: {entry['tx']} (status={receipt.status})")

    def expect_rejection(function, caller, reason):
        # eth_call checks the contract itself without mining a transaction.
        try:
            function.call({"from": caller})
        except Exception as error:
            check(reason in str(error), f"Unexpected rejection: {error}")
            return
        raise RuntimeError(f"Expected rejection: {reason}")

    def transact(function, caller):
        # Explicit gas bypasses estimation so invalid calls are actually mined.
        tx = function.build_transaction({"from": caller, "gas": 4000000,
                                         "gasPrice": w3.eth.gas_price})
        rpc_tx = {"from": caller, "data": tx["data"], "gas": hex(tx["gas"]),
                  "gasPrice": hex(tx["gasPrice"])}
        if tx.get("to"):
            rpc_tx["to"] = tx["to"]
        response = w3.provider.make_request("eth_sendTransaction", [rpc_tx])
        tx_hash = response.get("result")
        if not tx_hash:
            # Ganache Desktop may mine a revert and return its hash in error.data.
            error_data = response.get("error", {}).get("data", {})
            if isinstance(error_data, dict):
                tx_hash = error_data.get("hash")
            check(bool(tx_hash), f"RPC did not return a transaction hash: {response}")
        return w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60, poll_latency=0.2)

    print("=" * 72)
    print("DS441 | APARTMENT MAINTENANCE | PYTHON + GANACHE")
    print("=" * 72)
    print(f"RPC      : {args.rpc}")
    print(f"Chain ID : {w3.eth.chain_id}")
    print(f"Manager  : {manager}")
    print(f"Resident : {resident}")
    print(f"Worker   : {worker}")
    print("-" * 72)

    factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    deployed = transact(factory.constructor(), manager)
    check(deployed.status == 1 and deployed.contractAddress, "Deployment failed")
    contract = w3.eth.contract(address=deployed.contractAddress, abi=artifact["abi"])
    check(contract.functions.manager().call() == manager, "Manager mismatch")
    passed("Deploy contract; deployer is manager", deployed)
    print(f"          contract: {contract.address}")

    created = transact(contract.functions.createRequest("Apartment A101: leaking kitchen tap"), resident)
    check(created.status == 1, "Request creation failed")
    events = contract.events.RequestCreated().process_receipt(created)
    check(len(events) == 1, "RequestCreated event missing")
    request_id = events[0]["args"]["id"]
    request = contract.functions.getRequest(request_id).call()
    check(request[1] == resident and request[4] == 0, "Wrong resident or initial state")
    passed("Resident creates request -> Pending (0)", created)

    expect_rejection(contract.functions.assignWorker(request_id, worker), resident, "Only manager")
    check(contract.functions.getRequest(request_id).call()[4] == 0, "State changed after rejection")
    passed("Resident cannot assign worker", reason="Only manager", rejection_type="eth_call")

    assigned = transact(contract.functions.assignWorker(request_id, worker), manager)
    check(assigned.status == 1, "Assignment failed")
    check(len(contract.events.WorkerAssigned().process_receipt(assigned)) == 1, "Assignment event missing")
    request = contract.functions.getRequest(request_id).call()
    check(request[3] == worker and request[4] == 1, "Wrong worker or assigned state")
    passed("Manager assigns worker -> Assigned (1)", assigned)

    expect_rejection(contract.functions.completeRequest(request_id), resident, "Only assigned worker")
    rejected = transact(contract.functions.completeRequest(request_id), resident)
    check(rejected.status == 0, "Unauthorized completion unexpectedly succeeded")
    check(contract.functions.getRequest(request_id).call()[4] == 1, "Revert changed request state")
    passed("Wrong account completion REVERTED; state stays Assigned", rejected,
           reason="Only assigned worker")

    completed = transact(contract.functions.completeRequest(request_id), worker)
    check(completed.status == 1, "Worker completion failed")
    check(len(contract.events.RequestCompleted().process_receipt(completed)) == 1, "Completion event missing")
    check(contract.functions.getRequest(request_id).call()[4] == 2, "Expected Completed")
    passed("Assigned worker completes -> Completed (2)", completed)

    expect_rejection(contract.functions.completeRequest(request_id), worker, "Request is not assigned")
    passed("Cannot complete the same request twice", rejection_type="eth_call")
    expect_rejection(contract.functions.getRequest(0), resident, "Request does not exist")
    passed("Nonexistent request is rejected", rejection_type="eth_call")

    info = {"address": contract.address, "chainId": w3.eth.chain_id, "rpcUrl": args.rpc,
            "manager": manager, "demoAccounts": {"resident": resident, "worker": worker},
            "transactionHash": Web3.to_hex(deployed.transactionHash),
            "deploymentBlock": deployed.blockNumber,
            "deployedAt": datetime.now(timezone.utc).isoformat(), "abi": artifact["abi"]}
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "contract": contract.address,
              "chainId": w3.eth.chain_id, "requestId": request_id,
              "accounts": {"manager": manager, "resident": resident, "worker": worker},
              "passed": len(results), "failed": 0, "results": results}
    target = ROOT / "frontend/contract.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print("=" * 72)
    print(f"RESULT: {len(results)}/{len(results)} PASS | 0 FAIL")
    print(f"Contract: {contract.address}")
    print("Contract address + ABI: frontend/contract.json")
    print("Frontend updated. Run npm.cmd run dev and open http://127.0.0.1:8080")
    print("Each run deploys a NEW contract and creates one test request.")
    print("=" * 72)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\n[FAIL] {error}", file=sys.stderr)
        sys.exit(1)
