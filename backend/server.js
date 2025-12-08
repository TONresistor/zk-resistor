require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { MerkleTree } = require('./merkle-tree');

// Simple rate limiter (in-memory)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!rateLimits.has(ip)) {
        rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return next();
    }

    const limit = rateLimits.get(ip);
    if (now > limit.resetAt) {
        limit.count = 1;
        limit.resetAt = now + RATE_LIMIT_WINDOW;
        return next();
    }

    if (limit.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }

    limit.count++;
    next();
}
const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { beginCell, Address, toNano } = require('@ton/core');
const { getHttpEndpoint } = require('@orbs-network/ton-access');

const app = express();
app.use(cors());
app.use(express.json());

// ========== CONFIGURATION ==========
const MIXER_CONTRACT = process.env.MIXER_CONTRACT;
const REDO_JETTON_MASTER = process.env.REDO_JETTON_MASTER;
const TON_RPC = process.env.TON_RPC || 'https://toncenter.com/api/v2/jsonRPC';
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY;
const ADMIN_MNEMONIC = process.env.ADMIN_MNEMONIC;
const DEPOSIT_AMOUNT = '100'; // 100 REDO

// TON Client and wallet (initialized on startup)
let tonClient = null;
let adminWallet = null;
let adminKeyPair = null;

// Merkle tree state (synced with blockchain)
const tree = new MerkleTree();
const commitments = new Map(); // commitment -> { leafIndex, txHash, timestamp }
const spentNullifiers = new Set();

// ========== TON BLOCKCHAIN SYNC ==========

