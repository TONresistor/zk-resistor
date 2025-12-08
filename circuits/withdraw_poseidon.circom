pragma circom 2.0.0;

include "../node_modules/poseidon-bls12381-circom/circuits/poseidon255.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Poseidon hash de 2 inputs (utilise Poseidon255 avec 2 inputs)
template Poseidon2() {
    signal input a;
    signal input b;
    signal output out;

    component hasher = Poseidon255(2);
    hasher.in[0] <== a;
    hasher.in[1] <== b;
    out <== hasher.out;
}

// Merkle tree proof checker avec Poseidon BLS12-381
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashers[levels];

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon2();

        // Si pathIndices[i] == 0, le leaf est a gauche
        // Si pathIndices[i] == 1, le leaf est a droite
        hashers[i].a <== pathIndices[i] * (pathElements[i] - hashes[i]) + hashes[i];
        hashers[i].b <== (1 - pathIndices[i]) * (pathElements[i] - hashes[i]) + hashes[i];

        hashes[i + 1] <== hashers[i].out;
    }

    root === hashes[levels];
}

// Hash commitment = Poseidon(secret, nullifier)
template CommitmentHasher() {
    signal input secret;
    signal input nullifier;
    signal output commitment;
    signal output nullifierHash;

    // Commitment = Poseidon(secret, nullifier)
    component commitmentHasher = Poseidon2();
    commitmentHasher.a <== secret;
    commitmentHasher.b <== nullifier;
    commitment <== commitmentHasher.out;

    // NullifierHash = Poseidon(nullifier, 0)
    component nullifierHasher = Poseidon2();
    nullifierHasher.a <== nullifier;
    nullifierHasher.b <== 0;
    nullifierHash <== nullifierHasher.out;
}

// Circuit principal de retrait
template Withdraw(levels) {
    // Inputs publics
    signal input root;
    signal input nullifierHash;
    signal input recipient;  // Adresse de retrait (pour eviter front-running)
    signal input relayer;    // Adresse relayer (peut etre 0)
    signal input fee;        // Frais relayer (peut etre 0)

    // Inputs prives
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Verifier que recipient n'est pas 0
    component recipientCheck = IsZero();
    recipientCheck.in <== recipient;
    recipientCheck.out === 0;

    // Calculer le commitment et le nullifierHash
    component hasher = CommitmentHasher();
    hasher.secret <== secret;
    hasher.nullifier <== nullifier;

    // Verifier que le nullifierHash correspond
    nullifierHash === hasher.nullifierHash;

    // Verifier que le commitment est dans l'arbre Merkle
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== hasher.commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Eviter l'optimisation du compilateur sur les inputs publics
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
}

// Arbre de profondeur 10 = 1,024 depots possibles (MVP)
component main {public [root, nullifierHash, recipient, relayer, fee]} = Withdraw(10);
