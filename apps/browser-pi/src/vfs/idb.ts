// Minimaler IndexedDB-Wrapper ohne externe Abhängigkeit.
// Trägt das virtuelle Dateisystem (Prinzip 2 in CLAUDE.md): Nutzerdaten leben
// ausschliesslich lokal hier, nie auf einem Server.

const DB_NAME = "browser-pi";
const DB_VERSION = 1;
export const FILES_STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(FILES_STORE)) {
				// Key = absoluter VFS-Pfad (z.B. "/prompts/foo.md").
				db.createObjectStore(FILES_STORE, { keyPath: "path" });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

function tx<T>(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(FILES_STORE, mode);
				const store = transaction.objectStore(FILES_STORE);
				const req = fn(store);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			}),
	);
}

export interface FileRecord {
	path: string;
	content: string;
	mtime: number;
}

export const idb = {
	get: (path: string): Promise<FileRecord | undefined> =>
		tx("readonly", (s) => s.get(path) as IDBRequest<FileRecord | undefined>),

	put: (record: FileRecord): Promise<IDBValidKey> =>
		tx("readwrite", (s) => s.put(record)),

	delete: (path: string): Promise<undefined> =>
		tx("readwrite", (s) => s.delete(path) as IDBRequest<undefined>),

	all: (): Promise<FileRecord[]> =>
		tx("readonly", (s) => s.getAll() as IDBRequest<FileRecord[]>),

	allKeys: (): Promise<string[]> =>
		tx("readonly", (s) => s.getAllKeys() as IDBRequest<string[]>) as Promise<
			string[]
		>,
};

// Persistenz-Garantie gegen Cache-Eviction anfordern (Best-Effort).
export async function requestPersistence(): Promise<boolean> {
	if (navigator.storage?.persist) {
		return navigator.storage.persist();
	}
	return false;
}
