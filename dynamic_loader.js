// ============================================================================
// FORUM SCRIPTS DYNAMIC LOADER - BODY VERSION (FIXED)
// Place this script RIGHT AFTER the opening <body> tag
// ============================================================================
(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        observerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@0e0384d/forum_core_observer.js',
        modernizerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@88d60a8/forum_enhacer.js',
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 10000, // 10 seconds timeout
        debug: true,
        // NEW: Script injection preferences
        injectTo: 'head',    // 'head' for dependencies
        startDelay: 100,     // Small delay to let body initialize
        deferModernizer: true // Defer modernizer to avoid conflicts
    };
    
    // State tracking
    const state = {
        observerLoaded: false,
        modernizerLoaded: false,
        observerRetries: 0,
        modernizerRetries: 0,
        observerTimeoutId: null,
        modernizerTimeoutId: null,
        loadStarted: false,
        isBodyReady: !!document.body,
        isHeadReady: !!document.head,
        // NEW: Track script elements for cleanup
        observerScriptElement: null,
        modernizerScriptElement: null,
        activeScripts: new Set() // Track all injected scripts
    };
    
    // Logging helper with better error display
    function log(message, level = 'info') {
        if (!CONFIG.debug && level === 'debug') return;
        
        const styles = {
            info: 'color: #4CAF50; font-weight: bold;',
            warn: 'color: #FF9800; font-weight: bold;',
            error: 'color: #F44336; font-weight: bold;',
            debug: 'color: #9C27B0; font-weight: bold;'
        };
        
        console.log(`%c[Forum Loader] ${message}`, styles[level] || styles.info);
    }
    
    // Better error handler with event extraction
    function handleError(type, error, scriptUrl) {
        let errorMessage = '[Unknown Error]';
        
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (error && typeof error === 'object') {
            // Try to extract useful info from Event object
            if (error.type) {
                errorMessage = `${error.type}: ${error.target?.src || scriptUrl}`;
            } else if (error.message) {
                errorMessage = error.message;
            } else {
                // Try to stringify the object
                try {
                    errorMessage = JSON.stringify(error);
                } catch {
                    errorMessage = String(error);
                }
            }
        } else {
            errorMessage = String(error);
        }
        
        log(`Failed to load ${type}: ${errorMessage}`, 'error');
        
        // Clean up failed script element
        if (type === 'observer' && state.observerScriptElement) {
            removeScript(state.observerScriptElement);
            state.observerScriptElement = null;
        } else if (type === 'modernizer' && state.modernizerScriptElement) {
            removeScript(state.modernizerScriptElement);
            state.modernizerScriptElement = null;
        }
        
        // Update retry counts
        if (type === 'observer') {
            state.observerRetries++;
            if (state.observerRetries < CONFIG.maxRetries) {
                log(`Retrying observer load (${state.observerRetries}/${CONFIG.maxRetries})...`, 'warn');
                setTimeout(() => loadObserver(), CONFIG.retryDelay * state.observerRetries);
            } else {
                log(`Max retries reached for observer. Forum features may be limited.`, 'error');
            }
        } else if (type === 'modernizer') {
            state.modernizerRetries++;
            if (state.modernizerRetries < CONFIG.maxRetries) {
                log(`Retrying modernizer load (${state.modernizerRetries}/${CONFIG.maxRetries})...`, 'warn');
                setTimeout(() => loadModernizer(), CONFIG.retryDelay * state.modernizerRetries);
            } else {
                log(`Max retries reached for modernizer. Post modernization may not work.`, 'error');
            }
        }
    }
    
    // Remove script element safely
    function removeScript(scriptElement) {
        if (!scriptElement || !scriptElement.parentNode) return;
        
        try {
            scriptElement.parentNode.removeChild(scriptElement);
            state.activeScripts.delete(scriptElement);
            log(`Cleaned up script: ${scriptElement.src}`, 'debug');
        } catch (error) {
            log(`Failed to remove script: ${error.message}`, 'debug');
        }
    }
    
    // Clean up all pending scripts
    function cleanupScripts() {
        log(`Cleaning up ${state.activeScripts.size} script(s)...`, 'debug');
        state.activeScripts.forEach(script => {
            removeScript(script);
        });
        state.activeScripts.clear();
    }
    
    // Get the target element for script injection
    function getInjectionTarget() {
        if (CONFIG.injectTo === 'head' && state.isHeadReady) {
            return document.head;
        } else if (state.isBodyReady) {
            return document.body;
        } else {
            return document.documentElement;
        }
    }
    
    // Safe script injection with validation
    function injectScript(script, onLoad, onError) {
        const target = getInjectionTarget();
        
        if (!target) {
            const error = new Error(`No DOM element available for script injection (head: ${state.isHeadReady}, body: ${state.isBodyReady})`);
            log(error.message, 'error');
            onError(error);
            return null;
        }
        
        // Track this script
        state.activeScripts.add(script);
        
        // Clone handlers to prevent multiple calls
        let loadCalled = false;
        let errorCalled = false;
        
        const safeOnLoad = () => {
            if (!loadCalled) {
                loadCalled = true;
                clearTimeout(loadTimeout);
                onLoad();
            }
        };
        
        const safeOnError = (error) => {
            if (!errorCalled) {
                errorCalled = true;
                clearTimeout(loadTimeout);
                onError(error);
            }
        };
        
        script.onload = safeOnLoad;
        script.onerror = safeOnError;
        
        // Add load timeout
        const loadTimeout = setTimeout(() => {
            if (!loadCalled && !errorCalled) {
                safeOnError(new Error(`Script load timeout after ${CONFIG.timeout}ms`));
            }
        }, CONFIG.timeout);
        
        // Store timeout for cleanup
        if (script.src.includes('observer')) {
            state.observerTimeoutId = loadTimeout;
        } else {
            state.modernizerTimeoutId = loadTimeout;
        }
        
        try {
            target.appendChild(script);
            log(`Injected script: ${script.src}`, 'debug');
            return script;
        } catch (error) {
            safeOnError(new Error(`Failed to inject script: ${error.message}`));
            return null;
        }
    }
    
    // Load observer script
    function loadObserver() {
        if (state.observerLoaded) {
            log('Observer already loaded', 'debug');
            return;
        }
        
        log('Loading Forum Core Observer...', 'info');
        
        // Clear any existing observer script
        if (state.observerScriptElement) {
            removeScript(state.observerScriptElement);
        }
        
        // Clear timeout if exists
        if (state.observerTimeoutId) {
            clearTimeout(state.observerTimeoutId);
            state.observerTimeoutId = null;
        }
        
        const script = document.createElement('script');
        script.src = CONFIG.observerScript;
        script.type = 'text/javascript';
        script.async = false; // Synchronous for dependency chain
        script.defer = false; // Don't defer observer - we need it first
        script.crossOrigin = 'anonymous';
        script.dataset.loaderOrigin = 'forum-loader';
        script.dataset.loadTime = Date.now();
        
        state.observerScriptElement = script;
        
        const injected = injectScript(
            script,
            () => {
                state.observerLoaded = true;
                state.observerRetries = 0; // Reset retry count on success
                log('✅ Forum Core Observer loaded successfully', 'info');
                
                // Wait a bit for observer initialization, then load modernizer
                setTimeout(() => {
                    if (globalThis.forumObserver) {
                        log('Forum Observer initialized globally', 'debug');
                        loadModernizer();
                    } else {
                        log('Waiting for forumObserver global initialization...', 'warn');
                        // Wait up to 2 seconds for observer to initialize
                        const checkInterval = setInterval(() => {
                            if (globalThis.forumObserver) {
                                clearInterval(checkInterval);
                                log('Forum Observer now available', 'debug');
                                loadModernizer();
                            }
                        }, 100);
                        
                        setTimeout(() => {
                            clearInterval(checkInterval);
                            if (!globalThis.forumObserver) {
                                log('Forum Observer not initialized after wait, loading modernizer anyway...', 'warn');
                                loadModernizer();
                            }
                        }, 2000);
                    }
                }, CONFIG.startDelay);
            },
            (error) => {
                state.observerScriptElement = null;
                handleError('observer', error, CONFIG.observerScript);
            }
        );
        
        if (!injected) {
            handleError('observer', new Error('Failed to inject script'), CONFIG.observerScript);
        }
    }
    
    // Load modernizer script
    function loadModernizer() {
        if (state.modernizerLoaded) {
            log('Modernizer already loaded', 'debug');
            return;
        }
        
        log('Loading Post Modernizer...', 'info');
        
        // Clear any existing modernizer script
        if (state.modernizerScriptElement) {
            removeScript(state.modernizerScriptElement);
        }
        
        // Clear timeout if exists
        if (state.modernizerTimeoutId) {
            clearTimeout(state.modernizerTimeoutId);
            state.modernizerTimeoutId = null;
        }
        
        const script = document.createElement('script');
        script.src = CONFIG.modernizerScript;
        script.type = 'text/javascript';
        script.async = CONFIG.deferModernizer; // Async if deferring
        script.defer = CONFIG.deferModernizer; // Defer modernizer
        script.crossOrigin = 'anonymous';
        script.dataset.loaderOrigin = 'forum-loader';
        script.dataset.loadTime = Date.now();
        script.dataset.dependsOn = 'forumObserver'; // Mark dependency
        
        state.modernizerScriptElement = script;
        
        const injected = injectScript(
            script,
            () => {
                state.modernizerLoaded = true;
                state.modernizerRetries = 0; // Reset retry count on success
                log('✅ Post Modernizer loaded successfully', 'info');
                
                // Check initialization
                setTimeout(() => {
                    checkInitialization();
                }, CONFIG.startDelay);
            },
            (error) => {
                state.modernizerScriptElement = null;
                handleError('modernizer', error, CONFIG.modernizerScript);
            }
        );
        
        if (!injected) {
            handleError('modernizer', new Error('Failed to inject script'), CONFIG.modernizerScript);
        }
    }
    
    // Check if scripts initialized properly
    function checkInitialization() {
        const checks = {
            'Forum Observer': () => globalThis.forumObserver,
            'Post Modernizer': () => globalThis.postModernizer
        };
        
        let allInitialized = true;
        let observerAvailable = false;
        
        Object.entries(checks).forEach(([name, check]) => {
            const instance = check();
            if (instance) {
                log(`✅ ${name} initialized successfully`, 'info');
                if (name === 'Forum Observer') observerAvailable = true;
            } else {
                log(`⚠️ ${name} script loaded but not initialized`, 'warn');
                allInitialized = false;
            }
        });
        
        // Report final status
        if (allInitialized) {
            log('🎉 All forum scripts loaded and initialized successfully!', 'info');
            dispatchLoadComplete();
        } else {
            log('Some forum features may not be fully available', 'warn');
            
            // If observer is available but modernizer failed, register a fallback
            if (observerAvailable && !globalThis.postModernizer) {
                log('Setting up fallback for postModernizer...', 'warn');
                setupModernizerFallback();
            }
        }
    }
    
    // Fallback if modernizer fails to load
    function setupModernizerFallback() {
        if (globalThis.postModernizer) return; // Already exists
        
        globalThis.postModernizer = {
            initialized: false,
            error: 'Modernizer script failed to load',
            fallback: true,
            modernizePost: (post) => {
                console.warn('Modernizer fallback: Basic post styling applied');
                // Minimal fallback styling
                if (post && post.classList) {
                    post.classList.add('post-modern-fallback');
                }
            }
        };
        
        log('Modernizer fallback created', 'info');
    }
    
    // Dispatch custom event when loading is complete
    function dispatchLoadComplete() {
        const event = new CustomEvent('forumScriptsLoaded', {
            detail: {
                observer: globalThis.forumObserver,
                modernizer: globalThis.postModernizer,
                timestamp: Date.now(),
                loaderState: { ...state }
            }
        });
        document.dispatchEvent(event);
        log('forumScriptsLoaded event dispatched', 'debug');
    }
    
    // Start loading - BODY VERSION: Start immediately
    function startLoading() {
        if (state.loadStarted) {
            log('Loader already started, skipping duplicate start', 'debug');
            return;
        }
        
        state.loadStarted = true;
        log('Starting forum scripts loading sequence from body...', 'info');
        
        // Clean up any existing scripts first
        cleanupScripts();
        
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            loadObserver();
        }, CONFIG.startDelay);
    }
    
    // Monitor DOM readiness
    function waitForDOM() {
        // If body doesn't exist yet, wait for it
        if (!state.isBodyReady) {
            log('Body not ready, waiting...', 'debug');
            
            const observer = new MutationObserver(() => {
                if (document.body) {
                    observer.disconnect();
                    state.isBodyReady = true;
                    log('Body is now ready', 'debug');
                    startLoading();
                }
            });
            
            observer.observe(document.documentElement, { childList: true, subtree: true });
            
            // Fallback timeout
            setTimeout(() => {
                observer.disconnect();
                if (document.body) {
                    state.isBodyReady = true;
                    startLoading();
                } else {
                    log('Body still not available after timeout, trying anyway...', 'warn');
                    startLoading();
                }
            }, 1000);
        } else {
            // Body exists, start immediately
            startLoading();
        }
    }
    
    // Initialize loader
    log('Forum Scripts Loader initializing in body...', 'info');
    
    // Check if we're really in a browser environment
    if (typeof document === 'undefined') {
        log('ERROR: Document not available - not in browser environment', 'error');
        return;
    }
    
    // Check if scripts are already loaded (prevent duplicate loading)
    if (globalThis.forumObserver || globalThis.postModernizer) {
        log('Forum scripts already loaded globally, skipping loader', 'warn');
        return;
    }
    
    // Check for existing forum loader scripts
    const existingLoaders = document.querySelectorAll('script[data-loader-origin="forum-loader"]');
    if (existingLoaders.length > 0) {
        log(`Found ${existingLoaders.length} existing forum loader script(s), skipping duplicate`, 'warn');
        return;
    }
    
    // Start loading process
    waitForDOM();
    
    // Expose loader for debugging with enhanced API
    globalThis.__forumLoader = {
        config: CONFIG,
        state: Object.freeze({ ...state }), // Read-only copy
        reload: () => {
            log('Manual reload requested...', 'info');
            
            // Clean up existing state
            cleanupScripts();
            
            // Reset state
            state.loadStarted = false;
            state.observerLoaded = false;
            state.modernizerLoaded = false;
            state.observerRetries = 0;
            state.modernizerRetries = 0;
            state.observerScriptElement = null;
            state.modernizerScriptElement = null;
            
            // Clear timeouts
            if (state.observerTimeoutId) clearTimeout(state.observerTimeoutId);
            if (state.modernizerTimeoutId) clearTimeout(state.modernizerTimeoutId);
            state.observerTimeoutId = null;
            state.modernizerTimeoutId = null;
            
            // Start fresh
            setTimeout(startLoading, 100);
        },
        checkStatus: () => {
            const status = {
                observer: {
                    loaded: state.observerLoaded,
                    initialized: !!globalThis.forumObserver,
                    retries: state.observerRetries,
                    scriptElement: !!state.observerScriptElement
                },
                modernizer: {
                    loaded: state.modernizerLoaded,
                    initialized: !!globalThis.postModernizer,
                    retries: state.modernizerRetries,
                    scriptElement: !!state.modernizerScriptElement
                },
                loadStarted: state.loadStarted,
                domReady: {
                    body: state.isBodyReady,
                    head: state.isHeadReady
                },
                environment: {
                    inBrowser: typeof document !== 'undefined',
                    readyState: document.readyState,
                    url: window.location.href
                },
                activeScripts: state.activeScripts.size
            };
            
            // Add debug URLs
            if (CONFIG.debug) {
                status.urls = {
                    observer: CONFIG.observerScript,
                    modernizer: CONFIG.modernizerScript
                };
            }
            
            return status;
        },
        cleanup: cleanupScripts,
        // Test script loading
        testLoad: (url) => {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.onload = () => resolve(true);
                script.onerror = (e) => reject(e);
                document.head.appendChild(script);
            });
        }
    };
    
    // Add global helper for other scripts to wait for forum scripts
    if (!globalThis.waitForForumScripts) {
        globalThis.waitForForumScripts = (timeout = 10000) => {
            return new Promise((resolve, reject) => {
                if (globalThis.forumObserver && globalThis.postModernizer) {
                    resolve({
                        observer: globalThis.forumObserver,
                        modernizer: globalThis.postModernizer
                    });
                } else {
                    const timeoutId = setTimeout(() => {
                        reject(new Error('Timeout waiting for forum scripts'));
                    }, timeout);
                    
                    document.addEventListener('forumScriptsLoaded', (e) => {
                        clearTimeout(timeoutId);
                        resolve(e.detail);
                    }, { once: true });
                }
            });
        };
    }
    
    // Cleanup on page unload
    globalThis.addEventListener('pagehide', () => {
        log('Page unloading, cleaning up...', 'debug');
        cleanupScripts();
        if (state.observerTimeoutId) clearTimeout(state.observerTimeoutId);
        if (state.modernizerTimeoutId) clearTimeout(state.modernizerTimeoutId);
    });
    
    // Add error boundary
    globalThis.addEventListener('error', (event) => {
        if (event.target && event.target.tagName === 'SCRIPT' && 
            event.target.dataset.loaderOrigin === 'forum-loader') {
            log(`Script error detected: ${event.target.src}`, 'error');
        }
    }, true);
    
})();
