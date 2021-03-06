class HashedTimeLockedContract extends Account {
    /**
     * @param {number} balance
     * @param {Address} sender
     * @param {Address} recipient
     * @param {Hash} hashRoot
     * @param {number} hashCount
     * @param {number} timeout
     * @param {number} totalAmount
     */
    constructor(balance = 0, sender = Address.NULL, recipient = Address.NULL, hashRoot = Hash.NULL, hashCount = 1, timeout = 0, totalAmount = balance) {
        super(Account.Type.HTLC, balance);
        if (!(sender instanceof Address)) throw new Error('Malformed address');
        if (!(recipient instanceof Address)) throw new Error('Malformed address');
        if (!(hashRoot instanceof Hash)) throw new Error('Malformed address');
        if (!NumberUtils.isUint8(hashCount) || hashCount === 0) throw new Error('Malformed hashCount');
        if (!NumberUtils.isUint32(timeout)) throw new Error('Malformed timeout');
        if (!NumberUtils.isUint64(totalAmount)) throw new Error('Malformed totalAmount');

        /** @type {Address} */
        this._sender = sender;
        /** @type {Address} */
        this._recipient = recipient;
        /** @type {Hash} */
        this._hashRoot = hashRoot;
        /** @type {number} */
        this._hashCount = hashCount;
        /** @type {number} */
        this._timeout = timeout;
        /** @type {number} */
        this._totalAmount = totalAmount;
    }

    /**
     * @param {SerialBuffer} buf
     * @return {HashedTimeLockedContract}
     */
    static unserialize(buf) {
        const type = buf.readUint8();
        if (type !== Account.Type.HTLC) throw new Error('Invalid account type');

        const balance = buf.readUint64();
        const sender = Address.unserialize(buf);
        const recipient = Address.unserialize(buf);
        const hashAlgorithm = /** @type {Hash.Algorithm} */ buf.readUint8();
        const hashRoot = Hash.unserialize(buf, hashAlgorithm);
        const hashCount = buf.readUint8();
        const timeout = buf.readUint32();
        const totalAmount = buf.readUint64();
        return new HashedTimeLockedContract(balance, sender, recipient, hashRoot, hashCount, timeout, totalAmount);
    }


    /**
     * Serialize this HTLC object into binary form.
     * @param {?SerialBuffer} [buf] Buffer to write to.
     * @return {SerialBuffer} Buffer from `buf` or newly generated one.
     */
    serialize(buf) {
        buf = buf || new SerialBuffer(this.serializedSize);
        super.serialize(buf);
        this._sender.serialize(buf);
        this._recipient.serialize(buf);
        buf.writeUint8(this._hashRoot.algorithm);
        this._hashRoot.serialize(buf);
        buf.writeUint8(this._hashCount);
        buf.writeUint32(this._timeout);
        buf.writeUint64(this._totalAmount);
        return buf;
    }

    /**
     * @return {number}
     */
    get serializedSize() {
        return super.serializedSize
            + this._sender.serializedSize
            + this._recipient.serializedSize
            + /*hashAlgorithm*/ 1
            + this._hashRoot.serializedSize
            + /*hashCount*/ 1
            + /*timeout*/ 4
            + /*totalAmount*/ 8;
    }

    /** @type {Address} */
    get sender() {
        return this._sender;
    }

    /** @type {Address} */
    get recipient() {
        return this._recipient;
    }

    /** @type {Hash} */
    get hashRoot() {
        return this._hashRoot;
    }

    /** @type {number} */
    get hashCount() {
        return this._hashCount;
    }

    /** @type {number} */
    get timeout() {
        return this._timeout;
    }

    /** @type {number} */
    get totalAmount() {
        return this._totalAmount;
    }

    toString() {
        return `HashedTimeLockedContract{sender=${this._sender.toUserFriendlyAddress(false)}, recipient=${this._sender.toUserFriendlyAddress(false)} amount=${this._totalAmount}/${this._hashCount}, timeout=${this._timeout}, balance=${this._balance}}`;
    }

    /**
     * @param {Transaction} transaction
     * @return {Promise.<boolean>}
     */
    static async verifyOutgoingTransaction(transaction) {
        try {
            const buf = new SerialBuffer(transaction.proof);
            const type = buf.readUint8();
            switch (type) {
                case HashedTimeLockedContract.ProofType.REGULAR_TRANSFER: {
                    // pre-image
                    const hashAlgorithm = /** @type {Hash.Algorithm} */ buf.readUint8();
                    const hashDepth = buf.readUint8();
                    const rootHash = Hash.unserialize(buf, hashAlgorithm);
                    let hashTmp = Hash.unserialize(buf, hashAlgorithm);
                    for (let i = 0; i < hashDepth; ++i) {
                        hashTmp = await Hash.compute(hashTmp.array, hashAlgorithm);
                    }
                    if (!rootHash.equals(hashTmp)) {
                        return false;
                    }

                    // signature proof of the htlc recipient
                    if (!(await SignatureProof.unserialize(buf).verify(transaction.recipient, transaction.serializeContent()))) {
                        return false;
                    }
                    break;
                }
                case HashedTimeLockedContract.ProofType.EARLY_RESOLVE: {
                    // signature proof of the htlc recipient
                    const htlcRecipientAddress = Address.unserialize(buf);
                    if (!(await SignatureProof.unserialize(buf).verify(htlcRecipientAddress, transaction.serializeContent()))) {
                        return false;
                    }

                    // signature proof of the htlc creator
                    if (!(await SignatureProof.unserialize(buf).verify(transaction.recipient, transaction.serializeContent()))) {
                        return false;
                    }
                    break;
                }
                case HashedTimeLockedContract.ProofType.TIMEOUT_RESOLVE:
                    // signature proof of the htlc creator
                    if (!(await SignatureProof.unserialize(buf).verify(transaction.recipient, transaction.serializeContent()))) {
                        return false;
                    }
                    break;
                default:
                    return false;
            }

            if (buf.readPos !== buf.byteLength) {
                return false;
            }

            return true; // Accept
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {Transaction} transaction
     * @return {Promise.<boolean>}
     */
    static async verifyIncomingTransaction(transaction) {
        try {
            const buf = new SerialBuffer(transaction.data);
            const recipient = Address.unserialize(buf);
            const hashAlgorithm = /** @type {Hash.Algorithm} */ buf.readUint8();
            const hashRoot = Hash.unserialize(buf, hashAlgorithm);
            const hashCount = buf.readUint8();
            const timeout = buf.readUint32();

            if (buf.readPos !== buf.byteLength) {
                return false;
            }

            const contract = new HashedTimeLockedContract(transaction.value, transaction.sender, recipient, hashRoot, hashCount, timeout);
            const hash = await Hash.blake2b(contract.serialize());
            if (!transaction.recipient.equals(Address.fromHash(hash))) {
                return false;
            }

            return true; // Accept
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {number} balance
     * @return {Account|*}
     */
    withBalance(balance) {
        return new HashedTimeLockedContract(balance, this._sender, this._recipient, this._hashRoot, this._hashCount, this._timeout, this._totalAmount);
    }

    /**
     * @param {Transaction} transaction
     * @param {number} blockHeight
     * @param {TransactionsCache} transactionsCache
     * @param {boolean} [revert]
     * @return {Account|*}
     */
    withOutgoingTransaction(transaction, blockHeight, transactionsCache, revert = false) {
        const buf = new SerialBuffer(transaction.proof);
        const type = buf.readUint8();
        let minCap = 0;
        switch (type) {
            case HashedTimeLockedContract.ProofType.REGULAR_TRANSFER: {
                if (!transaction.recipient.equals(this._recipient)) {
                    throw new Error('Proof Error!');
                }

                if (this._timeout < blockHeight) {
                    throw new Error('Proof Error!');
                }

                const hashAlgorithm = /** @type {Hash.Algorithm} */ buf.readUint8();
                const hashDepth = buf.readUint8();
                if (!Hash.unserialize(buf, hashAlgorithm).equals(this._hashRoot)) {
                    throw new Error('Proof Error!');
                }

                minCap = Math.max(0, Math.floor((1 - (hashDepth / this._hashCount)) * this._totalAmount));

                break;
            }
            case HashedTimeLockedContract.ProofType.EARLY_RESOLVE: {
                if (!transaction.recipient.equals(this._sender)) {
                    throw new Error('Proof Error!');
                }

                if (!Address.unserialize(buf).equals(this._recipient)) {
                    throw new Error('Proof Error!');
                }

                break;
            }
            case HashedTimeLockedContract.ProofType.TIMEOUT_RESOLVE: {
                if (!transaction.recipient.equals(this._sender)) {
                    throw new Error('Proof Error!');
                }

                if (this._timeout >= blockHeight) {
                    throw new Error('Proof Error!');
                }

                break;
            }
            default:
                throw new Error('Proof Error!');
        }
        if (!revert) {
            const newBalance = this._balance - transaction.value - transaction.fee;
            if (newBalance < minCap) {
                throw new Error('Balance Error!');
            }
        }
        return super.withOutgoingTransaction(transaction, blockHeight, transactionsCache, revert);
    }


    /**
     * @param {Transaction} transaction
     * @param {number} blockHeight
     * @param {boolean} [revert]
     * @return {Account}
     */
    withIncomingTransaction(transaction, blockHeight, revert = false) {
        if (this === HashedTimeLockedContract.INITIAL) {
            const buf = new SerialBuffer(transaction.data);
            const recipient = Address.unserialize(buf);
            const hashAlgorithm = /** @type {Hash.Algorithm} */ buf.readUint8();
            const hashRoot = Hash.unserialize(buf, hashAlgorithm);
            const hashCount = buf.readUint8();
            const timeout = buf.readUint32();

            return new HashedTimeLockedContract(transaction.value, transaction.sender, recipient, hashRoot, hashCount, timeout);
        } else if (revert && transaction.data.length > 0) {
            return HashedTimeLockedContract.INITIAL;
        } else {
            // No incoming transactions after creation
            throw new Error('Data Error!');
        }
    }
}

HashedTimeLockedContract.ProofType = {
    REGULAR_TRANSFER: 1,
    EARLY_RESOLVE: 2,
    TIMEOUT_RESOLVE: 3
};
HashedTimeLockedContract.INITIAL = new HashedTimeLockedContract();
Account.TYPE_MAP.set(Account.Type.HTLC, HashedTimeLockedContract);
Class.register(HashedTimeLockedContract);
