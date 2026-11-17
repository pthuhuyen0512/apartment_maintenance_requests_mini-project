import "dotenv/config";
import { network, artifacts } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

const { ethers } = await network.create();
const actualNetwork = await ethers.provider.getNetwork();
const accounts = await ethers.getSigners();
if (accounts.length < 3) throw new Error("Ganache must expose at least 3 unlocked test accounts.");
const [manager, resident, worker] = accounts;
const contract = await ethers.deployContract("MaintenanceRequests", [], manager);
await contract.waitForDeployment();
const tx = contract.deploymentTransaction();
const receipt = await tx.wait();
const artifact = await artifacts.readArtifact("MaintenanceRequests");
const deployment = {
  address: await contract.getAddress(),
  chainId: Number(actualNetwork.chainId),
  rpcUrl: process.env.GANACHE_RPC_URL ?? "http://127.0.0.1:7545",
  manager: manager.address,
  demoAccounts: { resident: resident.address, worker: worker.address },
  transactionHash: tx.hash,
  deploymentBlock: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
  abi: artifact.abi,
};
await mkdir("frontend", { recursive: true });
const json = JSON.stringify(deployment, null, 2) + "\n";
await writeFile("frontend/contract.json", json);
console.log(`Contract: ${deployment.address}`);
console.log(`Manager: ${deployment.manager}`);
console.log(`Chain ID: ${deployment.chainId}`);
console.log(`Deployment transaction: ${tx.hash}`);
console.log("ABI + address exported to frontend/contract.json");
