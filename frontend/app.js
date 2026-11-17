import deploymentConfig from "./contract.json";
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from "ethers";

const $ = (id) => document.getElementById(id);
const statusNames = ["Pending", "Assigned", "Completed"];
let config, reader, contract, wallet, signer, account = "", manager = "";
let busy = false, loading = false, page = 0, total = 0, available = false;
const pageSize = 8;
const workerDrafts = new Map();
const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function notice(message, kind = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${kind}`;
}
function errorMessage(error) {
  const raw = [error.reason, error.shortMessage, error.message, error.info?.error?.message, error.error?.message, error.info?.error?.data?.reason].filter(Boolean).join(" · ");
  const translations = {
    "Only manager": "Only the building manager can assign a worker.",
    "Only assigned worker": "Rejected: only the assigned worker can complete this request.",
    "Request is not assigned": "This request is not assigned or has already been completed.",
    "Request is not pending": "This request has already been assigned and cannot be reassigned.",
    "Request does not exist": "This request does not exist.",
    "Invalid worker address": "The worker address is invalid.",
    "Description is required": "Please enter a description.",
  };
  for (const [key, message] of Object.entries(translations)) if (raw.includes(key)) return `${message} (${key})`;
  if (error.code === 4001 || error.code === "ACTION_REJECTED") return "You rejected the action in your wallet.";
  if (raw.includes("insufficient funds")) return "This account does not have enough test ETH to pay gas fees.";
  return raw || "Unable to complete the action. Check Ganache and your wallet connection.";
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function updateControls() {
  $("create").disabled = busy || !available || !account;
  $("connect").disabled = busy;
  $("refresh").disabled = busy || loading || !available;
  $("switch-network").disabled = busy;
  $("previous").disabled = busy || loading || page === 0;
  $("next").disabled = busy || loading || (page + 1) * pageSize >= total;
  document.querySelectorAll(".request-card button").forEach(button => { button.disabled = busy || !available || !account; });
}
async function getSigner() {
  if (!window.ethereum) throw new Error("Install MetaMask to send transactions.");
  wallet = new BrowserProvider(window.ethereum);
  const walletNetwork = await wallet.getNetwork();
  if (Number(walletNetwork.chainId) !== config.chainId) {
    $("switch-network").hidden = false;
    throw new Error(`Your wallet is on chain ${walletNetwork.chainId}. Switch to Ganache, chain ${config.chainId}.`);
  }
  $("switch-network").hidden = true;
  signer = await wallet.getSigner();
  return signer;
}
async function connect() {
  try {
    if (!window.ethereum) throw new Error("MetaMask was not found. Install the extension and reload this page.");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const activeSigner = await getSigner();
    account = await activeSigner.getAddress();
    $("account").textContent = account;
    $("connect").textContent = "Connected";
    $("role").textContent = same(account, manager) ? "Building manager · Can assign workers" : "Resident / worker · Permissions depend on each request";
    notice("Ganache wallet connected. You can now submit transactions.", "success");
    await loadRequests();
  } catch (error) { notice(errorMessage(error), "error"); }
  updateControls();
}
async function transaction(label, action, onSuccess) {
  if (busy) return;
  busy = true; updateControls();
  try {
    const activeSigner = await getSigner();
    if (!same(await activeSigner.getAddress(), account)) throw new Error("Your wallet account has changed. Please reconnect.");
    notice(`${label}: waiting for your confirmation in MetaMask…`);
    const tx = await action(contract.connect(activeSigner));
    notice(`${label}: waiting for blockchain confirmation. Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("The transaction was rejected by the blockchain.");
    onSuccess?.();
    notice(`${label} successful · Block ${receipt.blockNumber} · Tx: ${tx.hash}`, "success");
  } catch (error) {
    const hash = error.receipt?.hash;
    notice(`${errorMessage(error)}${hash ? ` · Tx: ${hash}` : ""}`, "error");
  } finally {
    busy = false;
    await loadRequests();
    updateControls();
  }
}
function renderRequest(r) {
  const card = node("article", "request-card");
  const heading = node("div", "card-heading");
  heading.append(node("span", "request-id", `REQUEST #${r.id}`), node("span", `badge status-${r.status}`, statusNames[Number(r.status)]));
  card.append(heading, node("p", "description", r.description));
  const addresses = node("div", "addresses");
  for (const [label, address] of [["RESIDENT", r.resident], ["ASSIGNED WORKER", r.worker === ZeroAddress ? "Not assigned" : r.worker]]) {
    const item = node("div"); item.append(node("span", "", label), node("code", "", address)); addresses.append(item);
  }
  card.append(addresses);
  if (Number(r.status) === 0 && same(account, manager)) {
    const form = node("form", "assign-form");
    const input = node("input"); input.placeholder = "Worker wallet address: 0x…"; input.required = true;
    input.value = workerDrafts.get(String(r.id)) ?? "";
    input.addEventListener("input", () => workerDrafts.set(String(r.id), input.value));
    input.setAttribute("aria-label", `Worker address for request ${r.id}`);
    const button = node("button", "secondary", "Assign worker"); button.type = "submit";
    form.append(input, button);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const address = input.value.trim();
      if (!isAddress(address) || getAddress(address) === ZeroAddress) { notice("Enter a valid, non-zero Ethereum wallet address.", "error"); return; }
      transaction("Assign worker", c => c.assignWorker(r.id, getAddress(address)), () => workerDrafts.delete(String(r.id)));
    });
    card.append(form);
  }
  if (Number(r.status) === 1 && account) {
    const allowed = same(account, r.worker);
    const button = node("button", allowed ? "primary complete-button" : "secondary", allowed ? "Mark as completed ✓" : "Try completing with this account");
    button.addEventListener("click", () => transaction("Complete request", c => c.completeRequest(r.id)));
    if (allowed) card.append(button);
    else {
      const details = node("details", "test-action");
      details.append(node("summary", "", "Test unauthorized completion"), node("p", "", "This account is not the assigned worker. The contract will reject this action."), button);
      card.append(details);
    }
  }
  return card;
}
async function loadEvents() {
  try {
    const latest = await reader.getBlockNumber();
    const from = Math.max(config.deploymentBlock, latest - 1999);
    const events = await contract.queryFilter("*", from, latest);
    const list = $("events"); list.replaceChildren();
    for (const event of events.reverse().slice(0, 15)) {
      const parsed = contract.interface.parseLog(event);
      if (!parsed) continue;
      const id = parsed.args.id.toString();
      const labels = { RequestCreated: `Request created #${id}`, WorkerAssigned: `Worker assigned to request #${id}`, RequestCompleted: `Request completed #${id}` };
      const item = node("li", "", `${labels[parsed.name] ?? parsed.name} · Block ${event.blockNumber}`);
      item.append(node("code", "", `Tx: ${event.transactionHash}`)); list.append(item);
    }
    if (!list.children.length) list.append(node("li", "", "No events found in this block range."));
  } catch { $("events").replaceChildren(node("li", "", "Unable to load events. Select Refresh to try again.")); }
}
async function loadRequests() {
  if (!contract || loading) return;
  loading = true; updateControls();
  try {
    // Detect a reset Ganache chain instead of showing stale deployment data.
    if (await reader.getCode(config.address) === "0x") throw new Error("Contract not found. Ganache may have been reset. Run npm.cmd run deploy, then reload this page.");
    total = Number(await contract.requestCount());
    page = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
    const newest = total - page * pageSize;
    const ids = Array.from({ length: Math.min(pageSize, newest) }, (_, i) => newest - i);
    const requests = await Promise.all(ids.map(id => contract.getRequest(id)));
    $("total").textContent = String(total);
    $("page-label").textContent = `Page ${page + 1} / ${Math.max(1, Math.ceil(total / pageSize))}`;
    $("requests").replaceChildren(...requests.map(renderRequest));
    if (!requests.length) $("requests").append(node("p", "empty", "No requests yet. Submit your first maintenance request."));
    await loadEvents();
  } catch (error) { notice(errorMessage(error), "error"); }
  finally { loading = false; updateControls(); }
}
$("connect").addEventListener("click", connect);
$("refresh").addEventListener("click", loadRequests);
$("previous").addEventListener("click", () => { page--; loadRequests(); });
$("next").addEventListener("click", () => { page++; loadRequests(); });
$("create-form").addEventListener("submit", event => {
  event.preventDefault();
  const description = $("description").value.trim();
  if (!description) { notice("Please enter a request description.", "error"); return; }
  transaction("Create request", c => c.createRequest(description), () => { $("description").value = ""; page = 0; });
});
$("switch-network").addEventListener("click", async () => {
  try {
    const chainId = `0x${config.chainId.toString(16)}`;
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: "Ganache Local", nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [config.rpcUrl] }] });
    }
    await connect();
  } catch (error) { notice(errorMessage(error), "error"); }
});
if (window.ethereum) {
  for (const event of ["accountsChanged", "chainChanged"]) {
    window.ethereum.on(event, () => {
      account = ""; signer = undefined;
      $("account").textContent = "Your wallet changed. Please reconnect.";
      $("role").textContent = ""; $("connect").textContent = "Reconnect wallet";
      notice("Your wallet account or network changed. Select Reconnect wallet to update your account.");
      updateControls(); loadRequests();
    });
  }
}
async function init() {
  try {
    config = deploymentConfig;
    $("contract").textContent = config.address;
    $("chain-id").textContent = config.chainId;
    reader = new JsonRpcProvider(config.rpcUrl);
    reader.pollingInterval = 1000;
    if (Number((await reader.getNetwork()).chainId) !== config.chainId) throw new Error("The Ganache chain ID does not match the deployment configuration.");
    contract = new Contract(config.address, config.abi, reader);
    manager = await contract.manager();
    if (!same(manager, config.manager)) throw new Error("The deployment information does not match. Deploy the contract again.");
    $("manager").textContent = manager;
    available = true;
    notice("Connected to Ganache for live data. Connect your wallet to submit transactions.");
    await loadRequests();
  } catch (error) { notice(errorMessage(error), "error"); }
  updateControls();
}
await init();
setInterval(() => { if (available && !busy && !loading && !$("requests").contains(document.activeElement) && !document.querySelector(".test-action[open]")) loadRequests(); }, 12000);
