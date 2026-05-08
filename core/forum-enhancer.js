// core/forum-enhancer.js
// Main orchestrator for Forum Modernizer Suite
// Coordinates all modules and initializes the enhancement system
(function() {
    'use strict';

    // ===== USER TIMING: mark start =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('enhancer-start');
    }
    // ====================================

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
        hideOriginal: false,
        modules: {
            'media-dimensions': true,
            twemoji: true,
            posts: true,
            modals: true,
            'slick-carousel': true,       // NEW – hero carousel module
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
            // Handle special dependencies that are not modules but global objects/events
            if (depName === 'forumObserver') {
                if (!globalThis.forumObserver) return false;
                continue;
            }
            if (depName === 'twemojiLib') {
                if (typeof twemoji === 'undefined') return false;
                continue;
            }
            if (depName === 'domUtils') {
                if (typeof ForumDOMUtils === 'undefined') return false;
                continue;
            }
            if (depName === 'eventBus') {
                if (typeof ForumEventBus === 'undefined') return false;
                continue;
            }
            var dep = modules.find(function(m) { return m.name === depName; });
            if (!dep || !dep.initialized) {
                return false;
            }
        }
        return true;
    }
    
    async function initializeModule(module) {
        if (module.initialized) return true;
        if (!module.enabled) {
            log('Module ' + module.name + ' is disabled, skipping', 'warn');
            return false;
        }
        if (!checkDependencies(module)) return false;
       
        try {
            if (module.module && typeof module.module.initialize === 'function') {
                await module.module.initialize();   // async init
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
    
    async function initializeAllModules() {
        log('Initializing all modules...');
       
        var maxAttempts = 10;
        var attempt = 0;
        var remainingModules = modules.filter(function(m) { return m.enabled && !m.initialized; });
       
        while (remainingModules.length > 0 && attempt < maxAttempts) {
            var initializedAny = false;
           
            for (var i = 0; i < modules.length; i++) {
                var module = modules[i];
                if (module.enabled && !module.initialized) {
                    if (await initializeModule(module)) {
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
    
    // ============================================================================
    // REGISTER MODULES (all modules now exposed globally)
    // ============================================================================
    function registerAllModules() {
        if (typeof MediaDimensionsModule !== 'undefined') {
            registerModule('media-dimensions', MediaDimensionsModule, ['forumObserver']);
        } else {
            log('MediaDimensionsModule not found, media dimensions disabled', 'warn');
            if (ENHANCER_CONFIG && ENHANCER_CONFIG.modules) {
                ENHANCER_CONFIG.modules['media-dimensions'] = false;
            }
        }

        if (typeof TwemojiModule !== 'undefined') {
            registerModule('twemoji', TwemojiModule, ['twemojiLib', 'forumObserver']);
        } else {
            log('TwemojiModule not found, emoji replacement disabled', 'warn');
            ENHANCER_CONFIG.modules.twemoji = false;
        }

        if (typeof ForumPostsModule !== 'undefined') {
            registerModule('posts', ForumPostsModule, ['domUtils', 'eventBus']);
        } else {
            log('ForumPostsModule not found, posts enhancement disabled', 'warn');
            ENHANCER_CONFIG.modules.posts = false;
        }

        if (typeof ModalsModule !== 'undefined') {
            registerModule('modals', ModalsModule, ['forumObserver']);
        } else {
            log('ModalsModule not found, modern modals disabled', 'warn');
            if (ENHANCER_CONFIG && ENHANCER_CONFIG.modules) {
                ENHANCER_CONFIG.modules.modals = false;
            }
        }

        // NEW: Slick Carousel module registration
        if (typeof SlickCarouselModule !== 'undefined') {
            registerModule('slick-carousel', SlickCarouselModule, ['forumObserver']);
        } else {
            log('SlickCarouselModule not found, carousels will not be active', 'warn');
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
       
        registerAllModules();
        var initializedCount = await initializeAllModules();
        log(initializedCount + ' of ' + modules.length + ' modules initialized');
       
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.trigger('forum:enhancer:ready', {
                version: ENHANCER_CONFIG.version,
                modules: initializedCount,
                wrapper: document.getElementById(ENHANCER_CONFIG.wrapperId)
            });
        }
       
        log('========================================');
        log(ENHANCER_CONFIG.name + ' is ready!');
        log('========================================');

        // ===== USER TIMING: enhancer fully initialized =====
        if (typeof performance !== 'undefined' && performance.mark) {
            performance.mark('enhancer-ready');
            try {
                performance.measure('enhancer-init-time', 'enhancer-start', 'enhancer-ready');
            } catch (e) {
                // Ignore if marks are missing
            }
        }
        // ===================================================
    }
    
    // ============================================================================
    // EXPOSE GLOBALLY
    // ============================================================================
    window.ForumEnhancer = ForumEnhancer;
   
    if (ENHANCER_CONFIG.autoInitialize) {
        initialize();
    }
   
})();