async function initTonClient() {
    if (tonClient) return;

    try {
        let endpoint;
        let apiKey = undefined;

        if (TONCENTER_API_KEY) {
            // Try Toncenter first
            endpoint = 'https://toncenter.com/api/v2/jsonRPC';
            apiKey = TONCENTER_API_KEY;

            // Test the API key
            const testClient = new TonClient({ endpoint, apiKey });
            try {
                await testClient.getBalance(Address.parse(MIXER_CONTRACT));
                console.log('Using Toncenter API (10 req/s)');
            } catch (e) {
                if (e.message.includes('401') || e.message.includes('API key')) {
                    console.warn('Toncenter API key invalid, falling back to Orbs');
                    endpoint = await getHttpEndpoint({ network: 'mainnet' });
                    apiKey = undefined;
                    console.log('Using Orbs endpoint');
                } else {
                    throw e;
                }
            }
        } else {
            endpoint = await getHttpEndpoint({ network: 'mainnet' });
            console.log('Using Orbs endpoint (no Toncenter key)');
        }

        tonClient = new TonClient({ endpoint, apiKey });

        if (ADMIN_MNEMONIC) {
            const mnemonic = ADMIN_MNEMONIC.replace(/"/g, '').split(' ');
            adminKeyPair = await mnemonicToPrivateKey(mnemonic);
            adminWallet = WalletContractV4.create({
                workchain: 0,
                publicKey: adminKeyPair.publicKey
            });
            console.log('Admin wallet initialized:', adminWallet.address.toString());
        } else {
            console.warn('ADMIN_MNEMONIC not set - root sync disabled');
        }
    } catch (e) {
        console.error('Failed to init TON client:', e.message);
    }
}

// ========== BLOCKCHAIN INDEXER ==========
// Scans the blockchain for deposits and syncs the Merkle tree

async function getOnChainNextIndex() {
    if (!tonClient) return 0;

    try {
        const contract = tonClient.open({
            address: Address.parse(MIXER_CONTRACT),
            init: null
        });

        const result = await tonClient.runMethod(
            Address.parse(MIXER_CONTRACT),
            'get_next_index'
        );

        return Number(result.stack.readNumber());
    } catch (e) {
        console.error('Failed to get on-chain next_index:', e.message);
        return 0;
    }
}

async function getOnChainCommitmentIndex(commitment) {
    if (!tonClient) return -1;

    try {
        const result = await tonClient.runMethod(
            Address.parse(MIXER_CONTRACT),
            'get_commitment_index',
            [{ type: 'int', value: BigInt(commitment) }]
        );

        return Number(result.stack.readNumber());
    } catch (e) {
        console.error('Failed to get commitment index:', e.message);
        return -1;
    }
}

async function indexMissingDeposits() {
    if (!tonClient) {
        console.warn('Cannot index: TON client not initialized');
        return;
    }

    try {
        const onChainIndex = await getOnChainNextIndex();
        const localIndex = tree.getNextIndex();

        if (onChainIndex <= localIndex) {
            return; // Already in sync
        }

        console.log(`Indexer: Found ${onChainIndex - localIndex} missing deposits (local: ${localIndex}, chain: ${onChainIndex})`);

        // Get recent transactions from the mixer contract
        const transactions = await tonClient.getTransactions(
            Address.parse(MIXER_CONTRACT),
            { limit: 100 }
        );

        // Parse transfer_notification transactions to find deposits
        const deposits = [];

        for (const tx of transactions) {
            try {
                // Check if this is an incoming message
                if (!tx.inMessage || tx.inMessage.info.type !== 'internal') continue;

                const body = tx.inMessage.body;
                if (!body || body.bits.length < 32) continue;

                // Parse the body
                const slice = body.beginParse();
                const op = slice.loadUint(32);

                // Check if it's a transfer_notification (0x7362d09c)
                if (op !== 0x7362d09c) continue;

                const queryId = slice.loadUint(64);
                const amount = slice.loadCoins();
                const fromUser = slice.loadAddress();

                // Parse forward_payload (Either Cell ^Cell)
                const eitherBit = slice.loadBit();
                let forwardPayload;
                if (eitherBit) {
                    forwardPayload = slice.loadRef().beginParse();
                } else {
                    forwardPayload = slice;
                }

                // Parse deposit payload: op(32) + query_id(64) + commitment(256)
                if (forwardPayload.remainingBits < 352) continue;

                const payloadOp = forwardPayload.loadUint(32);
                if (payloadOp !== 0x1) continue; // op::deposit

                const payloadQueryId = forwardPayload.loadUint(64);
                const commitment = forwardPayload.loadUintBig(256);

                // Get the leaf index from on-chain
                const leafIndex = await getOnChainCommitmentIndex(commitment.toString());
                if (leafIndex < 0) continue;

                deposits.push({
                    commitment: commitment.toString(),
                    leafIndex,
                    timestamp: tx.now * 1000
                });

            } catch (e) {
                // Skip unparseable transactions
                continue;
            }
        }

        // Sort by leafIndex to insert in correct order
        deposits.sort((a, b) => a.leafIndex - b.leafIndex);

        // Add missing deposits to our tree
        let addedCount = 0;
        for (const deposit of deposits) {
            if (!commitments.has(deposit.commitment) && deposit.leafIndex >= localIndex) {
                // Insert into tree (must be in order)
                if (deposit.leafIndex === tree.getNextIndex()) {
                    tree.insert(BigInt(deposit.commitment));
                    commitments.set(deposit.commitment, {
                        leafIndex: deposit.leafIndex,
                        txHash: null,
                        timestamp: deposit.timestamp
                    });
                    addedCount++;
                    console.log(`Indexer: Added deposit at index ${deposit.leafIndex}`);
                }
            }
        }

        if (addedCount > 0) {
            saveState();

            // Sync the new root to the contract
            const newRoot = tree.getRoot();
            console.log(`Indexer: Syncing new root after ${addedCount} deposits`);
            syncRootToContract(newRoot).catch(e => {
                console.error('Indexer: Root sync failed:', e.message);
            });
        }

    } catch (e) {
        console.error('Indexer error:', e.message);
    }
}

// Run indexer periodically
const INDEXER_INTERVAL = 10000; // 10 seconds
let indexerRunning = false;

async function runIndexer() {
    if (indexerRunning) return;
    indexerRunning = true;

    try {
        await indexMissingDeposits();
    } finally {
        indexerRunning = false;
    }
}

function startIndexer() {
    console.log(`Starting blockchain indexer (interval: ${INDEXER_INTERVAL/1000}s)`);
    setInterval(runIndexer, INDEXER_INTERVAL);
    // Run immediately on startup
    runIndexer();
}

async function syncRootToContract(newRoot) {
    if (!tonClient || !adminWallet || !adminKeyPair) {
        console.warn('Cannot sync root: TON client or admin wallet not initialized');
        return false;
    }

    try {
        const walletContract = tonClient.open(adminWallet);
        const seqno = await walletContract.getSeqno();

        // Build update_root message: op(32) + query_id(64) + new_root(256)
        const OP_UPDATE_ROOT = 0x3;
        const body = beginCell()
            .storeUint(OP_UPDATE_ROOT, 32)
            .storeUint(0, 64) // query_id
            .storeUint(BigInt(newRoot.toString()), 256)
            .endCell();

        await walletContract.sendTransfer({
            secretKey: adminKeyPair.secretKey,
            seqno: seqno,
            messages: [
                internal({
                    to: Address.parse(MIXER_CONTRACT),
                    value: toNano('0.02'), // Gas for update
                    body: body
                })
            ]
        });

        console.log(`Root synced to contract: ${newRoot.toString().slice(0, 20)}...`);
        return true;
    } catch (e) {
        console.error('Failed to sync root:', e.message);
        return false;
    }
}

// ========== API ENDPOINTS ==========

// GET /api/info - Mixer information
app.get('/api/info', (req, res) => {
    const poolBalance = (commitments.size - spentNullifiers.size) * parseInt(DEPOSIT_AMOUNT);
    res.json({
        contract: MIXER_CONTRACT,
        jettonMaster: REDO_JETTON_MASTER,
        depositAmount: DEPOSIT_AMOUNT,
        root: tree.getRoot().toString(),
        nextIndex: tree.getNextIndex(),
        treeDepth: 10,
        depositsCount: commitments.size,
        withdrawalsCount: spentNullifiers.size,
        poolBalance: poolBalance
    });
});

// GET /api/merkle/root - Current Merkle root
app.get('/api/merkle/root', (req, res) => {
    res.json({
        root: tree.getRoot().toString(),
        nextIndex: tree.getNextIndex()
    });
});

// GET /api/merkle/path/:leafIndex - Get Merkle path for withdrawal proof
// This is the ONLY data the backend provides for withdrawals
// The frontend uses this to generate the ZK proof locally
app.get('/api/merkle/path/:leafIndex', (req, res) => {
    const leafIndex = parseInt(req.params.leafIndex);

    if (isNaN(leafIndex) || leafIndex < 0) {
        return res.status(400).json({ error: 'Invalid leaf index' });
    }

    if (leafIndex >= tree.getNextIndex()) {
        return res.status(404).json({ error: 'Leaf index not found' });
    }

    try {
        const { pathElements, pathIndices } = tree.getPath(leafIndex);
        res.json({
            leafIndex,
            pathElements: pathElements.map(e => e.toString()),
            pathIndices,
            root: tree.getRoot().toString()
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// GET /api/commitment/:commitment - Check if commitment exists and get its index
app.get('/api/commitment/:commitment', (req, res) => {
    const commitment = req.params.commitment;
    const info = commitments.get(commitment);

    if (!info) {
        return res.status(404).json({ exists: false });
    }

    res.json({
        exists: true,
        leafIndex: info.leafIndex,
        timestamp: info.timestamp
    });
});

// GET /api/nullifier/:nullifierHash - Check if nullifier is spent
app.get('/api/nullifier/:nullifierHash', (req, res) => {
    const nullifierHash = req.params.nullifierHash;
    res.json({
        spent: spentNullifiers.has(nullifierHash)
    });
});

// POST /api/deposit/register - DEPRECATED: Now handled by blockchain indexer
// Keeping endpoint for backward compatibility but it just returns success
app.post('/api/deposit/register', rateLimit, async (req, res) => {
    const { commitment } = req.body;

    if (!commitment) {
        return res.status(400).json({ error: 'Missing commitment' });
    }

    // Check if already indexed
    if (commitments.has(commitment)) {
        const info = commitments.get(commitment);
        return res.json({
            success: true,
            leafIndex: info.leafIndex,
            root: tree.getRoot().toString(),
            alreadyRegistered: true
        });
    }

    // Not indexed yet - tell frontend to wait for indexer
    res.json({
        success: true,
        message: 'Deposit will be indexed automatically within 30 seconds',
        pendingIndexer: true
    });
});

// POST /api/nullifier/mark - Mark nullifier as spent (called after successful withdrawal)
app.post('/api/nullifier/mark', rateLimit, (req, res) => {
    const { nullifierHash } = req.body;

    if (!nullifierHash) {
        return res.status(400).json({ error: 'Missing nullifierHash' });
    }

    if (spentNullifiers.has(nullifierHash)) {
        return res.json({ success: true, alreadySpent: true });
    }

    spentNullifiers.add(nullifierHash);
    console.log(`Nullifier marked spent: ${nullifierHash.slice(0, 20)}...`);

    // Save state immediately after modification
    saveState();

    res.json({ success: true });
});

// GET /api/jetton-wallet/:userAddress - Get user's jetton wallet address
// Required for jetton transfers (TEP-74: user sends to their own jetton wallet)
app.get('/api/jetton-wallet/:userAddress', async (req, res) => {
    const userAddress = req.params.userAddress;

    if (!userAddress) {
        return res.status(400).json({ error: 'Missing user address' });
    }

    try {
        if (!tonClient) {
            await initTonClient();
        }

        // Call get_wallet_address on jetton master contract
        const result = await tonClient.runMethod(
            Address.parse(REDO_JETTON_MASTER),
            'get_wallet_address',
            [{ type: 'slice', cell: beginCell().storeAddress(Address.parse(userAddress)).endCell() }]
        );

        const jettonWallet = result.stack.readAddress().toString();
        console.log(`Jetton wallet for ${userAddress.slice(0, 10)}...: ${jettonWallet}`);

        return res.json({
            jettonWallet,
            balance: '0' // Balance check not needed, just the wallet address
        });

    } catch (e) {
        console.error('Error getting jetton wallet:', e);
        res.status(500).json({ error: 'Failed to get jetton wallet address' });
    }
});

// ========== PROOF COMPRESSION ==========
// Compress proof using BLST format (matches TVM BLS12-381 opcodes)
// Note: ffjavascript uses a different internal representation, so we compute directly

const BLS_FIELD_MODULUS = 4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787n;

// Compress G1 point to BLST format (48 bytes)
// Format: bit0=compression(1), bit1=infinity(0), bit2=sign, bits3-383=x coordinate
function g1CompressedBLST(point) {
    const x = BigInt(point[0]);
    const y = BigInt(point[1]);

    // Sign flag: y > (q-1)/2 equivalent to (y * 2) / q
    const signFlag = (y * 2n) / BLS_FIELD_MODULUS;

    // Build 384-bit representation: 10 + sign + x(381 bits)
    const xBin = x.toString(2).padStart(381, '0');
    const fullBin = '10' + signFlag.toString() + xBin;

    // Convert binary to hex (48 bytes = 96 hex chars)
    let hex = '';
    for (let i = 0; i < fullBin.length; i += 8) {
        const byte = fullBin.slice(i, i + 8);
        hex += parseInt(byte, 2).toString(16).padStart(2, '0');
    }
    return hex;
}

// Compress G2 point to BLST format (96 bytes)
// Format: G2 = (x, y) where x = c0 + c1*u, y = c0 + c1*u
// Compressed: sign flag based on y_im (or y_re if y_im=0), then x1 (c1), then x0 (c0)
function g2CompressedBLST(point) {
    const x0 = BigInt(point[0][0]); // c0 of x
    const x1 = BigInt(point[0][1]); // c1 of x
    const y0 = BigInt(point[1][0]); // c0 of y
    const y1 = BigInt(point[1][1]); // c1 of y

    // Sign flag: based on imaginary part of y (y1) if non-zero, else real part (y0)
    let signFlag;
    if (y1 > 0n) {
        signFlag = (y1 * 2n) / BLS_FIELD_MODULUS;
    } else {
        signFlag = (y0 * 2n) / BLS_FIELD_MODULUS;
    }

    // First half: 10 + sign + x1 (c1 of x, 381 bits)
    const x1Bin = x1.toString(2).padStart(381, '0');
    const part1 = '10' + signFlag.toString() + x1Bin;

    // Second half: 000 + x0 (c0 of x, 381 bits) - no flags
    const x0Bin = x0.toString(2).padStart(381, '0');
    const part2 = '000' + x0Bin;

    // Convert to hex (96 bytes = 192 hex chars)
    let hex = '';
    for (let i = 0; i < part1.length; i += 8) {
        hex += parseInt(part1.slice(i, i + 8), 2).toString(16).padStart(2, '0');
    }
    for (let i = 0; i < part2.length; i += 8) {
        hex += parseInt(part2.slice(i, i + 8), 2).toString(16).padStart(2, '0');
    }
    return hex;
}

// POST /api/proof/compress - Compress proof for TON contract
app.post('/api/proof/compress', (req, res) => {
    const { pi_a, pi_b, pi_c } = req.body;

    if (!pi_a || !pi_b || !pi_c) {
        return res.status(400).json({ error: 'Missing proof components' });
    }

    try {
        const proofA = g1CompressedBLST(pi_a);
        const proofB = g2CompressedBLST(pi_b);
        const proofC = g1CompressedBLST(pi_c);

        res.json({
            pi_a: proofA,  // 48 bytes hex (96 chars)
            pi_b: proofB,  // 96 bytes hex (192 chars)
            pi_c: proofC   // 48 bytes hex (96 chars)
        });
    } catch (e) {
        console.error('Proof compression error:', e);
        res.status(500).json({ error: 'Failed to compress proof' });
    }
});

// GET /api/deposits - List recent deposits (public info only)
app.get('/api/deposits', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const deposits = [];

    for (const [commitment, info] of commitments) {
        deposits.push({
            leafIndex: info.leafIndex,
            timestamp: info.timestamp
        });
    }

    // Sort by leafIndex descending (most recent first)
    deposits.sort((a, b) => b.leafIndex - a.leafIndex);

    res.json({
        deposits: deposits.slice(0, limit),
        total: commitments.size
    });
});

// ========== PERSISTENCE (simple JSON file) ==========
const STATE_FILE = path.join(__dirname, 'state.json');

function saveState() {
    const state = {
        commitments: Array.from(commitments.entries()),
        spentNullifiers: Array.from(spentNullifiers),
        savedAt: Date.now()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        console.log('No state file found, starting fresh');
        return;
    }

    try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

        // Restore commitments and rebuild tree
        for (const [commitment, info] of state.commitments) {
            commitments.set(commitment, info);
            tree.insert(BigInt(commitment));
        }

        // Restore spent nullifiers
        for (const nh of state.spentNullifiers) {
            spentNullifiers.add(nh);
        }

        console.log(`State loaded: ${commitments.size} deposits, ${spentNullifiers.size} spent nullifiers`);
    } catch (e) {
        console.error('Failed to load state:', e.message);
    }
}

// Auto-save state every 60 seconds
setInterval(saveState, 60000);

// Save on exit
process.on('SIGINT', () => {
    console.log('Saving state before exit...');
    saveState();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Saving state before exit...');
    saveState();
    process.exit(0);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3001;

loadState();

app.listen(PORT, async () => {
    console.log(`REDO Mixer Backend running on port ${PORT}`);
    console.log(`Contract: ${MIXER_CONTRACT}`);
    console.log(`Merkle root: ${tree.getRoot().toString()}`);
    console.log(`Deposits: ${commitments.size}`);

    // Initialize TON client for root sync
    await initTonClient();

    // Start blockchain indexer
    startIndexer();
});
