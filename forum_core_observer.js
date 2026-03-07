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
    #pageState = this.#detectPageState();
    
    // Script readiness tracking
    #scriptsReady = {
        weserv: false,
        dimensionExtractor: false
    };
    
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
        this.#setupThemeListener();
        this.#setupScriptCoordination();
    }
    
    #init() {
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        this.#scanExistingContent();
        this.#setupCleanup();
        
        document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { 
            passive: true, 
            capture: true 
        });
        
        console.log('🔍 ForumCoreObserver initialized (GLOBAL - with script coordination)');
    }
    
    #setupScriptCoordination() {
        // Listen for Weserv ready event
        window.addEventListener('weserv-ready', (e) => {
            this.#scriptsReady.weserv = true;
            console.log('🎯 Weserv ready event received', e.detail || '');
            
            // Trigger dimension extractor if it exists
            if (globalThis.mediaDimensionExtractor) {
                queueMicrotask(() => {
                    globalThis.mediaDimensionExtractor.refresh();
                });
            }
            
            // Check if both are ready
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        // Listen for Dimension Extractor ready
        window.addEventListener('dimension-extractor-ready', (e) => {
            this.#scriptsReady.dimensionExtractor = true;
            console.log('📐 Dimension extractor ready', e.detail || '');
            
            // Check if both are ready
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        // Fallback: Check after load
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (!this.#scriptsReady.weserv && document.querySelector('img[data-optimized="true"]')) {
                    this.#scriptsReady.weserv = true;
                    window.dispatchEvent(new CustomEvent('weserv-ready', { 
                        detail: { source: 'fallback' } 
                    }));
                }
            }, 500);
        }, { once: true, passive: true });
    }
    
    #checkAllScriptsReady() {
        if (this.#scriptsReady.weserv && this.#scriptsReady.dimensionExtractor) {
            console.log('✅ All media scripts ready and coordinated');
            
            // Process any images that might have been missed
            if (globalThis.mediaDimensionExtractor) {
                requestIdleCallback(() => {
                    const unprocessed = document.querySelectorAll('img:not([width])');
                    if (unprocessed.length) {
                        console.log(`🔄 Processing ${unprocessed.length} missed images`);
                        unprocessed.forEach(img => {
                            globalThis.mediaDimensionExtractor.forceReprocessElement(img);
                        });
                    }
                }, { timeout: 1000 });
            }
        }
    }
    
    #detectPageState() {
        var pathname = window.location.pathname;
        var className = document.body.className;
        var theme = document.documentElement.dataset?.theme;
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
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
            currentTheme: theme || (prefersDark ? 'dark' : 'light'),
            themeMode: theme ? 'manual' : 'auto',
            isDarkMode: theme === 'dark' || (!theme && prefersDark),
            isLightMode: theme === 'light' || (!theme && !prefersDark),
            isLoggedIn: !!document.querySelector('.menuwrap .avatar'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            isSendPage: document.body.id === 'send' || className.includes('send'),
            hasPreview: !!document.querySelector('#preview, #ajaxObject, .preview, .Item.preview')
        };
    }
    
    #setupThemeListener() {
        window.addEventListener('themechange', (e) => {
            const { theme } = e.detail;
            console.log(`🎨 Theme change detected: ${theme}`);
            this.#pageState = this.#detectPageState();
            this.#notifyThemeDependentCallbacks(theme);
            this.#rescanThemeSensitiveElements(theme);
            this.#updateThemeAttributes(theme);
        }, { passive: true });
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('forum-theme')) {
                const newTheme = e.matches ? 'dark' : 'light';
                queueMicrotask(() => {
                    this.#pageState = this.#detectPageState();
                    this.#rescanThemeSensitiveElements('auto');
                });
            }
        });
    }
    
    #notifyThemeDependentCallbacks(newTheme) {
        const themeDependentCallbacks = Array.from(this.#callbacks.values()).filter(callback => {
            return callback.dependencies && (
                callback.dependencies.includes('theme') ||
                callback.dependencies.includes('theme-change') ||
                callback.dependencies.includes('data-theme')
            );
        });
        
        if (themeDependentCallbacks.length) {
            themeDependentCallbacks.forEach(callback => {
                try {
                    callback.fn(document.documentElement, newTheme);
                } catch (error) {
                    console.error(`Theme callback ${callback.id} failed:`, error);
                }
            });
        }
    }
    
    #rescanThemeSensitiveElements(theme) {
        const themeSensitiveSelectors = [
            '.modern-quote', '.modern-spoiler', '.modern-code', '.post',
            '.post-modernized', '.st-emoji-container', '.points_up, .points_down',
            '.btn', '.menu-dropdown', '.cs-fui.st-emoji-pop', '.modern-menu-wrap',
            '.search-post', '.post-header', '.post-content', '.post-footer',
            '.modern-topic-title', '.modern-nav', '.modern-breadcrumb'
        ];
        
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                themeSensitiveSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            this.#processedNodes.delete(element);
                            this.#processNode(element);
                        });
                    } catch (e) {}
                });
            }, { timeout: 500 });
        } else {
            setTimeout(() => {
                themeSensitiveSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            this.#processedNodes.delete(element);
                            this.#processNode(element);
                        });
                    } catch (e) {}
                });
            }, 100);
        }
    }
    
    #updateThemeAttributes(theme) {
        const elementsToUpdate = [
            '.cs-fui.st-emoji-pop', '.st-emoji-container', 
            '.post-modernized', '.post.preview'
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
        
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        if (target.nodeType === Node.ELEMENT_NODE) {
            var style = window.getComputedStyle(target);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            return true;
        }
        
        if (mutation.type === 'characterData') {
            var parent = target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            var oldValue = mutation.oldValue || '';
            var newValue = target.getAttribute('style') || '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        return true;
    }
    
    #shouldObserveTextChanges(element) {
        var tagName = element.tagName.toLowerCase();
        
        if (tagName === 'a' || tagName === 'button' || tagName === 'input' || 
            tagName === 'textarea' || tagName === 'select') {
            return true;
        }
        
        var classList = element.classList;
        if (classList) {
            if (classList.contains('post') || classList.contains('article') || 
                classList.contains('comment') || classList.contains('quote') || 
                classList.contains('signature') || classList.contains('post-text')) {
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
        
        var nodeArray = Array.from(affectedNodes);
        var nodesToProcess = [];
        
        for (var k = 0; k < nodeArray.length; k++) {
            var node = nodeArray[k];
            if (node && !this.#processedNodes.has(node)) {
                nodesToProcess.push(node);
            }
        }
        
        if (!nodesToProcess.length) return;
        
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
        
        var children = root.children;
        for (var i = 0; i < children.length; i++) {
            this.#collectAllElements(children[i], collection);
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        var matchingCallbacks = this.#getMatchingCallbacks(node);
        if (!matchingCallbacks.length) return;
        
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
        
        var previewSelectors = [
            '#preview', '#ajaxObject', '.preview', '.Item.preview', 
            '[id*="preview"]', '.preview-content', '.post-preview'
        ];
        
        var allSelectors = forumSelectors.concat(previewSelectors);
        
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
            } catch (e) {}
        }
        
        this.#initialScanComplete = true;
        console.log('✅ Initial content scan complete (GLOBAL mode)');
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(function() {
            if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
                console.warn('Processed nodes approaching limit: ' + this.#processedNodes.size);
                
                if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes * 1.5) {
                    console.warn('Clearing processed nodes cache');
                    this.#processedNodes = new WeakSet();
                }
            }
            
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
            queueMicrotask(function() {
                this.#scanExistingContent();
            }.bind(this));
        }
    }
    
    #pause() {
        if (this.#observer) {
            this.#observer.disconnect();
        }
        
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
    
    // ===== PUBLIC API =====
    
    register(settings) {
        var id = settings.id || 'callback_' + Date.now() + '_' + 
            (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2));
        
        var callback = {
            id: id,
            fn: settings.callback,
            priority: settings.priority || 'normal',
            selector: settings.selector,
            pageTypes: settings.pageTypes,
            dependencies: settings.dependencies,
            retryCount: 0,
            maxRetries: settings.maxRetries || 0,
            createdAt: performance.now()
        };
        
        this.#callbacks.set(id, callback);
        console.log('📝 Registered GLOBAL callback: ' + id + ' (priority: ' + callback.priority + ')');
        
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
    
    registerThemeAware(settings) {
        const callbackId = this.register({
            ...settings,
            dependencies: [...(settings.dependencies || []), 'theme']
        });
        
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
            scriptsReady: this.#scriptsReady,
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
        
        globalThis.registerForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.register(settings) : null;
        };
        
        globalThis.registerDebouncedForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerDebounced(settings) : null;
        };
        
        globalThis.registerThemeAwareScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerThemeAware(settings) : null;
        };
        
        globalThis.addEventListener('pagehide', function() {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.destroy();
            }
        }, { once: true });
        
        console.log('🚀 ForumCoreObserver ready (GLOBAL MODE) with script coordination');
        
    } catch (error) {
        console.error('Failed to initialize ForumCoreObserver:', error);
        
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
