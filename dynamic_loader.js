// Forum Scripts Dynamic Loader
// Loads observer and modernizer scripts with proper dependency handling
(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        observerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@0e0384d/forum_core_observer.js',
        modernizerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@88d60a8/forum_enhacer.js',
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 10000, // 10 seconds timeout
        debug: true
    };
    
    // State tracking
    const state = {
        observerLoaded: false,
        modernizerLoaded: false,
        observerRetries: 0,
        modernizerRetries: 0,
        observerTimeoutId: null,
        modernizerTimeoutId: null,
        loadStarted: false
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
    
    // Load observer script
    function loadObserver() {
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
        
        script.onload = () => {
            clearTimeout(state.observerTimeoutId);
            state.observerLoaded = true;
            log('✅ Forum Core Observer loaded successfully', 'info');
            
            // Wait a bit for observer initialization, then load modernizer
            setTimeout(loadModernizer, 50);
        };
        
        script.onerror = (error) => {
            clearTimeout(state.observerTimeoutId);
            handleError('observer', error, CONFIG.observerScript);
        };
        
        document.head.appendChild(script);
    }
    
    // Load modernizer script
    function loadModernizer() {
        // Only load if observer is loaded
        if (!state.observerLoaded) {
            log('Waiting for observer before loading modernizer...', 'debug');
            
            // Check if observer becomes available
            const checkInterval = setInterval(() => {
                if (globalThis.forumObserver || state.observerLoaded) {
                    clearInterval(checkInterval);
                    log('Observer now available, loading modernizer...', 'debug');
                    loadModernizer();
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
        
        script.onload = () => {
            clearTimeout(state.modernizerTimeoutId);
            state.modernizerLoaded = true;
            log('✅ Post Modernizer loaded successfully', 'info');
            
            // Check if both scripts initialized properly
            setTimeout(() => {
                checkInitialization();
            }, 100);
        };
        
        script.onerror = (error) => {
            clearTimeout(state.modernizerTimeoutId);
            handleError('modernizer', error, CONFIG.modernizerScript);
        };
        
        document.head.appendChild(script);
    }
    
    // Check if scripts initialized properly
    function checkInitialization() {
        const checks = {
            'Forum Observer': () => globalThis.forumObserver,
            'Post Modernizer': () => globalThis.postModernizer
        };
        
        Object.entries(checks).forEach(([name, check]) => {
            if (check()) {
                log(`✅ ${name} initialized successfully`, 'info');
            } else {
                log(`⚠️ ${name} script loaded but not initialized`, 'warn');
            }
        });
        
        // Report final status
        if (globalThis.forumObserver && globalThis.postModernizer) {
            log('🎉 All forum scripts loaded and initialized successfully!', 'info');
        } else {
            log('Some forum features may not be fully available', 'warn');
        }
    }
    
    // Start loading based on document ready state
    function startLoading() {
        if (state.loadStarted) return;
        state.loadStarted = true;
        
        log('Starting forum scripts loading sequence...', 'info');
        loadObserver();
    }
    
    // Initialize based on document state
    function init() {
        const readyState = document.readyState;
        
        if (readyState === 'loading') {
            // Document still loading, wait for DOMContentLoaded
            log('Document still loading, waiting for DOMContentLoaded...', 'debug');
            document.addEventListener('DOMContentLoaded', startLoading);
        } else {
            // Document already loading or loaded
            log(`Document readyState: ${readyState}, starting load immediately...`, 'debug');
            startLoading();
        }
        
        // Also listen for page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !state.loadStarted) {
                log('Page became visible, starting load...', 'debug');
                startLoading();
            }
        });
    }
    
    // Start initialization
    log('Forum Scripts Loader initializing...', 'info');
    
    // Small delay to ensure other head scripts have a chance to run
    setTimeout(init, 0);
    
    // Expose loader for debugging
    globalThis.__forumLoader = {
        config: CONFIG,
        state: state,
        reload: () => {
            log('Manual reload requested...', 'info');
            state.loadStarted = false;
            state.observerLoaded = false;
            state.modernizerLoaded = false;
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
                loadStarted: state.loadStarted
            };
        }
    };
    
})();
