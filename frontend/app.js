import deploymentConfig from "./contract.json";
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from "ethers";

const $ = (id) => document.getElementById(id);
const statusNames = ["Mới tạo", "Đã phân công", "Đã hoàn thành"];
let config, reader, contract, wallet, signer, account = "", manager = "";
let busy = false, loading = false, page = 0, total = 0, available = false;
const pageSize = 8;
const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function notice(message, kind = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${kind}`;
}
function errorMessage(error) {
  const raw = [error.reason, error.shortMessage, error.message, error.info?.error?.message, error.error?.message, error.info?.error?.data?.reason].filter(Boolean).join(" · ");
  const translations = {
    "Only manager": "Chỉ quản lý tòa nhà được phân công thợ.",
    "Only assigned worker": "Bị từ chối: chỉ thợ được phân công mới được hoàn thành yêu cầu.",
    "Request is not assigned": "Yêu cầu chưa được phân công hoặc đã hoàn thành.",
    "Request is not pending": "Yêu cầu đã được phân công; không thể phân công lại.",
    "Request does not exist": "Yêu cầu không tồn tại.",
    "Invalid worker address": "Địa chỉ thợ không hợp lệ.",
    "Description is required": "Vui lòng nhập mô tả.",
  };
  for (const [key, message] of Object.entries(translations)) if (raw.includes(key)) return `${message} (${key})`;
  if (error.code === 4001 || error.code === "ACTION_REJECTED") return "Bạn đã từ chối thao tác trong ví.";
  if (raw.includes("insufficient funds")) return "Tài khoản không đủ ETH thử nghiệm để trả phí gas.";
  return raw || "Không thể thực hiện thao tác. Kiểm tra Ganache và kết nối ví.";
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
  if (!window.ethereum) throw new Error("Cần cài MetaMask để gửi giao dịch.");
  wallet = new BrowserProvider(window.ethereum);
  const walletNetwork = await wallet.getNetwork();
  if (Number(walletNetwork.chainId) !== config.chainId) {
    $("switch-network").hidden = false;
    throw new Error(`Ví đang ở chain ${walletNetwork.chainId}. Chuyển sang Ganache, chain ${config.chainId}.`);
  }
  $("switch-network").hidden = true;
  signer = await wallet.getSigner();
  return signer;
}
async function connect() {
  try {
    if (!window.ethereum) throw new Error("Chưa tìm thấy MetaMask. Cài tiện ích MetaMask rồi tải lại trang.");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const activeSigner = await getSigner();
    account = await activeSigner.getAddress();
    $("account").textContent = account;
    $("connect").textContent = "Đã kết nối";
    $("role").textContent = same(account, manager) ? "Quản lý tòa nhà · Có quyền phân công" : "Cư dân / thợ · Quyền phụ thuộc từng yêu cầu";
    notice("Đã kết nối ví Ganache. Bạn có thể gửi giao dịch.", "success");
    await loadRequests();
  } catch (error) { notice(errorMessage(error), "error"); }
  updateControls();
}
async function transaction(label, action, onSuccess) {
  if (busy) return;
  busy = true; updateControls();
  try {
    const activeSigner = await getSigner();
    if (!same(await activeSigner.getAddress(), account)) throw new Error("Tài khoản ví đã đổi. Vui lòng kết nối lại.");
    notice(`${label}: chờ bạn xác nhận trong MetaMask…`);
    const tx = await action(contract.connect(activeSigner));
    notice(`${label}: đang chờ blockchain xác nhận. Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Giao dịch đã bị blockchain từ chối.");
    onSuccess?.();
    notice(`${label} thành công · Block ${receipt.blockNumber} · Tx: ${tx.hash}`, "success");
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
  heading.append(node("span", "request-id", `YÊU CẦU #${r.id}`), node("span", `badge status-${r.status}`, statusNames[Number(r.status)]));
  card.append(heading, node("p", "description", r.description));
  const addresses = node("div", "addresses");
  for (const [label, address] of [["CƯ DÂN", r.resident], ["THỢ ĐƯỢC PHÂN CÔNG", r.worker === ZeroAddress ? "Chưa phân công" : r.worker]]) {
    const item = node("div"); item.append(node("span", "", label), node("code", "", address)); addresses.append(item);
  }
  card.append(addresses);
  if (Number(r.status) === 0 && same(account, manager)) {
    const form = node("form", "assign-form");
    const input = node("input"); input.placeholder = "Địa chỉ ví thợ: 0x…"; input.required = true;
    input.setAttribute("aria-label", `Địa chỉ thợ cho yêu cầu ${r.id}`);
    const button = node("button", "secondary", "Phân công"); button.type = "submit";
    form.append(input, button);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const address = input.value.trim();
      if (!isAddress(address) || getAddress(address) === ZeroAddress) { notice("Nhập địa chỉ ví Ethereum hợp lệ, khác địa chỉ 0.", "error"); return; }
      transaction("Phân công thợ", c => c.assignWorker(r.id, getAddress(address)));
    });
    card.append(form);
  }
  if (Number(r.status) === 1 && account) {
    const allowed = same(account, r.worker);
    const button = node("button", allowed ? "primary complete-button" : "secondary", allowed ? "Xác nhận hoàn thành ✓" : "Thử hoàn thành bằng tài khoản hiện tại");
    button.addEventListener("click", () => transaction("Hoàn thành yêu cầu", c => c.completeRequest(r.id)));
    if (allowed) card.append(button);
    else {
      const details = node("details", "test-action");
      details.append(node("summary", "", "Kiểm thử từ chối sai quyền"), node("p", "", "Tài khoản này không phải thợ được phân công. Hợp đồng sẽ từ chối thao tác."), button);
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
      const labels = { RequestCreated: `Tạo yêu cầu #${id}`, WorkerAssigned: `Phân công thợ cho yêu cầu #${id}`, RequestCompleted: `Hoàn thành yêu cầu #${id}` };
      const item = node("li", "", `${labels[parsed.name] ?? parsed.name} · Block ${event.blockNumber}`);
      item.append(node("code", "", `Tx: ${event.transactionHash}`)); list.append(item);
    }
    if (!list.children.length) list.append(node("li", "", "Chưa có sự kiện trong khoảng block này."));
  } catch { $("events").replaceChildren(node("li", "", "Chưa đọc được sự kiện. Bấm Làm mới để thử lại.")); }
}
async function loadRequests() {
  if (!contract || loading) return;
  loading = true; updateControls();
  try {
    // Detect a reset Ganache chain instead of showing stale deployment data.
    if (await reader.getCode(config.address) === "0x") throw new Error("Không tìm thấy hợp đồng. Ganache có thể đã được tạo lại; hãy chạy npm.cmd run deploy rồi tải lại trang.");
    total = Number(await contract.requestCount());
    page = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
    const newest = total - page * pageSize;
    const ids = Array.from({ length: Math.min(pageSize, newest) }, (_, i) => newest - i);
    const requests = await Promise.all(ids.map(id => contract.getRequest(id)));
    $("total").textContent = String(total);
    $("page-label").textContent = `Trang ${page + 1} / ${Math.max(1, Math.ceil(total / pageSize))}`;
    $("requests").replaceChildren(...requests.map(renderRequest));
    if (!requests.length) $("requests").append(node("p", "empty", "Chưa có yêu cầu nào. Hãy gửi yêu cầu bảo trì đầu tiên."));
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
  if (!description) { notice("Vui lòng nhập nội dung yêu cầu.", "error"); return; }
  transaction("Tạo yêu cầu", c => c.createRequest(description), () => { $("description").value = ""; page = 0; });
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
      $("account").textContent = "Ví đã thay đổi. Hãy kết nối lại.";
      $("role").textContent = ""; $("connect").textContent = "Kết nối lại ví";
      notice("Ví hoặc mạng đã thay đổi. Bấm Kết nối lại ví để cập nhật tài khoản.");
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
    if (Number((await reader.getNetwork()).chainId) !== config.chainId) throw new Error("Chain ID của Ganache khác cấu hình triển khai.");
    contract = new Contract(config.address, config.abi, reader);
    manager = await contract.manager();
    if (!same(manager, config.manager)) throw new Error("Thông tin triển khai không khớp. Hãy deploy lại.");
    $("manager").textContent = manager;
    available = true;
    notice("Đã kết nối Ganache để đọc dữ liệu. Kết nối ví khi bạn muốn gửi giao dịch.");
    await loadRequests();
  } catch (error) { notice(errorMessage(error), "error"); }
  updateControls();
}
await init();
setInterval(() => { if (available && !busy && !loading) loadRequests(); }, 12000);
