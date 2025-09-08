const hre = require("hardhat");
const Web3 = require("web3");
import * as ethers from "ethers"

const { FireblocksWeb3Provider, ChainId, ApiBaseUrl } = require("@fireblocks/fireblocks-web3-provider")

const eip1193Provider = new FireblocksWeb3Provider({
    privateKey: process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH,
    apiKey: process.env.FIREBLOCKS_API_KEY,
    vaultAccountIds: process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS,
    chainId: ChainId.SEPOLIA,
 // apiBaseUrl: ApiBaseUrl.Sandbox // If using a sandbox workspace
});

const OnchainID = require('@onchain-id/solidity');

const provider = new ethers.providers.Web3Provider(eip1193Provider);
hre.ethers.provider = provider;

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    
    console.log("Deploying T-REX Factory with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Step 1: Deploy all implementation contracts
    console.log("\n=== Step 1: Deploying Implementation Contracts ===");
    
    console.log("Deploying Token implementation...");
    const tokenImplementation = await hre.ethers.deployContract('Token', [], deployer);
    await tokenImplementation.waitForDeployment();
    console.log("Token implementation deployed to:", await tokenImplementation.getAddress());

    console.log("Deploying ClaimTopicsRegistry implementation...");
    const claimTopicsRegistryImplementation = await hre.ethers.deployContract('ClaimTopicsRegistry', [], deployer);
    await claimTopicsRegistryImplementation.waitForDeployment();
    console.log("ClaimTopicsRegistry implementation deployed to:", await claimTopicsRegistryImplementation.getAddress());

    console.log("Deploying TrustedIssuersRegistry implementation...");
    const trustedIssuersRegistryImplementation = await hre.ethers.deployContract('TrustedIssuersRegistry', [], deployer);
    await trustedIssuersRegistryImplementation.waitForDeployment();
    console.log("TrustedIssuersRegistry implementation deployed to:", await trustedIssuersRegistryImplementation.getAddress());

    console.log("Deploying IdentityRegistryStorage implementation...");
    const identityRegistryStorageImplementation = await hre.ethers.deployContract('IdentityRegistryStorage', [], deployer);
    await identityRegistryStorageImplementation.waitForDeployment();
    console.log("IdentityRegistryStorage implementation deployed to:", await identityRegistryStorageImplementation.getAddress());

    console.log("Deploying IdentityRegistry implementation...");
    const identityRegistryImplementation = await hre.ethers.deployContract('IdentityRegistry', [], deployer);
    await identityRegistryImplementation.waitForDeployment();
    console.log("IdentityRegistry implementation deployed to:", await identityRegistryImplementation.getAddress());

    console.log("Deploying ModularCompliance implementation...");
    const modularComplianceImplementation = await hre.ethers.deployContract('ModularCompliance', [], deployer);
    await modularComplianceImplementation.waitForDeployment();
    console.log("ModularCompliance implementation deployed to:", await modularComplianceImplementation.getAddress());

    // Step 2: Deploy OnchainID infrastructure
    console.log("\n=== Step 2: Deploying OnchainID Infrastructure ===");
    
    console.log("Deploying Identity implementation...");
    const identityImplementation = await new hre.ethers.ContractFactory(
        OnchainID.contracts.Identity.abi,
        OnchainID.contracts.Identity.bytecode,
        deployer,
    ).deploy(deployer.address, true);
    await identityImplementation.waitForDeployment();
    console.log("Identity implementation deployed to:", await identityImplementation.getAddress());

    console.log("Deploying IdentityImplementationAuthority...");
    const identityImplementationAuthority = await new hre.ethers.ContractFactory(
        OnchainID.contracts.ImplementationAuthority.abi,
        OnchainID.contracts.ImplementationAuthority.bytecode,
        deployer,
    ).deploy(await identityImplementation.getAddress());
    await identityImplementationAuthority.waitForDeployment();
    console.log("IdentityImplementationAuthority deployed to:", await identityImplementationAuthority.getAddress());

    console.log("Deploying IdentityFactory...");
    const identityFactory = await new hre.ethers.ContractFactory(
        OnchainID.contracts.Factory.abi, 
        OnchainID.contracts.Factory.bytecode, 
        deployer
    ).deploy(await identityImplementationAuthority.getAddress());
    await identityFactory.waitForDeployment();
    console.log("IdentityFactory deployed to:", await identityFactory.getAddress());

    // Step 3: Deploy and configure TREXImplementationAuthority
    console.log("\n=== Step 3: Deploying TREXImplementationAuthority ===");
    
    const trexImplementationAuthority = await hre.ethers.deployContract(
        'TREXImplementationAuthority',
        [true, hre.ethers.ZeroAddress, hre.ethers.ZeroAddress],
        deployer,
    );
    await trexImplementationAuthority.waitForDeployment();
    console.log("TREXImplementationAuthority deployed to:", await trexImplementationAuthority.getAddress());

    console.log("Adding T-REX version to implementation authority...");
    const versionStruct = {
        major: 4,
        minor: 0,
        patch: 0,
    };
    const contractsStruct = {
        tokenImplementation: await tokenImplementation.getAddress(),
        ctrImplementation: await claimTopicsRegistryImplementation.getAddress(),
        irImplementation: await identityRegistryImplementation.getAddress(),
        irsImplementation: await identityRegistryStorageImplementation.getAddress(),
        tirImplementation: await trustedIssuersRegistryImplementation.getAddress(),
        mcImplementation: await modularComplianceImplementation.getAddress(),
    };

    const addVersionTx = await trexImplementationAuthority.addAndUseTREXVersion(versionStruct, contractsStruct);
    await addVersionTx.wait();
    console.log("T-REX version added successfully");

    // Step 4: Deploy TREXFactory
    console.log("\n=== Step 4: Deploying TREXFactory ===");
    
    const trexFactory = await hre.ethers.deployContract('TREXFactory', [
        await trexImplementationAuthority.getAddress(),
        await identityFactory.getAddress()
    ], deployer);
    await trexFactory.waitForDeployment();
    console.log("TREXFactory deployed to:", await trexFactory.getAddress());

    // Step 5: Configure IdentityFactory to allow TREXFactory
    console.log("\n=== Step 5: Configuring IdentityFactory ===");
    
    const addTokenFactoryTx = await identityFactory.addTokenFactory(await trexFactory.getAddress());
    await addTokenFactoryTx.wait();
    console.log("TREXFactory added as token factory to IdentityFactory");

    // Step 6: Deploy IAFactory (Implementation Authority Factory)
    console.log("\n=== Step 6: Deploying IAFactory ===");
    
    const iaFactory = await hre.ethers.deployContract('IAFactory', [await trexFactory.getAddress()], deployer);
    await iaFactory.waitForDeployment();
    console.log("IAFactory deployed to:", await iaFactory.getAddress());

    // Step 7: Configure TREXImplementationAuthority with factories
    console.log("\n=== Step 7: Final Configuration ===");
    
    const setTREXFactoryTx = await trexImplementationAuthority.setTREXFactory(await trexFactory.getAddress());
    await setTREXFactoryTx.wait();
    
    const setIAFactoryTx = await trexImplementationAuthority.setIAFactory(await iaFactory.getAddress());
    await setIAFactoryTx.wait();
    console.log("TREXImplementationAuthority configured with factories");

    // Summary
    console.log("\n=== DEPLOYMENT SUMMARY ===");
    console.log("Implementation Contracts:");
    console.log("  Token:", await tokenImplementation.getAddress());
    console.log("  ClaimTopicsRegistry:", await claimTopicsRegistryImplementation.getAddress());
    console.log("  TrustedIssuersRegistry:", await trustedIssuersRegistryImplementation.getAddress());
    console.log("  IdentityRegistryStorage:", await identityRegistryStorageImplementation.getAddress());
    console.log("  IdentityRegistry:", await identityRegistryImplementation.getAddress());
    console.log("  ModularCompliance:", await modularComplianceImplementation.getAddress());
    console.log("\nOnchainID Infrastructure:");
    console.log("  Identity:", await identityImplementation.getAddress());
    console.log("  IdentityImplementationAuthority:", await identityImplementationAuthority.getAddress());
    console.log("  IdentityFactory:", await identityFactory.getAddress());
    console.log("\nT-REX Infrastructure:");
    console.log("  TREXImplementationAuthority:", await trexImplementationAuthority.getAddress());
    console.log("  TREXFactory:", await trexFactory.getAddress());
    console.log("  IAFactory:", await iaFactory.getAddress());
    console.log("\n✅ All contracts deployed successfully!");
    console.log("\n🚀 You can now use TREXFactory.deployTREXSuite() to deploy token suites");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });