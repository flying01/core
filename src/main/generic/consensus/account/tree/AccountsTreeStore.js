class AccountsTreeStore {
    static getPersistent() {
        return new PersistentAccountsTreeStore();
    }

    static createVolatile() {
        return new VolatileAccountsTreeStore();
        //return new PersistentAccountsTreeStore();
    }
}
Class.register(AccountsTreeStore);

class PersistentAccountsTreeStore extends ObjectDB {
    constructor() {
        super('accounts', AccountsTreeNode);
    }

    async getRootKey() {
        return await ObjectDB.prototype.getString.call(this, 'root');
    }

    async setRootKey(rootKey) {
        return await ObjectDB.prototype.putString.call(this, 'root', rootKey);
    }

    async transaction() {
        const tx = await ObjectDB.prototype.transaction.call(this);
        tx.getRootKey = function(rootKey) {
            return tx.getString('root');
        };
        tx.setRootKey = function(rootKey) {
            return tx.putString('root', rootKey);
        };
        return tx;
    }
}

class VolatileAccountsTreeStore {
    constructor() {
        this._store = {};
        this._rootKey = undefined;
    }

    async key(node) {
        return (await node.hash()).toBase64();
    }

    get(key) {
        return this._store[key];
    }

    async put(node) {
        const key = await this.key(node);
        this._store[key] = node;
        return key;
    }

    async remove(node) {
        const key = await this.key(node);
        delete this._store[key];
        return key;
    }

    transaction() {
        const tx = this;
        tx.commit = () => true;
        return tx;
    }

    getRootKey() {
        return this._rootKey;
    }

    setRootKey(rootKey) {
        this._rootKey = rootKey;
    }
}
