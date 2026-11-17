import "dotenv/config";
import { defineConfig } from "hardhat/config";
import toolbox from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [toolbox],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    ganache: {
      type: "http",
      chainType: "l1",
      url: process.env.GANACHE_RPC_URL ?? "http://127.0.0.1:7545",
      chainId: Number(process.env.GANACHE_CHAIN_ID ?? 1337),
      accounts: "remote",
    },
  },
  test: { mocha: { timeout: 60000 } },
});
