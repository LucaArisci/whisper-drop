import { MODELS } from "../constants";
import type { ModelDefinition, ModelInstallState } from "../types";

const DB_NAME = "whisper-drop";
const META_STORE_NAME = "meta";
const META_KEY = "whisper-drop-meta";
const TRANSFORMERS_CACHE_KEY = "transformers-cache";

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

export async function persistLastSelections(
  modelId: string,
  language: string
): Promise<void> {
  const meta = await getMeta();
  await setMeta({
    ...meta,
    lastModelId: modelId,
    lastLanguage: language
  });
}

export async function markModelInstalled(modelId: string): Promise<void> {
  const meta = await getMeta();
  await setMeta({
    ...meta,
    installedModels: {
      ...(meta.installedModels ?? {}),
      [modelId]: Date.now()
    }
  });
}

export async function markModelRemoved(modelId: string): Promise<void> {
  const meta = await getMeta();
  const installedModels = {
    ...(meta.installedModels ?? {})
  };
  delete installedModels[modelId];
  await setMeta({
    ...meta,
    installedModels
  });
}

export async function listInstalledModels(): Promise<ModelInstallState[]> {
  const meta = await getMeta();
  const installedModels = meta.installedModels ?? {};

  return MODELS.map((model) => ({
    modelId: model.id,
    installed: Boolean(installedModels[model.id]),
    pending: false,
    sizeBytes: model.sizeBytes,
    updatedAt: installedModels[model.id]
  }));
}

export function getModelDefinition(modelId: string): ModelDefinition {
  const model = MODELS.find((entry) => entry.id === modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return model;
}

export async function clearModelCache(modelId: string): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }

  const model = getModelDefinition(modelId);
  const cache = await caches.open(TRANSFORMERS_CACHE_KEY);
  const entries = await cache.keys();
  const repoMarker = `/${model.engineModelId}/resolve/`;

  await Promise.all(
    entries
      .filter((request) => request.url.includes(repoMarker))
      .map((request) => cache.delete(request))
  );
}
