/* eslint-disable no-restricted-globals */
/**
 * Classic dedicated worker for whisper.cpp (Emscripten main.js + pthreads).
 * Loaded from /whispercpp/bootstrap-worker.js — must stay plain JS for importScripts().
 */
(function () {
  "use strict";

  var DB_NAME = "whispercpp-worker-cache";
  var DB_VERSION = 1;
  var STORE = "models";

  var REGISTRY = {
    "wc-tiny-q5": { label: "Tiny (Q5_1)", sizeBytes: 31 * 1024 * 1024 },
    "wc-base-q5": { label: "Base (Q5_1)", sizeBytes: 57 * 1024 * 1024 },
    "wc-turbo-q5": {
      label: "Large v3 Turbo (Q5_0, experimental)",
      sizeBytes: 574 * 1024 * 1024
    }
  };

  var runtimeReady = false;
  var runtimePromise = null;
  var instance = null;
  var loadedModelId = null;
  var printBuffer = [];
  var cancelRequested = false;

  function post(msg) {
    self.postMessage(msg);
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      rq.onsuccess = function () {
        resolve(rq.result);
      };
      rq.onerror = function () {
        reject(rq.error);
      };
    });
  }

  function idbGet(modelId) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var os = tx.objectStore(STORE);
        var g = os.get(modelId);
        g.onsuccess = function () {
          db.close();
          resolve(g.result);
        };
        g.onerror = function () {
          db.close();
          reject(g.error);
        };
      });
    });
  }

  function idbPut(modelId, buf) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        var os = tx.objectStore(STORE);
        var p = os.put(buf, modelId);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
        p.onerror = function () {
          reject(p.error);
        };
      });
    });
  }

  function idbDelete(modelId) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        var os = tx.objectStore(STORE);
        os.delete(modelId);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function idbHas(modelId) {
    return idbGet(modelId).then(function (v) {
      return Boolean(v);
    });
  }

  function emitInstalledStates() {
    var ids = Object.keys(REGISTRY);
    return Promise.all(
      ids.map(function (id) {
        return idbHas(id).then(function (installed) {
          post({
            type: "modelState",
            state: {
              modelId: id,
              installed: installed,
              pending: false,
              sizeBytes: REGISTRY[id].sizeBytes
            }
          });
        });
      })
    );
  }

  function setupModulePreScript() {
    self.Module = self.Module || {};
    var M = self.Module;
    M.print = function (text) {
      if (arguments.length > 1) {
        text = Array.prototype.slice.call(arguments).join(" ");
      }
      printBuffer.push(String(text));
      if (printBuffer.length > 400) {
        printBuffer = printBuffer.slice(-300);
      }
      if (printBuffer.length % 25 === 0) {
        post({
          type: "progress",
          progress: {
            stage: "transcribe",
            percent: Math.min(92, 12 + printBuffer.length / 8),
            message: "Transcribing…"
          }
        });
      }
    };
    M.printErr = M.print;
    M.setStatus = function () {};
    M.monitorRunDependencies = function () {};
  }

  function loadMainScript() {
    var url = self.location.origin + "/whispercpp/main.js";
    setupModulePreScript();
    return new Promise(function (resolve, reject) {
      self.Module.onRuntimeInitialized = function () {
        runtimeReady = true;
        resolve();
      };
      try {
        importScripts(url);
      } catch (e) {
        reject(e);
      }
    });
  }

  function ensureRuntime() {
    if (runtimeReady) {
      return Promise.resolve();
    }
    if (!runtimePromise) {
      runtimePromise = loadMainScript();
    }
    return runtimePromise;
  }

  function storeFS(fname, buf) {
    var M = self.Module;
    try {
      M.FS_unlink(fname);
    } catch (e) {
      /* ignore */
    }
    M.FS_createDataFile("/", fname, buf, true, true);
  }

  /**
   * Hugging Face LFS often omits Content-Length on XHR (lengthComputable stays false),
   * so we stream with fetch and use expectedBytes from the model registry as fallback.
   */
  function fetchWithProgress(url, onProgress, expectedBytes) {
    expectedBytes = expectedBytes || 0;
    var lastEmit = 0;
    function emit(p) {
      var now = Date.now();
      var clamped = Math.min(1, Math.max(0, p));
      if (clamped >= 0.999 || now - lastEmit > 150 || clamped === 0) {
        lastEmit = now;
        if (onProgress) {
          onProgress(clamped);
        }
      }
    }

    emit(0);

    return fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Download failed (" + res.status + ")");
        }
        var headerLen = parseInt(res.headers.get("content-length") || "0", 10);
        var denom = headerLen > 0 ? headerLen : expectedBytes;

        if (!res.body || typeof res.body.getReader !== "function") {
          return res.arrayBuffer().then(function (ab) {
            emit(1);
            return new Uint8Array(ab);
          });
        }

        var reader = res.body.getReader();
        var parts = [];
        var loaded = 0;

        function pump() {
          return reader.read().then(function (st) {
            if (st.done) {
              emit(1);
              var out = new Uint8Array(loaded);
              var pos = 0;
              for (var i = 0; i < parts.length; i++) {
                out.set(parts[i], pos);
                pos += parts[i].length;
              }
              return out;
            }
            parts.push(st.value);
            loaded += st.value.length;
            var p = 0;
            if (denom > 0) {
              p = loaded / denom;
            } else if (loaded > 0) {
              p = 0.05;
            }
            emit(Math.min(0.999, p));
            return pump();
          });
        }

        return pump();
      })
      .catch(function (err) {
        return Promise.reject(
          err instanceof Error ? err : new Error(String(err || "Network error while downloading the model."))
        );
      });
  }

  function parseTranscriptFromPrint(lines) {
    var re = /^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*(.*)$/;
    var parts = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = line.match(re);
      if (m) {
        parts.push(m[1].trim());
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function waitForTranscriptionEnd(timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve, reject) {
      function tick() {
        if (cancelRequested) {
          reject(new Error("Transcription cancelled."));
          return;
        }
        var blob = printBuffer.join("\n");
        if (blob.indexOf("total time =") !== -1 && blob.indexOf("encode time =") !== -1) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Transcription timed out."));
          return;
        }
        setTimeout(tick, 40);
      }
      tick();
    });
  }

  function freeInstance() {
    if (instance && self.Module && self.Module.free) {
      try {
        self.Module.free(instance);
      } catch (e) {
        /* ignore */
      }
    }
    instance = null;
    loadedModelId = null;
  }

  self.onmessage = function (ev) {
    var data = ev.data;
    var type = data && data.type;
    Promise.resolve()
      .then(function () {
        switch (type) {
          case "init":
            return ensureRuntime().then(function () {
              post({
                type: "ready",
                available: true,
                capabilities: {
                  crossOriginIsolated: self.crossOriginIsolated,
                  simd: true,
                  pthreads: typeof SharedArrayBuffer !== "undefined"
                }
              });
              return emitInstalledStates();
            });
          case "ensureModel":
            return handleEnsureModel(data);
          case "deleteModel":
            return handleDeleteModel(data.modelId);
          case "transcribe":
            return handleTranscribe(data);
          case "cancel":
            cancelRequested = true;
            return Promise.resolve();
          default:
            return Promise.resolve();
        }
      })
      .catch(function (err) {
        post({
          type: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      });
  };

  function handleEnsureModel(data) {
    var modelId = data.modelId;
    var downloadUrl = data.downloadUrl;
    var sizeBytes = data.sizeBytes || 0;
    if (!REGISTRY[modelId]) {
      return Promise.reject(new Error("Unknown whisper.cpp model."));
    }
    return ensureRuntime()
      .then(function () {
        return idbHas(modelId);
      })
      .then(function (exists) {
        if (exists) {
          post({
            type: "modelState",
            state: {
              modelId: modelId,
              installed: true,
              pending: false,
              sizeBytes: sizeBytes || REGISTRY[modelId].sizeBytes,
              updatedAt: Date.now()
            }
          });
          return;
        }
        post({
          type: "modelState",
          state: {
            modelId: modelId,
            installed: false,
            pending: true,
            sizeBytes: sizeBytes || REGISTRY[modelId].sizeBytes
          }
        });
        return fetchWithProgress(
          downloadUrl,
          function (p) {
            post({
              type: "progress",
              progress: {
                stage: "download",
                percent: Math.round(p * 100),
                message: "Downloading " + (REGISTRY[modelId].label || modelId) + "…"
              }
            });
          },
          sizeBytes || REGISTRY[modelId].sizeBytes || 0
        )
          .then(function (buf) {
            return idbPut(modelId, buf);
          })
          .then(function () {
            post({
              type: "modelState",
              state: {
                modelId: modelId,
                installed: true,
                pending: false,
                sizeBytes: sizeBytes || REGISTRY[modelId].sizeBytes,
                updatedAt: Date.now()
              }
            });
          })
          .catch(function (err) {
            post({
              type: "modelState",
              state: {
                modelId: modelId,
                installed: false,
                pending: false,
                sizeBytes: sizeBytes || REGISTRY[modelId].sizeBytes,
                error: err instanceof Error ? err.message : String(err)
              }
            });
            throw err;
          });
      });
  }

  function handleDeleteModel(modelId) {
    return idbDelete(modelId).then(function () {
      if (loadedModelId === modelId) {
        freeInstance();
      }
      post({
        type: "modelState",
        state: {
          modelId: modelId,
          installed: false,
          pending: false,
          sizeBytes: REGISTRY[modelId] ? REGISTRY[modelId].sizeBytes : 0
        }
      });
    });
  }

  function handleTranscribe(data) {
    var request = data.request;
    var audio = data.audio;
    var modelId = request.modelId;
    var lang = request.language === "auto" ? "auto" : request.language;
    var nthreads = request.threads && request.threads > 0 ? request.threads : 4;
    var translate = Boolean(request.translate);
    cancelRequested = false;
    var startedAt = performance.now();

    return ensureRuntime()
      .then(function () {
        return idbGet(modelId);
      })
      .then(function (buf) {
        if (!buf || !buf.byteLength) {
          throw new Error("Model is not installed. Download it before transcribing.");
        }
        post({
          type: "progress",
          progress: { stage: "prepare", percent: 5, message: "Loading model into runtime…" }
        });
        storeFS("whisper.bin", buf);
        if (loadedModelId !== modelId) {
          freeInstance();
        }
        if (!instance) {
          instance = self.Module.init("whisper.bin");
          loadedModelId = modelId;
        }
        if (!instance) {
          throw new Error("Whisper model failed to load in the WASM runtime.");
        }
        var samples = new Float32Array(audio.samples.buffer, audio.samples.byteOffset, audio.samples.length);
        printBuffer = [];
        post({
          type: "progress",
          progress: { stage: "transcribe", percent: 10, message: "Running whisper.cpp…" }
        });
        var ret = self.Module.full_default(instance, samples, lang, nthreads, translate);
        if (ret !== 0) {
          throw new Error("whisper.cpp returned error code " + ret);
        }
        return waitForTranscriptionEnd(35 * 60 * 1000);
      })
      .then(function () {
        var text = parseTranscriptFromPrint(printBuffer);
        if (!text) {
          throw new Error("Empty transcript. Try another language or a clearer recording.");
        }
        post({
          type: "result",
          result: {
            text: text,
            durationSeconds: audio.durationSeconds,
            elapsedMs: Math.round(performance.now() - startedAt),
            outputName: data.outputName || "transcript.txt"
          }
        });
        post({
          type: "progress",
          progress: { stage: "finalize", percent: 100, message: "Transcript ready." }
        });
      });
  }
})();
