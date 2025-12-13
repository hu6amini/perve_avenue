// Enhanced ForumCoreObserver with Modern JavaScript Optimizations
class ForumCoreObserver {
    #observer = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    #abortControllers = new Map();
    
    // Private fields for better encapsulation
    #callbacks = new Map();           // id -> callback config
    #debouncedCallbacks = new Map();  // id -> debounced config
    #pageState = this.#detectPageState();
    #performanceObserver = null;
    
    // Configuration with static getters using modern syntax
    static #OBSERVER_OPTIONS = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'id', 'style', 'data-*']
    };
    
    static #PERFORMANCE_CONFIG = {
        maxProcessingTime: 16,        // 60fps budget
        mutationBatchSize: 50,
        debounceThreshold: 100,
        idleCallbackTimeout: 2000,
        searchPageBatchSize: 10,
        concurrencyLimit: 4,
        yieldThreshold: 8            // Yield after 8ms of processing
    };
    
    static #MEMORY_CONFIG = {
        maxProcessedNodes: 10000,
        cleanupInterval: 30000,
        nodeTTL: 300000,
        queueMaxSize: 1000
    };
    
    #mutationMetrics = {
        totalMutations: 0n,
        processedMutations: 0n,
        averageProcessingTime: 0,
        lastMutationTime: 0,
        longestProcessingTime: 0,
        callbackExecutions: 0
    };
    
    #selectorCache = new Map();
    
    constructor() {
        this.#init();
    }
    
    async #init() {
        try {
            // Create observer with private class field
            this.#observer = new MutationObserver(this.#handleMutations.bind(this));
            
            // Observe entire document with modern options
            this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
            
            // Setup performance monitoring
            this.#setupPerformanceObserver();
            
            // Initial scan of existing content
            await this.#scanExistingContent();
            
            // Setup periodic cleanup
            this.#setupCleanup();
            
            // Use modern event listener with AbortSignal
            const abortController = new AbortController();
            document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { 
                passive: true,
                signal: abortController.signal
            });
            this.#abortControllers.set('visibilitychange', abortController);
            
            // Log initialization with structured data
            console.group('🚀 Enhanced Forum Core Observer');
            console.log('Initialized with modern optimizations');
            console.table({
                'Page Type': this.#pageState.isTopic ? 'Topic' : 
                           this.#pageState.isForum ? 'Forum' :
                           this.#pageState.isBlog ? 'Blog' : 'Other',
                'Dark Mode': this.#pageState.isDarkMode,
                'Logged In': this.#pageState.isLoggedIn,
                'Mobile': this.#pageState.isMobile,
                'Modernized Posts': this.#pageState.hasModernizedPosts
            });
            console.groupEnd();
            
        } catch (error) {
            console.error('Failed to initialize ForumCoreObserver:', error);
            this.#handleInitError(error);
        }
    }
    
    #setupPerformanceObserver() {
        if ('PerformanceObserver' in window) {
            try {
                this.#performanceObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    entries.forEach(entry => {
                        if (entry.entryType === 'longtask' && entry.duration > 50) {
                            console.warn('Long task detected:', entry);
                        }
                    });
                });
                this.#performanceObserver.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                console.warn('PerformanceObserver not supported:', e);
            }
        }
    }
    
    #detectPageState() {
        const { pathname, search } = window.location;
        const params = new URLSearchParams(search);
        
        // Modern selector detection with caching
        const selectors = new Map([
            ['forum', '.board, .big_list'],
            ['topic', '.modern-topic-title, .post'],
            ['blog', '#blog, .article'],
            ['profile', '.modern-profile, .profile'],
            ['search', '#search.posts, body#search'],
            ['modernized', '.post-modernized']
        ]);
        
        const checks = {};
        for (const [key, selector] of selectors) {
            checks[key] = document.querySelector(selector) ?? null;
        }
        
        return {
            ...checks,
            isForum: pathname.includes('/f/') || !!checks.forum,
            isTopic: pathname.includes('/t/') || !!checks.topic,
            isBlog: pathname.includes('/b/') || !!checks.blog,
            isProfile: pathname.includes('/user/') || !!checks.profile,
            isSearch: pathname.includes('/search/') || !!checks.search,
            hasModernizedPosts: !!checks.modernized,
            hasModernizedQuotes: !!document.querySelector('.modern-quote'),
            hasModernizedProfile: !!document.querySelector('.modern-profile'),
            hasModernizedNavigation: !!document.querySelector('.modern-nav'),
            isDarkMode: document.documentElement.dataset?.theme === 'dark',
            isLoggedIn: !!document.querySelector('.menuwrap .avatar'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            queryParams: Object.fromEntries(params),
            pageId: crypto.randomUUID?.() ?? `page_${Date.now()}_${Math.random().toString(36).slice(2)}`
        };
    }
    
    #handleMutations(mutations) {
        // Use performance mark for precise timing
        performance.mark('mutation-handling-start');
        
        this.#mutationMetrics.totalMutations++;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        // Filter mutations using modern array methods with early exit
        const validMutations = mutations.filter(mutation => 
            this.#shouldProcessMutation(mutation)
        );
        
        if (!validMutations.length) {
            performance.mark('mutation-handling-end');
            performance.measure('mutation-handling', 'mutation-handling-start', 'mutation-handling-end');
            return;
        }
        
        // Add to queue with size limit
        if (this.#mutationQueue.length < ForumCoreObserver.#MEMORY_CONFIG.queueMaxSize) {
            this.#mutationQueue.push(...validMutations);
            this.#mutationMetrics.totalMutations += BigInt(validMutations.length);
        } else {
            console.warn('Mutation queue size limit reached, dropping mutations');
        }
        
        // Start processing if idle
        if (!this.#isProcessing) {
            this.#scheduleQueueProcessing();
        }
        
        performance.mark('mutation-handling-end');
        performance.measure('mutation-handling', 'mutation-handling-start', 'mutation-handling-end');
    }
    
    #scheduleQueueProcessing() {
        if (typeof scheduler !== 'undefined' && scheduler.postTask) {
            scheduler.postTask(() => this.#processMutationQueue(), {
                priority: 'user-visible'
            });
        } else {
            // Use queueMicrotask for immediate next tick
            queueMicrotask(() => this.#processMutationQueue());
        }
    }
    
    #shouldProcessMutation(mutation) {
        // Quick checks first for performance
        if (mutation.target.dataset?.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip already processed or modernized content
        if (this.#shouldSkipProcessing(mutation.target)) {
            return false;
        }
        
        // Type-specific checks
        switch (mutation.type) {
            case 'characterData':
                return this.#shouldProcessTextMutation(mutation);
                
            case 'attributes':
                return this.#shouldProcessAttributeMutation(mutation);
                
            case 'childList':
                return this.#shouldProcessChildListMutation(mutation);
                
            default:
                return true;
        }
    }
    
    #shouldSkipProcessing(node) {
        // Quick class check
        if (node.classList?.contains('post-modernized') || 
            node.classList?.contains('modern-quote') ||
            node.classList?.contains('modern-profile')) {
            return true;
        }
        
        // Check ancestors efficiently
        const modernSelectors = [
            '.post-modernized',
            '.modern-quote',
            '.modern-profile',
            '.modern-nav',
            '.modern-breadcrumb'
        ];
        
        for (const selector of modernSelectors) {
            if (node.closest?.(selector)) {
                return true;
            }
        }
        
        return false;
    }
    
    #shouldProcessTextMutation(mutation) {
        const parent = mutation.target.parentElement;
        if (!parent) return false;
        
        const tagName = parent.tagName.toLowerCase();
        const textContent = mutation.target.textContent.trim();
        
        // Skip empty or whitespace-only text changes
        if (!textContent || /^\s+$/.test(textContent)) {
            return false;
        }
        
        // Only process text in relevant elements
        const relevantTags = new Set(['p', 'span', 'div', 'a', 'button', 'td', 'li']);
        const hasForumClass = Array.from(parent.classList).some(cls => 
            cls.includes('post') || cls.includes('comment') || cls.includes('content')
        );
        
        return relevantTags.has(tagName) || hasForumClass;
    }
    
    #shouldProcessAttributeMutation(mutation) {
        if (mutation.attributeName !== 'style') return true;
        
        const oldValue = mutation.oldValue ?? '';
        const newValue = mutation.target.getAttribute('style') ?? '';
        
        // Parse styles efficiently
        const oldStyles = this.#parseStyleString(oldValue);
        const newStyles = this.#parseStyleString(newValue);
        
        // Check only relevant style properties
        const relevantProperties = ['display', 'visibility', 'opacity', 'position', 'width', 'height'];
        return relevantProperties.some(prop => 
            oldStyles.get(prop) !== newStyles.get(prop)
        );
    }
    
    #shouldProcessChildListMutation(mutation) {
        // Check if added nodes are significant
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip script and style elements
                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
                    continue;
                }
                
                // Check if element might contain forum content
                if (node.matches?.('.post, .article, .comment, .reply') || 
                    node.querySelector?.('.post, .article, .comment, .reply')) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    #parseStyleString(styleString) {
        if (!styleString) return new Map();
        
        // Efficient style parsing
        return new Map(
            styleString.split(';')
                .map(part => part.split(':'))
                .filter(pair => pair.length === 2)
                .map(([key, value]) => [key.trim(), value.trim()])
        );
    }
    
    async #processMutationQueue() {
        if (this.#isProcessing) return;
        
        this.#isProcessing = true;
        const startTime = performance.now();
        
        try {
            performance.mark('queue-processing-start');
            
            while (this.#mutationQueue.length > 0) {
                const batch = this.#mutationQueue.splice(
                    0, 
                    Math.min(
                        ForumCoreObserver.#PERFORMANCE_CONFIG.mutationBatchSize,
                        this.#mutationQueue.length
                    )
                );
                
                await this.#processMutationBatch(batch);
                
                // Yield to main thread if taking too long
                if (performance.now() - startTime > ForumCoreObserver.#PERFORMANCE_CONFIG.yieldThreshold) {
                    await this.#yieldToMainThread();
                }
            }
            
        } catch (error) {
            console.error('Mutation processing error:', error);
            this.#handleProcessingError(error);
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
            const processingTime = performance.now() - startTime;
            this.#updateMetrics(processingTime);
            
            performance.mark('queue-processing-end');
            performance.measure('queue-processing', 'queue-processing-start', 'queue-processing-end');
        }
    }
    
    async #processMutationBatch(mutations) {
        performance.mark('batch-processing-start');
        
        // Use Set for deduplication
        const affectedNodes = new Set();
        
        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'childList':
                    this.#collectAddedElements(mutation.addedNodes, affectedNodes);
                    break;
                    
                case 'attributes':
                    affectedNodes.add(mutation.target);
                    break;
                    
                case 'characterData':
                    affectedNodes.add(mutation.target.parentElement);
                    break;
            }
        }
        
        // Process nodes in optimized batches
        const nodesToProcess = Array.from(affectedNodes)
            .filter(node => node && !this.#processedNodes.has(node));
        
        if (nodesToProcess.length === 0) {
            performance.mark('batch-processing-end');
            performance.measure('batch-processing', 'batch-processing-start', 'batch-processing-end');
            return;
        }
        
        // Process with controlled concurrency
        await this.#processNodesWithConcurrency(nodesToProcess);
        
        performance.mark('batch-processing-end');
        performance.measure('batch-processing', 'batch-processing-start', 'batch-processing-end');
    }
    
    #collectAddedElements(nodes, collection) {
        for (const node of nodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                collection.add(node);
                
                // Collect children efficiently
                if (node.children.length > 0) {
                    for (const child of node.children) {
                        this.#collectAddedElements([child], collection);
                    }
                }
            }
        }
    }
    
    async #processNodesWithConcurrency(nodes) {
        const concurrencyLimit = ForumCoreObserver.#PERFORMANCE_CONFIG.concurrencyLimit;
        const chunks = [];
        
        for (let i = 0; i < nodes.length; i += concurrencyLimit) {
            chunks.push(nodes.slice(i, i + concurrencyLimit));
        }
        
        for (const chunk of chunks) {
            await Promise.allSettled(
                chunk.map(node => this.#processNode(node))
            );
            
            // Small delay between chunks to prevent blocking
            if (chunks.length > 1) {
                await this.#yieldToMainThread();
            }
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        performance.mark(`process-node-${node.id || 'unknown'}`);
        
        try {
            const matchingCallbacks = this.#getMatchingCallbacks(node);
            if (matchingCallbacks.length === 0) return;
            
            // Group by priority
            const priorityGroups = new Map([
                ['critical', []],
                ['high', []],
                ['normal', []],
                ['low', []]
            ]);
            
            for (const callback of matchingCallbacks) {
                const priority = callback.priority ?? 'normal';
                priorityGroups.get(priority)?.push(callback);
            }
            
            // Execute in priority order
            for (const [priority, callbacks] of priorityGroups) {
                if (callbacks.length === 0) continue;
                
                if (priority === 'critical') {
                    await this.#executeCallbacks(callbacks, node);
                } else {
                    this.#deferCallbacks(callbacks, node, priority);
                }
            }
            
            this.#processedNodes.add(node);
            this.#mutationMetrics.callbackExecutions++;
            
        } catch (error) {
            console.error(`Error processing node:`, node, error);
        } finally {
            performance.mark(`process-node-${node.id || 'unknown'}-end`);
            performance.measure(
                `process-node-${node.id || 'unknown'}`,
                `process-node-${node.id || 'unknown'}`,
                `process-node-${node.id || 'unknown'}-end`
            );
        }
    }
    
    #getMatchingCallbacks(node) {
        const matching = [];
        
        for (const callback of this.#callbacks.values()) {
            // Check page type restrictions
            if (callback.pageTypes?.length) {
                if (!this.#matchesPageTypes(callback.pageTypes)) {
                    continue;
                }
            }
            
            // Check dependencies
            if (callback.dependencies?.length) {
                if (!this.#dependenciesMet(callback.dependencies)) {
                    continue;
                }
            }
            
            // Check selector match
            if (callback.selector) {
                if (!this.#nodeMatchesSelector(node, callback.selector)) {
                    continue;
                }
            }
            
            matching.push(callback);
        }
        
        return matching;
    }
    
    #matchesPageTypes(pageTypes) {
        return pageTypes.some(type => {
            const stateKey = `is${type.charAt(0).toUpperCase() + type.slice(1)}`;
            return this.#pageState[stateKey];
        });
    }
    
    #dependenciesMet(dependencies) {
        return dependencies.every(dep => {
            if (typeof dep === 'string') {
                return !!document.querySelector(dep);
            }
            if (typeof dep === 'function') {
                return dep();
            }
            return true;
        });
    }
    
    #nodeMatchesSelector(node, selector) {
        // Use cached selector checks for performance
        if (!this.#selectorCache.has(selector)) {
            this.#selectorCache.set(selector, {
                test: (el) => el.matches?.(selector) || el.querySelector?.(selector)
            });
        }
        
        const cached = this.#selectorCache.get(selector);
        return cached.test(node);
    }
    
    async #executeCallbacks(callbacks, node) {
        const abortController = new AbortController();
        const signal = abortController.signal;
        
        // Set timeout for callback execution
        const timeoutId = setTimeout(() => {
            abortController.abort();
            console.warn(`Callback execution timeout for node:`, node);
        }, 5000);
        
        try {
            const promises = callbacks.map(async (callback) => {
                if (signal.aborted) return;
                
                try {
                    await callback.fn(node);
                } catch (error) {
                    if (!signal.aborted) {
                        console.error(`Callback ${callback.id} failed:`, error);
                        await this.#handleCallbackError(callback, node, error);
                    }
                }
            });
            
            await Promise.allSettled(promises);
            
        } finally {
            clearTimeout(timeoutId);
        }
    }
    
    async #handleCallbackError(callback, node, error) {
        // Retry logic with exponential backoff
        const retryCount = callback.retryCount ?? 0;
        const maxRetries = callback.maxRetries ?? 0;
        
        if (retryCount < maxRetries) {
            callback.retryCount = retryCount + 1;
            const delay = 100 * Math.pow(2, retryCount);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            await callback.fn(node);
        }
    }
    
    #deferCallbacks(callbacks, node, priority) {
        const delays = new Map([
            ['high', 50],
            ['normal', 100],
            ['low', 500]
        ]);
        
        const delay = delays.get(priority) ?? 100;
        
        const execute = () => this.#executeCallbacks(callbacks, node);
        
        if (typeof scheduler !== 'undefined' && scheduler.postTask) {
            scheduler.postTask(execute, { 
                priority: 'user-visible', 
                delay 
            });
        } else if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(execute, { timeout: delay });
        } else {
            setTimeout(execute, delay);
        }
    }
    
    async #scanExistingContent() {
        const forumSelectors = [
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
        
        // Process selectors in batches
        const batchSize = 10;
        for (let i = 0; i < forumSelectors.length; i += batchSize) {
            const batch = forumSelectors.slice(i, i + batchSize);
            
            const nodes = [];
            for (const selector of batch) {
                try {
                    const found = document.querySelectorAll(selector);
                    nodes.push(...found);
                } catch (e) {
                    console.warn(`Invalid selector: ${selector}`, e);
                }
            }
            
            // Process unique nodes
            const uniqueNodes = [...new Set(nodes)]
                .filter(node => node && !this.#processedNodes.has(node));
            
            if (uniqueNodes.length > 0) {
                await this.#processNodesWithConcurrency(uniqueNodes);
            }
            
            // Yield between batches
            if (i + batchSize < forumSelectors.length) {
                await this.#yieldToMainThread();
            }
        }
        
        this.#initialScanComplete = true;
        console.log('✅ Initial content scan complete');
    }
    
    async #yieldToMainThread() {
        return new Promise(resolve => {
            if (typeof scheduler !== 'undefined' && scheduler.yield) {
                scheduler.yield().then(resolve);
            } else if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }
    
    #updateMetrics(processingTime) {
        this.#mutationMetrics.averageProcessingTime = 
            this.#mutationMetrics.averageProcessingTime * 0.9 + processingTime * 0.1;
        
        if (processingTime > this.#mutationMetrics.longestProcessingTime) {
            this.#mutationMetrics.longestProcessingTime = processingTime;
        }
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(() => {
            // Clean up old processed nodes if needed
            if (this.#processedNodes.size > ForumCoreObserver.#MEMORY_CONFIG.maxProcessedNodes) {
                console.warn('Clearing processed nodes cache for memory management');
                this.#processedNodes = new WeakSet();
            }
            
            // Clear old debounce timeouts
            const now = Date.now();
            for (const [id, timeoutId] of this.#debounceTimeouts) {
                if (now - (this.#debouncedCallbacks.get(id)?.lastRun ?? 0) > 30000) {
                    clearTimeout(timeoutId);
                    this.#debounceTimeouts.delete(id);
                }
            }
            
            // Optional: trigger garbage collection if available
            if (typeof globalThis.gc === 'function') {
                globalThis.gc();
            }
            
        }, ForumCoreObserver.#MEMORY_CONFIG.cleanupInterval);
    }
    
    #handleVisibilityChange() {
        if (document.hidden) {
            this.#pause();
        } else {
            this.#resume();
            queueMicrotask(() => this.#scanExistingContent());
        }
    }
    
    #pause() {
        this.#observer?.disconnect();
        
        // Clear all timeouts
        for (const timeoutId of this.#debounceTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.#debounceTimeouts.clear();
        
        // Abort all ongoing operations
        for (const controller of this.#abortControllers.values()) {
            controller.abort();
        }
        this.#abortControllers.clear();
    }
    
    #resume() {
        if (!this.#observer) {
            this.#init();
        } else {
            this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
        }
    }
    
    #handleInitError(error) {
        console.error('Initialization error:', error);
        // Implement fallback or recovery logic here
    }
    
    #handleProcessingError(error) {
        console.error('Processing error:', error);
        // Implement error recovery or notification
    }
    
    // PUBLIC API
    
    register(settings) {
        const id = settings.id ?? `callback_${Date.now()}_${crypto.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2)}`;
        
        const callback = {
            id,
            fn: settings.callback,
            priority: settings.priority ?? 'normal',
            selector: settings.selector,
            pageTypes: settings.pageTypes,
            dependencies: settings.dependencies,
            retryCount: 0,
            maxRetries: settings.maxRetries ?? 0,
            createdAt: performance.now()
        };
        
        this.#callbacks.set(id, callback);
        console.log(`📝 Registered callback: ${id} (priority: ${callback.priority})`);
        
        // Run on existing elements if scan is complete
        if (this.#initialScanComplete && callback.selector) {
            this.forceScan(callback.selector);
        }
        
        return id;
    }
    
    registerDebounced(settings) {
        const id = this.register(settings);
        
        this.#debouncedCallbacks.set(id, {
            callback: settings.callback,
            delay: settings.delay ?? ForumCoreObserver.#PERFORMANCE_CONFIG.debounceThreshold,
            lastRun: 0
        });
        
        return id;
    }
    
    unregister(callbackId) {
        let removed = false;
        
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
            console.log(`🗑️ Unregistered callback: ${callbackId}`);
        }
        
        return removed;
    }
    
    forceScan(selector) {
        if (!selector) {
            this.#scanExistingContent();
            return;
        }
        
        const nodes = document.querySelectorAll(selector);
        const uniqueNodes = Array.from(nodes)
            .filter(node => !this.#processedNodes.has(node));
        
        if (uniqueNodes.length > 0) {
            this.#processNodesWithConcurrency(uniqueNodes);
        }
    }
    
    getStats() {
        return {
            totalMutations: Number(this.#mutationMetrics.totalMutations),
            processedMutations: Number(this.#mutationMetrics.processedMutations),
            averageProcessingTime: this.#mutationMetrics.averageProcessingTime,
            longestProcessingTime: this.#mutationMetrics.longestProcessingTime,
            lastMutationTime: this.#mutationMetrics.lastMutationTime,
            callbackExecutions: this.#mutationMetrics.callbackExecutions,
            registeredCallbacks: this.#callbacks.size,
            debouncedCallbacks: this.#debouncedCallbacks.size,
            pendingTimeouts: this.#debounceTimeouts.size,
            processedNodes: this.#processedNodes.size,
            queueLength: this.#mutationQueue.length,
            isProcessing: this.#isProcessing,
            pageState: this.#pageState,
            performanceEntries: performance.getEntriesByType('measure').length,
            memory: typeof performance.memory !== 'undefined' ? {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize
            } : null
        };
    }
    
    destroy() {
        this.#pause();
        
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        if (this.#performanceObserver) {
            this.#performanceObserver.disconnect();
        }
        
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#mutationQueue.length = 0;
        this.#debounceTimeouts.clear();
        this.#abortControllers.clear();
        this.#selectorCache.clear();
        
        console.log('🛑 Enhanced Forum Core Observer destroyed');
    }
    
    isPostModernizerActive() {
        return {
            hasModernizer: !!globalThis.postModernizer,
            modernizedPosts: document.querySelectorAll('.post-modernized').length,
            modernizedQuotes: document.querySelectorAll('.modern-quote').length,
            modernizedProfiles: document.querySelectorAll('.modern-profile').length,
            isInitialized: this.#pageState.hasModernizedPosts || 
                         this.#pageState.hasModernizedQuotes || 
                         this.#pageState.hasModernizedProfile
        };
    }
    
    optimizeForPostModernizer() {
        const skipSelectors = [
            '.post-modernized',
            '.modern-quote',
            '.modern-profile',
            '.modern-nav',
            '.modern-breadcrumb',
            '.post-new-badge',
            '.quote-jump-btn',
            '.anchor-container'
        ];
        
        let skipped = 0;
        for (const selector of skipSelectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                this.#processedNodes.add(node);
                skipped++;
            }
        }
        
        console.log(`🔧 Optimized for Post Modernizer, skipped ${skipped} nodes`);
        return { skippedNodes: skipped };
    }
    
    // Static factory method
    static create() {
        return new ForumCoreObserver();
    }
}

// Modern initialization with proper error handling
if (!globalThis.forumObserver) {
    try {
        // Use queueMicrotask for deferred initialization
        queueMicrotask(() => {
            globalThis.forumObserver = ForumCoreObserver.create();
            
            // Add global helpers
            globalThis.registerForumScript = (settings) => 
                globalThis.forumObserver?.register(settings) ?? null;
            
            globalThis.registerDebouncedForumScript = (settings) => 
                globalThis.forumObserver?.registerDebounced(settings) ?? null;
            
            globalThis.getPostModernizerStats = () => 
                globalThis.forumObserver?.getStats()?.postModernizerStats ?? {};
            
            // Auto-cleanup
            globalThis.addEventListener('pagehide', () => {
                globalThis.forumObserver?.destroy();
                globalThis.forumObserver = null;
            }, { once: true });
            
            // Auto-optimize after a brief delay
            setTimeout(() => {
                globalThis.forumObserver?.optimizeForPostModernizer();
            }, 500);
            
            // Debug mode for development
            if (globalThis.location?.hostname.includes('localhost') || 
                globalThis.location?.hostname.includes('127.0.0.1') ||
                globalThis.location?.port) {
                globalThis.__FORUM_OBSERVER_DEBUG__ = globalThis.forumObserver;
                console.log('🔍 Forum Core Observer debug mode enabled');
            }
            
            console.log('🎯 Enhanced Forum Core Observer ready');
        });
        
    } catch (error) {
        console.error('Failed to initialize Enhanced Forum Core Observer:', error);
        
        // Modern fallback with Proxy
        globalThis.forumObserver = new Proxy({}, {
            get(target, prop) {
                const methods = ['register', 'registerDebounced', 'unregister', 'forceScan', 'getStats', 'destroy'];
                if (methods.includes(prop)) {
                    return () => console.warn(`Forum Observer not initialized - ${prop} called`);
                }
                return undefined;
            }
        });
    }
}
