const { poseidon2 } = require('poseidon-bls12381');

const TREE_DEPTH = 10;
const ZEROS = [
    0n,
    51576823595707970152643159819788304363803754756066229172775779360774743019614n,
    33646187916922823865935622258451714952164674255482660942215703235411158105736n,
    27818645450144846908742692719385898720249207574255739267233226464286012246073n,
    39404029000907277292464556408734412130261913210564395069696342233560511006152n,
    24907123534309659921713005795092724527532698077589223246276579583330771465031n,
    22103361713848256938655449390262013863291224679776344310249539314760174194771n,
    28665358770471415124367990738618755861132249577405347373337125991381323369983n,
    6786998243528185650306462855937293964443624194496859265310261299800128548513n,
    50997336463747555660384185705133244552288600683323691317203235239320942865561n,
    13916937046501108967048154641689659101970478684843793251827738918983778486795n
];

class MerkleTree {
    constructor() {
        this.leaves = [];
        this.filledSubtrees = new Array(TREE_DEPTH).fill(0n);
        this.nextIndex = 0;
        this.root = ZEROS[TREE_DEPTH];
    }

    insert(commitment) {
        if (this.nextIndex >= (1 << TREE_DEPTH)) {
            throw new Error('Tree is full');
        }

        const leafIndex = this.nextIndex;
        let currentHash = BigInt(commitment);
        let currentIndex = leafIndex;

        for (let level = 0; level < TREE_DEPTH; level++) {
            const isRight = currentIndex % 2 === 1;

            if (!isRight) {
                this.filledSubtrees[level] = currentHash;
                currentHash = poseidon2([currentHash, ZEROS[level]]);
            } else {
                const left = this.filledSubtrees[level];
                currentHash = poseidon2([left, currentHash]);
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        this.root = currentHash;
        this.leaves.push(BigInt(commitment));
        this.nextIndex++;

        return { leafIndex, root: this.root };
    }

    getPath(leafIndex) {
        if (leafIndex >= this.nextIndex) {
            throw new Error('Leaf not found');
        }

        const pathElements = [];
        const pathIndices = [];

        let currentIndex = leafIndex;

        for (let level = 0; level < TREE_DEPTH; level++) {
            const siblingIndex = currentIndex ^ 1;
            const isRight = currentIndex % 2 === 1;

            pathIndices.push(isRight ? 1 : 0);

            if (siblingIndex < this._getSubtreeSize(level)) {
                pathElements.push(this._getNode(level, siblingIndex));
            } else {
                pathElements.push(ZEROS[level]);
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        return { pathElements, pathIndices };
    }

    _getSubtreeSize(level) {
        return Math.ceil(this.nextIndex / (1 << level));
    }

    _getNode(level, index) {
        if (level === 0) {
            return index < this.leaves.length ? this.leaves[index] : ZEROS[0];
        }

        const leftChild = this._getNode(level - 1, index * 2);
        const rightChild = this._getNode(level - 1, index * 2 + 1);

        if (leftChild === ZEROS[level - 1] && rightChild === ZEROS[level - 1]) {
            return ZEROS[level];
        }

        return poseidon2([leftChild, rightChild]);
    }

    getRoot() {
        return this.root;
    }

    getNextIndex() {
        return this.nextIndex;
    }

    static computeCommitment(secret, nullifier) {
        return poseidon2([BigInt(secret), BigInt(nullifier)]);
    }

    static computeNullifierHash(nullifier) {
        return poseidon2([BigInt(nullifier), 0n]);
    }
}

module.exports = { MerkleTree, ZEROS, TREE_DEPTH };
