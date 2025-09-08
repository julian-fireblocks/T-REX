import '@xyrusworx/hardhat-solidity-json';
import '@nomicfoundation/hardhat-toolbox';
import { HardhatUserConfig } from 'hardhat/config';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import '@nomiclabs/hardhat-solhint';
import '@primitivefi/hardhat-dodoc';
import { FireblocksWeb3Provider, ChainId } from "@fireblocks/fireblocks-web3-provider";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Default local network
    },
    hoodi: {
      url: "https://rpc.hoodi.io", // Replace with actual Hoodi RPC URL
      // Fireblocks provider will be set up in the script
    },
    sepolia: {
      url: "https://ethereum-sepolia.publicnode.com",
      // Fireblocks provider will be set up in the script
    }
  },
  gasReporter: {
    enabled: true,
  },
  dodoc: {
    runOnCompile: false,
    debugMode: true,
    outputDir: "./docgen",
    freshOutput: true,
  },
};

export default config;
