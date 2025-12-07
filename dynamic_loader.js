// ============================================================================
// FORUM SCRIPTS DYNAMIC LOADER - BODY VERSION
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
        injectTo: 'head',    // 'head' for dependencies, 'body' for performance
        startDelay: 50       // Small delay to let body initialize
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
        isBodyReady: !!document.body,  // Check if body exists immediately
        isHeadReady: !!document.head   // Check if head exists
    };
    
    // Logging helper
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
    
    // Error handler
    function handleError(type, error, scriptUrl) {
        log(`Failed to load ${type}: ${error.message || error}`, 'error');
        
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
    
    // Get the target element for script injection
    function getInjectionTarget() {
        if (CONFIG.injectTo === 'head' && state.isHeadReady) {
            return document.head;
        } else if (state.isBodyReady) {
            return document.body;
        } else {
            // Fallback to document.documentElement
            return document.documentElement;
        }
    }
    
    // Safe script injection with validation
    function injectScript(script, onLoad, onError) {
        const target = getInjectionTarget();
        
        if (!target) {
            log(`No injection target available (head: ${state.isHeadReady}, body: ${state.isBodyReady})`, 'error');
            onError(new Error('No DOM element available for script injection'));
            return null;
        }
        
        // Clone handlers to prevent multiple calls
        let loadCalled = false;
        let errorCalled = false;
        
        const safeOnLoad = () => {
            if (!loadCalled) {
                loadCalled = true;
                onLoad();
            }
        };
        
        const safeOnError = (error) => {
            if (!errorCalled) {
                errorCalled = true;
                onError(error);
            }
        };
        
        script.onload = safeOnLoad;
        script.onerror = safeOnError;
        
        // Add fallback timeout
        const fallbackTimeout = setTimeout(() => {
            if (!loadCalled && !errorCalled) {
                safeOnError(new Error('Script load timeout'));
            }
        }, CONFIG.timeout + 1000);
        
        // Override onload to clear timeout
        const originalOnLoad = script.onload;
        script.onload = function() {
            clearTimeout(fallbackTimeout);
            originalOnLoad?.call(this);
        };
        
        target.appendChild(script);
        return script;
    }
    
    // Load observer script
    function loadObserver() {
        if (state.observerLoaded) return;
        
        log('Loading Forum Core Observer...', 'info');
        
        // Clear any existing timeout
        if (state.observerTimeoutId) {
            clearTimeout(state.observerTimeoutId);
        }
        
        // Set timeout for observer load
        state.observerTimeoutId = setTimeout(() => {
            if (!state.observerLoaded) {
                handleError('observer', new Error('Load timeout'), CONFIG.observerScript);
            }
        }, CONFIG.timeout);
        
        const script = document.createElement('script');
        script.src = CONFIG.observerScript;
        script.type = 'text/javascript';
        script.async = false; // Ensure sequential loading
        script.crossOrigin = 'anonymous';
        script.dataset.loaderOrigin = 'forum-loader'; // Mark as from our loader
        
        const injected = injectScript(
            script,
            () => {
                clearTimeout(state.observerTimeoutId);
                state.observerLoaded = true;
                log('✅ Forum Core Observer loaded successfully', 'info');
                
                // Wait a bit for observer initialization, then load modernizer
                setTimeout(loadModernizer, CONFIG.startDelay);
            },
            (error) => {
                clearTimeout(state.observerTimeoutId);
                handleError('observer', error, CONFIG.observerScript);
            }
        );
        
        if (!injected) {
            handleError('observer', new Error('Failed to inject script'), CONFIG.observerScript);
        }
    }
    
    // Load modernizer script
    function loadModernizer() {
        // Only load if observer is loaded and initialized
        if (!state.observerLoaded) {
            log('Waiting for observer before loading modernizer...', 'debug');
            
            // Check if observer becomes available
            const checkInterval = setInterval(() => {
                if (globalThis.forumObserver || state.observerLoaded) {
                    clearInterval(checkInterval);
                    log('Observer now available, loading modernizer...', 'debug');
                    forceLoadModernizer();
                }
            }, 100);
            
            // Timeout for waiting
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!state.observerLoaded && !globalThis.forumObserver) {
                    log('Observer not available after wait, attempting modernizer load anyway...', 'warn');
                    // Continue anyway - modernizer has its own retry logic
                    forceLoadModernizer();
                }
            }, 2000);
            
            return;
        }
        
        forceLoadModernizer();
    }
    
    function forceLoadModernizer() {
        if (state.modernizerLoaded) return;
        
        log('Loading Post Modernizer...', 'info');
        
        // Clear any existing timeout
        if (state.modernizerTimeoutId) {
            clearTimeout(state.modernizerTimeoutId);
        }
        
        // Set timeout for modernizer load
        state.modernizerTimeoutId = setTimeout(() => {
            if (!state.modernizerLoaded) {
                handleError('modernizer', new Error('Load timeout'), CONFIG.modernizerScript);
            }
        }, CONFIG.timeout);
        
        const script = document.createElement('script');
        script.src = CONFIG.modernizerScript;
        script.type = 'text/javascript';
        script.async = false; // Ensure sequential loading
        script.crossOrigin = 'anonymous';
        script.dataset.loaderOrigin = 'forum-loader'; // Mark as from our loader
        
        const injected = injectScript(
            script,
            () => {
                clearTimeout(state.modernizerTimeoutId);
                state.modernizerLoaded = true;
                log('✅ Post Modernizer loaded successfully', 'info');
                
                // Check if both scripts initialized properly
                setTimeout(() => {
                    checkInitialization();
                }, CONFIG.startDelay);
            },
            (error) => {
                clearTimeout(state.modernizerTimeoutId);
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
        
        Object.entries(checks).forEach(([name, check]) => {
            if (check()) {
                log(`✅ ${name} initialized successfully`, 'info');
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
        }
    }
    
    // Dispatch custom event when loading is complete
    function dispatchLoadComplete() {
        const event = new CustomEvent('forumScriptsLoaded', {
            detail: {
                observer: globalThis.forumObserver,
                modernizer: globalThis.postModernizer,
                timestamp: Date.now()
            }
        });
        document.dispatchEvent(event);
    }
    
    // Start loading - BODY VERSION: Start immediately
    function startLoading() {
        if (state.loadStarted) {
            log('Loader already started', 'debug');
            return;
        }
        
        state.loadStarted = true;
        log('Starting forum scripts loading sequence from body...', 'info');
        
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
    
    // Initialize loader - BODY VERSION
    log('Forum Scripts Loader initializing in body...', 'info');
    
    // Check if we're really in a browser environment
    if (typeof document === 'undefined') {
        log('ERROR: Document not available - not in browser environment', 'error');
        return;
    }
    
    // Start loading process
    waitForDOM();
    
    // Expose loader for debugging with enhanced API
    globalThis.__forumLoader = {
        config: CONFIG,
        state: state,
        reload: () => {
            log('Manual reload requested...', 'info');
            state.loadStarted = false;
            state.observerLoaded = false;
            state.modernizerLoaded = false;
            state.observerRetries = 0;
            state.modernizerRetries = 0;
            
            // Clear timeouts
            if (state.observerTimeoutId) clearTimeout(state.observerTimeoutId);
            if (state.modernizerTimeoutId) clearTimeout(state.modernizerTimeoutId);
            
            startLoading();
        },
        checkStatus: () => {
            return {
                observer: {
                    loaded: state.observerLoaded,
                    initialized: !!globalThis.forumObserver,
                    retries: state.observerRetries
                },
                modernizer: {
                    loaded: state.modernizerLoaded,
                    initialized: !!globalThis.postModernizer,
                    retries: state.modernizerRetries
                },
                loadStarted: state.loadStarted,
                domReady: {
                    body: state.isBodyReady,
                    head: state.isHeadReady
                },
                environment: {
                    inBrowser: typeof document !== 'undefined',
                    readyState: document.readyState
                }
            };
        },
        // New: Force initialization check
        forceCheck: () => {
            checkInitialization();
            return this.checkStatus();
        },
        // New: Get injection target info
        getInjectionTarget: () => {
            const target = getInjectionTarget();
            return {
                element: target?.tagName || 'none',
                type: CONFIG.injectTo,
                available: !!target
            };
        }
    };
    
    // Add global helper for other scripts to wait for forum scripts
    if (!globalThis.waitForForumScripts) {
        globalThis.waitForForumScripts = () => {
            return new Promise((resolve) => {
                if (globalThis.forumObserver && globalThis.postModernizer) {
                    resolve({
                        observer: globalThis.forumObserver,
                        modernizer: globalThis.postModernizer
                    });
                } else {
                    document.addEventListener('forumScriptsLoaded', (e) => {
                        resolve(e.detail);
                    }, { once: true });
                }
            });
        };
    }
    
    // Cleanup on page unload
    globalThis.addEventListener('pagehide', () => {
        log('Page unloading, cleaning up...', 'debug');
        if (state.observerTimeoutId) clearTimeout(state.observerTimeoutId);
        if (state.modernizerTimeoutId) clearTimeout(state.modernizerTimeoutId);
    });
    
})();
