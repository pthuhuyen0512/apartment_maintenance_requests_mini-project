import assert from "node:assert/strict";
import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

// Ganache Desktop can return a plain ProviderError instead of ethers CALL_EXCEPTION.
// Check the actual rejection reason on both Ganache and Hardhat.
async function rejects(action, reason) {
  await assert.rejects(action, (error) => {
    expect(error.message).to.include(reason);
    return true;
  });
}

describe("MaintenanceRequests", function () {
  async function setup() {
    const [manager, resident, worker, stranger] = await ethers.getSigners();
    const contract = await ethers.deployContract("MaintenanceRequests", [], manager);
    await contract.waitForDeployment();
    return { contract, manager, resident, worker, stranger };
  }

  it("sets deployer as manager", async function () {
    const { contract, manager } = await setup();
    expect(await contract.manager()).to.equal(manager.address);
    expect(await contract.requestCount()).to.equal(0n);
  });
  it("stores resident, description, initial status and emits creation event", async function () {
    const { contract, resident } = await setup();
    await expect(contract.connect(resident).createRequest("Leaking tap A101"))
      .to.emit(contract, "RequestCreated").withArgs(1n, resident.address, "Leaking tap A101");
    const r = await contract.getRequest(1);
    expect(r.id).to.equal(1n);
    expect(r.resident).to.equal(resident.address);
    expect(r.description).to.equal("Leaking tap A101");
    expect(r.worker).to.equal(ethers.ZeroAddress);
    expect(r.status).to.equal(0n);
  });
  it("rejects an empty description", async function () {
    const { contract, resident } = await setup();
    await rejects(contract.connect(resident).createRequest(""), "Description is required");
    expect(await contract.requestCount()).to.equal(0n);
  });
  it("allocates separate IDs and keeps requests independent", async function () {
    const { contract, resident, worker } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await (await contract.connect(resident).createRequest("A102")).wait();
    await (await contract.assignWorker(1, worker.address)).wait();
    expect(await contract.requestCount()).to.equal(2n);
    expect((await contract.getRequest(1)).status).to.equal(1n);
    expect((await contract.getRequest(2)).status).to.equal(0n);
  });
  it("rejects assignment from a resident", async function () {
    const { contract, resident, worker } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await rejects(contract.connect(resident).assignWorker(1, worker.address), "Only manager");
    const r = await contract.getRequest(1);
    expect(r.status).to.equal(0n);
    expect(r.worker).to.equal(ethers.ZeroAddress);
  });
  it("manager assigns a worker and emits the assignment event", async function () {
    const { contract, resident, worker } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await expect(contract.assignWorker(1, worker.address)).to.emit(contract, "WorkerAssigned").withArgs(1n, worker.address);
    const r = await contract.getRequest(1);
    expect(r.worker).to.equal(worker.address);
    expect(r.status).to.equal(1n);
  });
  it("rejects the zero worker address", async function () {
    const { contract, resident } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await rejects(contract.assignWorker(1, ethers.ZeroAddress), "Invalid worker address");
  });
  it("does not allow reassignment", async function () {
    const { contract, resident, worker, stranger } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await (await contract.assignWorker(1, worker.address)).wait();
    await rejects(contract.assignWorker(1, stranger.address), "Request is not pending");
    expect((await contract.getRequest(1)).worker).to.equal(worker.address);
  });
  it("cannot complete a pending request", async function () {
    const { contract, resident } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await rejects(contract.connect(resident).completeRequest(1), "Request is not assigned");
  });
  for (const actor of ["resident", "manager", "stranger"]) {
    it(`rejects completion by ${actor} and preserves state`, async function () {
      const context = await setup();
      const { contract, resident, worker } = context;
      await (await contract.connect(resident).createRequest("A101")).wait();
      await (await contract.assignWorker(1, worker.address)).wait();
      await rejects(contract.connect(context[actor]).completeRequest(1), "Only assigned worker");
      expect((await contract.getRequest(1)).status).to.equal(1n);
    });
  }
  it("assigned worker completes the request and emits completion event", async function () {
    const { contract, resident, worker } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await (await contract.assignWorker(1, worker.address)).wait();
    await expect(contract.connect(worker).completeRequest(1)).to.emit(contract, "RequestCompleted").withArgs(1n, worker.address);
    expect((await contract.getRequest(1)).status).to.equal(2n);
  });
  it("rejects completion twice and assigning a completed request", async function () {
    const { contract, resident, worker } = await setup();
    await (await contract.connect(resident).createRequest("A101")).wait();
    await (await contract.assignWorker(1, worker.address)).wait();
    await (await contract.connect(worker).completeRequest(1)).wait();
    await rejects(contract.connect(worker).completeRequest(1), "Request is not assigned");
    await rejects(contract.assignWorker(1, worker.address), "Request is not pending");
  });
  for (const id of [0, 999]) {
    it(`rejects nonexistent request ID ${id} for reads, assignment, completion`, async function () {
      const { contract, worker } = await setup();
      await rejects(contract.getRequest(id), "Request does not exist");
      await rejects(contract.assignWorker(id, worker.address), "Request does not exist");
      await rejects(contract.connect(worker).completeRequest(id), "Request does not exist");
    });
  }
});
