// core/forum-enhancer.js
// Main orchestrator for Forum Modernizer Suite
// Coordinates all modules and initializes the enhancement system
(function() {
    'use strict';
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    const ENHANCER_CONFIG = {
        name: 'Forum Enhancer',
        version: '1.0.0',
        debug: false,
        autoInitialize: true,
        createWrapper: true,
        wrapperId: 'modern-forum-wrapper',
        hideOriginal: true,
        modules: {
            avatars: true,    // Avatar module - loads first
            posts: true,      // Posts module - depends on avatars
            navigation: false,
            sidebar: false,
            footer: false
        }
    };
    
    // ============================================================================
    // MODULE REGISTRY
    // ============================================================================
    const modules = [];
    const moduleStatus = new Map();
    
    function log(message, type) {
        if (!ENHANCER_CONFIG.debug && type !== 'error') return;
       
        const prefix = '[ForumEnhancer]';
        if (type === 'error') {
            console.error(prefix, message);
        } else if (type === 'warn') {
            console.warn(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }
    
    function registerModule(name, module, dependencies) {
        modules.push({
            name: name,
            module: module,
            dependencies: dependencies || [],
            initialized: false,
            enabled: ENHANCER_CONFIG.modules[name] !== false
        });
       
        if (ENHANCER_CONFIG.debug) {
            log('Registered module: ' + name);
        }
    }
    
    // ============================================================================
    // DEPENDENCY CHECKING
    // ============================================================================
    function checkDependencies(module) {
        if (!module.dependencies || module.dependencies.length === 0) {
            return true;
        }
       
        for (var i = 0; i < module.dependencies.length; i++) {
            var depName = module.dependencies[i];
            var dep = modules.find(function(m) { return m.name === depName; });
           
            if (!dep || !dep.initialized) {
                log('Module ' + module.name + ' waiting for dependency: ' + depName, 'warn');
                return false;
            }
        }
        return true;
    }
    
    function initializeModule(module) {
        if (module.initialized) return true;
        if (!module.enabled) {
            log('Module ' + module.name + ' is disabled, skipping', 'warn');
            return false;
        }
        if (!checkDependencies(module)) return false;
       
        try {
            if (module.module && typeof module.module.initialize === 'function') {
                module.module.initialize();
                module.initialized = true;
                moduleStatus.set(module.name, { status: 'initialized', timestamp: Date.now() });
                log('✓ Initialized: ' + module.name);
                return true;
            }
        } catch (error) {
            log('Failed to initialize ' + module.name + ': ' + error.message, 'error');
            moduleStatus.set(module.name, { status: 'failed', error: error.message });
        }
        return false;
    }
    
    function initializeAllModules() {
        log('Initializing all modules...');
       
        var maxAttempts = 10;
        var attempt = 0;
        var remainingModules = modules.filter(function(m) { return m.enabled && !m.initialized; });
       
        while (remainingModules.length > 0 && attempt < maxAttempts) {
            var initializedAny = false;
           
            for (var i = 0; i < modules.length; i++) {
                var module = modules[i];
                if (module.enabled && !module.initialized) {
                    if (initializeModule(module)) {
                        initializedAny = true;
                    }
                }
            }
           
            if (!initializedAny) break;
            remainingModules = modules.filter(function(m) { return m.enabled && !m.initialized; });
            attempt++;
        }
       
        var failedModules = modules.filter(function(m) { return m.enabled && !m.initialized; });
        if (failedModules.length > 0) {
            log('Warning: ' + failedModules.length + ' modules failed to initialize', 'warn');
        }
       
        return modules.filter(function(m) { return m.initialized; }).length;
    }
    
    // ============================================================================
    // DEPENDENCY CHECKING (Core)
    // ============================================================================
    function checkDependenciesAvailable() {
        var required = ['ForumDOMUtils', 'ForumEventBus'];
        var missing = [];
       
        for (var i = 0; i < required.length; i++) {
            if (typeof window[required[i]] === 'undefined') {
                missing.push(required[i]);
            }
        }
       
        if (missing.length > 0) {
            log('Missing required dependencies: ' + missing.join(', '), 'error');
            return false;
        }
       
        log('All core dependencies available');
        return true;
    }
    
    // ============================================================================
    // WAIT FOR DEPENDENCIES
    // ============================================================================
    function waitForDependencies() {
        return new Promise(function(resolve) {
            var depsReady = {
                ForumDOMUtils: false,
                ForumEventBus: false
            };
            
            function checkAllReady() {
                if (depsReady.ForumDOMUtils && depsReady.ForumEventBus) {
                    resolve();
                }
            }
            
            // Check if already loaded
            if (typeof ForumDOMUtils !== 'undefined') {
                depsReady.ForumDOMUtils = true;
            } else {
                window.addEventListener('dom-utils-ready', function() {
                    depsReady.ForumDOMUtils = true;
                    checkAllReady();
                });
            }
            
            if (typeof ForumEventBus !== 'undefined') {
                depsReady.ForumEventBus = true;
            } else {
                window.addEventListener('event-bus-ready', function() {
                    depsReady.ForumEventBus = true;
                    checkAllReady();
                });
            }
            
            checkAllReady();
            
            // Timeout after 5 seconds
            setTimeout(resolve, 5000);
        });
    }
    
    // ============================================================================
    // WAIT FOR DOM READY
    // ============================================================================
    function domReady() {
        return new Promise(function(resolve) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                resolve();
            }
        });
    }
    
    // ============================================================================
    // WAIT FOR FORUM OBSERVER
    // ============================================================================
    function waitForForumObserver() {
        return new Promise(function(resolve) {
            if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
                resolve(globalThis.forumObserver);
                return;
            }
           
            var attempts = 0;
            var maxAttempts = 50;
            var interval = setInterval(function() {
                attempts++;
                if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
                    clearInterval(interval);
                    resolve(globalThis.forumObserver);
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    log('ForumCoreObserver not detected after ' + maxAttempts + ' attempts', 'warn');
                    resolve(null);
                }
            }, 100);
        });
    }
    
    // ============================================================================
    // WRAPPER CREATION
    // ============================================================================
    function createModernWrapper() {
        var existingWrapper = document.getElementById(ENHANCER_CONFIG.wrapperId);
        if (existingWrapper) {
            return existingWrapper;
        }
       
        var wrapper = document.createElement('div');
        wrapper.id = ENHANCER_CONFIG.wrapperId;
        wrapper.className = 'modern-forum-wrapper';
       
        document.body.insertBefore(wrapper, document.body.firstChild);
       
        var postsContainer = document.createElement('div');
        postsContainer.id = 'modern-posts-container';
        postsContainer.className = 'modern-posts-container';
        wrapper.appendChild(postsContainer);
       
        log('Created modern wrapper: ' + ENHANCER_CONFIG.wrapperId);
        return wrapper;
    }
    
    function hideOriginalContent() {
        // Add CSS to hide original content
        var style = document.createElement('style');
        style.textContent = `
            /* Hide original forum content but keep it functional */
            .topic .List, .topic .mainbg, .post:not(.modernized) {
                display: none !important;
            }
            
            /* Modern wrapper styles */
            .modern-forum-wrapper {
                display: block;
                width: 100%;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }
            
            .modern-posts-container {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            
            /* Post card styles */
            .post-card {
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                overflow: hidden;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .post-card:hover {
                box-shadow: 0 4px 16px rgba(0,0,0,0.15);
            }
            
            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .post-card {
                    background: #1a1a1a;
                    color: #e0e0e0;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.classList.add('forum-modernized');
       
        var originalPostsContainer = document.querySelector('.topic .List, .topic .mainbg');
        if (originalPostsContainer) {
            window._originalPostsContainer = originalPostsContainer;
        }
       
        log('Original content hidden (CSS handles visibility)');
    }
    
    // ============================================================================
    // REGISTER MODULES
    // ============================================================================
    function registerAllModules() {
        // Register avatars module FIRST (highest priority)
        if (typeof ForumAvatars !== 'undefined') {
            registerModule('avatars', ForumAvatars, []);
            log('✓ Registered avatars module');
        } else {
            log('ForumAvatars not found, avatar enhancement disabled', 'warn');
            ENHANCER_CONFIG.modules.avatars = false;
        }
        
        // Register posts module with dependency on avatars
        if (typeof ForumPostsModule !== 'undefined') {
            var postsDeps = ENHANCER_CONFIG.modules.avatars !== false ? ['avatars'] : [];
            registerModule('posts', ForumPostsModule, postsDeps);
            log('✓ Registered posts module with dependencies: ' + postsDeps.join(', '));
        } else {
            log('ForumPostsModule not found, posts enhancement disabled', 'warn');
            ENHANCER_CONFIG.modules.posts = false;
        }
    }
    
    // ============================================================================
    // PUBLIC API
    // ============================================================================
    const ForumEnhancer = {
        version: ENHANCER_CONFIG.version,
        name: ENHANCER_CONFIG.name,
       
        registerModule: registerModule,
       
        enableModule: function(moduleName) {
            if (ENHANCER_CONFIG.modules.hasOwnProperty(moduleName)) {
                ENHANCER_CONFIG.modules[moduleName] = true;
                var module = modules.find(function(m) { return m.name === moduleName; });
                if (module) {
                    module.enabled = true;
                    initializeModule(module);
                }
                log('Enabled module: ' + moduleName);
            }
        },
       
        disableModule: function(moduleName) {
            if (ENHANCER_CONFIG.modules.hasOwnProperty(moduleName)) {
                ENHANCER_CONFIG.modules[moduleName] = false;
                var module = modules.find(function(m) { return m.name === moduleName; });
                if (module) {
                    module.enabled = false;
                }
                log('Disabled module: ' + moduleName);
            }
        },
       
        getModuleStatus: function() {
            var status = {};
            modules.forEach(function(m) {
                status[m.name] = {
                    enabled: m.enabled,
                    initialized: m.initialized,
                    dependencies: m.dependencies
                };
            });
            return status;
        },
       
        getStats: function() {
            var initialized = modules.filter(function(m) { return m.initialized; }).length;
            var enabled = modules.filter(function(m) { return m.enabled; }).length;
           
            return {
                version: ENHANCER_CONFIG.version,
                modules: {
                    total: modules.length,
                    enabled: enabled,
                    initialized: initialized,
                    failed: enabled - initialized
                },
                debug: ENHANCER_CONFIG.debug,
                timestamp: Date.now()
            };
        },
       
        enableDebug: function() {
            ENHANCER_CONFIG.debug = true;
            log('Debug mode enabled');
            if (typeof ForumEventBus !== 'undefined') {
                ForumEventBus.enableDebug();
            }
        },
       
        disableDebug: function() {
            ENHANCER_CONFIG.debug = false;
            if (typeof ForumEventBus !== 'undefined') {
                ForumEventBus.disableDebug();
            }
        },
       
        reinitialize: function() {
            log('Reinitializing all modules...');
            modules.forEach(function(m) {
                m.initialized = false;
            });
            initializeAllModules();
        },
       
        getObserver: function() {
            return globalThis.forumObserver || null;
        },
       
        getWrapper: function() {
            return document.getElementById(ENHANCER_CONFIG.wrapperId);
        },
       
        getPostsContainer: function() {
            return document.getElementById('modern-posts-container');
        }
    };
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    async function initialize() {
        log('========================================');
        log(ENHANCER_CONFIG.name + ' v' + ENHANCER_CONFIG.version);
        log('========================================');
       
        // Wait for core dependencies
        await waitForDependencies();
       
        if (!checkDependenciesAvailable()) {
            log('Cannot start - missing dependencies', 'error');
            return;
        }
       
        await domReady();
        log('DOM ready');
       
        if (ENHANCER_CONFIG.createWrapper) {
            createModernWrapper();
        }
       
        if (ENHANCER_CONFIG.hideOriginal) {
            hideOriginalContent();
        }
       
        var observer = await waitForForumObserver();
        if (observer) {
            log('ForumCoreObserver detected and ready');
        } else {
            log('Running without ForumCoreObserver (dynamic content may not auto-enhance)', 'warn');
        }
       
        registerAllModules();
       
        var initializedCount = initializeAllModules();
        log(initializedCount + ' of ' + modules.length + ' modules initialized');
       
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.trigger('forum:enhancer:ready', {
                version: ENHANCER_CONFIG.version,
                modules: initializedCount,
                observer: !!observer,
                wrapper: document.getElementById(ENHANCER_CONFIG.wrapperId)
            });
        }
       
        log('========================================');
        log(ENHANCER_CONFIG.name + ' is ready!');
        log('========================================');
    }
    
    // ============================================================================
    // EXPOSE GLOBALLY
    // ============================================================================
    window.ForumEnhancer = ForumEnhancer;
   
    if (ENHANCER_CONFIG.autoInitialize) {
        initialize();
    }
   
})();
