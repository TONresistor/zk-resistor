const CONFIG = {
    API_URL: '/api',
    MIXER_CONTRACT: 'EQBUH-7pbBjvVKXe7FjPnCSIJ2vvUedfJmjoWdKfLYMC_1KF',
    REDO_JETTON_MASTER: 'EQBZ_cafPyDr5KUTs0aNxh0ZTDhkpEZONmLJA2SNGlLm4Cko',
    DEPOSIT_AMOUNT: '100000000000',
    WASM_URL: '/circuits/withdraw_poseidon.wasm',
    ZKEY_URL: '/circuits/withdraw_poseidon_final.zkey',
    FIELD_SIZE: 52435875175126190479447740508185965837690552500527637822603658699938581184513n,
    MANIFEST_URL: 'https://pool.resistance.dog/tonconnect-manifest.json'
};

let tonConnectUI = null;
let connectedWallet = null;
let currentNote = null;

// DOM Elements
const elements = {
    depositConnect: () => document.getElementById('deposit-connect'),
    depositStep1: () => document.getElementById('deposit-step-1'),
    depositStep2: () => document.getElementById('deposit-step-2'),
    depositStep3: () => document.getElementById('deposit-step-3'),
    depositStatus: () => document.getElementById('deposit-status'),
    depositProgressFill: () => document.getElementById('deposit-progress-fill'),
    depositProgressText: () => document.getElementById('deposit-progress-text'),
    noteDisplay: () => document.getElementById('note-display'),
    withdrawStep1: () => document.getElementById('withdraw-step-1'),
    withdrawProgress: () => document.getElementById('withdraw-progress'),
    withdrawStatus: () => document.getElementById('withdraw-status'),
    progressFill: () => document.getElementById('progress-fill'),
    progressText: () => document.getElementById('progress-text'),
    noteInput: () => document.getElementById('note-input'),
    recipientInput: () => document.getElementById('recipient-input')
};

async function initTonConnect() {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: CONFIG.MANIFEST_URL,
        buttonRootId: 'ton-connect-button'
    });

    tonConnectUI.onStatusChange(wallet => {
        connectedWallet = wallet;
        updateUIForWallet();
    });

    connectedWallet = tonConnectUI.wallet;
    updateUIForWallet();
}

function updateUIForWallet() {
    const isConnected = !!connectedWallet;
    elements.depositConnect().classList.toggle('hidden', isConnected);
    elements.depositStep1().classList.toggle('hidden', !isConnected);

    if (isConnected) {
        const addr = connectedWallet.account.address;
        const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
        elements.recipientInput().placeholder = shortAddr;
    }
}

function randomFieldElement() {
    // Rejection sampling to avoid modulo bias
    // FIELD_SIZE is ~255 bits, so we generate 256-bit random and reject if >= FIELD_SIZE
    while (true) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let value = 0n;
        for (let i = 0; i < 32; i++) {
            value = (value << 8n) | BigInt(bytes[i]);
        }
        if (value < CONFIG.FIELD_SIZE) {
            return value;
        }
        // ~50% rejection rate, but cryptographically uniform
    }
}

function encodeNote(secret, nullifier) {
    const secretHex = secret.toString(16).padStart(64, '0');
    const nullifierHex = nullifier.toString(16).padStart(64, '0');
    return `redo-${secretHex}-${nullifierHex}`;
}

function decodeNote(note) {
    if (!note.startsWith('redo-')) throw new Error('Invalid note format');
    const parts = note.slice(5).split('-');
    if (parts.length !== 2) throw new Error('Invalid note format');
    return {
        secret: BigInt('0x' + parts[0]),
        nullifier: BigInt('0x' + parts[1])
    };
}

