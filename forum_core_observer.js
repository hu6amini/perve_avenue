class ForumCoreObserver {
    #observer = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    
    // Private fields for better encapsulation
    #callbacks = new Map();           // id -> callback config
    #debouncedCallbacks = new Map();  // id -> debounced config
    #pageState = this.#detectPageState();
    
    // Configuration with static getters
    static get #OBSERVER_OPTIONS() {
        return {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'data-*']
        };
    }
    
    static get #PERFORMANCE_CONFIG() {
        return {
            maxProcessingTime: 16,        // 60fps budget
            mutationBatchSize: 50,
            debounceThreshold: 100,
            idleCallbackTimeout: 2000,
            searchPageBatchSize: 10       // NEW: Special batch size for search pages
        };
    }
    
    static get #MEMORY_CONFIG() {
        return {
            maxProcessedNodes: 10000,
            cleanupInterval: 30000,
            nodeTTL: 300000
        };
    }
    
    #mutationMetrics = {
        totalMutations: 0n,
        processedMutations: 0n,
        averageProcessingTime: 0,
        lastMutationTime: 0
    };
    
    constructor() {
        this.#init();
    }
    
    #init() {
        // Create observer with private class field
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        
        // Observe entire document with modern options
        this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
        
        // Initial scan of existing content
        this.#scanExistingContent();
        
        // Setup periodic cleanup with private method
        this.#setupCleanup();
        
        // Use modern event listener with options
        document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { passive: true });
        
        // Use console.group for better debugging
        console.group('🚀 Enhanced Forum Core Observer');
        console.log('Initialized with Post Modernizer optimizations');
        console.log('Page state:', this.#pageState);
        console.groupEnd();
    }
    
    #detectPageState() {
        const { pathname } = window.location;
        const { className } = document.body;
        const theme = document.documentElement.dataset?.theme;
        
        // Use optional chaining and nullish coalescing
        const selectors = {
            forum: '.board, .big_list',
            topic: '.modern-topic-title, .post',
            blog: '#blog, .article',
            profile: '.modern-profile, .profile',
            search: '#search.posts, body#search',
            modernized: '.post-modernized'  // NEW: Track modernized content
        };
        
        const checks = Object.entries(selectors).map(([key, selector]) => 
            [key, document.querySelector(selector) ?? null]
        );
        
        const pageChecks = Object.fromEntries(checks);
        
        return {
            ...pageChecks,
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            hasModernizedPosts: !!pageChecks.modernized,  // NEW: Track modernized posts
            hasModernizedQuotes: !!document.querySelector('.modern-quote'),  // NEW
            hasModernizedProfile: !!document.querySelector('.modern-profile'),  // NEW
            hasModernizedNavigation: !!document.querySelector('.modern-nav'),  // NEW
            isDarkMode: theme === 'dark',
            isLoggedIn: !!document.querySelector('.menuwrap .avatar'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            pageId: crypto.randomUUID?.() ?? `page_${Date.now()}_${Math.random().toString(36).slice(2)}`
        };
    }
    
    #handleMutations(mutations) {
        this.#mutationMetrics.totalMutations++;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        // Filter mutations using modern array methods
        const validMutations = mutations.filter(mutation => 
            this.#shouldProcessMutation(mutation)
        );
        
        if (!validMutations.length) return;
        
        // Use spread operator with BigInt
        this.#mutationMetrics.totalMutations += BigInt(validMutations.length);
        
        // Add to queue
        this.#mutationQueue.push(...validMutations);
        
        // Start processing if idle
        if (!this.#isProcessing) {
            this.#processMutationQueue();
        }
    }
    
    #shouldProcessMutation(mutation) {
        // Skip mutations from our own scripts
        if (mutation.target.dataset?.observerOrigin === 'forum-script') {
            return false;
        }
        
        // NEW: Skip mutations in already modernized content
        if (this.#shouldSkipPostModernizerProcessing(mutation.target)) {
            return false;
        }
        
        // Skip invisible elements using optional chaining
        const style = mutation.target.nodeType === Node.ELEMENT_NODE 
            ? window.getComputedStyle(mutation.target)
            : null;
            
        if (style?.display === 'none' || style?.visibility === 'hidden') {
            return false;
        }
        
        // Skip irrelevant text changes
        if (mutation.type === 'characterData') {
            const parent = mutation.target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        // Skip non-critical style changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const oldValue = mutation.oldValue ?? '';
            const newValue = mutation.target.getAttribute('style') ?? '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        return true;
    }
    
    #shouldSkipPostModernizerProcessing(node) {
        // Skip nodes that are already modernized
        if (node.classList?.contains('post-modernized')) {
            return true;
        }
        
        // Skip nodes inside modernized posts
        if (node.closest('.post-modernized')) {
            return true;
        }
        
        // Skip nodes inside modern quotes
        if (node.closest('.modern-quote')) {
            return true;
        }
        
        // Skip nodes inside modern profiles
        if (node.closest('.modern-profile')) {
            return true;
        }
        
        // Skip modern navigation elements
        if (node.closest('.modern-nav, .modern-breadcrumb, .modern-topic-title')) {
            return true;
        }
        
        // Skip Post Modernizer-specific elements
        const modernizerElements = [
            '.post-new-badge', '.quote-jump-btn', '.anchor-container',
            '.modern-bottom-actions', '.multiquote-control',
            '.moderator-controls', '.ip-address-control'
        ];
        
        for (const selector of modernizerElements) {
            if (node.matches?.(selector) || node.closest?.(selector)) {
                return true;
            }
        }
        
        return false;
    }
    
    #shouldObserveTextChanges(element) {
        const tagName = element.tagName.toLowerCase();
        const interactiveTags = new Set(['a', 'button', 'input', 'textarea', 'select']);
        const forumContentClasses = new Set(['post', 'article', 'comment', 'quote', 'signature', 'post-text']);
        
        if (interactiveTags.has(tagName)) return true;
        
        // Check if any forum content class exists
        return Array.from(element.classList).some(cls => 
            forumContentClasses.has(cls)
        );
    }
    
    #styleChangeAffectsDOM(oldStyle, newStyle) {
        const visibilityProps = new Set(['display', 'visibility', 'opacity', 'position', 'width', 'height']);
        const oldProps = this.#parseStyleString(oldStyle);
        const newProps = this.#parseStyleString(newStyle);
        
        return Array.from(visibilityProps).some(prop => 
            oldProps[prop] !== newProps[prop]
        );
    }
    
    #parseStyleString(styleString) {
        if (!styleString) return new Map();
        
        const pairs = styleString.split(';')
            .map(part => part.split(':').map(s => s.trim()))
            .filter(([key, value]) => key && value);
            
        return new Map(pairs);
    }
    
    async #processMutationQueue() {
        this.#isProcessing = true;
        const startTime = performance.now();
        
        try {
            while (this.#mutationQueue.length) {
                // NEW: Special handling for search pages
                if (this.#pageState.isSearch && this.#mutationQueue.length > 10) {
                    await this.#processSearchPageBatch();
                    continue;
                }
                
                const batch = this.#mutationQueue.splice(0, ForumCoreObserver.#PERFORMANCE_CONFIG.mutationBatchSize);
                await this.#processMutationBatch(batch);
                
                // Yield to main thread if taking too long
                if (performance.now() - startTime > ForumCoreObserver.#PERFORMANCE_CONFIG.maxProcessingTime) {
                    await new Promise(resolve => queueMicrotask(resolve));
                }
            }
        } catch (error) {
            console.error('Mutation processing error:', error);
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
            // Update metrics with exponential moving average
            const processingTime = performance.now() - startTime;
            this.#mutationMetrics.averageProcessingTime = 
                this.#mutationMetrics.averageProcessingTime * 0.9 + processingTime * 0.1;
        }
    }
    
    async #processMutationBatch(mutations) {
        const affectedNodes = new Set();
        
        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'childList':
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, affectedNodes);
                        }
                    });
                    break;
                    
                case 'attributes':
                    affectedNodes.add(mutation.target);
                    break;
                    
                case 'characterData':
                    affectedNodes.add(mutation.target.parentElement);
                    break;
            }
        }
        
        // NEW: Special handling for search page posts
        if (this.#pageState.isSearch) {
            const searchPosts = Array.from(affectedNodes).filter(node => 
                node.classList?.contains('post') && 
                node.closest('body#search')
            );
            
            if (searchPosts.length > 5) {
                await this.#processSearchPostsBatch(searchPosts);
                
                // Remove processed search posts from affectedNodes
                searchPosts.forEach(post => affectedNodes.delete(post));
            }
        }
        
        // Process remaining nodes in parallel with concurrency limit
        const nodeArray = Array.from(affectedNodes).filter(node => 
            node && !this.#processedNodes.has(node)
        );
        
        const CONCURRENCY_LIMIT = 4;
        const chunks = [];
        
        for (let i = 0; i < nodeArray.length; i += CONCURRENCY_LIMIT) {
            chunks.push(nodeArray.slice(i, i + CONCURRENCY_LIMIT));
        }
        
        for (const chunk of chunks) {
            await Promise.allSettled(
                chunk.map(node => this.#processNode(node))
            );
        }
    }
    
    async #processSearchPageBatch() {
        const batchSize = ForumCoreObserver.#PERFORMANCE_CONFIG.searchPageBatchSize;
        const batch = this.#mutationQueue.splice(0, batchSize);
        
        console.log(`🔍 Processing search page batch: ${batch.length} mutations`);
        
        // Group mutations by type for efficient processing
        const addedNodes = new Set();
        const attributeNodes = new Set();
        const textNodes = new Set();
        
        for (const mutation of batch) {
            switch (mutation.type) {
                case 'childList':
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, addedNodes);
                        }
                    });
                    break;
                    
                case 'attributes':
                    attributeNodes.add(mutation.target);
                    break;
                    
                case 'characterData':
                    textNodes.add(mutation.target.parentElement);
                    break;
            }
        }
        
        // Process search posts first (higher priority)
        const searchPosts = Array.from(addedNodes).filter(node => 
            node.classList?.contains('post') && node.closest('body#search')
        );
        
        if (searchPosts.length > 0) {
            await this.#processSearchPostsBatch(searchPosts);
        }
        
        // Process other elements
        const otherNodes = new Set([
            ...Array.from(addedNodes).filter(node => !searchPosts.includes(node)),
            ...attributeNodes,
            ...textNodes
        ]);
        
        await this.#processNodeBatch(Array.from(otherNodes));
    }
    
    async #processSearchPostsBatch(posts) {
        console.log(`📋 Processing ${posts.length} search posts in batch`);
        
        // Process posts in smaller chunks to avoid blocking
        const CHUNK_SIZE = 3;
        for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
            const chunk = posts.slice(i, i + CHUNK_SIZE);
            
            await Promise.allSettled(
                chunk.map(post => {
                    if (!this.#processedNodes.has(post)) {
                        return this.#processNode(post);
                    }
                    return Promise.resolve();
                })
            );
            
            // Yield to main thread between chunks
            if (i + CHUNK_SIZE < posts.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
    
    async #processNodeBatch(nodes) {
        const CONCURRENCY_LIMIT = 4;
        const chunks = [];
        
        for (let i = 0; i < nodes.length; i += CONCURRENCY_LIMIT) {
            chunks.push(nodes.slice(i, i + CONCURRENCY_LIMIT));
        }
        
        for (const chunk of chunks) {
            await Promise.allSettled(
                chunk.map(node => this.#processNode(node))
            );
        }
    }
    
    #collectAllElements(root, collection) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        
        collection.add(root);
        
        // Use for...of for performance
        for (const child of root.children) {
            this.#collectAllElements(child, collection);
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        const matchingCallbacks = this.#getMatchingCallbacks(node);
        if (!matchingCallbacks.length) return;
        
        // Group by priority using Map
        const priorityGroups = new Map([
            ['critical', []],
            ['high', []],
            ['normal', []],
            ['low', []]
        ]);
        
        matchingCallbacks.forEach(callback => {
            const priority = callback.priority ?? 'normal';
            priorityGroups.get(priority)?.push(callback);
        });
        
        // Execute in priority order
        for (const [priority, callbacks] of priorityGroups) {
            if (!callbacks?.length) continue;
            
            if (priority === 'critical') {
                await this.#executeCallbacks(callbacks, node);
            } else {
                this.#deferCallbacks(callbacks, node, priority);
            }
        }
        
        this.#processedNodes.add(node);
    }
    
    #getMatchingCallbacks(node) {
        const matching = [];
        
        for (const callback of this.#callbacks.values()) {
            // Check page type restrictions
            if (callback.pageTypes?.length) {
                const hasMatchingPageType = callback.pageTypes.some(type => {
                    const stateKey = `is${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    return this.#pageState[stateKey];
                });
                if (!hasMatchingPageType) continue;
            }
            
            // NEW: Special handling for quote links
            if (callback.id?.includes('quote-link') || callback.id?.includes('anchor')) {
                const isQuoteLink = node.matches?.('.quote-link, .quote_top a[href*="#entry"]');
                if (!isQuoteLink) {
                    const hasQuoteLink = node.querySelector?.('.quote-link, .quote_top a[href*="#entry"]');
                    if (!hasQuoteLink) continue;
                }
            }
            
            // Check dependencies
            if (callback.dependencies?.length) {
                const unmetDeps = callback.dependencies.filter(dep => {
                    if (typeof dep === 'string') return !document.querySelector(dep);
                    if (typeof dep === 'function') return !dep();
                    return true;
                });
                if (unmetDeps.length) continue;
            }
            
            // Check selector match
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
        const promises = callbacks.map(async callback => {
            try {
                await callback.fn(node);
            } catch (error) {
                console.error(`Callback ${callback.id} failed:`, error);
                
                // Retry logic with exponential backoff
                if (callback.retryCount < (callback.maxRetries ?? 0)) {
                    callback.retryCount = (callback.retryCount ?? 0) + 1;
                    const delay = 100 * Math.pow(2, callback.retryCount - 1);
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.#executeCallbacks([callback], node);
                }
            }
        });
        
        await Promise.allSettled(promises);
    }
    
    #deferCallbacks(callbacks, node, priority) {
        const delays = new Map([
            ['high', 50],
            ['normal', 100],
            ['low', 500]
        ]);
        
        const delay = delays.get(priority) ?? 100;
        
        // Use scheduler API if available
        if (scheduler?.postTask) {
            scheduler.postTask(() => 
                this.#executeCallbacks(callbacks, node), 
                { priority: 'user-visible', delay }
            );
        } else if (window.requestIdleCallback) {
            requestIdleCallback(() => 
                this.#executeCallbacks(callbacks, node),
                { timeout: delay }
            );
        } else {
            setTimeout(() => 
                this.#executeCallbacks(callbacks, node),
                delay
            );
        }
    }
    
    #scanExistingContent() {
        const forumSelectors = [
            '.post', '.article', '.btn', '.forminput', '.points_up', '.points_down',
            '.st-emoji-container', '.modern-quote', '.modern-profile', '.modern-topic-title',
            '.menu', '.tabs', '.code', '.spoiler', '.poll', '.tag li', '.online .thumbs a',
            '.profile-avatar', '.breadcrumb-item', '.page-number',
            // NEW: Post Modernizer elements
            '.post-modernized', '.modern-quote', '.modern-profile', '.modern-topic-title',
            '.modern-breadcrumb', '.modern-nav', '.post-new-badge', '.quote-jump-btn',
            '.anchor-container', '.modern-bottom-actions', '.multiquote-control',
            '.moderator-controls', '.ip-address-control', '.search-post',
            '.post-actions', '.user-info', '.post-content', '.post-footer'
        ];
        
        const root = document.documentElement;
        const observer = new MutationObserver((mutations, obs) => {
            for (const selector of forumSelectors) {
                root.querySelectorAll(selector).forEach(node => {
                    if (!this.#processedNodes.has(node)) {
                        this.#processNode(node);
                    }
                });
            }
            obs.disconnect();
        });
        
        observer.observe(root, { childList: true, subtree: true });
        
        // Force immediate check
        forumSelectors.forEach(selector => {
            root.querySelectorAll(selector).forEach(node => {
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            });
        });
        
        this.#initialScanComplete = true;
        console.log('✅ Initial content scan complete');
        console.log(`📊 Found: ${document.querySelectorAll('.post-modernized').length} modernized posts`);
        console.log(`📊 Found: ${document.querySelectorAll('.modern-quote').length} modern quotes`);
    }
    
    #setupCleanup() {
        const intervalId = setInterval(() => {
            if (this.#processedNodes.size > ForumCoreObserver.#MEMORY_CONFIG.maxProcessedNodes) {
                console.warn('Processed nodes approaching limit');
                
                // Clear processed nodes if getting too large
                if (this.#processedNodes.size > ForumCoreObserver.#MEMORY_CONFIG.maxProcessedNodes * 1.5) {
                    console.warn('Clearing processed nodes cache');
                    this.#processedNodes = new WeakSet();
                }
            }
            
            // Force GC if available
            globalThis.gc?.();
        }, ForumCoreObserver.#MEMORY_CONFIG.cleanupInterval);
        
        // Store interval ID for cleanup
        this.#cleanupIntervalId = intervalId;
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
    }
    
    #resume() {
        if (!this.#observer) {
            this.#init();
        } else {
            this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
        }
    }
    
    // PUBLIC API with modern methods
    
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
        
        // Run on existing elements
        if (this.#initialScanComplete && callback.selector) {
            const nodes = document.querySelectorAll(callback.selector);
            nodes.forEach(node => {
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            });
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
    
    // Utility methods
    
    forceScan(selector) {
        if (!selector) {
            this.#scanExistingContent();
            return;
        }
        
        const nodes = document.querySelectorAll(selector);
        nodes.forEach(node => {
            if (!this.#processedNodes.has(node)) {
                this.#processNode(node);
            }
        });
    }
    
    getStats() {
        return {
            totalMutations: Number(this.#mutationMetrics.totalMutations),
            processedMutations: Number(this.#mutationMetrics.processedMutations),
            averageProcessingTime: this.#mutationMetrics.averageProcessingTime,
            lastMutationTime: this.#mutationMetrics.lastMutationTime,
            registeredCallbacks: this.#callbacks.size,
            debouncedCallbacks: this.#debouncedCallbacks.size,
            pendingTimeouts: this.#debounceTimeouts.size,
            processedNodes: this.#processedNodes.size,
            pageState: this.#pageState,
            isProcessing: this.#isProcessing,
            queueLength: this.#mutationQueue.length,
            // NEW: Post Modernizer specific stats
            postModernizerStats: {
                modernizedPosts: document.querySelectorAll('.post-modernized').length,
                modernQuotes: document.querySelectorAll('.modern-quote').length,
                modernProfiles: document.querySelectorAll('.modern-profile').length,
                modernNavigation: document.querySelectorAll('.modern-nav, .modern-breadcrumb, .modern-topic-title').length,
                anchorContainers: document.querySelectorAll('.anchor-container').length,
                quoteJumpButtons: document.querySelectorAll('.quote-jump-btn').length,
                postNewBadges: document.querySelectorAll('.post-new-badge').length,
                modernizedElements: document.querySelectorAll('[class*="modern-"], [class*="-modernized"]').length
            }
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
        
        console.log('🛑 Enhanced Forum Core Observer destroyed');
    }
    
    // NEW: Method to check if Post Modernizer is active
    isPostModernizerActive() {
        return {
            hasModernizer: !!globalThis.postModernizer,
            modernizedPosts: document.querySelectorAll('.post-modernized').length,
            modernizedQuotes: document.querySelectorAll('.modern-quote').length,
            isInitialized: this.#pageState.hasModernizedPosts || this.#pageState.hasModernizedQuotes
        };
    }
    
    // NEW: Method to optimize for Post Modernizer
    optimizeForPostModernizer() {
        console.log('🔧 Optimizing for Post Modernizer');
        
        // Skip already modernized content
        const skipSelectors = [
            '.post-modernized',
            '.modern-quote',
            '.modern-profile',
            '.modern-nav',
            '.modern-breadcrumb'
        ];
        
        skipSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(node => {
                this.#processedNodes.add(node);
            });
        });
        
        return {
            skippedNodes: skipSelectors.reduce((total, selector) => 
                total + document.querySelectorAll(selector).length, 0
            ),
            message: 'Post Modernizer optimization applied'
        };
    }
    
    // Static factory method
    static create() {
        return new ForumCoreObserver();
    }
}

// Modern initialization with globalThis
if (!globalThis.forumObserver) {
    try {
        globalThis.forumObserver = ForumCoreObserver.create();
        
        // Add global helper with proper error handling
        globalThis.registerForumScript = (settings) => {
            return globalThis.forumObserver?.register(settings) ?? null;
        };
        
        globalThis.registerDebouncedForumScript = (settings) => {
            return globalThis.forumObserver?.registerDebounced(settings) ?? null;
        };
        
        // NEW: Add Post Modernizer helper
        globalThis.getPostModernizerStats = () => {
            return globalThis.forumObserver?.getStats().postModernizerStats ?? {};
        };
        
        // Auto-cleanup with modern event
        globalThis.addEventListener('pagehide', () => {
            globalThis.forumObserver?.destroy();
        }, { once: true });
        
        // Auto-optimize for Post Modernizer after initialization
        setTimeout(() => {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.optimizeForPostModernizer();
            }
        }, 1000);
        
        // Export for debugging in development
        if (globalThis.location?.hostname === 'localhost' || 
            globalThis.location?.hostname === '127.0.0.1' ||
            globalThis.location?.hostname.startsWith('192.168.') ||
            globalThis.location?.port) {
            globalThis.__FORUM_OBSERVER_DEBUG__ = globalThis.forumObserver;
            console.log('🔍 Forum Core Observer debug mode enabled');
        }
        
        console.log('🎯 Enhanced Forum Core Observer ready');
        console.log('🚀 Post Modernizer optimizations active');
        
    } catch (error) {
        console.error('Failed to initialize Enhanced Forum Core Observer:', error);
        
        // Modern fallback with Proxy
        globalThis.forumObserver = new Proxy({}, {
            get(target, prop) {
                const methods = ['register', 'registerDebounced', 'unregister', 'forceScan', 'getStats', 'destroy', 'optimizeForPostModernizer'];
                if (methods.includes(prop)) {
                    return () => console.warn(`Enhanced Forum Observer not initialized - ${prop} called`);
                }
                return undefined;
            }
        });
    }
}
