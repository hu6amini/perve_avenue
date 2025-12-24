'use strict';

/**
 * 🛡️ Ultra-Robust ForumCoreObserver v3.0
 * Comprehensive DOM mutation observer with multiple fallback strategies
 * Handles Shadow DOM, iframes, rapid mutations, and edge cases
 */
class ForumCoreObserver {
    #observer = null;
    #backupObserver = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    #shadowObservers = new WeakMap();
    #iframeObservers = new WeakMap();
    #periodicScannerId = null;
    #intersectionObservers = new Map();
    
    #callbacks = new Map();
    #debouncedCallbacks = new Map();
    #pageState = this.#detectPageState();
    #performanceStats = new Map();
    
    // Comprehensive configuration
    static #CONFIG = {
        observer: {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'src', 'href', 'value', 'alt', 'title', 'data-*'],
            attributeOldValue: true,
            characterDataOldValue: true
        },
        backupObserver: {
            childList: true,
            subtree: false, // Root level only for backup
            attributes: false,
            characterData: false
        },
        performance: {
            maxProcessingTime: 10, // ms per batch
            mutationBatchSize: 30,
            debounceThreshold: 50,
            idleCallbackTimeout: 1000,
            searchPageBatchSize: 10,
            maxQueueSize: 1000,
            queueOverflowStrategy: 'sample' // 'sample', 'clear', or 'throttle'
        },
        memory: {
            maxProcessedNodes: 15000,
            cleanupInterval: 30000,
            nodeTTL: 300000,
            maxShadowObservers: 50,
            maxIframeObservers: 20
        },
        redundancy: {
            periodicScanInterval: 30000,
            fullRescanInterval: 120000,
            intersectionThreshold: 0.01,
            intersectionRootMargin: '500px',
            backupObservation: true,
            iframeObservation: true,
            shadowDOMPolyfill: true
        },
        resilience: {
            maxRetries: 3,
            retryDelay: 100,
            errorThreshold: 10,
            recoveryAttempts: 5,
            fallbackToPolling: true,
            pollingInterval: 5000
        }
    };
    
    #mutationMetrics = {
        totalMutations: 0,
        processedMutations: 0,
        droppedMutations: 0,
        averageProcessingTime: 0,
        lastMutationTime: 0,
        queueOverflows: 0,
        shadowObservations: 0,
        iframeObservations: 0,
        periodicScans: 0,
        errors: 0,
        retries: 0
    };
    
    #errorTracker = {
        recentErrors: [],
        errorCount: 0,
        lastErrorTime: 0,
        recoveryMode: false
    };
    
    constructor() {
        this.#init();
    }
    
    #init() {
        try {
            // Primary observer
            this.#observer = new MutationObserver(this.#handleMutations.bind(this));
            this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
            
            // Backup observer for root-level changes
            if (ForumCoreObserver.#CONFIG.redundancy.backupObservation) {
                this.#backupObserver = new MutationObserver(this.#handleBackupMutations.bind(this));
                this.#backupObserver.observe(document.body, ForumCoreObserver.#CONFIG.backupObserver);
            }
            
            // Setup redundancy systems
            this.#setupRedundancySystems();
            
            // Initial scan with progressive enhancement
            this.#scanExistingContent();
            
            // Setup cleanup and monitoring
            this.#setupCleanup();
            this.#setupPerformanceMonitoring();
            
            // Setup event listeners
            this.#setupEventListeners();
            
            // Start periodic scanning
            this.#startPeriodicScanning();
            
            // Initialize intersection observer for lazy content
            this.#setupIntersectionObserver();
            
            console.log('🔍 ForumCoreObserver v3.0 initialized with redundancy systems');
            
        } catch (error) {
            console.error('Failed to initialize primary observer:', error);
            this.#activateFallbackMode();
        }
    }
    
    #setupRedundancySystems() {
        // Monitor Shadow DOM hosts
        this.#setupShadowDOMObservation();
        
        // Monitor iframes
        if (ForumCoreObserver.#CONFIG.redundancy.iframeObservation) {
            this.#setupIframeObservation();
        }
        
        // Setup polyfill for browsers without full MutationObserver support
        if (ForumCoreObserver.#CONFIG.redundancy.shadowDOMPolyfill) {
            this.#setupShadowDOMPolyfill();
        }
    }
    
    #setupShadowDOMObservation() {
        const scanShadowHosts = () => {
            try {
                const allElements = document.querySelectorAll('*');
                let shadowCount = 0;
                
                for (const element of allElements) {
                    if (shadowCount >= ForumCoreObserver.#CONFIG.memory.maxShadowObservers) {
                        console.warn('Max shadow observers reached');
                        break;
                    }
                    
                    if (element.shadowRoot && !this.#shadowObservers.has(element)) {
                        this.#observeShadowRoot(element.shadowRoot);
                        shadowCount++;
                    }
                }
                
                this.#mutationMetrics.shadowObservations += shadowCount;
            } catch (error) {
                console.debug('Shadow DOM scan error:', error);
            }
        };
        
        // Initial scan
        scanShadowHosts();
        
        // Monitor for new shadow hosts
        const shadowObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.shadowRoot) {
                                this.#observeShadowRoot(node.shadowRoot);
                            }
                            // Check children
                            const shadowHosts = node.querySelectorAll('*');
                            shadowHosts.forEach(host => {
                                if (host.shadowRoot) {
                                    this.#observeShadowRoot(host.shadowRoot);
                                }
                            });
                        }
                    }
                }
            }
            scanShadowHosts();
        });
        
        shadowObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
    
    #observeShadowRoot(shadowRoot) {
        try {
            const observer = new MutationObserver((mutations) => {
                this.#handleMutations(mutations, { source: 'shadow-dom' });
            });
            
            observer.observe(shadowRoot, ForumCoreObserver.#CONFIG.observer);
            this.#shadowObservers.set(shadowRoot.host, observer);
            
            // Also observe any nested shadow roots
            const nestedHosts = shadowRoot.querySelectorAll('*');
            nestedHosts.forEach(host => {
                if (host.shadowRoot && !this.#shadowObservers.has(host)) {
                    this.#observeShadowRoot(host.shadowRoot);
                }
            });
        } catch (error) {
            console.debug('Cannot observe shadow root:', error);
        }
    }
    
    #setupIframeObservation() {
        const observeIframe = (iframe) => {
            if (!iframe.contentWindow || !iframe.contentDocument) return;
            if (this.#iframeObservers.has(iframe)) return;
            
            try {
                // Try to observe same-origin iframes
                const observer = new MutationObserver((mutations) => {
                    this.#handleMutations(mutations, { source: 'iframe' });
                });
                
                observer.observe(iframe.contentDocument.documentElement, ForumCoreObserver.#CONFIG.observer);
                this.#iframeObservers.set(iframe, observer);
                this.#mutationMetrics.iframeObservations++;
                
            } catch (error) {
                // Cross-origin iframe - can't observe directly
                console.debug('Cannot observe cross-origin iframe:', error);
                
                // Fallback: monitor iframe load events
                iframe.addEventListener('load', () => {
                    this.#handleIframeLoad(iframe);
                }, { once: true });
            }
        };
        
        // Observe existing iframes
        document.querySelectorAll('iframe').forEach(observeIframe);
        
        // Monitor for new iframes
        const iframeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.tagName === 'IFRAME') {
                            observeIframe(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('iframe').forEach(observeIframe);
                        }
                    }
                }
            }
        });
        
        iframeObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
    
    #handleIframeLoad(iframe) {
        // Mark iframe content for processing
        queueMicrotask(() => {
            this.#scanIframeContent(iframe);
        });
    }
    
    async #scanIframeContent(iframe) {
        try {
            const doc = iframe.contentDocument;
            if (!doc) return;
            
            const selectors = this.#getForumSelectors();
            for (const selector of selectors) {
                const elements = doc.querySelectorAll(selector);
                for (const element of elements) {
                    if (!this.#processedNodes.has(element)) {
                        await this.#processNode(element, { source: 'iframe-scan' });
                    }
                }
            }
        } catch (error) {
            // Cross-origin - can't access
        }
    }
    
    #setupShadowDOMPolyfill() {
        // For browsers without native Shadow DOM support
        if (!Element.prototype.attachShadow) {
            console.warn('Shadow DOM not supported, using polyfill detection');
            
            // Monitor custom elements for polyfilled shadow DOM
            const customElementObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check for polyfilled shadow DOM indicators
                                const shadowIndicator = node.querySelector('[shadowroot], [data-shadowroot]');
                                if (shadowIndicator) {
                                    this.#handlePolyfilledShadowDOM(node);
                                }
                            }
                        }
                    }
                }
            });
            
            customElementObserver.observe(document, {
                childList: true,
                subtree: true
            });
        }
    }
    
    #handlePolyfilledShadowDOM(element) {
        // Process polyfilled shadow DOM content
        const shadowContent = element.querySelector('[shadowroot], [data-shadowroot]');
        if (shadowContent) {
            this.#collectAllElements(shadowContent, new Set()).forEach(node => {
                this.#processNode(node, { source: 'shadow-polyfill' });
            });
        }
    }
    
    #setupIntersectionObserver() {
        // For lazy-loaded content
        this.#intersectionObservers.set('lazy', new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        this.#processNode(entry.target, { source: 'intersection' });
                        // Optionally unobserve after processing
                        // this.#intersectionObservers.get('lazy').unobserve(entry.target);
                    }
                }
            },
            {
                threshold: ForumCoreObserver.#CONFIG.redundancy.intersectionThreshold,
                rootMargin: ForumCoreObserver.#CONFIG.redundancy.intersectionRootMargin
            }
        ));
        
        // Observe potentially lazy elements
        const lazySelectors = [
            '[loading="lazy"]',
            '.lazy-load',
            '[data-lazy]',
            'img, iframe, video'
        ];
        
        requestIdleCallback(() => {
            lazySelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(element => {
                    this.#intersectionObservers.get('lazy').observe(element);
                });
            });
        }, { timeout: 2000 });
    }
    
    #setupEventListeners() {
        // Use passive event listeners for performance
        const passiveOptions = { passive: true, capture: true };
        
        document.addEventListener('visibilitychange', 
            this.#handleVisibilityChange.bind(this), passiveOptions);
        
        window.addEventListener('load', 
            this.#handleWindowLoad.bind(this), passiveOptions);
        
        window.addEventListener('pageshow', 
            this.#handlePageShow.bind(this), passiveOptions);
        
        window.addEventListener('pagehide', 
            this.#handlePageHide.bind(this), passiveOptions);
        
        // Listen for history state changes (SPA navigation)
        window.addEventListener('popstate', 
            this.#handlePopState.bind(this), passiveOptions);
        
        // Custom event for manual triggers
        document.addEventListener('forum:rescan', 
            () => this.#scanExistingContent(), passiveOptions);
        
        // Error boundary
        window.addEventListener('error', 
            this.#handleGlobalError.bind(this), { capture: true });
        
        // Monitor for DOMContentLoaded for early content
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', 
                () => this.#handleDOMContentLoaded(), { once: true });
        } else {
            this.#handleDOMContentLoaded();
        }
    }
    
    #handleDOMContentLoaded() {
        // Early content scan
        this.#initialScanComplete = false;
        this.#scanExistingContent();
    }
    
    #handleWindowLoad() {
        // Final comprehensive scan
        this.#scanExistingContent(true);
        console.log('✅ Window load complete - final content scan done');
    }
    
    #handlePageShow(event) {
        if (event.persisted) {
            // Page restored from back-forward cache
            console.log('🔄 Page restored from bfcache - rescanning');
            this.#resume();
            this.#scanExistingContent(true);
        }
    }
    
    #handlePageHide() {
        this.#pause();
    }
    
    #handlePopState() {
        // SPA navigation occurred
        setTimeout(() => {
            this.#pageState = this.#detectPageState();
            this.#scanExistingContent();
        }, 100);
    }
    
    #handleGlobalError(event) {
        this.#errorTracker.errorCount++;
        this.#errorTracker.lastErrorTime = Date.now();
        this.#errorTracker.recentErrors.push({
            message: event.message,
            source: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: event.error,
            timestamp: Date.now()
        });
        
        // Keep only recent errors
        if (this.#errorTracker.recentErrors.length > 50) {
            this.#errorTracker.recentErrors.shift();
        }
        
        // Enter recovery mode if too many errors
        if (this.#errorTracker.errorCount > ForumCoreObserver.#CONFIG.resilience.errorThreshold &&
            !this.#errorTracker.recoveryMode) {
            this.#enterRecoveryMode();
        }
    }
    
    #enterRecoveryMode() {
        console.warn('⚠️ Entering recovery mode due to errors');
        this.#errorTracker.recoveryMode = true;
        
        // Disable non-critical features
        this.#pause();
        
        // Switch to polling as fallback
        if (ForumCoreObserver.#CONFIG.resilience.fallbackToPolling) {
            this.#startPollingFallback();
        }
        
        // Try to recover after delay
        setTimeout(() => {
            this.#attemptRecovery();
        }, 5000);
    }
    
    #attemptRecovery() {
        const maxAttempts = ForumCoreObserver.#CONFIG.resilience.recoveryAttempts;
        let attempts = 0;
        
        const tryRecover = () => {
            attempts++;
            
            try {
                this.#resume();
                this.#errorTracker.recoveryMode = false;
                this.#errorTracker.errorCount = 0;
                console.log('✅ Recovery successful');
                return true;
            } catch (error) {
                console.warn(`Recovery attempt ${attempts} failed:`, error);
                
                if (attempts < maxAttempts) {
                    setTimeout(tryRecover, ForumCoreObserver.#CONFIG.resilience.retryDelay * attempts);
                } else {
                    console.error('Recovery failed after maximum attempts');
                    this.#activateFallbackMode();
                }
                return false;
            }
        };
        
        tryRecover();
    }
    
    #startPollingFallback() {
        console.log('🔄 Activating polling fallback');
        
        const pollInterval = ForumCoreObserver.#CONFIG.resilience.pollingInterval;
        const pollId = setInterval(() => {
            if (!this.#errorTracker.recoveryMode) {
                clearInterval(pollId);
                return;
            }
            
            this.#scanExistingContent();
        }, pollInterval);
        
        // Store for cleanup
        this.#pollingFallbackId = pollId;
    }
    
    #activateFallbackMode() {
        console.error('💥 Activating fallback mode');
        
        // Minimal observation mode
        this.#pause();
        
        // Use setInterval for basic observation
        this.#fallbackInterval = setInterval(() => {
            this.#scanExistingContent();
        }, 10000);
        
        // Still process major DOM changes
        document.addEventListener('DOMNodeInserted', (e) => {
            this.#processNode(e.target, { source: 'fallback-event' });
        }, true);
    }
    
    #detectPageState() {
        const pathname = window.location.pathname;
        const className = document.body.className;
        const theme = document.documentElement.dataset?.theme;
        
        // Use direct DOM queries for maximum speed
        const selectors = {
            forum: '.board, .big_list, .forum, .subforum',
            topic: '.modern-topic-title, .post, .topic, .thread',
            blog: '#blog, .article, .blog-post, .entry',
            profile: '.modern-profile, .profile, .user-profile',
            search: '#search.posts, body#search, .search-results',
            modernized: '.post-modernized, .modernized',
            poll: '.poll, .survey, .vote',
            gallery: '.gallery, .album, .photo',
            privateMessage: '.pm, .message, .conversation'
        };
        
        const pageChecks = {};
        for (const key in selectors) {
            pageChecks[key] = document.querySelector(selectors[key]) !== null;
        }
        
        // Check for SPA frameworks
        const spaIndicators = {
            isReact: !!document.querySelector('[data-reactroot], [data-reactid]'),
            isVue: !!document.querySelector('[data-v-app], [v-app]'),
            isAngular: !!document.querySelector('[ng-app], [ng-version]'),
            isSvelte: !!document.querySelector('[data-svelte]'),
            isNextJS: !!document.querySelector('[data-next-hide-fouc]'),
            isNuxtJS: !!document.querySelector('[data-nuxt]')
        };
        
        return {
            // Page type detection
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            isPoll: pageChecks.poll,
            isGallery: pageChecks.gallery,
            isPrivateMessage: pathname.includes('/pm/') || pageChecks.privateMessage,
            
            // Modernization state
            hasModernizedPosts: pageChecks.modernized,
            hasModernizedQuotes: !!document.querySelector('.modern-quote'),
            hasModernizedProfile: !!document.querySelector('.modern-profile'),
            hasModernizedNavigation: !!document.querySelector('.modern-nav'),
            
            // UI state
            isDarkMode: theme === 'dark' || document.body.classList.contains('dark-mode'),
            isLoggedIn: !!document.querySelector('.menuwrap .avatar, [data-user-id]'),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            isTablet: window.matchMedia('(max-width: 1024px) and (min-width: 769px)').matches,
            isDesktop: !window.matchMedia('(max-width: 1024px)').matches,
            
            // SPA detection
            ...spaIndicators,
            isSPA: Object.values(spaIndicators).some(val => val),
            
            // Performance hints
            hasWebP: document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0,
            hasIntersectionObserver: 'IntersectionObserver' in window,
            hasResizeObserver: 'ResizeObserver' in window,
            hasMutationObserver: 'MutationObserver' in window
        };
    }
    
    #handleMutations(mutations, options = {}) {
        const startTime = performance.now();
        this.#mutationMetrics.totalMutations += mutations.length;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        // Fast filter with multiple strategies
        const filteredMutations = [];
        
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            
            if (this.#shouldProcessMutation(mutation, options)) {
                filteredMutations.push(mutation);
            }
        }
        
        if (filteredMutations.length === 0) return;
        
        // Queue management with overflow handling
        const currentQueueSize = this.#mutationQueue.length;
        const newItems = filteredMutations.length;
        
        if (currentQueueSize + newItems > ForumCoreObserver.#CONFIG.performance.maxQueueSize) {
            this.#mutationMetrics.queueOverflows++;
            
            switch (ForumCoreObserver.#CONFIG.performance.queueOverflowStrategy) {
                case 'sample':
                    // Sample mutations (keep every Nth)
                    const sampleRate = Math.ceil((currentQueueSize + newItems) / 
                        ForumCoreObserver.#CONFIG.performance.maxQueueSize);
                    for (let i = 0; i < filteredMutations.length; i += sampleRate) {
                        this.#mutationQueue.push(filteredMutations[i]);
                    }
                    this.#mutationMetrics.droppedMutations += filteredMutations.length - 
                        Math.ceil(filteredMutations.length / sampleRate);
                    break;
                    
                case 'clear':
                    // Clear old queue and start fresh
                    this.#mutationQueue.length = 0;
                    this.#mutationQueue.push(...filteredMutations);
                    this.#mutationMetrics.droppedMutations += currentQueueSize;
                    break;
                    
                case 'throttle':
                default:
                    // Drop oldest mutations
                    const overflow = (currentQueueSize + newItems) - 
                        ForumCoreObserver.#CONFIG.performance.maxQueueSize;
                    this.#mutationQueue.splice(0, overflow);
                    this.#mutationQueue.push(...filteredMutations);
                    this.#mutationMetrics.droppedMutations += overflow;
                    break;
            }
        } else {
            this.#mutationQueue.push(...filteredMutations);
        }
        
        // Start processing if not already
        if (this.#mutationQueue.length > 0 && !this.#isProcessing) {
            if (this.#mutationQueue.length > ForumCoreObserver.#CONFIG.performance.mutationBatchSize * 2) {
                // High load - process immediately
                this.#processMutationQueue();
            } else {
                // Normal load - use microtask
                queueMicrotask(() => {
                    if (!this.#isProcessing) {
                        this.#processMutationQueue();
                    }
                });
            }
        }
        
        const processingTime = performance.now() - startTime;
        this.#recordPerformance('mutation-handling', processingTime);
    }
    
    #handleBackupMutations(mutations) {
        // Backup observer for root-level changes only
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Force process this node through backup system
                        this.#processNode(node, { source: 'backup-observer', force: true });
                    }
                }
            }
        }
    }
    
    #shouldProcessMutation(mutation, options = {}) {
        const target = mutation.target;
        
        // Skip mutations from our own scripts
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip if in recovery mode (except critical)
        if (this.#errorTracker.recoveryMode && !options.force) {
            return false;
        }
        
        // Check visibility based on mutation type
        switch (mutation.type) {
            case 'characterData':
                return this.#shouldProcessCharacterData(mutation, target);
                
            case 'attributes':
                return this.#shouldProcessAttribute(mutation, target);
                
            case 'childList':
                return this.#shouldProcessChildList(mutation, target);
                
            default:
                return true;
        }
    }
    
    #shouldProcessCharacterData(mutation, target) {
        const parent = target.parentElement;
        if (!parent) return false;
        
        // Skip if text hasn't actually changed (some observers fire on whitespace changes)
        const oldValue = mutation.oldValue || '';
        const newValue = target.textContent || '';
        if (oldValue.trim() === newValue.trim()) return false;
        
        // Check if parent is visible
        if (!this.#isElementVisible(parent)) return false;
        
        // Check if this is content we care about
        return this.#isContentElement(parent);
    }
    
    #shouldProcessAttribute(mutation, target) {
        const attrName = mutation.attributeName;
        
        // Always process certain attributes
        const criticalAttributes = ['class', 'id', 'style', 'src', 'href'];
        if (criticalAttributes.includes(attrName)) return true;
        
        // Process data attributes
        if (attrName.startsWith('data-')) return true;
        
        // Skip if value hasn't actually changed
        const oldValue = mutation.oldValue || '';
        const newValue = target.getAttribute(attrName) || '';
        if (oldValue === newValue) return false;
        
        // Check visibility
        if (!this.#isElementVisible(target)) return false;
        
        return this.#isContentElement(target);
    }
    
    #shouldProcessChildList(mutation, target) {
        // Check if any added nodes are visible content
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (this.#isElementVisible(node) || this.#hasVisibleChild(node)) {
                    return true;
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || '';
                if (text.trim().length > 0) {
                    const parent = node.parentElement;
                    if (parent && this.#isElementVisible(parent)) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    #isElementVisible(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        
        // Quick checks first
        if (element.hasAttribute('hidden')) return false;
        
        // Check computed style (more expensive)
        try {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || 
                style.opacity === '0' || style.width === '0px' || style.height === '0px') {
                return false;
            }
            
            // Check if element is in viewport (approximate)
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                // Element might be empty or collapsed
                return false;
            }
            
        } catch (error) {
            // Cross-origin iframe or other security error
            return false;
        }
        
        return true;
    }
    
    #hasVisibleChild(element) {
        // Check if any child is visible (depth-limited)
        const maxDepth = 3;
        
        const checkChildren = (el, depth) => {
            if (depth > maxDepth) return false;
            
            for (const child of el.children) {
                if (this.#isElementVisible(child)) return true;
                if (checkChildren(child, depth + 1)) return true;
            }
            
            return false;
        };
        
        return checkChildren(element, 1);
    }
    
    #isContentElement(element) {
        const tagName = element.tagName.toLowerCase();
        
        // Common forum content tags
        const contentTags = [
            'div', 'span', 'article', 'section', 'header', 'footer',
            'main', 'aside', 'nav', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
            'a', 'button', 'input', 'textarea', 'select', 'label',
            'img', 'video', 'audio', 'iframe'
        ];
        
        if (!contentTags.includes(tagName)) return false;
        
        // Check for forum-specific classes
        const classList = element.classList;
        if (classList) {
            const forumClasses = [
                'post', 'article', 'comment', 'quote', 'signature',
                'profile', 'message', 'topic', 'thread', 'forum',
                'poll', 'vote', 'gallery', 'album', 'photo',
                'modern-', 'st-', 'btn-', 'form-'
            ];
            
            for (const forumClass of forumClasses) {
                for (const className of classList) {
                    if (className.includes(forumClass)) {
                        return true;
                    }
                }
            }
        }
        
        // Check for data attributes
        const dataset = element.dataset;
        if (dataset) {
            const dataAttrs = Object.keys(dataset);
            for (const attr of dataAttrs) {
                if (attr.includes('post') || attr.includes('user') || 
                    attr.includes('topic') || attr.includes('forum')) {
                    return true;
                }
            }
        }
        
        // Check for common forum attributes
        const attributes = ['id', 'class', 'data-*'];
        for (const attr of attributes) {
            const value = element.getAttribute(attr);
            if (value && (
                value.includes('post') || value.includes('user') || 
                value.includes('topic') || value.includes('forum') ||
                value.includes('comment') || value.includes('message')
            )) {
                return true;
            }
        }
        
        return false;
    }
    
    async #processMutationQueue() {
        if (this.#isProcessing) return;
        
        this.#isProcessing = true;
        const startTime = performance.now();
        
        try {
            while (this.#mutationQueue.length > 0) {
                const batchSize = Math.min(
                    ForumCoreObserver.#CONFIG.performance.mutationBatchSize,
                    this.#mutationQueue.length
                );
                
                const batch = this.#mutationQueue.splice(0, batchSize);
                await this.#processMutationBatch(batch);
                
                // Yield to prevent blocking
                if (performance.now() - startTime > ForumCoreObserver.#CONFIG.performance.maxProcessingTime) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                
                // Check for recovery mode
                if (this.#errorTracker.recoveryMode) {
                    break;
                }
            }
        } catch (error) {
            console.error('Mutation processing error:', error);
            this.#mutationMetrics.errors++;
            this.#handleGlobalError({ error, message: 'Mutation processing failed' });
        } finally {
            this.#isProcessing = false;
            this.#mutationMetrics.processedMutations++;
            
            const processingTime = performance.now() - startTime;
            this.#mutationMetrics.averageProcessingTime = 
                (this.#mutationMetrics.averageProcessingTime * 0.9) + (processingTime * 0.1);
                
            this.#recordPerformance('queue-processing', processingTime);
        }
    }
    
    async #processMutationBatch(mutations) {
        const affectedNodes = new Set();
        const processedThisBatch = new Set();
        
        // Phase 1: Collect all affected nodes
        for (const mutation of mutations) {
            this.#collectAffectedNodes(mutation, affectedNodes);
        }
        
        // Phase 2: Filter and process
        const nodesToProcess = [];
        for (const node of affectedNodes) {
            if (node && node.nodeType === Node.ELEMENT_NODE && 
                !this.#processedNodes.has(node) && 
                !processedThisBatch.has(node)) {
                nodesToProcess.push(node);
                processedThisBatch.add(node);
            }
        }
        
        if (nodesToProcess.length === 0) return;
        
        // Phase 3: Process in parallel with concurrency control
        const CONCURRENCY_LIMIT = 4;
        const chunks = [];
        
        for (let i = 0; i < nodesToProcess.length; i += CONCURRENCY_LIMIT) {
            chunks.push(nodesToProcess.slice(i, i + CONCURRENCY_LIMIT));
        }
        
        for (const chunk of chunks) {
            await Promise.allSettled(
                chunk.map(node => this.#processNode(node, { batch: true }))
            );
        }
    }
    
    #collectAffectedNodes(mutation, collection) {
        switch (mutation.type) {
            case 'childList':
                // Add all added nodes and their descendants
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.#collectAllElements(node, collection);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        const parent = node.parentElement;
                        if (parent) {
                            collection.add(parent);
                        }
                    }
                }
                // Also check the target itself (for container changes)
                collection.add(mutation.target);
                break;
                
            case 'attributes':
                collection.add(mutation.target);
                // Also check parent for context changes
                if (mutation.target.parentElement) {
                    collection.add(mutation.target.parentElement);
                }
                break;
                
            case 'characterData':
                const parent = mutation.target.parentElement;
                if (parent) {
                    collection.add(parent);
                }
                break;
        }
    }
    
    #collectAllElements(root, collection, depth = 0, maxDepth = 10) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE || depth > maxDepth) return;
        
        collection.add(root);
        
        // Use direct child iteration for performance
        const children = root.children;
        for (let i = 0; i < children.length; i++) {
            this.#collectAllElements(children[i], collection, depth + 1, maxDepth);
        }
    }
    
    async #processNode(node, options = {}) {
        if (!node || this.#processedNodes.has(node)) return;
        
        const startTime = performance.now();
        const nodeId = this.#generateNodeId(node);
        
        try {
            // Check if node is still in document
            if (!document.contains(node) && !this.#isInShadowDOM(node)) {
                return;
            }
            
            // Get matching callbacks
            const matchingCallbacks = this.#getMatchingCallbacks(node);
            if (matchingCallbacks.length === 0) return;
            
            // Execute callbacks
            await this.#executeNodeCallbacks(node, matchingCallbacks, options);
            
            // Mark as processed
            this.#processedNodes.add(node);
            
            // Record performance
            const processingTime = performance.now() - startTime;
            this.#recordPerformance('node-processing', processingTime, nodeId);
            
        } catch (error) {
            console.error(`Error processing node ${nodeId}:`, error);
            this.#mutationMetrics.errors++;
            
            // Retry logic
            if (options.retryCount < ForumCoreObserver.#CONFIG.resilience.maxRetries) {
                this.#mutationMetrics.retries++;
                setTimeout(() => {
                    this.#processNode(node, { 
                        ...options, 
                        retryCount: (options.retryCount || 0) + 1 
                    });
                }, ForumCoreObserver.#CONFIG.resilience.retryDelay);
            }
        }
    }
    
    #generateNodeId(node) {
        if (!node) return 'unknown';
        
        const parts = [];
        
        // Use tag name
        if (node.tagName) {
            parts.push(node.tagName.toLowerCase());
        }
        
        // Use ID if available
        if (node.id) {
            parts.push(`#${node.id}`);
        }
        
        // Use classes if available
        if (node.className && typeof node.className === 'string') {
            const classes = node.className.split(' ').filter(c => c.length > 0);
            if (classes.length > 0) {
                parts.push(`.${classes[0]}`);
            }
        }
        
        // Use data attributes for uniqueness
        if (node.dataset) {
            const dataAttrs = Object.keys(node.dataset);
            if (dataAttrs.length > 0) {
                parts.push(`[data-${dataAttrs[0]}]`);
            }
        }
        
        return parts.join('') || 'element';
    }
    
    #isInShadowDOM(node) {
        let current = node;
        while (current) {
            if (current.getRootNode && current.getRootNode() instanceof ShadowRoot) {
                return true;
            }
            current = current.parentNode;
        }
        return false;
    }
    
    #getMatchingCallbacks(node) {
        const matching = [];
        const callbackValues = Array.from(this.#callbacks.values());
        
        for (const callback of callbackValues) {
            // Check page type restrictions
            if (callback.pageTypes && callback.pageTypes.length > 0) {
                const hasMatchingPageType = callback.pageTypes.some(type => {
                    const stateKey = 'is' + type.charAt(0).toUpperCase() + type.slice(1);
                    return this.#pageState[stateKey];
                });
                
                if (!hasMatchingPageType) continue;
            }
            
            // Check selector match
            if (callback.selector) {
                if (!node.matches(callback.selector)) {
                    // Check if node contains matching element
                    const matchingChild = node.querySelector(callback.selector);
                    if (!matchingChild) {
                        continue;
                    }
                }
            }
            
            // Check dependency availability
            if (callback.dependencies) {
                const missingDeps = callback.dependencies.filter(dep => {
                    if (typeof dep === 'string') {
                        return !this.#callbacks.has(dep);
                    }
                    return false;
                });
                
                if (missingDeps.length > 0) {
                    continue;
                }
            }
            
            matching.push(callback);
        }
        
        return matching;
    }
    
    async #executeNodeCallbacks(node, callbacks, options) {
        // Group by priority
        const priorityGroups = {
            critical: [],
            high: [],
            normal: [],
            low: [],
            idle: []
        };
        
        for (const callback of callbacks) {
            const priority = callback.priority || 'normal';
            priorityGroups[priority].push(callback);
        }
        
        // Execute in priority order
        const priorities = ['critical', 'high', 'normal', 'low', 'idle'];
        
        for (const priority of priorities) {
            const callbacks = priorityGroups[priority];
            
            if (callbacks.length === 0) continue;
            
            switch (priority) {
                case 'critical':
                    // Execute immediately and sequentially
                    for (const callback of callbacks) {
                        await this.#executeCallback(callback, node);
                    }
                    break;
                    
                case 'high':
                    // Execute with microtask scheduling
                    await Promise.allSettled(
                        callbacks.map(callback => 
                            Promise.resolve().then(() => this.#executeCallback(callback, node))
                        )
                    );
                    break;
                    
                case 'normal':
                    // Execute with minimal delay
                    setTimeout(() => {
                        callbacks.forEach(callback => {
                            this.#executeCallback(callback, node).catch(console.error);
                        });
                    }, 0);
                    break;
                    
                case 'low':
                    // Defer execution
                    requestIdleCallback(() => {
                        callbacks.forEach(callback => {
                            this.#executeCallback(callback, node).catch(console.error);
                        });
                    }, { timeout: 100 });
                    break;
                    
                case 'idle':
                    // Execute only during idle periods
                    requestIdleCallback(() => {
                        callbacks.forEach(callback => {
                            this.#executeCallback(callback, node).catch(console.error);
                        });
                    }, { timeout: 1000 });
                    break;
            }
        }
    }
    
    async #executeCallback(callback, node) {
        const startTime = performance.now();
        
        try {
            // Check if callback should be skipped due to errors
            if (callback.errorCount > ForumCoreObserver.#CONFIG.resilience.maxRetries * 2) {
                console.warn(`Skipping callback ${callback.id} due to repeated errors`);
                return;
            }
            
            // Execute callback
            await callback.fn(node);
            
            // Record successful execution
            callback.lastSuccess = Date.now();
            callback.errorCount = 0;
            
        } catch (error) {
            console.error(`Callback ${callback.id} failed:`, error);
            
            // Update error tracking
            callback.errorCount = (callback.errorCount || 0) + 1;
            callback.lastError = Date.now();
            
            // Record in global error tracker
            this.#errorTracker.recentErrors.push({
                type: 'callback-error',
                callbackId: callback.id,
                error: error.message,
                timestamp: Date.now()
            });
            
            throw error;
        } finally {
            const executionTime = performance.now() - startTime;
            this.#recordPerformance('callback-execution', executionTime, callback.id);
        }
    }
    
    #getForumSelectors() {
        return [
            // Posts and content
            '.post', '.post-modernized', '.article', '.comment', '.message',
            '.topic', '.thread', '.forum-post', '.user-post',
            
            // UI Elements
            '.btn', '.button', '.forminput', '.form-control', '.input',
            '.points_up', '.points_down', '.vote', '.rating',
            '.st-emoji-container', '.emoji', '.reaction',
            '.modern-quote', '.quote', '.blockquote',
            '.modern-profile', '.profile', '.user-card',
            '.modern-topic-title', '.topic-title', '.thread-title',
            '.menu', '.menuwrap', '.navigation', '.nav',
            '.tabs', '.tab', '.tab-content',
            '.code', '.pre', '.code-block',
            '.spoiler', '.spoiler-content',
            '.poll', '.poll-option', '.survey',
            '.tag', '.tag li', '.badge',
            
            // Media and interactive
            '.online .thumbs a', '.thumbnail', '.gallery-item',
            '.profile-avatar', '.avatar', '.user-avatar',
            '.breadcrumb', '.breadcrumb-item', '.breadcrumbs',
            '.page-number', '.pagination', '.page-link',
            
            // Modern UI components
            '.modern-breadcrumb', '.modern-nav',
            '.post-new-badge', '.new-indicator',
            '.quote-jump-btn', '.jump-to',
            '.anchor-container', '.anchor',
            '.modern-bottom-actions', '.post-actions',
            '.multiquote-control', '.multi-quote',
            '.moderator-controls', '.mod-tools',
            '.ip-address-control', '.ip-info',
            
            // Search and lists
            '.search-post', '.search-result',
            '.post-actions', '.action-buttons',
            '.user-info', '.user-details',
            '.post-content', '.content',
            '.post-footer', '.footer',
            '.signature', '.user-signature',
            
            // Forms and inputs
            'textarea', 'input[type="text"]', 'input[type="search"]',
            'select', 'option', 'datalist',
            
            // Dynamic content
            '[data-post-id]', '[data-user-id]', '[data-topic-id]',
            '[data-forum]', '[data-comment]', '[data-message]',
            
            // Lazy loading placeholders
            '[data-src]', '[data-lazy]', '.lazy',
            
            // SPA framework markers
            '[data-reactroot]', '[data-reactid]',
            '[data-v-app]', '[v-app]',
            '[ng-app]', '[ng-version]',
            '[data-svelte]'
        ];
    }
    
    async #scanExistingContent(isFinal = false) {
        if (this.#isProcessing && !isFinal) {
            // Skip if already processing, unless this is the final scan
            return;
        }
        
        const startTime = performance.now();
        this.#mutationMetrics.periodicScans++;
        
        console.log(`📊 ${isFinal ? 'Final' : 'Periodic'} content scan started`);
        
        try {
            const selectors = this.#getForumSelectors();
            const foundNodes = new Set();
            
            // Scan in chunks to avoid blocking
            const CHUNK_SIZE = ForumCoreObserver.#CONFIG.performance.searchPageBatchSize;
            
            for (let i = 0; i < selectors.length; i += CHUNK_SIZE) {
                const chunk = selectors.slice(i, i + CHUNK_SIZE);
                
                // Use Promise.all for parallel scanning
                const scanPromises = chunk.map(selector => {
                    return new Promise(resolve => {
                        requestIdleCallback(() => {
                            try {
                                const nodes = document.querySelectorAll(selector);
                                for (const node of nodes) {
                                    foundNodes.add(node);
                                }
                            } catch (error) {
                                console.debug(`Selector scan failed for ${selector}:`, error);
                            }
                            resolve();
                        }, { timeout: 100 });
                    });
                });
                
                await Promise.all(scanPromises);
                
                // Process found nodes in batch
                if (foundNodes.size >= CHUNK_SIZE * 5) {
                    await this.#processFoundNodes(Array.from(foundNodes));
                    foundNodes.clear();
                }
                
                // Yield to prevent blocking
                if (performance.now() - startTime > 50) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            // Process remaining nodes
            if (foundNodes.size > 0) {
                await this.#processFoundNodes(Array.from(foundNodes));
            }
            
            // Also scan Shadow DOM
            await this.#scanShadowDOMContent();
            
            // Scan iframes if accessible
            await this.#scanAccessibleIframes();
            
        } catch (error) {
            console.error('Content scan error:', error);
        } finally {
            this.#initialScanComplete = true;
            
            const scanTime = performance.now() - startTime;
            console.log(`✅ Content scan completed in ${scanTime.toFixed(1)}ms`);
            this.#recordPerformance('content-scan', scanTime);
        }
    }
    
    async #processFoundNodes(nodes) {
        const batchSize = ForumCoreObserver.#CONFIG.performance.mutationBatchSize;
        
        for (let i = 0; i < nodes.length; i += batchSize) {
            const batch = nodes.slice(i, i + batchSize);
            const promises = batch.map(node => 
                this.#processNode(node, { source: 'periodic-scan' })
            );
            
            await Promise.allSettled(promises);
            
            // Yield to prevent blocking
            if (i % (batchSize * 10) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
    
    async #scanShadowDOMContent() {
        try {
            const allElements = document.querySelectorAll('*');
            const shadowRoots = [];
            
            // Collect shadow roots
            for (const element of allElements) {
                if (element.shadowRoot) {
                    shadowRoots.push(element.shadowRoot);
                }
            }
            
            // Scan each shadow root
            for (const shadowRoot of shadowRoots) {
                const selectors = this.#getForumSelectors();
                
                for (const selector of selectors) {
                    try {
                        const nodes = shadowRoot.querySelectorAll(selector);
                        for (const node of nodes) {
                            if (!this.#processedNodes.has(node)) {
                                await this.#processNode(node, { source: 'shadow-scan' });
                            }
                        }
                    } catch (error) {
                        // Security error - cannot access closed shadow root
                        break;
                    }
                }
            }
        } catch (error) {
            console.debug('Shadow DOM scan error:', error);
        }
    }
    
    async #scanAccessibleIframes() {
        const iframes = document.querySelectorAll('iframe');
        
        for (const iframe of iframes) {
            try {
                const doc = iframe.contentDocument;
                if (doc && doc.documentElement) {
                    const selectors = this.#getForumSelectors();
                    
                    for (const selector of selectors) {
                        const nodes = doc.querySelectorAll(selector);
                        for (const node of nodes) {
                            if (!this.#processedNodes.has(node)) {
                                await this.#processNode(node, { source: 'iframe-scan' });
                            }
                        }
                    }
                }
            } catch (error) {
                // Cross-origin iframe - cannot access
            }
        }
    }
    
    #startPeriodicScanning() {
        if (ForumCoreObserver.#CONFIG.redundancy.periodicScanInterval > 0) {
            this.#periodicScannerId = setInterval(() => {
                if (!document.hidden && !this.#errorTracker.recoveryMode) {
                    this.#scanExistingContent();
                }
            }, ForumCoreObserver.#CONFIG.redundancy.periodicScanInterval);
        }
        
        // Full rescan less frequently
        if (ForumCoreObserver.#CONFIG.redundancy.fullRescanInterval > 0) {
            setInterval(() => {
                if (!document.hidden && !this.#errorTracker.recoveryMode) {
                    // Clear processed nodes cache for full rescan
                    this.#processedNodes = new WeakSet();
                    this.#scanExistingContent(true);
                }
            }, ForumCoreObserver.#CONFIG.redundancy.fullRescanInterval);
        }
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(() => {
            // Memory management
            if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
                console.warn(`Processed nodes: ${this.#processedNodes.size}, approaching limit`);
                
                // Aggressive cleanup if way over limit
                if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes * 2) {
                    console.warn('Force clearing processed nodes cache');
                    this.#processedNodes = new WeakSet();
                }
            }
            
            // Cleanup old performance stats
            const cutoff = Date.now() - 300000; // 5 minutes
            for (const [key, stats] of this.#performanceStats.entries()) {
                if (stats.lastRecorded < cutoff && !key.startsWith('callback-')) {
                    this.#performanceStats.delete(key);
                }
            }
            
            // Cleanup error tracker
            const errorCutoff = Date.now() - 600000; // 10 minutes
            this.#errorTracker.recentErrors = this.#errorTracker.recentErrors.filter(
                error => error.timestamp > errorCutoff
            );
            
            // Suggest garbage collection if available
            if (typeof globalThis.gc === 'function') {
                try {
                    globalThis.gc();
                } catch (e) {
                    // Ignore
                }
            }
        }, ForumCoreObserver.#CONFIG.memory.cleanupInterval);
    }
    
    #setupPerformanceMonitoring() {
        // Monitor FPS and performance
        if ('PerformanceObserver' in window) {
            try {
                const perfObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.name === 'longtask') {
                            console.warn(`Long task detected: ${entry.duration.toFixed(1)}ms`);
                        }
                    }
                });
                
                perfObserver.observe({ entryTypes: ['longtask'] });
            } catch (error) {
                console.debug('PerformanceObserver not supported:', error);
            }
        }
        
        // Monitor memory if available
        if ('memory' in performance) {
            setInterval(() => {
                const mem = performance.memory;
                if (mem && mem.usedJSHeapSize > 0) {
                    const usedMB = mem.usedJSHeapSize / 1024 / 1024;
                    if (usedMB > 100) {
                        console.warn(`High memory usage: ${usedMB.toFixed(1)}MB`);
                    }
                }
            }, 30000);
        }
    }
    
    #recordPerformance(operation, duration, context = '') {
        const key = context ? `${operation}-${context}` : operation;
        const now = Date.now();
        
        if (!this.#performanceStats.has(key)) {
            this.#performanceStats.set(key, {
                count: 0,
                total: 0,
                avg: 0,
                min: Infinity,
                max: 0,
                lastRecorded: now
            });
        }
        
        const stats = this.#performanceStats.get(key);
        stats.count++;
        stats.total += duration;
        stats.avg = stats.total / stats.count;
        stats.min = Math.min(stats.min, duration);
        stats.max = Math.max(stats.max, duration);
        stats.lastRecorded = now;
    }
    
    #handleVisibilityChange() {
        if (document.hidden) {
            this.#pause();
        } else {
            this.#resume();
            
            // Rescan when page becomes visible
            requestIdleCallback(() => {
                this.#scanExistingContent();
            }, { timeout: 1000 });
        }
    }
    
    #pause() {
        if (this.#observer) {
            this.#observer.disconnect();
        }
        
        if (this.#backupObserver) {
            this.#backupObserver.disconnect();
        }
        
        // Pause shadow observers
        for (const observer of this.#shadowObservers.values()) {
            observer.disconnect();
        }
        
        // Pause iframe observers
        for (const observer of this.#iframeObservers.values()) {
            observer.disconnect();
        }
        
        // Clear timeouts
        for (const timeoutId of this.#debounceTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.#debounceTimeouts.clear();
        
        // Clear polling fallback
        if (this.#pollingFallbackId) {
            clearInterval(this.#pollingFallbackId);
        }
        
        console.log('⏸️ Observer paused');
    }
    
    #resume() {
        if (!this.#observer) {
            this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        }
        
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        
        if (ForumCoreObserver.#CONFIG.redundancy.backupObservation) {
            if (!this.#backupObserver) {
                this.#backupObserver = new MutationObserver(this.#handleBackupMutations.bind(this));
            }
            this.#backupObserver.observe(document.body, ForumCoreObserver.#CONFIG.backupObserver);
        }
        
        // Resume shadow observers
        for (const [host, observer] of this.#shadowObservers.entries()) {
            if (host.shadowRoot) {
                observer.observe(host.shadowRoot, ForumCoreObserver.#CONFIG.observer);
            }
        }
        
        // Resume iframe observers
        for (const [iframe, observer] of this.#iframeObservers.entries()) {
            try {
                if (iframe.contentDocument) {
                    observer.observe(iframe.contentDocument.documentElement, ForumCoreObserver.#CONFIG.observer);
                }
            } catch (error) {
                // Cross-origin iframe
            }
        }
        
        console.log('▶️ Observer resumed');
    }
    
    // Public API
    register(settings) {
        const id = settings.id || `callback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        
        const callback = {
            id,
            fn: settings.callback,
            priority: settings.priority || 'normal',
            selector: settings.selector,
            pageTypes: settings.pageTypes,
            dependencies: settings.dependencies,
            retryCount: 0,
            maxRetries: settings.maxRetries || ForumCoreObserver.#CONFIG.resilience.maxRetries,
            createdAt: performance.now(),
            errorCount: 0,
            lastSuccess: 0,
            lastError: 0
        };
        
        this.#callbacks.set(id, callback);
        console.log(`📝 Registered callback: ${id} (priority: ${callback.priority})`);
        
        // Scan existing content if selector provided
        if (this.#initialScanComplete && callback.selector) {
            requestIdleCallback(() => {
                const nodes = document.querySelectorAll(callback.selector);
                for (const node of nodes) {
                    if (!this.#processedNodes.has(node)) {
                        this.#processNode(node, { source: 'registration' });
                    }
                }
            }, { timeout: 500 });
        }
        
        return id;
    }
    
    registerDebounced(settings) {
        const id = this.register(settings);
        
        this.#debouncedCallbacks.set(id, {
            callback: settings.callback,
            delay: settings.delay || ForumCoreObserver.#CONFIG.performance.debounceThreshold,
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
    
    forceScan(selector = null) {
        if (selector) {
            // Scan specific selector
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                if (!this.#processedNodes.has(node)) {
                    this.#processNode(node, { source: 'force-scan', force: true });
                }
            }
        } else {
            // Full rescan
            this.#processedNodes = new WeakSet();
            this.#scanExistingContent(true);
        }
    }
    
    getStats() {
        return {
            // Mutation metrics
            totalMutations: this.#mutationMetrics.totalMutations,
            processedMutations: this.#mutationMetrics.processedMutations,
            droppedMutations: this.#mutationMetrics.droppedMutations,
            averageProcessingTime: this.#mutationMetrics.averageProcessingTime,
            lastMutationTime: this.#mutationMetrics.lastMutationTime,
            queueOverflows: this.#mutationMetrics.queueOverflows,
            
            // Observer metrics
            registeredCallbacks: this.#callbacks.size,
            debouncedCallbacks: this.#debouncedCallbacks.size,
            pendingTimeouts: this.#debounceTimeouts.size,
            processedNodes: this.#processedNodes.size,
            shadowObservations: this.#mutationMetrics.shadowObservations,
            iframeObservations: this.#mutationMetrics.iframeObservations,
            periodicScans: this.#mutationMetrics.periodicScans,
            
            // Error metrics
            errors: this.#mutationMetrics.errors,
            retries: this.#mutationMetrics.retries,
            errorCount: this.#errorTracker.errorCount,
            recoveryMode: this.#errorTracker.recoveryMode,
            recentErrors: this.#errorTracker.recentErrors.length,
            
            // State
            pageState: this.#pageState,
            isProcessing: this.#isProcessing,
            queueLength: this.#mutationQueue.length,
            initialScanComplete: this.#initialScanComplete,
            
            // Performance
            performanceStats: Object.fromEntries(this.#performanceStats)
        };
    }
    
    getPerformanceReport() {
        const report = {};
        
        for (const [key, stats] of this.#performanceStats.entries()) {
            report[key] = {
                count: stats.count,
                average: stats.avg,
                min: stats.min,
                max: stats.max,
                lastRecorded: new Date(stats.lastRecorded).toISOString()
            };
        }
        
        return report;
    }
    
    destroy() {
        console.log('🔄 Destroying ForumCoreObserver...');
        
        // Stop all observation
        this.#pause();
        
        // Clear intervals
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        if (this.#periodicScannerId) {
            clearInterval(this.#periodicScannerId);
        }
        
        if (this.#fallbackInterval) {
            clearInterval(this.#fallbackInterval);
        }
        
        if (this.#pollingFallbackId) {
            clearInterval(this.#pollingFallbackId);
        }
        
        // Clear intersection observers
        for (const observer of this.#intersectionObservers.values()) {
            observer.disconnect();
        }
        
        // Clear all collections
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#shadowObservers.clear();
        this.#iframeObservers.clear();
        this.#intersectionObservers.clear();
        this.#performanceStats.clear();
        
        this.#processedNodes = new WeakSet();
        this.#mutationQueue.length = 0;
        this.#debounceTimeouts.clear();
        
        // Remove event listeners
        document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
        window.removeEventListener('load', this.#handleWindowLoad);
        window.removeEventListener('pageshow', this.#handlePageShow);
        window.removeEventListener('pagehide', this.#handlePageHide);
        window.removeEventListener('popstate', this.#handlePopState);
        document.removeEventListener('forum:rescan', () => this.#scanExistingContent());
        window.removeEventListener('error', this.#handleGlobalError);
        
        console.log('✅ ForumCoreObserver destroyed');
    }
    
    static create() {
        return new ForumCoreObserver();
    }
}

// Global initialization with multiple fallback strategies
if (!globalThis.forumObserver) {
    (function initForumObserver() {
        try {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    initializeObserver();
                });
            } else {
                initializeObserver();
            }
            
            function initializeObserver() {
                try {
                    globalThis.forumObserver = ForumCoreObserver.create();
                    
                    // Global helper functions
                    globalThis.registerForumScript = function(settings) {
                        return globalThis.forumObserver ? 
                            globalThis.forumObserver.register(settings) : null;
                    };
                    
                    globalThis.registerDebouncedForumScript = function(settings) {
                        return globalThis.forumObserver ? 
                            globalThis.forumObserver.registerDebounced(settings) : null;
                    };
                    
                    globalThis.forceForumScan = function(selector) {
                        if (globalThis.forumObserver) {
                            globalThis.forumObserver.forceScan(selector);
                        }
                    };
                    
                    globalThis.getForumStats = function() {
                        return globalThis.forumObserver ? 
                            globalThis.forumObserver.getStats() : null;
                    };
                    
                    // Auto-cleanup
                    globalThis.addEventListener('pagehide', function() {
                        if (globalThis.forumObserver) {
                            globalThis.forumObserver.destroy();
                        }
                    }, { once: true });
                    
                    // Expose for debugging
                    if (globalThis.location.hostname === 'localhost' || 
                        globalThis.location.hostname === '127.0.0.1') {
                        globalThis.__FORUM_OBSERVER_DEBUG__ = globalThis.forumObserver;
                    }
                    
                    console.log('🚀 ForumCoreObserver v3.0 ready with redundancy systems');
                    
                } catch (error) {
                    console.error('Failed to initialize ForumCoreObserver:', error);
                    setupEmergencyFallback();
                }
            }
            
            function setupEmergencyFallback() {
                console.warn('⚠️ Setting up emergency fallback observer');
                
                globalThis.forumObserver = {
                    register: function(settings) {
                        console.warn('Emergency mode - register called for:', settings.id);
                        const id = 'emergency_' + Date.now();
                        
                        // Simple periodic scanning as fallback
                        const interval = setInterval(() => {
                            if (settings.selector) {
                                document.querySelectorAll(settings.selector).forEach(node => {
                                    try {
                                        settings.callback(node);
                                    } catch (e) {
                                        console.error('Emergency callback error:', e);
                                    }
                                });
                            }
                        }, 5000);
                        
                        return {
                            id,
                            unregister: () => clearInterval(interval)
                        };
                    },
                    
                    registerDebounced: function(settings) {
                        return this.register(settings);
                    },
                    
                    forceScan: function(selector) {
                        if (selector) {
                            document.querySelectorAll(selector).forEach(node => {
                                // Try to find and execute relevant callbacks
                                // This is very basic in emergency mode
                            });
                        }
                    },
                    
                    getStats: function() {
                        return { mode: 'emergency', message: 'Observer failed to initialize' };
                    },
                    
                    destroy: function() {
                        console.log('Emergency observer destroyed');
                    }
                };
            }
            
        } catch (error) {
            console.error('Critical observer initialization error:', error);
            
            // Last resort fallback
            globalThis.forumObserver = {
                register: () => ({ id: 'none', unregister: () => {} }),
                registerDebounced: () => ({ id: 'none', unregister: () => {} }),
                forceScan: () => {},
                getStats: () => ({ mode: 'failed' }),
                destroy: () => {}
            };
        }
    })();
}
