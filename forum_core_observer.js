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
            maxProcessingTime: 16,
            mutationBatchSize: 50,
            debounceThreshold: 100,
            idleCallbackTimeout: 2000,
            searchPageBatchSize: 10
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
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
        this.#scanExistingContent();
        this.#setupCleanup();
        
        document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { passive: true });
        
        console.group('Enhanced Forum Core Observer');
        console.log('Initialized with Post Modernizer optimizations');
        console.log('Page state: ' + JSON.stringify(this.#pageState));
        console.groupEnd();
    }
    
    #detectPageState() {
        const pathname = window.location.pathname;
        const className = document.body.className;
        const theme = document.documentElement.dataset?.theme;
        
        const selectors = {
            forum: '.board, .big_list',
            topic: '.modern-topic-title, .post',
            blog: '#blog, .article',
            profile: '.modern-profile, .profile',
            search: '#search.posts, body#search',
            modernized: '.post-modernized'
        };
        
        const pageChecks = {};
        for (const [key, selector] of Object.entries(selectors)) {
            pageChecks[key] = document.querySelector(selector) ?? null;
        }
        
        return {
            ...pageChecks,
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            hasModernizedPosts: !!pageChecks.modernized,
            hasModernizedQuotes: !!document.querySelector('.modern-quote'),
            hasModernizedProfile: !!document.querySelector('.modern-profile'),
            hasModernizedNavigation: !!document.querySelector('.modern-nav'),
            isDarkMode: theme === 'dark',
            isLoggedIn: !!document.querySelector('.menuwrap .avatar'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            pageId: crypto.randomUUID?.() ?? 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2)
        };
    }
    
    #handleMutations(mutations) {
        this.#mutationMetrics.totalMutations++;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        const validMutations = [];
        for (const mutation of mutations) {
            if (this.#shouldProcessMutation(mutation)) {
                validMutations.push(mutation);
            }
        }
        
        if (!validMutations.length) return;
        
        this.#mutationMetrics.totalMutations += BigInt(validMutations.length);
        this.#mutationQueue.push(...validMutations);
        
        if (!this.#isProcessing) {
            this.#processMutationQueue();
        }
    }
    
    #shouldProcessMutation(mutation) {
        if (mutation.target.dataset?.observerOrigin === 'forum-script') {
            return false;
        }
        
        if (this.#shouldSkipPostModernizerProcessing(mutation.target)) {
            return false;
        }
        
        if (mutation.target.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(mutation.target);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        
        if (mutation.type === 'characterData') {
            const parent = mutation.target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const oldValue = mutation.oldValue ?? '';
            const newValue = mutation.target.getAttribute('style') ?? '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        return true;
    }
    
    #shouldSkipPostModernizerProcessing(node) {
        if (node.classList?.contains('post-modernized')) {
            return true;
        }
        
        if (node.closest('.post-modernized')) {
            return true;
        }
        
        if (node.closest('.modern-quote')) {
            return true;
        }
        
        if (node.closest('.modern-profile')) {
            return true;
        }
        
        if (node.closest('.modern-nav, .modern-breadcrumb, .modern-topic-title')) {
            return true;
        }
        
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
        
        const elementClasses = Array.from(element.classList);
        for (const cls of elementClasses) {
            if (forumContentClasses.has(cls)) {
                return true;
            }
        }
        
        return false;
    }
    
    #styleChangeAffectsDOM(oldStyle, newStyle) {
        const visibilityProps = new Set(['display', 'visibility', 'opacity', 'position', 'width', 'height']);
        const oldProps = this.#parseStyleString(oldStyle);
        const newProps = this.#parseStyleString(newStyle);
        
        for (const prop of visibilityProps) {
            if (oldProps.get(prop) !== newProps.get(prop)) {
                return true;
            }
        }
        
        return false;
    }
    
    #parseStyleString(styleString) {
        if (!styleString) return new Map();
        
        const result = new Map();
        const pairs = styleString.split(';');
        
        for (const pair of pairs) {
            const [key, value] = pair.split(':').map(s => s.trim());
            if (key && value) {
                result.set(key, value);
            }
        }
        
        return result;
    }
    
    async #processMutationQueue() {
        this.#isProcessing = true;
        const startTime = performance.now();
        
        try {
            while (this.#mutationQueue.length) {
                if (this.#pageState.isSearch && this.#mutationQueue.length > 10) {
                    await this.#processSearchPageBatch();
                    continue;
                }
                
                const batchSize = ForumCoreObserver.#PERFORMANCE_CONFIG.mutationBatchSize;
                const batch = this.#mutationQueue.splice(0, batchSize);
                await this.#processMutationBatch(batch);
                
                if (performance.now() - startTime > ForumCoreObserver.#PERFORMANCE_CONFIG.maxProcessingTime) {
                    await new Promise(resolve => queueMicrotask(resolve));
                }
            }
        } catch (error) {
            console.error('Mutation processing error: ' + error);
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
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
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, affectedNodes);
                        }
                    }
                    break;
                    
                case 'attributes':
                    affectedNodes.add(mutation.target);
                    break;
                    
                case 'characterData':
                    affectedNodes.add(mutation.target.parentElement);
                    break;
            }
        }
        
        if (this.#pageState.isSearch) {
            const searchPosts = [];
            for (const node of affectedNodes) {
                if (node.classList?.contains('post') && node.closest('body#search')) {
                    searchPosts.push(node);
                }
            }
            
            if (searchPosts.length > 5) {
                await this.#processSearchPostsBatch(searchPosts);
                
                for (const post of searchPosts) {
                    affectedNodes.delete(post);
                }
            }
        }
        
        const nodeArray = [];
        for (const node of affectedNodes) {
            if (node && !this.#processedNodes.has(node)) {
                nodeArray.push(node);
            }
        }
        
        const CONCURRENCY_LIMIT = 4;
        const chunks = [];
        
        for (let i = 0; i < nodeArray.length; i += CONCURRENCY_LIMIT) {
            chunks.push(nodeArray.slice(i, i + CONCURRENCY_LIMIT));
        }
        
        for (const chunk of chunks) {
            const promises = chunk.map(node => this.#processNode(node));
            await Promise.allSettled(promises);
        }
    }
    
    async #processSearchPageBatch() {
        const batchSize = ForumCoreObserver.#PERFORMANCE_CONFIG.searchPageBatchSize;
        const batch = this.#mutationQueue.splice(0, batchSize);
        
        console.log('Processing search page batch: ' + batch.length + ' mutations');
        
        const addedNodes = new Set();
        const attributeNodes = new Set();
        const textNodes = new Set();
        
        for (const mutation of batch) {
            switch (mutation.type) {
                case 'childList':
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, addedNodes);
                        }
                    }
                    break;
                    
                case 'attributes':
                    attributeNodes.add(mutation.target);
                    break;
                    
                case 'characterData':
                    textNodes.add(mutation.target.parentElement);
                    break;
            }
        }
        
        const searchPosts = [];
        for (const node of addedNodes) {
            if (node.classList?.contains('post') && node.closest('body#search')) {
                searchPosts.push(node);
            }
        }
        
        if (searchPosts.length > 0) {
            await this.#processSearchPostsBatch(searchPosts);
        }
        
        const otherNodes = new Set();
        for (const node of addedNodes) {
            if (!searchPosts.includes(node)) {
                otherNodes.add(node);
            }
        }
        for (const node of attributeNodes) otherNodes.add(node);
        for (const node of textNodes) otherNodes.add(node);
        
        await this.#processNodeBatch(Array.from(otherNodes));
    }
    
    async #processSearchPostsBatch(posts) {
        console.log('Processing ' + posts.length + ' search posts in batch');
        
        const CHUNK_SIZE = 3;
        for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
            const chunk = posts.slice(i, i + CHUNK_SIZE);
            const promises = [];
            
            for (const post of chunk) {
                if (!this.#processedNodes.has(post)) {
                    promises.push(this.#processNode(post));
                }
            }
            
            await Promise.allSettled(promises);
            
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
            const promises = chunk.map(node => this.#processNode(node));
            await Promise.allSettled(promises);
        }
    }
    
    #collectAllElements(root, collection) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        
        collection.add(root);
        
        for (const child of root.children) {
            this.#collectAllElements(child, collection);
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        const matchingCallbacks = this.#getMatchingCallbacks(node);
        if (!matchingCallbacks.length) return;
        
        const priorityGroups = new Map([
            ['critical', []],
            ['high', []],
            ['normal', []],
            ['low', []]
        ]);
        
        for (const callback of matchingCallbacks) {
            const priority = callback.priority ?? 'normal';
            const group = priorityGroups.get(priority);
            if (group) {
                group.push(callback);
            }
        }
        
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
            if (callback.pageTypes?.length) {
                let hasMatchingPageType = false;
                for (const type of callback.pageTypes) {
                    const stateKey = 'is' + type.charAt(0).toUpperCase() + type.slice(1);
                    if (this.#pageState[stateKey]) {
                        hasMatchingPageType = true;
                        break;
                    }
                }
                if (!hasMatchingPageType) continue;
            }
            
            if (callback.id?.includes('quote-link') || callback.id?.includes('anchor')) {
                const isQuoteLink = node.matches?.('.quote-link, .quote_top a[href*="#entry"]');
                if (!isQuoteLink) {
                    const hasQuoteLink = node.querySelector?.('.quote-link, .quote_top a[href*="#entry"]');
                    if (!hasQuoteLink) continue;
                }
            }
            
            if (callback.dependencies?.length) {
                const unmetDeps = [];
                for (const dep of callback.dependencies) {
                    if (typeof dep === 'string' && !document.querySelector(dep)) {
                        unmetDeps.push(dep);
                    } else if (typeof dep === 'function' && !dep()) {
                        unmetDeps.push(dep);
                    }
                }
                if (unmetDeps.length) continue;
            }
            
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
                console.error('Callback ' + callback.id + ' failed: ' + error);
                
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
            '.post-modernized', '.modern-quote', '.modern-profile', '.modern-topic-title',
            '.modern-breadcrumb', '.modern-nav', '.post-new-badge', '.quote-jump-btn',
            '.anchor-container', '.modern-bottom-actions', '.multiquote-control',
            '.moderator-controls', '.ip-address-control', '.search-post',
            '.post-actions', '.user-info', '.post-content', '.post-footer'
        ];
        
        const root = document.documentElement;
        const observer = new MutationObserver((mutations, obs) => {
            for (const selector of forumSelectors) {
                const nodes = root.querySelectorAll(selector);
                for (const node of nodes) {
                    if (!this.#processedNodes.has(node)) {
                        this.#processNode(node);
                    }
                }
            }
            obs.disconnect();
        });
        
        observer.observe(root, { childList: true, subtree: true });
        
        for (const selector of forumSelectors) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            }
        }
        
        this.#initialScanComplete = true;
        console.log('Initial content scan complete');
        console.log('Found: ' + document.querySelectorAll('.post-modernized').length + ' modernized posts');
        console.log('Found: ' + document.querySelectorAll('.modern-quote').length + ' modern quotes');
    }
    
    #setupCleanup() {
        const intervalId = setInterval(() => {
            if (this.#processedNodes.size > ForumCoreObserver.#MEMORY_CONFIG.maxProcessedNodes) {
                console.warn('Processed nodes approaching limit');
                
                if (this.#processedNodes.size > ForumCoreObserver.#MEMORY_CONFIG.maxProcessedNodes * 1.5) {
                    console.warn('Clearing processed nodes cache');
                    this.#processedNodes = new WeakSet();
                }
            }
            
            globalThis.gc?.();
        }, ForumCoreObserver.#MEMORY_CONFIG.cleanupInterval);
        
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
    
    register(settings) {
        const id = settings.id ?? 'callback_' + Date.now() + '_' + 
            (crypto.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2));
        
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
        console.log('Registered callback: ' + id + ' (priority: ' + callback.priority + ')');
        
        if (this.#initialScanComplete && callback.selector) {
            const nodes = document.querySelectorAll(callback.selector);
            for (const node of nodes) {
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node);
                }
            }
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
            console.log('Unregistered callback: ' + callbackId);
        }
        
        return removed;
    }
    
    forceScan(selector) {
        if (!selector) {
            this.#scanExistingContent();
            return;
        }
        
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
            if (!this.#processedNodes.has(node)) {
                this.#processNode(node);
            }
        }
    }
    
    getStats() {
        const modernizedPosts = document.querySelectorAll('.post-modernized').length;
        const modernQuotes = document.querySelectorAll('.modern-quote').length;
        const modernProfiles = document.querySelectorAll('.modern-profile').length;
        const modernNavigation = document.querySelectorAll('.modern-nav, .modern-breadcrumb, .modern-topic-title').length;
        const anchorContainers = document.querySelectorAll('.anchor-container').length;
        const quoteJumpButtons = document.querySelectorAll('.quote-jump-btn').length;
        const postNewBadges = document.querySelectorAll('.post-new-badge').length;
        const modernizedElements = document.querySelectorAll('[class*="modern-"], [class*="-modernized"]').length;
        
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
            postModernizerStats: {
                modernizedPosts,
                modernQuotes,
                modernProfiles,
                modernNavigation,
                anchorContainers,
                quoteJumpButtons,
                postNewBadges,
                modernizedElements
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
        
        console.log('Enhanced Forum Core Observer destroyed');
    }
    
    isPostModernizerActive() {
        return {
            hasModernizer: !!globalThis.postModernizer,
            modernizedPosts: document.querySelectorAll('.post-modernized').length,
            modernizedQuotes: document.querySelectorAll('.modern-quote').length,
            isInitialized: this.#pageState.hasModernizedPosts || this.#pageState.hasModernizedQuotes
        };
    }
    
    optimizeForPostModernizer() {
        console.log('Optimizing for Post Modernizer');
        
        const skipSelectors = [
            '.post-modernized',
            '.modern-quote',
            '.modern-profile',
            '.modern-nav',
            '.modern-breadcrumb'
        ];
        
        let skippedTotal = 0;
        for (const selector of skipSelectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                this.#processedNodes.add(node);
            }
            skippedTotal += nodes.length;
        }
        
        return {
            skippedNodes: skippedTotal,
            message: 'Post Modernizer optimization applied'
        };
    }
    
    static create() {
        return new ForumCoreObserver();
    }
}