function addressToField(address) {
    const clean = address.replace(/^(EQ|UQ|kQ|0:)/, '');
    const bytes = atob(clean.replace(/-/g, '+').replace(/_/g, '/'));
    let value = 0n;
    for (let i = 0; i < Math.min(bytes.length, 32); i++) {
        value = (value << 8n) | BigInt(bytes.charCodeAt(i));
    }
    return value % CONFIG.FIELD_SIZE;
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function showTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab:nth-child(${tab === 'deposit' ? 1 : 2})`).classList.add('active');
    document.getElementById(`${tab}-panel`).classList.add('active');
}

function showComingSoon() {
    if (window.Telegram?.WebApp?.showAlert) {
        Telegram.WebApp.showAlert('Coming later');
    } else {
        alert('Coming later');
    }
}

function closeBetaNotice() {
    const notice = document.getElementById('beta-notice');
    if (notice) {
        notice.style.display = 'none';
        localStorage.setItem('betaNoticeClosed', 'true');
    }
}

function isUserRejection(error) {
    const msg = (error?.message || '').toLowerCase();
    return msg.includes('reject') || msg.includes('cancel') || msg.includes('user declined');
}

function showStatus(elementId, type, message) {
    const el = document.getElementById(elementId);
    el.className = `status ${type}`;
    el.textContent = message;
    el.classList.remove('hidden');
}

function updateProgress(percent, text) {
    elements.progressFill().style.width = `${percent}%`;
    elements.progressText().textContent = text;
}

function updateDepositProgress(percent, text) {
    elements.depositProgressFill().style.width = `${percent}%`;
    elements.depositProgressText().textContent = text;
}

async function generateNote() {
    try {
        showStatus('deposit-status', 'loading', 'Generating...');

        const secret = randomFieldElement();
        const nullifier = randomFieldElement();
        const commitment = PoseidonBLS12381.computeCommitment(secret, nullifier);
        const nullifierHash = PoseidonBLS12381.computeNullifierHash(nullifier);

        currentNote = {
            secret,
            nullifier,
            commitment: commitment.toString(),
            nullifierHash: nullifierHash.toString(),
            note: encodeNote(secret, nullifier)
        };

        elements.noteDisplay().textContent = currentNote.note;
        elements.depositStep1().classList.add('hidden');
        elements.depositStep2().classList.remove('hidden');
        elements.depositStatus().className = 'status hidden';
    } catch (e) {
        showStatus('deposit-status', 'error', e.message);
    }
}

function copyNote() {
    if (currentNote) {
        navigator.clipboard.writeText(currentNote.note);
        showStatus('deposit-status', 'success', 'Copied!');
        setTimeout(() => {
            elements.depositStatus().className = 'status hidden';
        }, 2000);
    }
}

function copyContract() {
    navigator.clipboard.writeText(CONFIG.MIXER_CONTRACT);
    showStatus('deposit-status', 'success', 'Contract address copied!');
    setTimeout(() => {
        elements.depositStatus().className = 'status hidden';
    }, 2000);
}

async function buildJettonTransferPayload(destinationAddress, amount, forwardPayload) {
    const Cell = TonWeb.boc.Cell;
    const Address = TonWeb.utils.Address;

    const body = new Cell();
    body.bits.writeUint(0x0f8a7ea5, 32);
    body.bits.writeUint(0, 64);
    body.bits.writeCoins(TonWeb.utils.toNano(amount));
    body.bits.writeAddress(new Address(destinationAddress));
    body.bits.writeAddress(new Address(connectedWallet.account.address));
    body.bits.writeBit(false);
    body.bits.writeCoins(TonWeb.utils.toNano('0.01'));  // Minimal gas for mixer
    body.bits.writeBit(true);
    body.refs.push(forwardPayload);

    const boc = await body.toBoc();
    return TonWeb.utils.bytesToBase64(boc);
}

function buildDepositForwardPayload(commitment) {
    const Cell = TonWeb.boc.Cell;
    const BN = TonWeb.utils.BN;

    const cell = new Cell();
    cell.bits.writeUint(0x1, 32);
    cell.bits.writeUint(0, 64);
    cell.bits.writeUint(new BN(commitment.toString()), 256);
    return cell;
}

async function sendDeposit() {
    if (!currentNote || !connectedWallet) {
        showStatus('deposit-status', 'error', 'Wallet not connected');
        return;
    }

    try {
        elements.depositStep2().classList.add('hidden');
        elements.depositStep3().classList.remove('hidden');
        updateDepositProgress(25, 'Getting wallet...');

        const commitment = BigInt(currentNote.commitment);
        const userAddress = connectedWallet.account.address;
        const jettonWalletResponse = await fetch(`${CONFIG.API_URL}/jetton-wallet/${userAddress}`);

        if (!jettonWalletResponse.ok) {
            throw new Error('Could not find REDO wallet');
        }

        const { jettonWallet: userJettonWallet } = await jettonWalletResponse.json();
        updateDepositProgress(40, 'Building transaction...');

        const forwardPayload = buildDepositForwardPayload(commitment);
        const jettonTransferBody = await buildJettonTransferPayload(CONFIG.MIXER_CONTRACT, '100', forwardPayload);

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [
                {
                    // Message 1: Network fee direct to mixer (visible)
                    address: CONFIG.MIXER_CONTRACT,
                    amount: '100000000'  // 0.1 TON network fee
                },
                {
                    // Message 2: Jetton transfer (minimal TON for gas)
                    address: userJettonWallet,
                    amount: '50000000',  // 0.05 TON for jetton gas
                    payload: jettonTransferBody
                }
            ]
        };

        updateDepositProgress(50, 'Confirm in wallet...');
        const result = await tonConnectUI.sendTransaction(transaction);

        updateDepositProgress(100, 'Done!');
        elements.depositStep3().classList.add('hidden');
        showStatus('deposit-status', 'success', 'Deposit sent! Available for withdrawal in ~30 seconds.');
        currentNote = null;

    } catch (e) {
        console.error('Deposit error:', e);
        elements.depositStep3().classList.add('hidden');
        elements.depositStep1().classList.remove('hidden');
        if (!isUserRejection(e)) {
            showStatus('deposit-status', 'error', e.message);
        }
    }
}

async function buildWithdrawPayload(proofData, recipientAddress) {
    const Cell = TonWeb.boc.Cell;
    const Address = TonWeb.utils.Address;
    const BN = TonWeb.utils.BN;
    const publicSignals = proofData.publicSignals;

    const root = new BN(publicSignals[0]);
    const nullifierHash = new BN(publicSignals[1]);
    const recipientField = new BN(publicSignals[2]);
    const relayerField = new BN(publicSignals[3]);
    const feeField = new BN(publicSignals[4]);

    const publicInputsCell = new Cell();
    publicInputsCell.bits.writeUint(recipientField, 256);
    publicInputsCell.bits.writeUint(relayerField, 256);
    publicInputsCell.bits.writeUint(feeField, 256);

    const addressesCell = new Cell();
    addressesCell.bits.writeAddress(new Address(recipientAddress));
    addressesCell.bits.writeAddress(null);
    addressesCell.bits.writeCoins(0);

    const compressResponse = await fetch(`${CONFIG.API_URL}/proof/compress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pi_a: proofData.pi_a,
            pi_b: proofData.pi_b,
            pi_c: proofData.pi_c
        })
    });

    if (!compressResponse.ok) throw new Error('Failed to compress proof');
    const compressed = await compressResponse.json();

    const proofA = hexToBytes(compressed.pi_a);
    const proofB = hexToBytes(compressed.pi_b);
    const proofC = hexToBytes(compressed.pi_c);

    const proofACell = new Cell();
    const proofBCell = new Cell();
    const proofCCell = new Cell();
    proofACell.bits.writeBytes(proofA);
    proofBCell.bits.writeBytes(proofB);
    proofCCell.bits.writeBytes(proofC);

    const proofsCell = new Cell();
    proofsCell.refs.push(proofACell);
    proofsCell.refs.push(proofBCell);
    proofsCell.refs.push(proofCCell);

    const mainCell = new Cell();
    mainCell.bits.writeUint(0x2, 32);
    mainCell.bits.writeUint(0, 64);
    mainCell.bits.writeUint(root, 256);
    mainCell.bits.writeUint(nullifierHash, 256);
    mainCell.refs.push(publicInputsCell);
    mainCell.refs.push(addressesCell);
    mainCell.refs.push(proofsCell);

    const boc = await mainCell.toBoc();
    return TonWeb.utils.bytesToBase64(boc);
}

