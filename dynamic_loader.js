// ============================================================================
// FORUM SCRIPTS DYNAMIC LOADER - BODY INJECTION VERSION
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
        // CRITICAL CHANGE: Inject scripts into BODY, not head
        injectTo: 'body',    // 'body' ensures scripts load after body exists
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
        isBodyReady: !!document.body,
        isHeadReady: !!document.head,
        scriptsInjected: []  // Track injected scripts
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
    
    // Get the target element for script injection - CRITICAL FIX
    function getInjectionTarget() {
        // ALWAYS use body for injection when possible
        if (document.body) {
            log('Injecting scripts into body', 'debug');
            return document.body;
        }
        
        // Fallback for edge cases
        log('Body not available, using documentElement', 'warn');
        return document.documentElement;
    }
    
    // Safe script injection with validation
    function injectScript(script, onLoad, onError, scriptType) {
        const target = getInjectionTarget();
        
        if (!target) {
            log(`No injection target available`, 'error');
            onError(new Error('No DOM element available for script injection'));
            return null;
        }
        
        // Track this script
        state.scriptsInjected.push({
            type: scriptType,
            src: script.src,
            timestamp: Date.now(),
            injectedInto: target.tagName
        });
        
        log(`Injecting ${scriptType} into ${target.tagName}...`, 'debug');
        
        // Clone handlers to prevent multiple calls
        let loadCalled = false;
        let errorCalled = false;
        
        const safeOnLoad = () => {
            if (!loadCalled) {
                loadCalled = true;
                log(`${scriptType} loaded successfully`, 'debug');
                onLoad();
            }
        };
        
        const safeOnError = (error) => {
            if (!errorCalled) {
                errorCalled = true;
                log(`${scriptType} load error: ${error.message}`, 'debug');
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
        
        // CRITICAL: Append to body, not head!
        target.appendChild(script);
        
        // Verify injection
        if (script.parentNode === target) {
            log(`${scriptType} successfully injected into ${target.tagName}`, 'debug');
        } else {
            log(`${scriptType} may not have been injected properly`, 'warn');
        }
        
        return script;
    }
    
    // Load observer script
    function loadObserver() {
        if (state.observerLoaded) {
            log('Observer already loaded', 'debug');
            return;
        }
        
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
        script.dataset.loaderOrigin = 'forum-loader';
        script.dataset.injectedInto = 'body'; // Mark as injected into body
        // DON'T use defer - we want immediate execution
        
        const injected = injectScript(
            script,
            () => {
                clearTimeout(state.observerTimeoutId);
                state.observerLoaded = true;
                log('✅ Forum Core Observer loaded successfully', 'info');
                
                // Verify observer initialized
                if (globalThis.forumObserver) {
                    log('Forum Observer initialized successfully', 'info');
                } else {
                    log('Forum Observer loaded but not initialized', 'warn');
                }
                
                // Wait a bit for observer initialization, then load modernizer
                setTimeout(loadModernizer, CONFIG.startDelay);
            },
            (error) => {
                clearTimeout(state.observerTimeoutId);
                handleError('observer', error, CONFIG.observerScript);
            },
            'observer'
        );
        
        if (!injected) {
            handleError('observer', new Error('Failed to inject script'), CONFIG.observerScript);
        }
    }
    
    // Load modernizer script
    function loadModernizer() {
        // Check if already loaded
        if (state.modernizerLoaded) {
            log('Modernizer already loaded', 'debug');
            checkInitialization();
            return;
        }
        
        // Only load if observer is loaded
        if (!state.observerLoaded) {
            log('Observer not loaded yet, waiting...', 'debug');
            
            // Wait for observer
            const checkInterval = setInterval(() => {
                if (state.observerLoaded) {
                    clearInterval(checkInterval);
                    log('Observer now loaded, proceeding with modernizer...', 'debug');
                    forceLoadModernizer();
                }
            }, 100);
            
            // Timeout for waiting
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!state.observerLoaded) {
                    log('Observer still not loaded after wait, attempting modernizer anyway...', 'warn');
                    forceLoadModernizer();
                }
            }, 3000);
            
            return;
        }
        
        forceLoadModernizer();
    }
    
    function forceLoadModernizer() {
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
        script.dataset.loaderOrigin = 'forum-loader';
        script.dataset.injectedInto = 'body'; // Mark as injected into body
        // DON'T use defer - we want immediate execution
        
        const injected = injectScript(
            script,
            () => {
                clearTimeout(state.modernizerTimeoutId);
                state.modernizerLoaded = true;
                log('✅ Post Modernizer loaded successfully', 'info');
                
                // Verify modernizer initialized
                if (globalThis.postModernizer) {
                    log('Post Modernizer initialized successfully', 'info');
                } else {
                    log('Post Modernizer loaded but not initialized', 'warn');
                }
                
                // Check if both scripts initialized properly
                setTimeout(() => {
                    checkInitialization();
                }, CONFIG.startDelay);
            },
            (error) => {
                clearTimeout(state.modernizerTimeoutId);
                handleError('modernizer', error, CONFIG.modernizerScript);
            },
            'modernizer'
        );
        
        if (!injected) {
            handleError('modernizer', new Error('Failed to inject script'), CONFIG.modernizerScript);
        }
    }
    
    // Check if scripts initialized properly
    function checkInitialization() {
        log('Checking script initialization...', 'debug');
        
        const checks = {
            'Forum Observer': () => globalThis.forumObserver,
            'Post Modernizer': () => globalThis.postModernizer
        };
        
        let allInitialized = true;
        
        Object.entries(checks).forEach(([name, check]) => {
            const isInitialized = check();
            if (isInitialized) {
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
            
            // Try to auto-recover
            if (!globalThis.forumObserver && state.observerLoaded) {
                log('Attempting to manually initialize observer...', 'debug');
                setTimeout(() => {
                    if (!globalThis.forumObserver && typeof ForumCoreObserver !== 'undefined') {
                        try {
                            globalThis.forumObserver = ForumCoreObserver.create();
                            log('Manually initialized Forum Observer', 'info');
                            checkInitialization();
                        } catch (e) {
                            log(`Manual initialization failed: ${e.message}`, 'error');
                        }
                    }
                }, 1000);
            }
        }
    }
    
    // Dispatch custom event when loading is complete
    function dispatchLoadComplete() {
        const event = new CustomEvent('forumScriptsLoaded', {
            detail: {
                observer: globalThis.forumObserver,
                modernizer: globalThis.postModernizer,
                timestamp: Date.now(),
                scripts: state.scriptsInjected
            }
        });
        document.dispatchEvent(event);
        log('Dispatched forumScriptsLoaded event', 'debug');
    }
    
    // Start loading - BODY VERSION: Start immediately
    function startLoading() {
        if (state.loadStarted) {
            log('Loader already started', 'debug');
            return;
        }
        
        state.loadStarted = true;
        log('Starting forum scripts loading sequence from body...', 'info');
        
        // Check current DOM state
        log(`DOM state: body=${!!document.body}, head=${!!document.head}, readyState=${document.readyState}`, 'debug');
        
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            loadObserver();
        }, CONFIG.startDelay);
    }
    
    // Monitor DOM readiness
    function waitForDOM() {
        // Check if body exists
        if (document.body) {
            state.isBodyReady = true;
            log('Body exists, starting load immediately', 'debug');
            startLoading();
        } else {
            log('Body not found, waiting for DOM...', 'debug');
            
            // Use DOMContentLoaded as fallback
            document.addEventListener('DOMContentLoaded', () => {
                state.isBodyReady = !!document.body;
                log(`DOMContentLoaded fired, body exists: ${state.isBodyReady}`, 'debug');
                startLoading();
            }, { once: true });
            
            // Also try immediate check
            const immediateCheck = setInterval(() => {
                if (document.body) {
                    clearInterval(immediateCheck);
                    state.isBodyReady = true;
                    log('Body found via interval check', 'debug');
                    startLoading();
                }
            }, 100);
            
            // Cleanup after 5 seconds
            setTimeout(() => {
                clearInterval(immediateCheck);
                if (!state.loadStarted) {
                    log('DOM not ready after timeout, trying anyway...', 'warn');
                    startLoading();
                }
            }, 5000);
        }
    }
    
    // Initialize loader - BODY VERSION
    log('Forum Scripts Body Loader initializing...', 'info');
    log(`Loader location: ${document.currentScript?.parentNode?.tagName || 'unknown'}`, 'debug');
    
    // Check if we're really in a browser environment
    if (typeof document === 'undefined') {
        log('ERROR: Document not available - not in browser environment', 'error');
        return;
    }
    
    // Start loading process
    waitForDOM();
    
    // Expose loader for debugging
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
            state.scriptsInjected = [];
            
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
                    retries: state.observerRetries,
                    exists: typeof ForumCoreObserver !== 'undefined'
                },
                modernizer: {
                    loaded: state.modernizerLoaded,
                    initialized: !!globalThis.postModernizer,
                    retries: state.modernizerRetries
                },
                loadStarted: state.loadStarted,
                domReady: {
                    body: state.isBodyReady,
                    head: state.isHeadReady,
                    readyState: document.readyState
                },
                scripts: state.scriptsInjected,
                injectionTarget: getInjectionTarget()?.tagName || 'none'
            };
        },
        // Debug: Show all script tags
        debugScripts: () => {
            const scripts = document.querySelectorAll('script[src*="forum"], script[data-loader-origin]');
            return Array.from(scripts).map(s => ({
                src: s.src,
                parent: s.parentNode.tagName,
                async: s.async,
                defer: s.defer,
                dataset: s.dataset
            }));
        },
        // Force injection test
        testInjection: () => {
            const target = getInjectionTarget();
            const testScript = document.createElement('script');
            testScript.textContent = 'console.log("Test script injected into", document.currentScript.parentNode.tagName);';
            target.appendChild(testScript);
            return { target: target.tagName, success: testScript.parentNode === target };
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
    
    // Also expose a simple init check
    setTimeout(() => {
        if (!state.loadStarted) {
            log('Loader not started after timeout, forcing start...', 'warn');
            startLoading();
        }
    }, 1000);
    
})();
