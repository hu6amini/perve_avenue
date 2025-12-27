'use strict';

class ForumCoreObserver {
    #observer = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    
    #callbacks = new Map();
    #debouncedCallbacks = new Map();
    #pageState = this.#detectPageState(); // Keep for stats, but don't filter by it
    
    // Performance optimized configuration
    static #CONFIG = {
        observer: {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'data-*']
        },
        performance: {
            maxProcessingTime: 16,
            mutationBatchSize: 50,
            debounceThreshold: 100,
            idleCallbackTimeout: 2000,
            searchPageBatchSize: 10
        },
        memory: {
            maxProcessedNodes: 10000,
            cleanupInterval: 30000,
            nodeTTL: 300000
        }
    };
    
    #mutationMetrics = {
        totalMutations: 0,
        processedMutations: 0,
        averageProcessingTime: 0,
        lastMutationTime: 0
    };
    
    constructor() {
        this.#init();
        this.#setupThemeListener(); // ADDED: Theme change integration
    }
    
    #init() {
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        this.#scanExistingContent();
        this.#setupCleanup();
        
        // Use passive event listener for better performance
        document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { 
            passive: true, 
            capture: true 
        });
        
        console.log('🔍 ForumCoreObserver initialized (GLOBAL - no page restrictions)');
    }
    
    #detectPageState() {
        var pathname = window.location.pathname;
        var className = document.body.className;
        var theme = document.documentElement.dataset?.theme;
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        // Use direct DOM queries for maximum speed
        var selectors = {
            forum: '.board, .big_list',
            topic: '.modern-topic-title, .post',
            blog: '#blog, .article',
            profile: '.modern-profile, .profile',
            search: '#search.posts, body#search',
            modernized: '.post-modernized'
        };
        
        var pageChecks = {};
        for (var key in selectors) {
            if (selectors.hasOwnProperty(key)) {
                pageChecks[key] = document.querySelector(selectors[key]) || null;
            }
        }
        
        return {
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            hasModernizedPosts: !!pageChecks.modernized,
            hasModernizedQuotes: !!document.querySelector('.modern-quote'),
            hasModernizedProfile: !!document.querySelector('.modern-profile'),
            hasModernizedNavigation: !!document.querySelector('.modern-nav'),
            // ADDED: Theme detection
            currentTheme: theme || (prefersDark ? 'dark' : 'light'),
            themeMode: theme ? 'manual' : 'auto',
            isDarkMode: theme === 'dark' || (!theme && prefersDark),
            isLightMode: theme === 'light' || (!theme && !prefersDark),
            isLoggedIn: !!document.querySelector('.menuwrap .avatar'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            // Add detection for send/preview pages
            isSendPage: document.body.id === 'send' || className.includes('send'),
            hasPreview: !!document.querySelector('#preview, #ajaxObject, .preview, .Item.preview')
        };
    }
    
    #setupThemeListener() {
        // Listen for theme change events from menu modernizer
        window.addEventListener('themechange', (e) => {
            const { theme } = e.detail;
            
            console.log(`🎨 Theme change detected: ${theme}`);
            
            // Update page state with new theme
            this.#pageState = this.#detectPageState();
            
            // Trigger callbacks that depend on theme
            this.#notifyThemeDependentCallbacks(theme);
            
            // Force re-scan of theme-dependent elements
            this.#rescanThemeSensitiveElements(theme);
            
            // Update theme attribute for all relevant elements
            this.#updateThemeAttributes(theme);
        }, { passive: true });
        
        // Also listen for system theme changes (for auto mode)
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            // Only respond if we're in auto mode
            if (!localStorage.getItem('forum-theme')) {
                const newTheme = e.matches ? 'dark' : 'light';
                console.log(`🌗 System theme changed to ${newTheme} (auto mode)`);
                
                queueMicrotask(() => {
                    this.#pageState = this.#detectPageState();
                    this.#rescanThemeSensitiveElements('auto');
                });
            }
        });
    }
    
    #notifyThemeDependentCallbacks(newTheme) {
        // Find callbacks that have theme dependencies
        const themeDependentCallbacks = Array.from(this.#callbacks.values()).filter(callback => {
            return callback.dependencies && (
                callback.dependencies.includes('theme') ||
                callback.dependencies.includes('theme-change') ||
                callback.dependencies.includes('data-theme')
            );
        });
        
        if (themeDependentCallbacks.length) {
            console.log(`🎨 Notifying ${themeDependentCallbacks.length} theme-dependent callbacks`);
            
            // Execute theme-dependent callbacks with theme info
            themeDependentCallbacks.forEach(callback => {
                try {
                    // Pass theme info to callback
                    callback.fn(document.documentElement, newTheme);
                } catch (error) {
                    console.error(`Theme callback ${callback.id} failed:`, error);
                }
            });
        }
    }
    
    #rescanThemeSensitiveElements(theme) {
        // Elements that need re-processing on theme change
        const themeSensitiveSelectors = [
            '.modern-quote',
            '.modern-spoiler',
            '.modern-code',
            '.post',
            '.post-modernized',
            '.st-emoji-container',
            '.points_up, .points_down',
            '.btn',
            '.menu-dropdown',
            '.cs-fui.st-emoji-pop',
            '.modern-menu-wrap',
            '.search-post',
            '.post-header',
            '.post-content',
            '.post-footer',
            '.modern-topic-title',
            '.modern-nav',
            '.modern-breadcrumb'
        ];
        
        // Force rescan of theme-sensitive elements
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                themeSensitiveSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            // Clear from processed nodes to force re-processing
                            this.#processedNodes.delete(element);
                            this.#processNode(element);
                        });
                    } catch (e) {
                        // Skip invalid selectors
                    }
                });
            }, { timeout: 500 });
        } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(() => {
                themeSensitiveSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            this.#processedNodes.delete(element);
                            this.#processNode(element);
                        });
                    } catch (e) {
                        // Skip invalid selectors
                    }
                });
            }, 100);
        }
    }
    
    #updateThemeAttributes(theme) {
        // Update theme attributes on components that need it
        const elementsToUpdate = [
            '.cs-fui.st-emoji-pop',
            '.st-emoji-container',
            '.post-modernized',
            '.post.preview'
        ];
        
        elementsToUpdate.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                el.setAttribute('data-theme', theme);
            });
        });
    }
    
    #handleMutations(mutations) {
        this.#mutationMetrics.totalMutations += mutations.length;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        // Fast filter: only process mutations that are actually visible and not filtered
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (this.#shouldProcessMutation(mutation)) {
                this.#mutationQueue.push(mutation);
            }
        }
        
        if (this.#mutationQueue.length && !this.#isProcessing) {
            this.#processMutationQueue();
        }
    }
    
    #shouldProcessMutation(mutation) {
        var target = mutation.target;
        
        // Skip mutations with data-observer-origin flag
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip hidden elements
        if (target.nodeType === Node.ELEMENT_NODE) {
            var style = window.getComputedStyle(target);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        
        // Special handling for theme attribute changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            // Always process theme attribute changes
            return true;
        }
        
        // Special handling for character data
        if (mutation.type === 'characterData') {
            var parent = target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        // Special handling for style changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            var oldValue = mutation.oldValue || '';
            var newValue = target.getAttribute('style') || '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        // Process ALL other mutations (bulletproof approach)
        return true;
    }
    
    #shouldObserveTextChanges(element) {
        var tagName = element.tagName.toLowerCase();
        
        // Always observe interactive elements
        if (tagName === 'a' || tagName === 'button' || tagName === 'input' || 
            tagName === 'textarea' || tagName === 'select') {
            return true;
        }
        
        // Observe forum content
        var classList = element.classList;
        if (classList) {
            if (classList.contains('post') || 
                classList.contains('article') || 
                classList.contains('comment') || 
                classList.contains('quote') || 
                classList.contains('signature') || 
                classList.contains('post-text')) {
                return true;
            }
        }
        
        return false;
    }
    
    #styleChangeAffectsDOM(oldStyle, newStyle) {
        var visibilityProps = ['display', 'visibility', 'opacity', 'position', 'width', 'height'];
        var oldProps = this.#parseStyleString(oldStyle);
        var newProps = this.#parseStyleString(newStyle);
        
        for (var i = 0; i < visibilityProps.length; i++) {
            var prop = visibilityProps[i];
            if (oldProps.get(prop) !== newProps.get(prop)) {
                return true;
            }
        }
        
        return false;
    }
    
    #parseStyleString(styleString) {
        if (!styleString) return new Map();
        
        var result = new Map();
        var pairs = styleString.split(';');
        
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i];
            var colonIndex = pair.indexOf(':');
            if (colonIndex > -1) {
                var key = pair.substring(0, colonIndex).trim();
                var value = pair.substring(colonIndex + 1).trim();
                if (key && value) {
                    result.set(key, value);
                }
            }
        }
        
        return result;
    }
    
    async #processMutationQueue() {
        this.#isProcessing = true;
        var startTime = performance.now();
        
        try {
            while (this.#mutationQueue.length) {
                var batchSize = Math.min(
                    ForumCoreObserver.#CONFIG.performance.mutationBatchSize,
                    this.#mutationQueue.length
                );
                
                var batch = this.#mutationQueue.splice(0, batchSize);
                await this.#processMutationBatch(batch);
                
                // Yield to prevent blocking
                if (performance.now() - startTime > ForumCoreObserver.#CONFIG.performance.maxProcessingTime) {
                    await new Promise(function(resolve) {
                        queueMicrotask(resolve);
                    });
                    startTime = performance.now();
                }
            }
        } catch (error) {
            console.error('Mutation processing error:', error);
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
            var processingTime = performance.now() - startTime;
            this.#mutationMetrics.averageProcessingTime = 
                this.#mutationMetrics.averageProcessingTime * 0.9 + processingTime * 0.1;
        }
    }
    
    async #processMutationBatch(mutations) {
        var affectedNodes = new Set();
        
        // Collect all affected nodes
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            
            switch (mutation.type) {
                case 'childList':
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, affectedNodes);
                        }
                    }
                    break;
                    
                case 'attributes':
                    affectedNodes.add(mutation.target);
                    
                    // If theme changed, update page state
                    if (mutation.attributeName === 'data-theme') {
                        this.#pageState = this.#detectPageState();
                        const theme = mutation.target.getAttribute('data-theme');
                        this.#notifyThemeDependentCallbacks(theme);
                    }
                    break;
                    
                case 'characterData':
                    var parent = mutation.target.parentElement;
                    if (parent) {
                        affectedNodes.add(parent);
                    }
                    break;
            }
        }
        
        // Process nodes
        var nodeArray = Array.from(affectedNodes);
        var nodesToProcess = [];
        
        // Filter out already processed nodes
        for (var k = 0; k < nodeArray.length; k++) {
            var node = nodeArray[k];
            if (node && !this.#processedNodes.has(node)) {
                nodesToProcess.push(node);
            }
        }
        
        if (!nodesToProcess.length) return;
        
        // Process in parallel chunks
        var CONCURRENCY_LIMIT = 4;
        var chunks = [];
        
        for (var l = 0; l < nodesToProcess.length; l += CONCURRENCY_LIMIT) {
            chunks.push(nodesToProcess.slice(l, l + CONCURRENCY_LIMIT));
        }
        
        for (var m = 0; m < chunks.length; m++) {
            var chunk = chunks[m];
            var promises = [];
            
            for (var n = 0; n < chunk.length; n++) {
                promises.push(this.#processNode(chunk[n]));
            }
            
            await Promise.allSettled(promises);
        }
    }
    
    #collectAllElements(root, collection) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        
        collection.add(root);
        
        // Use for loop instead of for...of for better performance
        var children = root.children;
        for (var i = 0; i < children.length; i++) {
            this.#collectAllElements(children[i], collection);
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        var matchingCallbacks = this.#getMatchingCallbacks(node);
        if (!matchingCallbacks.length) return;
        
        // Group by priority
        var priorityGroups = {
            critical: [],
            high: [],
            normal: [],
            low: []
        };
        
        for (var i = 0; i < matchingCallbacks.length; i++) {
            var callback = matchingCallbacks[i];
            var priority = callback.priority || 'normal';
            priorityGroups[priority].push(callback);
        }
        
        // Execute callbacks by priority
        var priorities = ['critical', 'high', 'normal', 'low'];
        for (var j = 0; j < priorities.length; j++) {
            var priority = priorities[j];
            var callbacks = priorityGroups[priority];
            
            if (!callbacks.length) continue;
            
            if (priority === 'critical') {
                await this.#executeCallbacks(callbacks, node);
            } else {
                this.#deferCallbacks(callbacks, node, priority);
            }
        }
        
        this.#processedNodes.add(node);
    }
    
    #getMatchingCallbacks(node) {
        var matching = [];
        var callbackValues = Array.from(this.#callbacks.values());
        
        for (var i = 0; i < callbackValues.length; i++) {
            var callback = callbackValues[i];
            
            // REMOVED: Page type filtering - runs globally on ALL pages
            // if (callback.pageTypes && callback.pageTypes.length) {
            //     var hasMatchingPageType = false;
            //     for (var j = 0; j < callback.pageTypes.length; j++) {
            //         var type = callback.pageTypes[j];
            //         var stateKey = 'is' + type.charAt(0).toUpperCase() + type.slice(1);
            //         if (this.#pageState[stateKey]) {
            //             hasMatchingPageType = true;
            //             break;
            //         }
            //     }
            //     if (!hasMatchingPageType) continue;
            // }
            
            // Check selector
            if (callback.selector) {
                if (!node.matches(callback.selector) && !node.querySelector(callback.selector)) {
                    continue;
                }
            }
            
            matching.push(callback);
        }
        
        return matching;
    }
    
    async #executeCallbacks(callbacks, node) {
        var promises = [];
        
        for (var i = 0; i < callbacks.length; i++) {
            var callback = callbacks[i];
            promises.push((async function() {
                try {
                    // Pass theme info to callbacks that need it
                    if (callback.dependencies && callback.dependencies.includes('theme')) {
                        await callback.fn(node, this.#pageState.currentTheme);
                    } else {
                        await callback.fn(node);
                    }
                } catch (error) {
                    console.error('Callback ' + callback.id + ' failed:', error);
                }
            }).call(this));
        }
        
        await Promise.allSettled(promises);
    }
    
    #deferCallbacks(callbacks, node, priority) {
        var delays = {
            high: 50,
            normal: 100,
            low: 500
        };
        
        var delay = delays[priority] || 100;
        
        // Use the best available scheduling API
        if (typeof scheduler !== 'undefined' && scheduler.postTask) {
            scheduler.postTask(function() {
                this.#executeCallbacks(callbacks, node);
            }.bind(this), { 
                priority: 'user-visible', 
                delay: delay 
            });
        } else if (window.requestIdleCallback) {
            requestIdleCallback(function() {
                this.#executeCallbacks(callbacks, node);
            }.bind(this), { 
                timeout: delay 
            });
        } else {
            setTimeout(function() {
                this.#executeCallbacks(callbacks, node);
            }.bind(this), delay);
        }
    }
    
    #scanExistingContent() {
        var forumSelectors = [
            '.post', '.article', '.btn', '.forminput', '.points_up', '.points_down',
            '.st-emoji-container', '.modern-quote', '.modern-profile', '.modern-topic-title',
            '.menu', '.tabs', '.code', '.spoiler', '.poll', '.tag li', '.online .thumbs a',
            '.profile-avatar', '.breadcrumb-item', '.page-number',
            '.post-modernized', '.modern-quote', '.modern-profile', '.modern-topic-title',
            '.modern-breadcrumb', '.modern-nav', '.post-new-badge', '.quote-jump-btn',
            '.anchor-container', '.modern-bottom-actions', '.multiquote-control',
            '.moderator-controls', '.ip-address-control', '.search-post',
            '.post-actions', '.user-info', '.post-content', '.post-footer'
        ];
        
        // Add preview-related selectors
        var previewSelectors = [
            '#preview', '#ajaxObject', '.preview', '.Item.preview', 
            '[id*="preview"]', '.preview-content', '.post-preview'
        ];
        
        // Combine all selectors
        var allSelectors = forumSelectors.concat(previewSelectors);
        
        // Scan all selectors
        for (var i = 0; i < allSelectors.length; i++) {
            var selector = allSelectors[i];
            try {
                var nodes = document.querySelectorAll(selector);
                for (var j = 0; j < nodes.length; j++) {
                    var node = nodes[j];
                    if (!this.#processedNodes.has(node)) {
                        this.#processNode(node);
                    }
                }
            } catch (e) {
                // Skip invalid selectors
            }
        }
        
        this.#initialScanComplete = true;
        console.log('✅ Initial content scan complete (GLOBAL mode)');
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(function() {
            // Monitor memory usage
            if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
                console.warn('Processed nodes approaching limit: ' + this.#processedNodes.size);
                
                if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes * 1.5) {
                    console.warn('Clearing processed nodes cache');
                    this.#processedNodes = new WeakSet();
                }
            }
            
            // Suggest garbage collection if available
            if (typeof globalThis.gc === 'function') {
                globalThis.gc();
            }
        }.bind(this), ForumCoreObserver.#CONFIG.memory.cleanupInterval);
    }
    
    #handleVisibilityChange() {
        if (document.hidden) {
            this.#pause();
        } else {
            this.#resume();
            // Rescan content when page becomes visible
            queueMicrotask(function() {
                this.#scanExistingContent();
            }.bind(this));
        }
    }
    
    #pause() {
        if (this.#observer) {
            this.#observer.disconnect();
        }
        
        // Clear all timeouts
        var timeoutIds = Array.from(this.#debounceTimeouts.values());
        for (var i = 0; i < timeoutIds.length; i++) {
            clearTimeout(timeoutIds[i]);
        }
        this.#debounceTimeouts.clear();
    }
    
    #resume() {
        if (!this.#observer) {
            this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        }
        
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
    }
    
    // ============================================
    // PUBLIC API WITH THEME INTEGRATION
    // ============================================
    
    register(settings) {
        var id = settings.id || 'callback_' + Date.now() + '_' + 
            (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2));
        
        var callback = {
            id: id,
            fn: settings.callback,
            priority: settings.priority || 'normal',
            selector: settings.selector,
            pageTypes: settings.pageTypes, // Still accept for compatibility, but won't be used
            dependencies: settings.dependencies,
            retryCount: 0,
            maxRetries: settings.maxRetries || 0,
            createdAt: performance.now()
        };
        
        this.#callbacks.set(id, callback);
        console.log('📝 Registered GLOBAL callback: ' + id + ' (priority: ' + callback.priority + ')');
        
        // If selector is provided, scan for existing matching nodes
        if (this.#initialScanComplete && callback.selector) {
            var nodes = document.querySelectorAll(callback.selector);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            }
        }
        
        return id;
    }
    
    registerDebounced(settings) {
        var id = this.register(settings);
        
        this.#debouncedCallbacks.set(id, {
            callback: settings.callback,
            delay: settings.delay || ForumCoreObserver.#CONFIG.performance.debounceThreshold,
            lastRun: 0
        });
        
        return id;
    }
    
    // NEW: Theme-aware callback registration
    registerThemeAware(settings) {
        const callbackId = this.register({
            ...settings,
            dependencies: [...(settings.dependencies || []), 'theme']
        });
        
        // Initial execution with current theme
        const currentTheme = this.#pageState.currentTheme;
        queueMicrotask(() => {
            try {
                settings.callback(document.documentElement, currentTheme);
            } catch (error) {
                console.error(`Theme-aware callback ${callbackId} failed on init:`, error);
            }
        });
        
        return callbackId;
    }
    
    unregister(callbackId) {
        var removed = false;
        
        if (this.#callbacks.has(callbackId)) {
            this.#callbacks.delete(callbackId);
            removed = true;
        }
        
        if (this.#debouncedCallbacks.has(callbackId)) {
            this.#debouncedCallbacks.delete(callbackId);
            removed = true;
        }
        
        if (this.#debounceTimeouts.has(callbackId)) {
            clearTimeout(this.#debounceTimeouts.get(callbackId));
            this.#debounceTimeouts.delete(callbackId);
        }
        
        if (removed) {
            console.log('🗑️ Unregistered callback: ' + callbackId);
        }
        
        return removed;
    }
    
    forceScan(selector) {
        if (!selector) {
            this.#scanExistingContent();
            return;
        }
        
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!this.#processedNodes.has(node)) {
                this.#processNode(node);
            }
        }
    }
    
    // NEW: Force theme update on specific elements
    updateThemeOnElements(theme) {
        this.#rescanThemeSensitiveElements(theme);
    }
    
    getStats() {
        return {
            totalMutations: this.#mutationMetrics.totalMutations,
            processedMutations: this.#mutationMetrics.processedMutations,
            averageProcessingTime: this.#mutationMetrics.averageProcessingTime,
            lastMutationTime: this.#mutationMetrics.lastMutationTime,
            registeredCallbacks: this.#callbacks.size,
            debouncedCallbacks: this.#debouncedCallbacks.size,
            pendingTimeouts: this.#debounceTimeouts.size,
            processedNodes: this.#processedNodes.size,
            pageState: this.#pageState,
            isProcessing: this.#isProcessing,
            queueLength: this.#mutationQueue.length,
            // ADDED: Theme stats
            currentTheme: this.#pageState.currentTheme,
            themeMode: this.#pageState.themeMode,
            themeDependentCallbacks: Array.from(this.#callbacks.values()).filter(c => 
                c.dependencies && c.dependencies.includes('theme')
            ).length
        };
    }
    
    destroy() {
        this.#pause();
        
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#mutationQueue.length = 0;
        this.#debounceTimeouts.clear();
        
        document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
        
        console.log('🔄 ForumCoreObserver destroyed');
    }
    
    static create() {
        return new ForumCoreObserver();
    }
}

// Initialize globally
if (!globalThis.forumObserver) {
    try {
        globalThis.forumObserver = ForumCoreObserver.create();
        
        // Global helper functions with theme support
        globalThis.registerForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.register(settings) : null;
        };
        
        globalThis.registerDebouncedForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerDebounced(settings) : null;
        };
        
        // NEW: Theme-aware registration helper
        globalThis.registerThemeAwareScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerThemeAware(settings) : null;
        };
        
        // Auto-cleanup on page hide
        globalThis.addEventListener('pagehide', function() {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.destroy();
            }
        }, { once: true });
        
        console.log('🚀 ForumCoreObserver ready (GLOBAL MODE) with theme integration');
        
    } catch (error) {
        console.error('Failed to initialize ForumCoreObserver:', error);
        
        // Fallback proxy
        globalThis.forumObserver = new Proxy({}, {
            get: function(target, prop) {
                var methods = ['register', 'registerDebounced', 'registerThemeAware', 'unregister', 'forceScan', 'updateThemeOnElements', 'getStats', 'destroy'];
                if (methods.indexOf(prop) > -1) {
                    return function() {
                        console.warn('ForumCoreObserver not initialized - ' + prop + ' called');
                    };
                }
                return undefined;
            }
        });
    }
}