async function startWithdraw() {
    const noteInput = elements.noteInput().value.trim();
    let recipientInput = elements.recipientInput().value.trim();

    if (!noteInput) {
        showStatus('withdraw-status', 'error', 'Enter your secret');
        return;
    }

    if (!recipientInput && connectedWallet) {
        recipientInput = connectedWallet.account.address;
    }

    if (!recipientInput) {
        showStatus('withdraw-status', 'error', 'Enter recipient or connect wallet');
        return;
    }

    try {
        const { secret, nullifier } = decodeNote(noteInput);
        elements.withdrawStep1().classList.add('hidden');
        elements.withdrawProgress().classList.remove('hidden');

        updateProgress(5, 'Computing...');
        const commitment = PoseidonBLS12381.computeCommitment(secret, nullifier).toString();
        const nullifierHash = PoseidonBLS12381.computeNullifierHash(nullifier).toString();

        updateProgress(10, 'Looking up deposit...');
        const depositResponse = await fetch(`${CONFIG.API_URL}/commitment/${commitment}`);
        if (!depositResponse.ok) throw new Error('Deposit not found');

        const depositInfo = await depositResponse.json();
        const leafIndex = depositInfo.leafIndex;

        updateProgress(15, 'Checking nullifier...');
        const nullifierResponse = await fetch(`${CONFIG.API_URL}/nullifier/${nullifierHash}`);
        const nullifierInfo = await nullifierResponse.json();
        if (nullifierInfo.spent) throw new Error('Already withdrawn!');

        updateProgress(20, 'Getting Merkle path...');
        const pathResponse = await fetch(`${CONFIG.API_URL}/merkle/path/${leafIndex}`);
        if (!pathResponse.ok) throw new Error('Failed to get path');

        const { pathElements, pathIndices, root } = await pathResponse.json();
        const recipientField = addressToField(recipientInput);

        const input = {
            root,
            nullifierHash,
            recipient: recipientField.toString(),
            relayer: '0',
            fee: '0',
            secret: secret.toString(),
            nullifier: nullifier.toString(),
            pathElements,
            pathIndices
        };

        updateProgress(30, 'Generating ZK proof (~30s)...');
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            CONFIG.WASM_URL,
            CONFIG.ZKEY_URL
        );

        updateProgress(80, 'Compressing proof...');
        const proofData = {
            pi_a: proof.pi_a.slice(0, 2),
            pi_b: proof.pi_b.slice(0, 2),
            pi_c: proof.pi_c.slice(0, 2),
            publicSignals
        };

        if (!connectedWallet) {
            updateProgress(100, 'Proof ready!');
            showStatus('withdraw-status', 'success', 'Proof generated. Connect wallet to submit.');
            return;
        }

        updateProgress(85, 'Building transaction...');
        const withdrawPayload = await buildWithdrawPayload(proofData, recipientInput);

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [{
                address: CONFIG.MIXER_CONTRACT,
                amount: '100000000',
                payload: withdrawPayload
            }]
        };

        updateProgress(90, 'Confirm in wallet...');
        await tonConnectUI.sendTransaction(transaction);

        updateProgress(95, 'Marking spent...');
        await fetch(`${CONFIG.API_URL}/nullifier/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nullifierHash })
        });

        updateProgress(100, 'Done!');
        showStatus('withdraw-status', 'success', 'Withdrawal complete!');

    } catch (e) {
        console.error('Withdraw error:', e);
        elements.withdrawStep1().classList.remove('hidden');
        elements.withdrawProgress().classList.add('hidden');
        if (!isUserRejection(e)) {
            showStatus('withdraw-status', 'error', e.message);
        }
    }
}

async function loadPoolInfo() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/info`);
        if (response.ok) {
            const info = await response.json();
            const poolBalanceEl = document.getElementById('pool-balance');
            if (poolBalanceEl) {
                poolBalanceEl.textContent = `${info.poolBalance} REDO`;
            }
            const poolDepositsEl = document.getElementById('pool-deposits');
            if (poolDepositsEl) {
                const maxDeposits = Math.pow(2, info.treeDepth);
                poolDepositsEl.textContent = `${info.depositsCount}/${maxDeposits}`;
            }
        }
    } catch (e) {
        console.error('Failed to load pool info:', e);
    }
}

async function init() {
    try {
        // Restore beta notice state
        if (localStorage.getItem('betaNoticeClosed') === 'true') {
            const notice = document.getElementById('beta-notice');
            if (notice) notice.style.display = 'none';
        }

        await initTonConnect();
        await loadPoolInfo();

        if (window.Telegram?.WebApp) {
            Telegram.WebApp.ready();
            Telegram.WebApp.expand();
        }
    } catch (e) {
        console.error('Init error:', e);
    }
}

document.addEventListener('DOMContentLoaded', init);
