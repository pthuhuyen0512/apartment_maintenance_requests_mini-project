// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MaintenanceRequests {
    enum Status { Pending, Assigned, Completed }

    struct MaintenanceRequest {
        uint256 id;
        address resident;
        string description;
        address worker;
        Status status;
    }

    address public immutable manager;
    uint256 public requestCount;
    mapping(uint256 => MaintenanceRequest) private requests;

    event RequestCreated(uint256 indexed id, address indexed resident, string description);
    event WorkerAssigned(uint256 indexed id, address indexed worker);
    event RequestCompleted(uint256 indexed id, address indexed worker);

    constructor() { manager = msg.sender; }

    modifier onlyManager() {
        require(msg.sender == manager, "Only manager");
        _;
    }

    modifier existingRequest(uint256 id) {
        require(id > 0 && id <= requestCount, "Request does not exist");
        _;
    }

    function createRequest(string calldata description) external returns (uint256 id) {
        require(bytes(description).length > 0, "Description is required");
        id = ++requestCount;
        requests[id] = MaintenanceRequest(id, msg.sender, description, address(0), Status.Pending);
        emit RequestCreated(id, msg.sender, description);
    }

    function assignWorker(uint256 id, address worker) external onlyManager existingRequest(id) {
        require(worker != address(0), "Invalid worker address");
        MaintenanceRequest storage request = requests[id];
        require(request.status == Status.Pending, "Request is not pending");
        request.worker = worker;
        request.status = Status.Assigned;
        emit WorkerAssigned(id, worker);
    }

    function completeRequest(uint256 id) external existingRequest(id) {
        MaintenanceRequest storage request = requests[id];
        require(request.status == Status.Assigned, "Request is not assigned");
        require(msg.sender == request.worker, "Only assigned worker");
        request.status = Status.Completed;
        emit RequestCompleted(id, msg.sender);
    }

    function getRequest(uint256 id) external view existingRequest(id) returns (MaintenanceRequest memory) {
        return requests[id];
    }
}
