// ============================================================================
// FORUM SCRIPTS BODY LOADER - SIMPLE & GUARANTEED
// Place this script RIGHT AFTER the opening <body> tag
// ============================================================================
(function() {
    'use strict';
    
    console.log('%c[Forum Loader] Starting from body...', 'color: #4CAF50; font-weight: bold;');
    
    // Verify we're in body
    const currentScript = document.currentScript;
    if (currentScript && currentScript.parentNode) {
        console.log(`%c[Forum Loader] Loader is in: ${currentScript.parentNode.tagName}`, 'color: #2196F3;');
    }
    
    // Configuration
    const CONFIG = {
        observerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@0e0384d/forum_core_observer.js',
        modernizerScript: 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@88d60a8/forum_enhacer.js',
        timeout: 10000
    };
    
    // Track loaded scripts
    const loadedScripts = new Set();
    let observerLoaded = false;
    let modernizerLoaded = false;
    
    // Create a unique ID for our script container
    const containerId = 'forum-scripts-container-' + Date.now();
    
    // METHOD 1: Direct script tags (most reliable)
    function loadWithDirectScriptTags() {
        console.log('%c[Forum Loader] Loading with direct script tags...', 'color: #4CAF50;');
        
        // Create a container div at the end of body
        const container = document.createElement('div');
        container.id = containerId;
        container.style.display = 'none';
        document.body.appendChild(container);
        
        // Create observer script
        const observerScript = document.createElement('script');
        observerScript.src = CONFIG.observerScript;
        observerScript.async = false; // Important: no async
        observerScript.defer = false; // Important: no defer
        observerScript.crossOrigin = 'anonymous';
        observerScript.dataset.loader = 'forum-loader';
        observerScript.dataset.position = 'body-end';
        
        observerScript.onload = function() {
            console.log('%c✅ Forum Observer loaded from body', 'color: #4CAF50;');
            observerLoaded = true;
            loadedScripts.add('observer');
            
            // Wait a moment, then load modernizer
            setTimeout(loadModernizerScript, 100);
        };
        
        observerScript.onerror = function() {
            console.error('%c❌ Failed to load Forum Observer', 'color: #F44336;');
            // Try fallback method
            setTimeout(loadWithXHR, 1000);
        };
        
        // Append to container (which is in body)
        container.appendChild(observerScript);
        
        console.log(`%c[Forum Loader] Observer script appended to: ${observerScript.parentNode.parentNode.tagName}`, 'color: #2196F3;');
    }
    
    function loadModernizerScript() {
        if (modernizerLoaded) return;
        
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const modernizerScript = document.createElement('script');
        modernizerScript.src = CONFIG.modernizerScript;
        modernizerScript.async = false;
        modernizerScript.defer = false;
        modernizerScript.crossOrigin = 'anonymous';
        modernizerScript.dataset.loader = 'forum-loader';
        modernizerScript.dataset.position = 'body-end';
        
        modernizerScript.onload = function() {
            console.log('%c✅ Forum Modernizer loaded from body', 'color: #4CAF50;');
            modernizerLoaded = true;
            loadedScripts.add('modernizer');
            checkInitialization();
        };
        
        modernizerScript.onerror = function() {
            console.error('%c❌ Failed to load Forum Modernizer', 'color: #F44336;');
        };
        
        container.appendChild(modernizerScript);
    }
    
    // METHOD 2: XHR as fallback
    function loadWithXHR() {
        console.log('%c[Forum Loader] Trying XHR fallback...', 'color: #FF9800;');
        
        // Load observer
        const xhr1 = new XMLHttpRequest();
        xhr1.open('GET', CONFIG.observerScript, true);
        xhr1.onload = function() {
            if (xhr1.status === 200) {
                const script = document.createElement('script');
                script.textContent = xhr1.responseText;
                script.dataset.loader = 'forum-loader-xhr';
                document.body.appendChild(script);
                observerLoaded = true;
                console.log('%c✅ Forum Observer loaded via XHR', 'color: #4CAF50;');
                loadModernizerXHR();
            }
        };
        xhr1.send();
    }
    
    function loadModernizerXHR() {
        const xhr2 = new XMLHttpRequest();
        xhr2.open('GET', CONFIG.modernizerScript, true);
        xhr2.onload = function() {
            if (xhr2.status === 200) {
                const script = document.createElement('script');
                script.textContent = xhr2.responseText;
                script.dataset.loader = 'forum-loader-xhr';
                document.body.appendChild(script);
                modernizerLoaded = true;
                console.log('%c✅ Forum Modernizer loaded via XHR', 'color: #4CAF50;');
                checkInitialization();
            }
        };
        xhr2.send();
    }
    
    // METHOD 3: Document.write (only as last resort)
    function loadWithDocumentWrite() {
        console.log('%c[Forum Loader] Using document.write as last resort...', 'color: #FF9800;');
        
        document.write(
            '<script src="' + CONFIG.observerScript + '" async="false" defer="false" crossorigin="anonymous" data-loader="forum-loader-docwrite"><\/script>' +
            '<script src="' + CONFIG.modernizerScript + '" async="false" defer="false" crossorigin="anonymous" data-loader="forum-loader-docwrite"><\/script>'
        );
    }
    
    // Check initialization
    function checkInitialization() {
        console.log('%c[Forum Loader] Checking initialization...', 'color: #2196F3;');
        
        setTimeout(() => {
            const checks = [
                { name: 'Forum Observer', check: () => window.forumObserver || globalThis.forumObserver },
                { name: 'Forum Modernizer', check: () => window.postModernizer || globalThis.postModernizer }
            ];
            
            checks.forEach(({ name, check }) => {
                if (check()) {
                    console.log(`%c✅ ${name} initialized`, 'color: #4CAF50;');
                } else {
                    console.warn(`%c⚠️ ${name} not initialized`, 'color: #FF9800;');
                }
            });
            
            // Report final status
            if (checks.every(c => c.check())) {
                console.log('%c🎉 All forum scripts loaded and initialized!', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
                dispatchLoadComplete();
            }
        }, 500);
    }
    
    function dispatchLoadComplete() {
        const event = new CustomEvent('forumScriptsLoaded', {
            detail: {
                observer: window.forumObserver || globalThis.forumObserver,
                modernizer: window.postModernizer || globalThis.postModernizer,
                timestamp: Date.now()
            }
        });
        document.dispatchEvent(event);
    }
    
    // Start loading
    function startLoading() {
        console.log('%c[Forum Loader] Body exists, starting load...', 'color: #4CAF50;');
        
        // Method 1: Try direct script tags first
        loadWithDirectScriptTags();
        
        // Fallback timer
        setTimeout(() => {
            if (!observerLoaded || !modernizerLoaded) {
                console.warn('%c[Forum Loader] Primary method taking too long, trying fallback...', 'color: #FF9800;');
                if (!observerLoaded) {
                    loadWithXHR();
                }
            }
        }, CONFIG.timeout);
    }
    
    // Check if body exists and start
    function init() {
        if (document.body) {
            startLoading();
        } else {
            console.log('%c[Forum Loader] Waiting for body...', 'color: #2196F3;');
            
            // Wait for body
            const checkBody = setInterval(() => {
                if (document.body) {
                    clearInterval(checkBody);
                    startLoading();
                }
            }, 100);
            
            // Fallback
            setTimeout(() => {
                clearInterval(checkBody);
                if (document.body) {
                    startLoading();
                } else {
                    console.error('%c[Forum Loader] Body never appeared!', 'color: #F44336;');
                    // Try document.write as last resort
                    loadWithDocumentWrite();
                }
            }, 5000);
        }
    }
    
    // Debug: Show all script tags
    function debugScripts() {
        console.log('%c[Forum Loader] All scripts on page:', 'color: #9C27B0; font-weight: bold;');
        document.querySelectorAll('script').forEach((script, i) => {
            console.log(`${i}. ${script.src || 'inline'} → parent: ${script.parentNode.tagName}`);
        });
    }
    
    // Initialize
    setTimeout(init, 0);
    
    // Expose debug tools
    window.__forumDebug = {
        checkStatus: () => ({
            observer: { loaded: observerLoaded, initialized: !!(window.forumObserver || globalThis.forumObserver) },
            modernizer: { loaded: modernizerLoaded, initialized: !!(window.postModernizer || globalThis.postModernizer) },
            bodyExists: !!document.body,
            scripts: Array.from(loadedScripts)
        }),
        debugScripts: debugScripts,
        reload: () => {
            console.log('%c[Forum Loader] Manual reload...', 'color: #2196F3;');
            observerLoaded = false;
            modernizerLoaded = false;
            loadedScripts.clear();
            startLoading();
        }
    };
    
})();
