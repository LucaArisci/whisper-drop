const DB_NAME = "whisper-drop";
const META_STORE_NAME = "meta";
const META_KEY = "whisper-drop-meta";

type MetaRecord = {
  lastModelId?: string;
  lastLanguage?: string;
  installedModels?: Record<string, number>;
};

async function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function setMeta(meta: MetaRecord): Promise<void> {
  const db = await openIndexedDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    tx.objectStore(META_STORE_NAME).put(meta, META_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getMeta(): Promise<MetaRecord> {
  const db = await openIndexedDb();
  const result = await new Promise<MetaRecord>((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const request = tx.objectStore(META_STORE_NAME).get(META_KEY);
    request.onsuccess = () => resolve((request.result as MetaRecord | undefined) ?? {});
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function persistLastSelections(modelId: string, language: string): Promise<void> {
  const meta = await getMeta();
  await setMeta({
    ...meta,
    lastModelId: modelId,
    lastLanguage: language
  });
}
