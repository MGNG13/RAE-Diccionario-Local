document.addEventListener('DOMContentLoaded', () => {
    // Variables para controlar el estado del servidor
    let serverAvailable = false;
    let lastServerCheck = 0;
    const SERVER_CHECK_INTERVAL = 10000; // 10 segundos entre verificaciones
    const elements = {
        toggle: document.getElementById('toggle'),
        status: document.getElementById('status'),
        serverStatus: document.getElementById('serverStatus'),
        processTextBtn: document.getElementById('processText'),
        processStatus: document.getElementById('processStatus'),
        deleteStorageBtn: document.getElementById('deleteStorage'),
        deleteStatus: document.getElementById('deleteStatus')
    };
    // Función para verificar la disponibilidad del servidor
    const checkServerAvailability = () => {
        const now = Date.now();
        // Siempre devolvemos una promesa, incluso cuando usamos el valor en caché
        if (now - lastServerCheck < SERVER_CHECK_INTERVAL) {
            return Promise.resolve(serverAvailable);
        }
        lastServerCheck = now;
        elements.serverStatus.textContent = "Verificando servidor...";
        elements.serverStatus.className = "server-status";
        // Devolvemos una promesa para poder esperar el resultado
        return new Promise((resolve) => {
            fetch('http://localhost:5000/ping', {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    "accept": "application/json",
                    "Origin": window.location.origin
                },
                signal: AbortSignal.timeout(6000)
            })
            .then(() => {
                if (!serverAvailable) {
                    console.log("Servidor disponible nuevamente");
                    serverAvailable = true;
                }
                elements.serverStatus.textContent = "Servidor disponible";
                elements.serverStatus.className = "server-status available";
                elements.processTextBtn.disabled = false;
                resolve(true);
            })
            .catch(() => {
                if (serverAvailable) {
                    console.log("Servidor no disponible");
                    serverAvailable = false;
                }
                elements.serverStatus.textContent = "Servidor no disponible";
                elements.serverStatus.className = "server-status unavailable";
                elements.processTextBtn.disabled = true;
                resolve(false);
            });
        }).then(() => serverAvailable);
    }
    const collectTextNodes = () => {
        try {
            const extractTextFromNode = node => {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
                if (node.nodeType !== Node.ELEMENT_NODE) return "";
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden' || 
                    node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return "";
                return Array.from(node.childNodes).map(extractTextFromNode).join(" ");
            };
            const allText = extractTextFromNode(document.body);
            const words = [...new Set(
                allText.split(/\s+/)
                    .map(word => word.toLowerCase().replace(/[^\p{L}_]/gu, ''))
                    .filter(word => word.length > 2 && word.length < 35)
                    .filter(word => /^\p{L}+$/u.test(word))
            )];
            return words;
        } catch (error) {
            return [];
        }
    }
    try {
        const updateDeleteStatus = () => {
            chrome.storage.local.get(['wordCache'], (result) => {
                const cache = result.wordCache || {};
                const cacheSize = Object.keys(cache).length;
                const cacheSizeJson = JSON.stringify(cache).length;
                elements.deleteStatus.textContent = `Base de datos local: ${cacheSize} palabras (${(cacheSizeJson / 1024 / 1024).toFixed(2)} MB)`;
            });
        };
        // Verificar el servidor periódicamente
        const startServerMonitoring = () => {
            checkServerAvailability().then(available => {
                console.log("Estado inicial del servidor:", available ? "disponible" : "no disponible");
            });
            setInterval(() => {
                checkServerAvailability().then(available => {
                    console.log("Verificación periódica del servidor:", available ? "disponible" : "no disponible");
                });
            }, SERVER_CHECK_INTERVAL);
        };
        const startProgressMonitoring = () => {
            const intervalId = setInterval(() => {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "getProcessingStatus" }, (status) => {
                        if (chrome.runtime.lastError) return;
                        if (!status) return;
                        if (status.isProcessing && status.currentWord) {
                            let statusText = `Procesando: "${status.currentWord}" (${status.processed || 0} completadas, ${status.remaining || 0} restantes, ${status.newWords || 0} nuevas)`;
                            if (status.percentComplete !== undefined) statusText += ` - ${status.percentComplete}% completado`;
                            if (status.estimatedTime) statusText += `, tiempo estimado: ${status.estimatedTime}`;
                            if (status.processingSpeed) statusText += ` (${status.processingSpeed} palabras/seg)`;
                            elements.processStatus.textContent = statusText;
                            if (status.cacheSize !== undefined)
                                elements.deleteStatus.textContent = `Base de datos local: ${status.cacheSize} palabras (actualizándose en tiempo real)`;
                        } else if (!status.isProcessing) {
                            elements.processStatus.textContent = `Procesamiento completado: ${status.processedCount} palabras procesadas, ${status.newWordsCount || 0} palabras nuevas agregadas - 100% completado`;
                            clearInterval(intervalId);
                            updateDeleteStatus();
                        }
                    });
                });
            }, 1000);
        };
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "processingUpdate") {
                let statusText = `Procesando: "${message.word}" (${message.processed || 0} completadas, ${message.remaining || 0} restantes, ${message.newWords || 0} nuevas)`;
                if (message.percentComplete !== undefined) statusText += ` - ${message.percentComplete}% completado`;
                if (message.estimatedTime) statusText += `, tiempo estimado: ${message.estimatedTime}`;
                if (message.processingSpeed) statusText += ` (${message.processingSpeed} palabras/seg)`;
                elements.deleteStatus.textContent = `Base de datos local: ${message.processed} palabras (actualizándose en tiempo real)`;
                elements.processStatus.textContent = statusText;
            } else if (message.action === "processingComplete") {
                elements.processStatus.textContent = `Procesamiento completado: ${message.count} palabras procesadas, ${message.newWordsCount} palabras nuevas agregadas - 100% completado`;
                updateDeleteStatus();
            }
        });
        chrome.storage.local.get(['wordCache'], (result) => {
            if (!result.wordCache) chrome.storage.local.set({ wordCache: {} });
        });
        chrome.storage.local.get(['enabled'], (result) => {
            elements.toggle.checked = result.enabled || false;
            elements.status.textContent = result.enabled ? "ACTIVADO" : "DESACTIVADO";
        });
        elements.toggle.addEventListener('change', () => {
            const isEnabled = elements.toggle.checked;
            chrome.storage.local.set({ enabled: isEnabled });
            elements.status.textContent = isEnabled ? "ACTIVADO" : "DESACTIVADO";
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => chrome.tabs.reload(tabs[0].id));
        });
        elements.processTextBtn.addEventListener('click', () => {
            // Verificar explícitamente si el servidor está disponible antes de procesar
            elements.processStatus.textContent = "Verificando disponibilidad del servidor...";
            // Usar la función checkServerAvailability que ahora devuelve una promesa
            checkServerAvailability().then(available => {
                if (!available) {
                    elements.processStatus.textContent = "Error: El servidor no está disponible. No se puede procesar el texto.";
                    return;
                }
                // El servidor está disponible, proceder con el procesamiento
                proceedWithTextProcessing();
            });
             // Función para proceder con el procesamiento de texto
             function proceedWithTextProcessing() {
                 elements.processStatus.textContent = "Recopilando texto...";
                 chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                     chrome.scripting.executeScript({
                         target: { tabId: tabs[0].id },
                         function: collectTextNodes
                     }, (results) => {
                         if (chrome.runtime.lastError) {
                             elements.processStatus.textContent = "Error: " + chrome.runtime.lastError.message;
                             return;
                         }
                         if (results?.[0]?.result) {
                             const words = results[0].result;
                             // Filtrar palabras que ya están en el caché
                             chrome.storage.local.get(['wordCache'], (result) => {
                                 const wordCache = result.wordCache || {};
                                 const filteredWords = words.filter(word => !wordCache[word]);
                                 // Verificar si hay palabras nuevas para procesar
                                 if (filteredWords.length === 0) {
                                     elements.processStatus.textContent = "No hay más palabras por agregar al diccionario";
                                     return;
                                 }
                                 elements.processStatus.textContent = `Procesando ${filteredWords.length} palabras...`;
                                 startProgressMonitoring();
                                 chrome.tabs.sendMessage(tabs[0].id, { action: "processWords", words: filteredWords }, (response) => {
                                     if (response?.success) {
                                         elements.processStatus.textContent = `Procesando ${response.count} palabras en segundo plano`;
                                     } else {
                                         elements.processStatus.textContent = `Error al procesar. Por favor, recarga manualmente la pantalla.`;
                                     }
                                 });
                                 updateDeleteStatus();
                             });
                         } else {
                             elements.processStatus.textContent = "No se encontraron palabras";
                         }
                     });
                 });
             }
        });
        elements.deleteStorageBtn.addEventListener('click', () => {
            elements.deleteStatus.textContent = "Eliminando base de datos local...";
            chrome.storage.local.set({ wordCache: {} }, () => {
                if (chrome.runtime.lastError) {
                    elements.deleteStatus.textContent = `Error al eliminar base de datos: ${chrome.runtime.lastError.message}`;
                    return;
                }
                elements.deleteStatus.textContent = "Base de datos local eliminada. Ahora se van a descargar todas las palabras de manera normal para poderlas guardar y cargarlas más rápido.";
                setTimeout(updateDeleteStatus, 2000);
            });
        });
        // Iniciar la verificación del servidor
        startServerMonitoring();
        updateDeleteStatus();
    } catch (e) {
        console.error("Error en popup.js:", e);
    }
});