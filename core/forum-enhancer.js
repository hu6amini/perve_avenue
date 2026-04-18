// forum-enhancer.js - Modified to create wrapper
(function() {
    'use strict';

    const ENHANCER_CONFIG = {
        name: 'Forum Enhancer',
        version: '1.0.0',
        debug: false,
        autoInitialize: true,
        createWrapper: true,  // NEW: Auto-create wrapper
        wrapperId: 'modern-forum-wrapper',
        hideOriginal: true,    // NEW: Hide original content
        modules: {
            posts: true,
            navigation: false,
            sidebar: false,
            footer: false
        }
    };

    // NEW: Create wrapper function
    function createModernWrapper() {
        // Check if wrapper already exists
        var existingWrapper = document.getElementById(ENHANCER_CONFIG.wrapperId);
        if (existingWrapper) {
            return existingWrapper;
        }

        // Create wrapper
        var wrapper = document.createElement('div');
        wrapper.id = ENHANCER_CONFIG.wrapperId;
        wrapper.className = 'modern-forum-wrapper';
        
        // Insert as first child of body
        document.body.insertBefore(wrapper, document.body.firstChild);
        
        // Add containers for different sections
        var postsContainer = document.createElement('div');
        postsContainer.id = 'modern-posts-container';
        postsContainer.className = 'modern-posts-container';
        wrapper.appendChild(postsContainer);
        
        // Future containers (commented out for now)
        // var headerContainer = document.createElement('div');
        // headerContainer.id = 'modern-header-container';
        // wrapper.appendChild(headerContainer);
        
        // var sidebarContainer = document.createElement('div');
        // sidebarContainer.id = 'modern-sidebar-container';
        // wrapper.appendChild(sidebarContainer);
        
        log('Created modern wrapper: ' + ENHANCER_CONFIG.wrapperId);
        return wrapper;
    }

    // NEW: Hide original content (keeps DOM intact for JS functions)
    function hideOriginalContent() {
        // Hide the main content areas - these are already hidden by CSS
        // But we also add a class to body for CSS targeting
        document.body.classList.add('forum-modernized');
        
        // Store original container reference for data extraction
        var originalPostsContainer = document.querySelector('.topic .List, .topic .mainbg');
        if (originalPostsContainer) {
            window._originalPostsContainer = originalPostsContainer;
        }
        
        log('Original content hidden (CSS handles visibility)');
    }

    // Modified initialize function
    async function initialize() {
        log('========================================');
        log(ENHANCER_CONFIG.name + ' v' + ENHANCER_CONFIG.version);
        log('========================================');

        // Check core dependencies
        if (!checkDependenciesAvailable()) {
            log('Cannot start - missing dependencies', 'error');
            return;
        }

        // Wait for DOM ready
        await domReady();
        log('DOM ready');

        // Create wrapper FIRST (before any content loads)
        if (ENHANCER_CONFIG.createWrapper) {
            createModernWrapper();
        }

        // Hide original content (CSS already hides, but this adds class)
        if (ENHANCER_CONFIG.hideOriginal) {
            hideOriginalContent();
        }

        // Wait for ForumCoreObserver
        var observer = await waitForForumObserver();
        if (observer) {
            log('ForumCoreObserver detected and ready');
        } else {
            log('Running without ForumCoreObserver', 'warn');
        }

        // Register all modules
        registerAllModules();

        // Initialize all modules
        var initializedCount = initializeAllModules();
        log(initializedCount + ' of ' + modules.length + ' modules initialized');

        // Dispatch ready event
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

    // Rest of the code remains the same...
    // (keep all existing functions: registerModule, checkDependencies, etc.)

    // Expose wrapper utilities
    window.ForumEnhancer = ForumEnhancer;
    window.ForumEnhancer.getWrapper = function() {
        return document.getElementById(ENHANCER_CONFIG.wrapperId);
    };
    window.ForumEnhancer.getPostsContainer = function() {
        return document.getElementById('modern-posts-container');
    };

    if (ENHANCER_CONFIG.autoInitialize) {
        initialize();
    }
})();
