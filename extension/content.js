try {
    let currentProcessingWord = null;
    let processedCount = 0;
    let newWordsCount = 0;
    let processingStartTime = null;
    let tooltipAnimating = false;
    let tooltipHideTimer = null;
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "processWords") {
            processWordsInBackground(request.words);
            sendResponse({ success: true, count: request.words.length });
        } else if (request.action === "getProcessingStatus") {
            chrome.storage.local.get(["wordCache"], (result) => {
                // Calcular el porcentaje de progreso
                let percentComplete = 0;
                if (totalWordsToProcess > 0) {
                    // Calcular basado en palabras procesadas y palabras restantes
                    const remainingWords = totalWordsToProcess - processedCount;
                    const wordsProcessedSoFar = totalWordsToProcess - remainingWords;
                    percentComplete = Math.round((wordsProcessedSoFar / totalWordsToProcess) * 100);
                    // Asegurar que el porcentaje esté entre 0 y 100
                    percentComplete = Math.max(0, Math.min(100, percentComplete));
                }
                sendResponse({
                    isProcessing: currentProcessingWord !== null,
                    currentWord: currentProcessingWord,
                    processedCount,
                    processed: processedCount,
                    newWordsCount,
                    newWords: newWordsCount,
                    percentComplete: percentComplete,
                    cacheSize: Object.keys(result?.wordCache || {}).length
                });
            });
            return true;
        }
        return true;
    });
    let totalWordsToProcess = 0;
    function processWordsInBackground(words) {
        try {
            chrome.storage.local.get(["wordCache"], (result) => {
                if (chrome.runtime.lastError) {
                    if (chrome.runtime.lastError.message.includes("context invalidated")) return;
                    console.log("Error al acceder al almacenamiento:", chrome.runtime.lastError.message);
                    return;
                }
                const wordCache = result.wordCache || {};
                processedCount = 0;
                newWordsCount = 0;
                processingStartTime = Date.now();
                totalWordsToProcess = words.length;
                const config = {
                    pendingRequests: 0,
                    maxConcurrentRequests: 5,
                    retryDelay: 2000,
                    retryLimit: 3
                };
                function checkProcessingComplete() {
                    if (config.pendingRequests === 0 && currentProcessingWord === null) {
                        console.log(`Procesamiento completado: ${processedCount} palabras procesadas, ${newWordsCount} palabras nuevas agregadas`);
                        chrome.runtime.sendMessage({ 
                            action: "processingComplete", 
                            count: processedCount, 
                            newWordsCount,
                            percentComplete: 100 // Indicar que el proceso está 100% completado
                        });
                    }
                }
                function calculateEstimatedTime(remainingWords) {
                    if (processedCount <= 0 || !processingStartTime || remainingWords <= 0) return '';
                    const elapsedTime = (Date.now() - processingStartTime) / 1000;
                    const processingSpeed = (processedCount / elapsedTime).toFixed(2);
                    if (processingSpeed <= 0) return '';
                    const estimatedSeconds = remainingWords / processingSpeed;
                    if (estimatedSeconds < 60) {
                        return `${Math.ceil(estimatedSeconds)} segundos`;
                    } else if (estimatedSeconds < 3300) {
                        return `${Math.ceil(estimatedSeconds / 60)} minutos`;
                    } else {
                        const hours = Math.floor(estimatedSeconds / 3300);
                        const minutes = Math.ceil((estimatedSeconds % 3300) / 60);
                        return `${hours} h ${minutes} min`;
                    }
                }
                function notifyProgress(word, remainingWords, retryCount = 0) {
                    const estimatedTime = calculateEstimatedTime(remainingWords);
                    const processingSpeed = processedCount > 0 && processingStartTime ? 
                        (processedCount / ((Date.now() - processingStartTime) / 1000)).toFixed(2) : 0;
                    // Calcular el porcentaje de progreso
                    let percentComplete = 0;
                    if (totalWordsToProcess > 0) {
                        // Calcular basado en palabras procesadas y palabras restantes
                        // Aseguramos que remainingWords sea un número válido
                        const validRemainingWords = typeof remainingWords === 'number' ? remainingWords : 0;
                        const wordsProcessedSoFar = totalWordsToProcess - validRemainingWords;
                        percentComplete = Math.round((wordsProcessedSoFar / totalWordsToProcess) * 100);
                        // Asegurar que el porcentaje esté entre 0 y 100
                        percentComplete = Math.max(0, Math.min(100, percentComplete));
                    }
                    chrome.runtime.sendMessage({
                        action: "processingUpdate",
                        word,
                        remaining: remainingWords,
                        processed: processedCount,
                        newWords: newWordsCount,
                        retryCount: retryCount > 0 ? retryCount : undefined,
                        estimatedTime,
                        processingSpeed,
                        percentComplete: percentComplete
                    });
                }
                function processWord(word, remainingWords, retryCount = 0) {
                    if (retryCount > config.retryLimit) {
                        console.log(`Palabra '${word}' excedió el límite de reintentos (${config.retryLimit}). Omitiendo.`);
                        config.pendingRequests--;
                        checkProcessingComplete();
                        return;
                    }
                    currentProcessingWord = word;
                    notifyProgress(word, remainingWords, retryCount);
                    fetch(`http://localhost:5000/${word}`, {
                        method: 'GET',
                        mode: 'cors',
                        credentials: 'omit',
                        headers: {
                            "accept": "application/json",
                            "content-type": "application/json",
                            "Origin": window.location.origin
                        },
                        signal: AbortSignal.timeout(10000)
                    })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Error de servidor: ${response.status} ${response.statusText}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        if (data?.ok && data?.data?.length > 0) {
                            const meaning = data.data.map(word_obj => 
                                `${word_obj.word} (${word_obj.meaning.map(mean => 
                                    `${mean.pos_tag}: ${mean.definition}`).join(", ")})`
                            ).join(" ");
                            const isNewWord = !wordCache.hasOwnProperty(word);
                            wordCache[word] = meaning;
                            try {
                                chrome.storage.local.set({ wordCache }, () => {
                                    if (chrome.runtime.lastError) {
                                        if (chrome.runtime.lastError.message.includes("context invalidated")) return;
                                        console.log("Error al guardar en el almacenamiento:", chrome.runtime.lastError.message);
                                        config.pendingRequests--;
                                        checkProcessingComplete();
                                        return;
                                    }
                                    processedCount++;
                                    if (isNewWord) newWordsCount++;
                                    config.pendingRequests--;
                                    checkProcessingComplete();
                                    processNextFromQueue();
                                });
                            } catch (error) {
                                if (error.message.includes("context invalidated")) return;
                                console.log("Error al guardar en el almacenamiento:", error.message);
                                config.pendingRequests--;
                                checkProcessingComplete();
                                processNextFromQueue();
                            }
                        } else {
                            config.pendingRequests--;
                            checkProcessingComplete();
                            processNextFromQueue();
                        }
                    })
                    .catch(error => {
                        if (error.toString().includes("context invalidated")) return;
                        if (error.name === 'AbortError') {
                            console.log(`Timeout al procesar '${word}'. Reintentando...`);
                        } else if (error.toString().includes("ERR_INSUFFICIENT_RESOURCES")) {
                            console.log(`Error de recursos insuficientes al procesar '${word}'. Reintentando con pausa...`);
                            config.maxConcurrentRequests = Math.max(2, config.maxConcurrentRequests - 1);
                        } else {
                            console.log(`Error procesando palabra '${word}':`, error);
                        }
                        const backoffDelay = config.retryDelay * Math.pow(1.5, retryCount);
                        setTimeout(() => {
                            processWord(word, remainingWords, retryCount + 1);
                        }, backoffDelay);
                    });
                }
                const wordQueue = words.filter(word => !wordCache.hasOwnProperty(word));
                console.log(`Filtradas ${words.length - wordQueue.length} palabras que ya existen en el caché. Procesando ${wordQueue.length} palabras nuevas.`);
                // Actualizar totalWordsToProcess con el número real de palabras a procesar después del filtrado
                totalWordsToProcess = wordQueue.length;
                
                // Si no hay palabras nuevas para procesar, notificar inmediatamente que el proceso está completo
                if (wordQueue.length === 0) {
                    console.log('No hay palabras nuevas para procesar. Notificando que el proceso está completo.');
                    chrome.runtime.sendMessage({ 
                        action: "processingComplete", 
                        count: processedCount, 
                        newWordsCount: 0,
                        percentComplete: 100
                    });
                    return;
                }
                function processNextFromQueue() {
                    if (config.pendingRequests < config.maxConcurrentRequests && wordQueue.length > 0) {
                        const word = wordQueue.shift();
                        config.pendingRequests++;
                        setTimeout(() => {
                            processWord(word, wordQueue.length);
                        }, 200);
                    }
                }
                const initialBatchSize = Math.min(config.maxConcurrentRequests, wordQueue.length);
                for (let i = 0; i < initialBatchSize; i++) {
                    processNextFromQueue();
                }
            });
        } catch (error) {
            if (error.message.includes("context invalidated")) return;
            console.log("Error al procesar palabras en segundo plano:", error.message);
        }
    }
    function initializeTooltip() {
        const styleElement = document.createElement('link');
        styleElement.rel = 'stylesheet';
        styleElement.href = chrome.runtime.getURL('content.css');
        document.head.appendChild(styleElement);
        const tooltip = document.createElement("div");
        tooltip.className = "tooltip";
        document.body.appendChild(tooltip);
        return tooltip;
    }
    function showTooltip(tooltip, text, x, y) {
        tooltip.textContent = text;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y + 20}px`;
        tooltip.style.display = "block";
        setTimeout(() => {
            tooltip.classList.add("show");
            tooltipAnimating = true;
            setTimeout(() => {
                tooltipAnimating = false;
            }, 300);
        }, 10);
    }
    function hideTooltip(tooltip) {
        if (tooltip.classList.contains("show") && !tooltipAnimating) {
            tooltipAnimating = true;
            tooltip.classList.remove("show");
            if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
            tooltipHideTimer = setTimeout(() => {
                tooltip.style.display = "none";
                tooltipAnimating = false;
            }, 300);
        }
    }
    chrome.storage.local.get(["enabled", "wordCache"], (result) => {
        if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message.includes("context invalidated")) return;
            console.log("Error al acceder al almacenamiento:", chrome.runtime.lastError.message);
            return;
        }
        if (!result?.enabled) return;
        try {
            const tooltip = initializeTooltip();
            let wordCache = result.wordCache || {};
            let requestQueue = [];
            let isProcessing = false;
            let wordBuffer = [];
            let bufferTimer = null;
            // Variable para controlar el estado del servidor
            let serverAvailable = true;
            let lastServerCheck = 0;
            const SERVER_CHECK_INTERVAL = 10000; // 10 segundos
            // Función para verificar si el servidor está disponible
            function checkServerAvailability() {
                const now = Date.now();
                if (now - lastServerCheck < SERVER_CHECK_INTERVAL) return serverAvailable;
                lastServerCheck = now;
                fetch('http://localhost:5000/ping', {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    headers: {
                        "accept": "application/json",
                        "Origin": window.location.origin
                    },
                    signal: AbortSignal.timeout(10000)
                })
                .then(() => {
                    if (!serverAvailable) {
                        console.log("Servidor disponible nuevamente");
                        serverAvailable = true;
                    }
                })
                .catch(() => {
                    if (serverAvailable) {
                        console.log("Servidor no disponible");
                        serverAvailable = false;
                    }
                });
                return serverAvailable;
            }
            function updateTooltip(text, x, y) {
                if (!text) return;
                text = text.replace(/[^\p{L}_]/gu, '').toLowerCase();
                if (text.trim().length <= 2) return;
                if (/^\d+$/.test(text)) {
                    showTooltip(tooltip, `"${text}" es un número`, x, y);
                    return;
                }
                if (tooltipHideTimer) {
                    clearTimeout(tooltipHideTimer);
                    tooltipHideTimer = null;
                }
                tooltip.style.display = "block";
                setTimeout(() => {
                    tooltip.classList.add("show");
                    tooltipAnimating = true;
                    setTimeout(() => tooltipAnimating = false, 300);
                }, 10);
                if (wordCache[text]) {
                    showTooltip(tooltip, `Significado de "${text}": ${wordCache[text]}`, x, y);
                    return;
                }
                // Verificar disponibilidad del servidor antes de encolar la palabra
                if (!checkServerAvailability()) {
                    showTooltip(tooltip, `El servidor no está disponible. No se puede procesar "${text}".`, x, y);
                    return;
                }
                if (!wordBuffer.includes(text)) {
                    wordBuffer.push({ text, x, y });
                    showTooltip(tooltip, `"${text}" en cola (posición ${wordBuffer.length})`, x, y);
                    if (!bufferTimer)
                        bufferTimer = setInterval(() => {
                            if (wordBuffer.length > 0 && !isProcessing) {
                                const lastWord = wordBuffer[wordBuffer.length - 1];
                                wordBuffer = [];
                                requestQueue.push(lastWord);
                                processQueue();
                            }
                        }, 2000);
                }
            }
            function processQueue() {
                if (isProcessing || requestQueue.length === 0) return;
                const { text, x, y } = requestQueue.shift();
                if (wordCache[text]) {
                    showTooltip(tooltip, `Significado de "${text}": ${wordCache[text]}`, x, y);
                    if (requestQueue.length > 0) processQueue();
                    return;
                }
                isProcessing = true;
                console.log(`Procesando "${text}"...`);
                // Verificar si el servidor está disponible antes de hacer la petición
                if (!serverAvailable) {
                    showTooltip(tooltip, `El servidor no está disponible. No se puede procesar "${text}".`, x, y);
                    isProcessing = false;
                    if (requestQueue.length > 0) processQueue();
                    return;
                }
                fetch(`http://localhost:5000/${text}`, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    headers: {
                        "accept": "application/json",
                        "content-type": "application/json",
                        "Origin": window.location.origin
                    },
                    signal: AbortSignal.timeout(10000)
                })
                .then(response => {
                    if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);
                    return response.json();
                })
                .then(data => {
                    if (data?.ok && data?.data?.length > 0) {
                        const meaning = data.data.map(word_obj => 
                            `${word_obj.word} (${word_obj.meaning.map(mean => 
                                `${mean.pos_tag}: ${mean.definition}`).join(", ")})`
                        ).join(" ");
                        wordCache[text] = meaning;
                        chrome.storage.local.set({ wordCache });
                        showTooltip(tooltip, `Significado de "${text}": ${meaning}`, x, y);
                    }
                })
                .catch(error => console.log(`Error al procesar "${text}":`, error))
                .finally(() => {
                    isProcessing = false;
                    if (requestQueue.length > 0) processQueue();
                });
            }
            function isElementVisible(element) {
                while (element) {
                    const style = getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    element = element.parentElement;
                }
                return true;
            }
            function handleMouseMove(e) {
                if (!e.ctrlKey) {
                    hideTooltip(tooltip);
                    return;
                }
                try {
                    // Asegurarse de que el tooltip esté visible cuando se presiona Ctrl
                    // incluso si el servidor está caído
                    const showTooltipForWord = (text, x, y) => {
                        if (text && text.length > 2) {
                            // Mostrar el tooltip inmediatamente para mejorar la experiencia del usuario
                            tooltip.style.display = "block";
                            setTimeout(() => {
                                tooltip.classList.add("show");
                                tooltipAnimating = true;
                                setTimeout(() => tooltipAnimating = false, 300);
                            }, 10);
                            updateTooltip(text, x, y);
                        }
                    };
                    chrome.storage.local.get(["wordCache"], (result) => {
                        if (chrome.runtime.lastError) {
                            if (chrome.runtime.lastError.message.includes("context invalidated")) return;
                            console.log("Error al acceder al almacenamiento:", chrome.runtime.lastError.message);
                            return;
                        }
                        if (result.wordCache && Object.keys(result.wordCache).length > Object.keys(wordCache).length) {
                            wordCache = result.wordCache;
                        }
                    });
                    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    if (!range) return;
                    const node = range.startContainer;
                    if (node.nodeType !== Node.TEXT_NODE || !isElementVisible(node.parentElement)) {
                        tooltip.style.display = "none";
                        return;
                    }
                    const content = node.textContent;
                    let start = range.startOffset;
                    let end = start;
                    while (start > 0 && !/\s/.test(content[start - 1])) start--;
                    while (end < content.length && !/\s/.test(content[end])) end++;
                    const text = content.slice(start, end).trim();
                    showTooltipForWord(text, e.pageX, e.pageY);
                } catch (error) {
                    if (error.message.includes("context invalidated")) return;
                    console.log("Error en el evento mousemove:", error.message);
                    if (tooltip) tooltip.style.display = "none";
                }
            }
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("keyup", e => {
                if (!e.ctrlKey) hideTooltip(tooltip);
            });
        } catch (error) {}
    });
} catch (error) {}