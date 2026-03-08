'use strict';

class ForumCoreObserver {
    #observer = null;
    #iframeObservers = new WeakMap();
    #shadowObservers = new WeakMap();
    #intersectionObserver = null;
    #resizeObserver = null;
    #animationObserver = null;
    #mutationQueue = [];
    #priorityQueue = {
        high: [],
        medium: [],
        low: []
    };
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = typeof WeakSet !== 'undefined' ? new WeakSet() : {
        has: () => false,
        add: () => {},
        delete: () => {}
    };
    #nodeTimestamps = new Map();
    #cleanupIntervalId = null;
    #lastStyleMutation = 0;
    #debug = false;
    #errorCount = 0;
    #maxErrors = 10;
    #resetTimeout = null;
    
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
            attributeFilter: ['class', 'id', 'style', 'data-*', 'src', 'href']
        },
        performance: {
            maxProcessingTime: 16,
            mutationBatchSize: 50,
            debounceThreshold: 100,
            idleCallbackTimeout: 2000,
            searchPageBatchSize: 10,
            styleMutationThrottle: 16, // 60fps
            maxContinuousProcessing: 100 // ms before yielding
        },
        memory: {
            maxProcessedNodes: 10000,
            cleanupInterval: 30000,
            nodeTTL: 300000,
            maxCallbackRetries: 3
        },
        priorities: {
            childList: 1,      // High
            attributes: 2,      // Medium
            characterData: 3    // Low
        }
    };
    
    #mutationMetrics = {
        totalMutations: 0,
        processedMutations: 0,
        averageProcessingTime: 0,
        lastMutationTime: 0,
        errors: 0,
        lastError: null,
        totalNodesProcessed: 0,
        queueHighWatermark: 0
    };
    
    constructor(debug = false) {
        this.#debug = debug;
        this.#init();
        this.#setupThemeListener();
        this.#setupScriptCoordination();
        this.#setupIframeObservation();
        this.#setupIntersectionObserver();
        this.#setupResizeObserver();
        this.#setupAnimationObserver();
        this.#setupErrorHandling();
        this.#setupPerformanceMonitoring();
    }
    
    #log(...args) {
        if (this.#debug) {
            console.log('[ForumObserver]', ...args);
        }
    }
    
    #error(...args) {
        console.error('[ForumObserver]', ...args);
        this.#mutationMetrics.errors++;
        this.#mutationMetrics.lastError = args.join(' ');
    }
    
    #init() {
        try {
            this.#observer = new MutationObserver(this.#handleMutationsWithRetry.bind(this));
            this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
            this.#scanExistingContent();
            this.#setupCleanup();
            
            document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { 
                passive: true, 
                capture: true 
            });
            
            document.addEventListener('load', this.#handleLoadEvents.bind(this), true);
            
            // Observe dynamically added styles
            this.#observeStyleChanges();
            
            this.#log('ForumCoreObserver initialized (GLOBAL - enhanced mode)');
        } catch (error) {
            this.#error('Failed to initialize:', error);
            this.#scheduleReset();
        }
    }
    
    #setupErrorHandling() {
        window.addEventListener('error', (event) => {
            if (event.error && event.error.message.includes('ForumObserver')) {
                this.#errorCount++;
                if (this.#errorCount > this.#maxErrors) {
                    this.#scheduleReset();
                }
            }
        });
    }
    
    #scheduleReset() {
        if (this.#resetTimeout) clearTimeout(this.#resetTimeout);
        this.#resetTimeout = setTimeout(() => {
            this.#log('Attempting to reset observer...');
            this.destroy();
            this.#init();
        }, 5000);
    }
    
    #setupPerformanceMonitoring() {
        if ('performance' in window && 'mark' in performance) {
            setInterval(() => {
                const memory = performance.memory;
                if (memory && memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.8) {
                    this.#log('High memory usage detected, triggering cleanup');
                    this.#cleanupProcessedNodes(true);
                }
            }, 10000);
        }
    }
    
    #observeStyleChanges() {
        const styleObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.tagName === 'STYLE' || node.tagName === 'LINK') {
                            this.#handleNewStyles(node);
                        }
                    });
                }
            });
        });
        
        styleObserver.observe(document.head, {
            childList: true,
            subtree: true
        });
    }
    
    #handleNewStyles(styleNode) {
        // Process any elements that might be affected by new styles
        setTimeout(() => {
            const affectedSelectors = this.#extractSelectorsFromStyles(styleNode);
            affectedSelectors.forEach(selector => {
                try {
                    document.querySelectorAll(selector).forEach(el => {
                        if (!this.#processedNodes.has(el)) {
                            this.#processNode(el);
                        }
                    });
                } catch (e) {}
            });
        }, 100);
    }
    
    #extractSelectorsFromStyles(styleNode) {
        // Simplified selector extraction
        const selectors = [];
        try {
            const sheet = styleNode.sheet || 
                (styleNode.tagName === 'LINK' ? styleNode.styleSheet : null);
            if (sheet && sheet.cssRules) {
                for (let rule of sheet.cssRules) {
                    if (rule.selectorText) {
                        selectors.push(rule.selectorText);
                    }
                }
            }
        } catch (e) {
            // CORS or other issues
        }
        return selectors;
    }
    
    #setupIframeObservation() {
        document.addEventListener('load', (e) => {
            if (e.target.tagName === 'IFRAME') {
                this.#observeIframe(e.target);
            }
        }, true);
        
        // Observe existing iframes
        document.querySelectorAll('iframe').forEach(iframe => this.#observeIframe(iframe));
    }
    
    #observeIframe(iframe) {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
                const iframeObserver = new MutationObserver((mutations) => {
                    this.#handleIframeMutations(mutations, iframe);
                });
                iframeObserver.observe(iframeDoc.documentElement, 
                    ForumCoreObserver.#CONFIG.observer);
                this.#iframeObservers.set(iframe, iframeObserver);
                
                // Process existing content in iframe
                this.#scanIframeContent(iframeDoc);
            }
        } catch (e) {
            // Cross-origin iframe - can't observe
            this.#log('Cannot observe cross-origin iframe');
        }
    }
    
    #scanIframeContent(doc) {
        const elements = doc.querySelectorAll('*');
        elements.forEach(el => {
            if (!this.#processedNodes.has(el)) {
                this.#processNode(el);
            }
        });
    }
    
    #handleIframeMutations(mutations, iframe) {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const affectedNodes = new Set();
                        this.#collectAllElements(node, affectedNodes);
                        affectedNodes.forEach(el => {
                            if (!this.#processedNodes.has(el)) {
                                this.#processNode(el);
                            }
                        });
                    }
                });
            }
        });
    }
    
    #setupIntersectionObserver() {
        this.#intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!this.#processedNodes.has(entry.target)) {
                        this.#processNode(entry.target);
                    }
                    this.#intersectionObserver.unobserve(entry.target);
                }
            });
        }, { 
            rootMargin: '200px', // Load slightly before visible
            threshold: 0.01 
        });
        
        // Observe lazy-load candidates
        this.#observeLazyElements();
    }
    
    #observeLazyElements() {
        const lazySelectors = [
            '.lazy', '.lazy-load', '[data-src]', '[loading="lazy"]',
            '.post', '.content', '.article', '.preview'
        ];
        
        lazySelectors.forEach(selector => {
            try {
                document.querySelectorAll(selector).forEach(el => {
                    if (!this.#processedNodes.has(el)) {
                        this.#intersectionObserver.observe(el);
                    }
                });
            } catch (e) {}
        });
    }
    
    #setupResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            this.#resizeObserver = new ResizeObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                        // Element became visible through resize
                        if (!this.#processedNodes.has(entry.target)) {
                            this.#processNode(entry.target);
                        }
                    }
                });
            });
            
            // Observe containers that might expand
            const containerSelectors = [
                '.post-content', '.expandable', '.collapsible',
                '.dropdown-content', '.modal-content'
            ];
            
            containerSelectors.forEach(selector => {
                try {
                    document.querySelectorAll(selector).forEach(el => {
                        this.#resizeObserver.observe(el);
                    });
                } catch (e) {}
            });
        }
    }
    
    #setupAnimationObserver() {
        if (typeof AnimationObserver !== 'undefined') {
            // Use AnimationObserver if available
            this.#animationObserver = new AnimationObserver((animations) => {
                animations.forEach(animation => {
                    const target = animation.effect.target;
                    if (target && !this.#processedNodes.has(target)) {
                        this.#processNode(target);
                    }
                });
            });
        } else {
            // Fallback: listen for animation events
            document.addEventListener('animationstart', (e) => {
                if (!this.#processedNodes.has(e.target)) {
                    this.#processNode(e.target);
                }
            }, true);
            
            document.addEventListener('transitionstart', (e) => {
                if (!this.#processedNodes.has(e.target)) {
                    this.#processNode(e.target);
                }
            }, true);
        }
    }
    
    #handleLoadEvents(e) {
        const target = e.target;
        if (target.nodeType === Node.ELEMENT_NODE) {
            // Handle image loads, font loads, etc.
            if (target.tagName === 'IMG' || target.tagName === 'VIDEO' || 
                target.tagName === 'IFRAME' || target.tagName === 'SCRIPT') {
                if (!this.#processedNodes.has(target)) {
                    this.#processNode(target);
                }
            }
        }
    }
    
    #setupScriptCoordination() {
        // Listen for Weserv ready event
        window.addEventListener('weserv-ready', (e) => {
            this.#scriptsReady.weserv = true;
            this.#log('Weserv ready event received', e.detail || '');
            
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
            this.#log('Dimension extractor ready', e.detail || '');
            
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
            this.#log('All media scripts ready and coordinated');
            
            // Process any images that might have been missed
            if (globalThis.mediaDimensionExtractor) {
                requestIdleCallback(() => {
                    const unprocessed = document.querySelectorAll('img:not([width])');
                    if (unprocessed.length) {
                        this.#log(`Processing ${unprocessed.length} missed images`);
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
            this.#log(`Theme change detected: ${theme}`);
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
                    this.#error(`Theme callback ${callback.id} failed:`, error);
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
            '.modern-topic-title', '.modern-nav', '.modern-breadcrumb',
            '[data-theme-sensitive="true"]'
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
    
    #handleMutationsWithRetry(mutations) {
        try {
            this.#handleMutations(mutations);
        } catch (error) {
            this.#error('Mutation handling failed:', error);
            this.#errorCount++;
            
            if (this.#errorCount > this.#maxErrors) {
                this.#log('Too many errors, resetting observer...');
                this.#observer.disconnect();
                this.#observer = new MutationObserver(this.#handleMutationsWithRetry.bind(this));
                this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
                this.#errorCount = 0;
            }
        }
    }
    
    #handleMutations(mutations) {
        this.#mutationMetrics.totalMutations += mutations.length;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        const startTime = performance.now();
        
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            
            // Prevent infinite loops
            if (mutation.target.dataset && mutation.target.dataset.observerOrigin === 'forum-script') {
                continue;
            }
            
            // Check if we should process this mutation
            if (this.#shouldProcessMutation(mutation)) {
                const priority = this.#getMutationPriority(mutation);
                this.#priorityQueue[priority].push(mutation);
            }
            
            // Yield if we're taking too long
            if (performance.now() - startTime > ForumCoreObserver.#CONFIG.performance.maxContinuousProcessing) {
                setTimeout(() => this.#processMutationQueue(), 0);
                return;
            }
        }
        
        if (!this.#isProcessing) {
            this.#processMutationQueue();
        }
    }
    
    #getMutationPriority(mutation) {
        const basePriority = ForumCoreObserver.#CONFIG.priorities[mutation.type] || 2;
        
        // Adjust priority based on context
        if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'src' || mutation.attributeName === 'href') {
                return 'high'; // Resource changes are high priority
            }
            if (mutation.attributeName === 'class' && 
                mutation.target.classList.contains('lazy')) {
                return 'high'; // Lazy loading classes are high priority
            }
        }
        
        if (mutation.type === 'childList' && 
            mutation.addedNodes.length > 10) {
            return 'medium'; // Large batches can be medium priority
        }
        
        return basePriority === 1 ? 'high' : basePriority === 2 ? 'medium' : 'low';
    }
    
    #shouldProcessMutation(mutation) {
        var target = mutation.target;
        
        // Skip mutations from our own scripts
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip hidden elements
        if (target.nodeType === Node.ELEMENT_NODE) {
            var style = window.getComputedStyle(target);
            if (style.display === 'none' || style.visibility === 'hidden') {
                // But track if they might become visible
                if (mutation.type === 'attributes' && 
                    (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
                    return true; // Might become visible
                }
                return false;
            }
        }
        
        // Theme changes are always important
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            return true;
        }
        
        // Throttle style mutations
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const now = Date.now();
            if (now - this.#lastStyleMutation < ForumCoreObserver.#CONFIG.performance.styleMutationThrottle) {
                return false;
            }
            this.#lastStyleMutation = now;
            
            var oldValue = mutation.oldValue || '';
            var newValue = target.getAttribute('style') || '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        // Text changes in important elements
        if (mutation.type === 'characterData') {
            var parent = target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
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
        if (this.#isProcessing) return;
        
        this.#isProcessing = true;
        var startTime = performance.now();
        
        try {
            // Process by priority
            const priorities = ['high', 'medium', 'low'];
            
            for (const priority of priorities) {
                const queue = this.#priorityQueue[priority];
                
                while (queue.length) {
                    var batchSize = Math.min(
                        priority === 'high' ? 25 : 
                        priority === 'medium' ? 50 : 100,
                        queue.length
                    );
                    
                    var batch = queue.splice(0, batchSize);
                    await this.#processMutationBatch(batch, priority);
                    
                    // Update watermark
                    const totalQueue = this.#priorityQueue.high.length + 
                                      this.#priorityQueue.medium.length + 
                                      this.#priorityQueue.low.length;
                    this.#mutationMetrics.queueHighWatermark = Math.max(
                        this.#mutationMetrics.queueHighWatermark, 
                        totalQueue
                    );
                    
                    // Check time limit
                    if (performance.now() - startTime > ForumCoreObserver.#CONFIG.performance.maxProcessingTime) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                        startTime = performance.now();
                    }
                }
            }
        } catch (error) {
            this.#error('Mutation processing error:', error);
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
            var processingTime = performance.now() - startTime;
            this.#mutationMetrics.averageProcessingTime = 
                this.#mutationMetrics.averageProcessingTime * 0.9 + processingTime * 0.1;
        }
    }
    
    async #processMutationBatch(mutations, priority) {
        var affectedNodes = new Set();
        
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            
            switch (mutation.type) {
                case 'childList':
                    // Process added nodes
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, affectedNodes);
                            
                            // Check for shadow DOM
                            if (node.shadowRoot) {
                                this.#collectAllElements(node.shadowRoot, affectedNodes);
                                this.#observeShadowRoot(node.shadowRoot, node);
                            }
                        }
                    }
                    
                    // Process removed nodes (clean up)
                    for (var j = 0; j < mutation.removedNodes.length; j++) {
                        var node = mutation.removedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#cleanupRemovedNode(node);
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
                    
                    // Check if element became visible
                    if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                        const style = window.getComputedStyle(mutation.target);
                        if (style.display !== 'none' && style.visibility !== 'hidden') {
                            affectedNodes.add(mutation.target);
                        }
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
                this.#nodeTimestamps.set(node, Date.now());
            }
        }
        
        if (!nodesToProcess.length) return;
        
        this.#mutationMetrics.totalNodesProcessed += nodesToProcess.length;
        
        // Process with concurrency based on priority
        var CONCURRENCY_LIMIT = priority === 'high' ? 8 : priority === 'medium' ? 4 : 2;
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
    
    #observeShadowRoot(shadowRoot, host) {
        if (this.#shadowObservers.has(host)) return;
        
        const shadowObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const affectedNodes = new Set();
                            this.#collectAllElements(node, affectedNodes);
                            affectedNodes.forEach(el => {
                                if (!this.#processedNodes.has(el)) {
                                    this.#processNode(el);
                                }
                            });
                        }
                    });
                }
            });
        });
        
        shadowObserver.observe(shadowRoot, ForumCoreObserver.#CONFIG.observer);
        this.#shadowObservers.set(host, shadowObserver);
    }
    
    #cleanupRemovedNode(node) {
        // Clean up any references to removed node
        this.#processedNodes.delete(node);
        this.#nodeTimestamps.delete(node);
        
        // Clean up shadow DOM observer
        if (this.#shadowObservers.has(node)) {
            this.#shadowObservers.get(node).disconnect();
            this.#shadowObservers.delete(node);
        }
        
        // Clean up iframe observer
        if (this.#iframeObservers.has(node)) {
            this.#iframeObservers.get(node).disconnect();
            this.#iframeObservers.delete(node);
        }
        
        // Unobserve from intersection observer
        if (this.#intersectionObserver) {
            this.#intersectionObserver.unobserve(node);
        }
        
        // Unobserve from resize observer
        if (this.#resizeObserver) {
            this.#resizeObserver.unobserve(node);
        }
    }
    
    #collectAllElements(root, collection) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        
        collection.add(root);
        
        // Check for shadow DOM
        if (root.shadowRoot) {
            this.#collectAllElements(root.shadowRoot, collection);
        }
        
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
            
            // Check retry count
            if (callback.retryCount > (callback.maxRetries || ForumCoreObserver.#CONFIG.memory.maxCallbackRetries)) {
                continue; // Skip if too many retries
            }
            
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
        this.#nodeTimestamps.set(node, Date.now());
    }
    
    #getMatchingCallbacks(node) {
        var matching = [];
        var callbackValues = Array.from(this.#callbacks.values());
        
        for (var i = 0; i < callbackValues.length; i++) {
            var callback = callbackValues[i];
            
            // Check if callback should run on this page type
            if (callback.pageTypes && !this.#matchesPageType(callback.pageTypes)) {
                continue;
            }
            
            if (callback.selector) {
                try {
                    if (!node.matches(callback.selector) && !node.querySelector(callback.selector)) {
                        continue;
                    }
                } catch (e) {
                    // Invalid selector, skip
                    continue;
                }
            }
            
            matching.push(callback);
        }
        
        return matching;
    }
    
    #matchesPageType(pageTypes) {
        if (!pageTypes) return true;
        
        for (var i = 0; i < pageTypes.length; i++) {
            var type = pageTypes[i];
            if (this.#pageState['is' + type.charAt(0).toUpperCase() + type.slice(1)]) {
                return true;
            }
        }
        
        return false;
    }
    
    async #executeCallbacks(callbacks, node) {
        var promises = [];
        
        for (var i = 0; i < callbacks.length; i++) {
            var callback = callbacks[i];
            promises.push((async function() {
                try {
                    // Set origin to prevent infinite loops
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        node.dataset.observerOrigin = 'forum-script';
                    }
                    
                    if (callback.dependencies && callback.dependencies.includes('theme')) {
                        await callback.fn(node, this.#pageState.currentTheme);
                    } else {
                        await callback.fn(node);
                    }
                    
                    // Reset retry count on success
                    callback.retryCount = 0;
                    
                } catch (error) {
                    callback.retryCount = (callback.retryCount || 0) + 1;
                    this.#error('Callback ' + callback.id + ' failed (attempt ' + callback.retryCount + '):', error);
                    
                    // Schedule retry if under limit
                    if (callback.retryCount <= (callback.maxRetries || ForumCoreObserver.#CONFIG.memory.maxCallbackRetries)) {
                        setTimeout(() => {
                            this.#processNode(node);
                        }, 1000 * callback.retryCount); // Exponential backoff
                    }
                } finally {
                    // Clean up origin marker
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        delete node.dataset.observerOrigin;
                    }
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
            '.post-actions', '.user-info', '.post-content', '.post-footer',
            '[data-forum-element="true"]'
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
                        
                        // Check for shadow DOM
                        if (node.shadowRoot) {
                            this.#collectAllElements(node.shadowRoot, new Set());
                        }
                    }
                }
            } catch (e) {}
        }
        
        // Scan for shadow DOM hosts
        this.#scanForShadowDOM();
        
        // Scan for iframes
        document.querySelectorAll('iframe').forEach(iframe => {
            this.#observeIframe(iframe);
        });
        
        this.#initialScanComplete = true;
        this.#log('Initial content scan complete (GLOBAL mode)');
    }
    
    #scanForShadowDOM() {
        const shadowHosts = document.querySelectorAll('*');
        shadowHosts.forEach(host => {
            if (host.shadowRoot && !this.#shadowObservers.has(host)) {
                this.#observeShadowRoot(host.shadowRoot, host);
            }
        });
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(() => {
            this.#cleanupProcessedNodes();
            
            if (typeof globalThis.gc === 'function' && 
                this.#mutationMetrics.totalNodesProcessed > 10000) {
                globalThis.gc();
            }
        }, ForumCoreObserver.#CONFIG.memory.cleanupInterval);
    }
    
    #cleanupProcessedNodes(force = false) {
        const now = Date.now();
        let cleanupCount = 0;
        
        // Clean up old nodes from timestamp map
        for (const [node, timestamp] of this.#nodeTimestamps) {
            if (force || now - timestamp > ForumCoreObserver.#CONFIG.memory.nodeTTL) {
                // Check if node still exists in DOM
                if (!document.body.contains(node)) {
                    this.#processedNodes.delete(node);
                    this.#nodeTimestamps.delete(node);
                    cleanupCount++;
                }
            }
        }
        
        if (cleanupCount > 0) {
            this.#log(`Cleaned up ${cleanupCount} old nodes`);
        }
        
        // Check if we need to clear the entire WeakSet
        if (this.#nodeTimestamps.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
            this.#log('Processed nodes approaching limit, clearing cache');
            this.#processedNodes = new WeakSet();
            // Keep timestamps for nodes that still exist
            const newTimestamps = new Map();
            for (const [node, timestamp] of this.#nodeTimestamps) {
                if (document.body.contains(node)) {
                    newTimestamps.set(node, timestamp);
                }
            }
            this.#nodeTimestamps = newTimestamps;
        }
    }
    
    #handleVisibilityChange() {
        if (document.hidden) {
            this.#pause();
        } else {
            this.#resume();
            queueMicrotask(() => {
                this.#scanExistingContent();
                this.#observeLazyElements();
            });
        }
    }
    
    #pause() {
        if (this.#observer) {
            this.#observer.disconnect();
        }
        
        // Pause iframe observers
        for (const [iframe, observer] of this.#iframeObservers) {
            observer.disconnect();
        }
        
        // Pause shadow DOM observers
        for (const [host, observer] of this.#shadowObservers) {
            observer.disconnect();
        }
        
        var timeoutIds = Array.from(this.#debounceTimeouts.values());
        for (var i = 0; i < timeoutIds.length; i++) {
            clearTimeout(timeoutIds[i]);
        }
        this.#debounceTimeouts.clear();
    }
    
    #resume() {
        if (!this.#observer) {
            this.#observer = new MutationObserver(this.#handleMutationsWithRetry.bind(this));
        }
        
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        
        // Resume iframe observers
        document.querySelectorAll('iframe').forEach(iframe => {
            if (!this.#iframeObservers.has(iframe)) {
                this.#observeIframe(iframe);
            }
        });
        
        // Resume shadow DOM observers
        this.#scanForShadowDOM();
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
            maxRetries: settings.maxRetries || ForumCoreObserver.#CONFIG.memory.maxCallbackRetries,
            createdAt: performance.now(),
            metadata: settings.metadata || {}
        };
        
        this.#callbacks.set(id, callback);
        this.#log('Registered GLOBAL callback: ' + id + ' (priority: ' + callback.priority + ')');
        
        if (this.#initialScanComplete && callback.selector) {
            try {
                var nodes = document.querySelectorAll(callback.selector);
                for (var i = 0; i < nodes.length; i++) {
                    var node = nodes[i];
                    if (!this.#processedNodes.has(node)) {
                        this.#processNode(node);
                    }
                }
            } catch (e) {
                this.#error('Error during initial callback scan:', e);
            }
        }
        
        return id;
    }
    
    registerDebounced(settings) {
        var id = this.register(settings);
        
        this.#debouncedCallbacks.set(id, {
            callback: settings.callback,
            delay: settings.delay || ForumCoreObserver.#CONFIG.performance.debounceThreshold,
            lastRun: 0,
            timeout: null
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
                this.#error(`Theme-aware callback ${callbackId} failed on init:`, error);
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
            const debounced = this.#debouncedCallbacks.get(callbackId);
            if (debounced.timeout) {
                clearTimeout(debounced.timeout);
            }
            this.#debouncedCallbacks.delete(callbackId);
            removed = true;
        }
        
        if (this.#debounceTimeouts.has(callbackId)) {
            clearTimeout(this.#debounceTimeouts.get(callbackId));
            this.#debounceTimeouts.delete(callbackId);
        }
        
        if (removed) {
            this.#log('Unregistered callback: ' + callbackId);
        }
        
        return removed;
    }
    
    forceScan(selector) {
        if (!selector) {
            this.#scanExistingContent();
            return;
        }
        
        try {
            var nodes = document.querySelectorAll(selector);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            }
        } catch (e) {
            this.#error('Error during force scan:', e);
        }
    }
    
    forceReprocess(selector) {
        try {
            var nodes = document.querySelectorAll(selector);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                this.#processedNodes.delete(node);
                this.#processNode(node);
            }
        } catch (e) {
            this.#error('Error during force reprocess:', e);
        }
    }
    
    updateThemeOnElements(theme) {
        this.#rescanThemeSensitiveElements(theme);
    }
    
    getStats() {
        const now = Date.now();
        const activeNodes = Array.from(this.#nodeTimestamps.entries())
            .filter(([node]) => document.body.contains(node)).length;
        
        return {
            mutations: {
                total: this.#mutationMetrics.totalMutations,
                processed: this.#mutationMetrics.processedMutations,
                avgTime: this.#mutationMetrics.averageProcessingTime,
                lastTime: this.#mutationMetrics.lastMutationTime,
                errors: this.#mutationMetrics.errors,
                lastError: this.#mutationMetrics.lastError,
                totalNodesProcessed: this.#mutationMetrics.totalNodesProcessed,
                queueHighWatermark: this.#mutationMetrics.queueHighWatermark
            },
            callbacks: {
                registered: this.#callbacks.size,
                debounced: this.#debouncedCallbacks.size,
                pendingTimeouts: this.#debounceTimeouts.size,
                themeDependent: Array.from(this.#callbacks.values()).filter(c => 
                    c.dependencies && c.dependencies.includes('theme')
                ).length
            },
            nodes: {
                processed: this.#processedNodes.size,
                active: activeNodes,
                tracked: this.#nodeTimestamps.size
            },
            state: {
                ...this.#pageState,
                isProcessing: this.#isProcessing,
                queueLength: this.#priorityQueue.high.length + 
                             this.#priorityQueue.medium.length + 
                             this.#priorityQueue.low.length,
                queueBreakdown: {
                    high: this.#priorityQueue.high.length,
                    medium: this.#priorityQueue.medium.length,
                    low: this.#priorityQueue.low.length
                },
                scriptsReady: this.#scriptsReady,
                errorCount: this.#errorCount,
                hasResetScheduled: !!this.#resetTimeout
            },
            memory: {
                iframeObservers: this.#iframeObservers.size,
                shadowObservers: this.#shadowObservers.size
            }
        };
    }
    
    async waitForScripts(scripts = ['weserv', 'dimensionExtractor'], timeout = 5000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            const allReady = scripts.every(script => this.#scriptsReady[script]);
            if (allReady) return true;
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return false;
    }
    
    destroy() {
        this.#pause();
        
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        if (this.#resetTimeout) {
            clearTimeout(this.#resetTimeout);
        }
        
        // Disconnect all observers
        if (this.#intersectionObserver) {
            this.#intersectionObserver.disconnect();
        }
        
        if (this.#resizeObserver) {
            this.#resizeObserver.disconnect();
        }
        
        // Clear all maps and sets
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#nodeTimestamps.clear();
        this.#iframeObservers.clear();
        this.#shadowObservers.clear();
        this.#priorityQueue.high = [];
        this.#priorityQueue.medium = [];
        this.#priorityQueue.low = [];
        this.#mutationQueue.length = 0;
        this.#debounceTimeouts.clear();
        
        document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
        document.removeEventListener('load', this.#handleLoadEvents, true);
        
        this.#log('ForumCoreObserver destroyed');
    }
    
    static create(debug = false) {
        return new ForumCoreObserver(debug);
    }
}

// Initialize globally with enhanced features
if (!globalThis.forumObserver) {
    try {
        // Check if we should enable debug mode
        const debug = localStorage.getItem('forum-observer-debug') === 'true' || 
                     window.location.hash === '#observer-debug';
        
        globalThis.forumObserver = ForumCoreObserver.create(debug);
        
        // Convenience global functions
        globalThis.registerForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.register(settings) : null;
        };
        
        globalThis.registerDebouncedForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerDebounced(settings) : null;
        };
        
        globalThis.registerThemeAwareScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerThemeAware(settings) : null;
        };
        
        globalThis.waitForForumScripts = function(scripts, timeout) {
            return globalThis.forumObserver ? globalThis.forumObserver.waitForScripts(scripts, timeout) : Promise.reject('Observer not initialized');
        };
        
        globalThis.getForumObserverStats = function() {
            return globalThis.forumObserver ? globalThis.forumObserver.getStats() : null;
        };
        
        // Debug helper
        if (debug) {
            globalThis.forumObserverDebug = {
                enable: () => {
                    localStorage.setItem('forum-observer-debug', 'true');
                    window.location.reload();
                },
                disable: () => {
                    localStorage.removeItem('forum-observer-debug');
                    window.location.reload();
                },
                stats: () => globalThis.forumObserver?.getStats(),
                reprocess: (selector) => globalThis.forumObserver?.forceReprocess(selector)
            };
            console.log('🔧 ForumObserver debug mode enabled. Use forumObserverDebug object.');
        }
        
        // Clean up on page unload
        globalThis.addEventListener('pagehide', function() {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.destroy();
                globalThis.forumObserver = null;
            }
        }, { once: true });
        
        console.log('🚀 ForumCoreObserver ready (ENHANCED GLOBAL MODE) with full DOM coverage');
        
    } catch (error) {
        console.error('Failed to initialize ForumCoreObserver:', error);
        
        // Provide fallback that logs warnings
        globalThis.forumObserver = new Proxy({}, {
            get: function(target, prop) {
                const methods = ['register', 'registerDebounced', 'registerThemeAware', 'unregister', 
                               'forceScan', 'forceReprocess', 'updateThemeOnElements', 'getStats', 
                               'destroy', 'waitForScripts'];
                if (methods.includes(prop)) {
                    return function() {
                        console.warn('ForumCoreObserver not initialized - ' + prop + ' called');
                        return prop === 'getStats' ? { error: 'Not initialized' } : 
                               prop === 'waitForScripts' ? Promise.reject('Not initialized') : null;
                    };
                }
                return undefined;
            }
        });
    }
}