if (!globalThis.forumObserver) {
    try {
        globalThis.forumObserver = ForumCoreObserver.create();
        
        globalThis.registerForumScript = (settings) => {
            return globalThis.forumObserver?.register(settings) ?? null;
        };
        
        globalThis.registerDebouncedForumScript = (settings) => {
            return globalThis.forumObserver?.registerDebounced(settings) ?? null;
        };
        
        globalThis.getPostModernizerStats = () => {
            return globalThis.forumObserver?.getStats().postModernizerStats ?? {};
        };
        
        globalThis.addEventListener('pagehide', () => {
            globalThis.forumObserver?.destroy();
        }, { once: true });
        
        setTimeout(() => {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.optimizeForPostModernizer();
            }
        }, 1000);
        
        const hostname = globalThis.location?.hostname;
        if (hostname === 'localhost' || 
            hostname === '127.0.0.1' ||
            hostname?.startsWith('192.168.') ||
            globalThis.location?.port) {
            globalThis.__FORUM_OBSERVER_DEBUG__ = globalThis.forumObserver;
            console.log('Forum Core Observer debug mode enabled');
        }
        
        console.log('Enhanced Forum Core Observer ready');
        console.log('Post Modernizer optimizations active');
        
    } catch (error) {
        console.error('Failed to initialize Enhanced Forum Core Observer: ' + error);
        
        globalThis.forumObserver = new Proxy({}, {
            get(target, prop) {
                const methods = ['register', 'registerDebounced', 'unregister', 'forceScan', 'getStats', 'destroy', 'optimizeForPostModernizer'];
                if (methods.includes(prop)) {
                    return () => console.warn('Enhanced Forum Observer not initialized - ' + prop + ' called');
                }
                return undefined;
            }
        });
    }
}
