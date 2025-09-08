import * as dotenv from "dotenv";
import { FireblocksWeb3Provider, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function main() {
    // Check for force flag
    const forceRedeploy = process.argv.includes('--force');
    if (forceRedeploy) {
        console.log("🔄 Force redeploy flag detected - will redeploy all contracts");
    }

    // Create deployment state object
    const deploymentState = {
        timestamp: new Date().toISOString(),
        network: ChainId.HOODI,
        deployer: null,
        contracts: {},
        progress: {
            step: 0,
            description: "Starting deployment..."
        }
    };

    // Helper function to save deployment state
    function saveDeploymentState() {
        const filename = `deployment-state.json`;
        const filepath = path.join(__dirname, filename);
        fs.writeFileSync(filepath, JSON.stringify(deploymentState, null, 2));
        console.log(`💾 Deployment state saved to: ${filename}`);
        return filename;
    }

    // Helper function to update progress
    function updateProgress(step, description, contractName = null, contractAddress = null) {
        deploymentState.progress.step = step;
        deploymentState.progress.description = description;
        deploymentState.progress.lastUpdated = new Date().toISOString();
        
        if (contractName && contractAddress) {
            deploymentState.contracts[contractName] = contractAddress;
        }
        
        console.log(`📍 Step ${step}: ${description}`);
        saveDeploymentState();
    }

    // Helper function to load existing deployment state
    function loadExistingDeployment() {
        try {
            const filepath = path.join(__dirname, 'deployment-state.json');
            
            if (fs.existsSync(filepath)) {
                const data = fs.readFileSync(filepath, 'utf8');
                const existingState = JSON.parse(data);
                
                console.log(`📂 Found existing deployment state from: ${existingState.timestamp}`);
                console.log(`📊 Last progress: Step ${existingState.progress.step} - ${existingState.progress.description}`);
                
                return existingState;
            }
        } catch (error) {
            console.log("No existing deployment found or error reading state, starting fresh...");
        }
        return null;
    }

    // Helper function to check if contract is deployed at address
    async function isContractDeployed(provider, address) {
        if (!address || !ethers.utils.isAddress(address)) {
            return false;
        }
        
        try {
            const code = await provider.getCode(address);
            return code !== "0x" && code !== "0x0";
        } catch (error) {
            return false;
        }
    }

    // Helper function to conditionally deploy contract
    async function deployIfNeeded(contractName, contractFactory, deployArgs = [], description = "") {
        // Check if already deployed (unless force flag is set)
        if (!forceRedeploy && deploymentState.contracts[contractName]) {
            const address = deploymentState.contracts[contractName];
            const isDeployed = await isContractDeployed(provider, address);
            
            if (isDeployed) {
                console.log(`⏭️  Skipping ${contractName} - already deployed at: ${address}`);
                return contractFactory.attach(address);
            } else {
                console.log(`🔄 ${contractName} address found but contract not deployed, redeploying...`);
                delete deploymentState.contracts[contractName];
            }
        } else if (forceRedeploy && deploymentState.contracts[contractName]) {
            console.log(`🔄 Force redeploy: ${contractName}`);
            delete deploymentState.contracts[contractName];
        }
        
        // Deploy the contract
        console.log(`🚀 Deploying ${contractName}${description ? ` - ${description}` : ''}...`);
        const contract = await contractFactory.deploy(...deployArgs);
        await contract.deployed();
        
        console.log(`✅ ${contractName} deployed at: ${contract.address}`);
        deploymentState.contracts[contractName] = contract.address;
        saveDeploymentState();
        
        return contract;
    }
    // Create Fireblocks provider
    const eip1193Provider = new FireblocksWeb3Provider({
        privateKey: process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH,
        apiKey: process.env.FIREBLOCKS_API_KEY,
        vaultAccountIds: process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS,
        chainId: ChainId.HOODI,
    });

    // Create ethers provider
    const provider = new ethers.providers.Web3Provider(eip1193Provider);
    const signer = provider.getSigner();
    const deployer = signer; // Use signer as deployer
    
    // Get accounts from provider
    const accounts = await provider.listAccounts();
    
    // Check for existing deployment and load if found
    const existingDeployment = !forceRedeploy ? loadExistingDeployment() : null;
    if (existingDeployment && !forceRedeploy) {
        console.log("🔍 Loading existing deployment state...");
        
        // Merge existing state into current deployment state
        deploymentState.contracts = { ...existingDeployment.contracts };
        deploymentState.progress = { ...existingDeployment.progress };
        deploymentState.deployer = existingDeployment.deployer;
        
        // If deployment was completed, exit early unless force flag is used
        if (existingDeployment.completed) {
            console.log("🎉 Deployment already completed!");
            console.log("📋 Summary of deployed contracts:");
            for (const [name, address] of Object.entries(existingDeployment.contracts)) {
                console.log(`  ${name}: ${address}`);
            }
            console.log("\n✅ All contracts are already deployed and configured.");
            console.log("💡 Use --force flag to redeploy everything.");
            return;
        }
        
        // Verify existing contracts are still deployed
        console.log("🔍 Verifying existing contract deployments...");
        const contractsToRemove = [];
        for (const [contractName, address] of Object.entries(deploymentState.contracts)) {
            const isDeployed = await isContractDeployed(provider, address);
            if (isDeployed) {
                console.log(`✅ ${contractName} verified at: ${address}`);
            } else {
                console.log(`❌ ${contractName} not found at: ${address}, will redeploy`);
                contractsToRemove.push(contractName);
            }
        }
        
        // Remove contracts that are no longer deployed
        contractsToRemove.forEach(name => delete deploymentState.contracts[name]);
        
        console.log(`📊 Resuming from step ${deploymentState.progress.step}: ${deploymentState.progress.description}`);
    } else if (forceRedeploy) {
        console.log("🔄 Force redeploy mode - clearing all existing state");
        // Reset deployment state for force redeploy
        deploymentState.contracts = {};
        deploymentState.progress = { step: 0, description: "Force redeployment starting..." };
    }    // Update deployment state with deployer info (only if not already set)
    if (!deploymentState.deployer) {
        deploymentState.deployer = accounts[0];
        updateProgress(0, "Initialized deployer");
    } else {
        console.log("📋 Using existing deployer:", deploymentState.deployer);
    }
    
    console.log("Deploying T-REX Factory with account:", accounts[0]);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Debug environment variables
    console.log("Environment variables check:");
    console.log("FIREBLOCKS_API_PRIVATE_KEY_PATH:", process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH ? "✓ Set" : "✗ Missing");
    console.log("FIREBLOCKS_API_KEY:", process.env.FIREBLOCKS_API_KEY ? "✓ Set" : "✗ Missing");
    console.log("FIREBLOCKS_VAULT_ACCOUNT_IDS:", process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS ? "✓ Set" : "✗ Missing");

    // Helper function to load contract artifacts and create factory
    function getContractArtifact(contractName) {
        const artifactPath = path.join(process.cwd(), 'artifacts', 'contracts');
        
        // Common contract paths
        const contractPaths = {
            'Token': 'token/Token.sol/Token.json',
            'ClaimTopicsRegistry': 'registry/implementation/ClaimTopicsRegistry.sol/ClaimTopicsRegistry.json',
            'TrustedIssuersRegistry': 'registry/implementation/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json',
            'IdentityRegistryStorage': 'registry/implementation/IdentityRegistryStorage.sol/IdentityRegistryStorage.json',
            'IdentityRegistry': 'registry/implementation/IdentityRegistry.sol/IdentityRegistry.json',
            'ModularCompliance': 'compliance/modular/ModularCompliance.sol/ModularCompliance.json',
            'TREXImplementationAuthority': 'proxy/authority/TREXImplementationAuthority.sol/TREXImplementationAuthority.json',
            'TREXFactory': 'factory/TREXFactory.sol/TREXFactory.json',
            'IAFactory': 'proxy/authority/IAFactory.sol/IAFactory.json'
        };

        if (contractPaths[contractName]) {
            const fullPath = path.join(artifactPath, contractPaths[contractName]);
            console.log(`Loading T-REX artifact for ${contractName} from: ${fullPath}`);
            
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Artifact file not found: ${fullPath}`);
            }
            
            const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            
            if (!artifact.abi || !artifact.bytecode) {
                throw new Error(`Invalid artifact for ${contractName}: missing abi or bytecode`);
            }
            
            return new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
        } else {
            throw new Error(`Unknown contract: ${contractName}`);
        }
    }

    // Helper function for OnchainID contracts using the npm package
    function getOnchainIDContractFactory(contractType) {
        console.log(`Loading OnchainID contract: ${contractType}`);
        
        const onchainIDPath = path.join(process.cwd(), 'node_modules', '@onchain-id', 'solidity', 'artifacts', 'contracts');
        
        let artifactPath;
        switch (contractType) {
            case 'Identity':
                artifactPath = path.join(onchainIDPath, 'Identity.sol', 'Identity.json');
                break;
            case 'ImplementationAuthority':
                artifactPath = path.join(onchainIDPath, 'proxy', 'ImplementationAuthority.sol', 'ImplementationAuthority.json');
                break;
            case 'Factory':
                artifactPath = path.join(onchainIDPath, 'factory', 'IdFactory.sol', 'IdFactory.json');
                break;
            default:
                throw new Error(`Unknown OnchainID contract: ${contractType}`);
        }
        
        console.log(`Loading OnchainID artifact from: ${artifactPath}`);
        
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`OnchainID artifact file not found: ${artifactPath}`);
        }
        
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        
        if (!artifact.abi || !artifact.bytecode) {
            throw new Error(`Invalid OnchainID artifact ${contractType}: missing abi or bytecode`);
        }
        
        return new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    }

    // Step 1: Deploy all implementation contracts
    console.log("\n=== Step 1: Deploying Implementation Contracts ===");
    updateProgress(1, "Starting implementation contracts deployment");
    
    const TokenFactory = getContractArtifact('Token');
    const tokenImplementation = await deployIfNeeded('TokenImplementation', TokenFactory, [], "Token implementation");
    updateProgress(1.1, "Token implementation deployment completed", "TokenImplementation", tokenImplementation.address);

    const CTRFactory = getContractArtifact('ClaimTopicsRegistry');
    const claimTopicsRegistryImplementation = await deployIfNeeded('ClaimTopicsRegistryImplementation', CTRFactory, [], "ClaimTopicsRegistry implementation");
    updateProgress(1.2, "ClaimTopicsRegistry implementation deployment completed", "ClaimTopicsRegistryImplementation", claimTopicsRegistryImplementation.address);

    const TIRFactory = getContractArtifact('TrustedIssuersRegistry');
    const trustedIssuersRegistryImplementation = await deployIfNeeded('TrustedIssuersRegistryImplementation', TIRFactory, [], "TrustedIssuersRegistry implementation");
    updateProgress(1.3, "TrustedIssuersRegistry implementation deployment completed", "TrustedIssuersRegistryImplementation", trustedIssuersRegistryImplementation.address);

    const IRSFactory = getContractArtifact('IdentityRegistryStorage');
    const identityRegistryStorageImplementation = await deployIfNeeded('IdentityRegistryStorageImplementation', IRSFactory, [], "IdentityRegistryStorage implementation");
    updateProgress(1.4, "IdentityRegistryStorage implementation deployment completed", "IdentityRegistryStorageImplementation", identityRegistryStorageImplementation.address);

    const IRFactory = getContractArtifact('IdentityRegistry');
    const identityRegistryImplementation = await deployIfNeeded('IdentityRegistryImplementation', IRFactory, [], "IdentityRegistry implementation");
    updateProgress(1.5, "IdentityRegistry implementation deployment completed", "IdentityRegistryImplementation", identityRegistryImplementation.address);

    const MCFactory = getContractArtifact('ModularCompliance');
    const modularComplianceImplementation = await deployIfNeeded('ModularComplianceImplementation', MCFactory, [], "ModularCompliance implementation");
    updateProgress(1.6, "All implementation contracts deployment completed", "ModularComplianceImplementation", modularComplianceImplementation.address);

    // Step 2: Deploy OnchainID infrastructure
    console.log("\n=== Step 2: Deploying OnchainID Infrastructure ===");
    updateProgress(2, "Starting OnchainID infrastructure deployment");
    
    const IdentityFactory = getOnchainIDContractFactory('Identity');
    const identityImplementation = await deployIfNeeded('IdentityImplementation', IdentityFactory, [accounts[0], true], "Identity implementation");
    updateProgress(2.1, "Identity implementation deployment completed", "IdentityImplementation", identityImplementation.address);

    const IdentityImplementationAuthorityFactory = getOnchainIDContractFactory('ImplementationAuthority');
    const identityImplementationAuthority = await deployIfNeeded('IdentityImplementationAuthority', IdentityImplementationAuthorityFactory, [identityImplementation.address], "IdentityImplementationAuthority");
    updateProgress(2.2, "IdentityImplementationAuthority deployment completed", "IdentityImplementationAuthority", identityImplementationAuthority.address);

    const IdentityFactoryFactory = getOnchainIDContractFactory('Factory');
    const identityFactory = await deployIfNeeded('IdentityFactory', IdentityFactoryFactory, [identityImplementationAuthority.address], "IdentityFactory");
    updateProgress(2.3, "OnchainID infrastructure deployment completed", "IdentityFactory", identityFactory.address);

    // Step 3: Deploy and configure TREXImplementationAuthority
    console.log("\n=== Step 3: Deploying TREXImplementationAuthority ===");
    updateProgress(3, "Deploying TREXImplementationAuthority");
    
    const TREXImplAuthorityFactory = getContractArtifact('TREXImplementationAuthority');
    const trexImplementationAuthority = await deployIfNeeded('TREXImplementationAuthority', TREXImplAuthorityFactory, [
        true, 
        ethers.constants.AddressZero, 
        ethers.constants.AddressZero
    ], "TREXImplementationAuthority");
    updateProgress(3.1, "TREXImplementationAuthority deployment completed", "TREXImplementationAuthority", trexImplementationAuthority.address);

    // Only configure if this is a fresh deployment or configuration wasn't completed
    const needsVersionConfig = !deploymentState.contracts.TREXImplementationAuthority || 
                              !deploymentState.progress.versionConfigured;
    
    if (needsVersionConfig) {
        console.log("Adding T-REX version to implementation authority...");
        const versionStruct = {
            major: 4,
            minor: 0,
            patch: 0,
        };
        const contractsStruct = {
            tokenImplementation: tokenImplementation.address,
            ctrImplementation: claimTopicsRegistryImplementation.address,
            irImplementation: identityRegistryImplementation.address,
            irsImplementation: identityRegistryStorageImplementation.address,
            tirImplementation: trustedIssuersRegistryImplementation.address,
            mcImplementation: modularComplianceImplementation.address,
        };

        const addVersionTx = await trexImplementationAuthority.addAndUseTREXVersion(versionStruct, contractsStruct);
        await addVersionTx.wait();
        console.log("T-REX version added successfully");
        deploymentState.progress.versionConfigured = true;
    } else {
        console.log("⏭️  Skipping T-REX version configuration - already completed");
    }
    updateProgress(3.2, "T-REX version configuration completed");

    // Step 4: Deploy TREXFactory
    console.log("\n=== Step 4: Deploying TREXFactory ===");
    updateProgress(4, "Deploying TREXFactory");
    
    const TREXFactoryFactory = getContractArtifact('TREXFactory');
    const trexFactory = await deployIfNeeded('TREXFactory', TREXFactoryFactory, [
        trexImplementationAuthority.address,
        identityFactory.address
    ], "TREXFactory");
    updateProgress(4.1, "TREXFactory deployment completed", "TREXFactory", trexFactory.address);

    // Step 5: Configure IdentityFactory to allow TREXFactory
    console.log("\n=== Step 5: Configuring IdentityFactory ===");
    updateProgress(5, "Configuring IdentityFactory");
    
    // Only configure if TREXFactory was just deployed or not configured yet
    if (!deploymentState.progress.identityFactoryConfigured) {
        try {
            const addTokenFactoryTx = await identityFactory.addTokenFactory(trexFactory.address);
            await addTokenFactoryTx.wait();
            console.log("TREXFactory added as token factory to IdentityFactory");
            deploymentState.progress.identityFactoryConfigured = true;
        } catch (error) {
            if (error.message.includes("already a TokenFactory")) {
                console.log("⏭️  TREXFactory already configured in IdentityFactory");
                deploymentState.progress.identityFactoryConfigured = true;
            } else {
                throw error;
            }
        }
    } else {
        console.log("⏭️  Skipping IdentityFactory configuration - already completed");
    }
    updateProgress(5.1, "IdentityFactory configuration completed");

    // Step 6: Deploy IAFactory (Implementation Authority Factory)
    console.log("\n=== Step 6: Deploying IAFactory ===");
    updateProgress(6, "Deploying IAFactory");
    
    const IAFactoryFactory = getContractArtifact('IAFactory');
    const iaFactory = await deployIfNeeded('IAFactory', IAFactoryFactory, [trexFactory.address], "IAFactory");
    updateProgress(6.1, "IAFactory deployment completed", "IAFactory", iaFactory.address);

    // Step 7: Configure TREXImplementationAuthority with factories
    console.log("\n=== Step 7: Final Configuration ===");
    updateProgress(7, "Final configuration");
    
    // Only configure if not already done
    if (!deploymentState.progress.trexFactoryConfigured) {
        try {
            const setTREXFactoryTx = await trexImplementationAuthority.setTREXFactory(trexFactory.address);
            await setTREXFactoryTx.wait();
            console.log("TREXFactory configured in TREXImplementationAuthority");
            deploymentState.progress.trexFactoryConfigured = true;
        } catch (error) {
            if (error.message.includes("already set") || error.message.includes("same")) {
                console.log("⏭️  TREXFactory already configured in TREXImplementationAuthority");
                deploymentState.progress.trexFactoryConfigured = true;
            } else {
                throw error;
            }
        }
    } else {
        console.log("⏭️  Skipping TREXFactory configuration - already completed");
    }
    
    if (!deploymentState.progress.iaFactoryConfigured) {
        try {
            const setIAFactoryTx = await trexImplementationAuthority.setIAFactory(iaFactory.address);
            await setIAFactoryTx.wait();
            console.log("IAFactory configured in TREXImplementationAuthority");
            deploymentState.progress.iaFactoryConfigured = true;
        } catch (error) {
            if (error.message.includes("already set") || error.message.includes("same")) {
                console.log("⏭️  IAFactory already configured in TREXImplementationAuthority");
                deploymentState.progress.iaFactoryConfigured = true;
            } else {
                throw error;
            }
        }
    } else {
        console.log("⏭️  Skipping IAFactory configuration - already completed");
    }
    updateProgress(7.1, "All configurations completed");

    // Final deployment state
    updateProgress(8, "Deployment completed successfully!");
    deploymentState.completed = true;
    deploymentState.completedAt = new Date().toISOString();
    
    // Save final deployment state
    saveDeploymentState();
    
    // Also create a backup with timestamp for reference
    const backupFilename = `deployment-complete-${Date.now()}.json`;
    const backupFilepath = path.join(__dirname, backupFilename);
    fs.writeFileSync(backupFilepath, JSON.stringify(deploymentState, null, 2));

    // Summary
    console.log("\n=== DEPLOYMENT SUMMARY ===");
    console.log("Implementation Contracts:");
    console.log("  Token:", tokenImplementation.address);
    console.log("  ClaimTopicsRegistry:", claimTopicsRegistryImplementation.address);
    console.log("  TrustedIssuersRegistry:", trustedIssuersRegistryImplementation.address);
    console.log("  IdentityRegistryStorage:", identityRegistryStorageImplementation.address);
    console.log("  IdentityRegistry:", identityRegistryImplementation.address);
    console.log("  ModularCompliance:", modularComplianceImplementation.address);
    console.log("\nOnchainID Infrastructure:");
    console.log("  Identity:", identityImplementation.address);
    console.log("  IdentityImplementationAuthority:", identityImplementationAuthority.address);
    console.log("  IdentityFactory:", identityFactory.address);
    console.log("\nT-REX Infrastructure:");
    console.log("  TREXImplementationAuthority:", trexImplementationAuthority.address);
    console.log("  TREXFactory:", trexFactory.address);
    console.log("  IAFactory:", iaFactory.address);
    console.log("\n✅ All contracts deployed successfully!");
    console.log(`💾 Complete deployment saved to: deployment-state.json`);
    console.log(`📁 Backup created: ${backupFilename}`);
    console.log("\n🚀 You can now use TREXFactory.deployTREXSuite() to deploy token suites");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });