'use strict';

class BulletproofForumObserver {
    #observer = null;
    #rafObserver = null;
    #iframeObserver = null;
    #shadowObservers = new Map();
    #mutationQueue = new Set(); // Use Set for deduplication
    #processingQueue = new Set();
    #scheduledFrame = null;
    #initialScanComplete = false;
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    
    #callbacks = new Map();
    #pendingCallbacks = new Map();
    
    // Enhanced configuration
    static #CONFIG = {
        observer: {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'data-*', 'aria-*', 'role'],
            attributeOldValue: true,
            characterDataOldValue: true
        },
        iframeObserver: {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true
        },
        performance: {
            maxProcessingTime: 8, // Reduced for more frequent checks
            mutationBatchSize: 100,
            idleCallbackTimeout: 1000,
            rafCheckInterval: 100, // Check every 100ms via rAF
            forceRescanInterval: 10000 // Force rescan every 10s
        },
        memory: {
            maxProcessedNodes: 20000,
            cleanupInterval: 15000
        }
    };
    
    #metrics = {
        totalMutations: 0,
        processedMutations: 0,
        missedMutations: 0,
        lastMutationTime: 0,
        lastRescanTime: 0
    };
    
    constructor() {
        this.#init();
    }
    
    #init() {
        const allowedBodyIds = ['send', 'board', 'topic', 'forum', 'search', 'members', 'online', 'group'];
        const currentBodyId = document.body.id;
        
        if (!allowedBodyIds.includes(currentBodyId)) {
            console.log('⏸️ Observer skipped on body#' + currentBodyId);
            return;
        }
        
        // 1. Initialize primary observer
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        this.#observer.observe(document.documentElement, BulletproofForumObserver.#CONFIG.observer);
        
        // 2. Set up requestAnimationFrame polling as backup
        this.#startRAFMonitoring();
        
        // 3. Monitor iframe creation
        this.#setupIframeObserver();
        
        // 4. Monitor shadow DOM creation
        this.#setupShadowDOMObserver();
        
        // 5. Initial deep scan
        this.#deepScanExistingContent();
        
        // 6. Set up periodic forced rescans
        this.#setupPeriodicRescan();
        
        // 7. Monitor dynamic script execution
        this.#monitorDynamicScripts();
        
        // 8. Hook into mutation methods as fallback
        this.#hookDOMMethods();
        
        console.log('🛡️ Bulletproof Observer initialized');
    }
    
    #handleMutations(mutations) {
        this.#metrics.totalMutations += mutations.length;
        this.#metrics.lastMutationTime = Date.now();
        
        // Use Set to deduplicate nodes
        for (const mutation of mutations) {
            this.#collectAllAffectedNodes(mutation, this.#mutationQueue);
        }
        
        // Schedule processing
        if (!this.#scheduledFrame) {
            this.#scheduledFrame = requestAnimationFrame(() => {
                this.#processAllQueues();
                this.#scheduledFrame = null;
            });
        }
    }
    
    #collectAllAffectedNodes(mutation, collection) {
        const target = mutation.target;
        
        // Always add the target
        if (target && target.nodeType === Node.ELEMENT_NODE) {
            collection.add(target);
        }
        
        switch (mutation.type) {
            case 'childList':
                // Add all added nodes and their children
                for (const node of mutation.addedNodes) {
                    collection.add(node);
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.#collectAllElements(node, collection);
                        
                        // Special handling for DocumentFragment
                        if (node.nodeName === '#document-fragment') {
                            // Force immediate processing of fragment contents
                            queueMicrotask(() => {
                                this.#scanNodeTree(node);
                            });
                        }
                    }
                }
                break;
                
            case 'attributes':
                // Add target and potentially affected children
                collection.add(target);
                // If visibility changed, scan children
                if (mutation.attributeName === 'style' || 
                    mutation.attributeName === 'class' ||
                    mutation.attributeName === 'hidden') {
                    this.#collectAllElements(target, collection);
                }
                break;
                
            case 'characterData':
                // Add parent and all text-affected elements
                const parent = target.parentElement;
                if (parent) {
                    collection.add(parent);
                    // Text changes in interactive elements affect siblings
                    if (this.#isInteractiveElement(parent)) {
                        Array.from(parent.parentElement?.children || []).forEach(child => {
                            collection.add(child);
                        });
                    }
                }
                break;
        }
    }
    
    #collectAllElements(root, collection, depth = 0) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE || depth > 50) return;
        
        collection.add(root);
        
        // Use NodeIterator for better performance with large trees
        const iterator = document.createNodeIterator(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    // Skip already processed nodes unless they're dynamic containers
                    if (this.#processedNodes.has(node) && 
                        !this.#isDynamicContainer(node)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        let currentNode;
        while ((currentNode = iterator.nextNode())) {
            collection.add(currentNode);
        }
    }
    
    #isDynamicContainer(node) {
        if (!node.classList) return false;
        
        const dynamicClasses = [
            'dynamic', 'ajax', 'lazy', 'infinite-scroll',
            'modal', 'popup', 'tooltip', 'dropdown', 'tab-content',
            'accordion-content', 'carousel-item', 'slide'
        ];
        
        return dynamicClasses.some(cls => node.classList.contains(cls));
    }
    
    #isInteractiveElement(element) {
        const tagName = element.tagName.toLowerCase();
        const interactiveTags = ['a', 'button', 'input', 'textarea', 'select'];
        const interactiveRoles = ['button', 'link', 'textbox', 'checkbox', 'radio'];
        
        return interactiveTags.includes(tagName) || 
               interactiveRoles.includes(element.getAttribute('role')) ||
               element.classList.contains('clickable') ||
               element.classList.contains('interactive');
    }
    
    #startRAFMonitoring() {
        const checkForNewContent = () => {
            // Check for elements that might have been missed
            this.#checkForMissedContent();
            
            // Reschedule
            setTimeout(() => {
                if (this.#rafObserver !== null) { // Check if still active
                    this.#rafObserver = requestAnimationFrame(checkForNewContent);
                }
            }, BulletproofForumObserver.#CONFIG.performance.rafCheckInterval);
        };
        
        this.#rafObserver = requestAnimationFrame(checkForNewContent);
    }
    
    #checkForMissedContent() {
        // Selectors that frequently have dynamic content
        const dynamicSelectors = [
            '.post:not([data-observed])',
            '.modal:not([data-observed])',
            '[data-dynamic]:not([data-observed])',
            '[data-ajax]:not([data-observed])',
            '.lazy-loaded:not([data-observed])'
        ];
        
        for (const selector of dynamicSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (!this.#processedNodes.has(element)) {
                    this.#mutationQueue.add(element);
                    element.dataset.observed = 'true';
                }
            }
        }
        
        // Check for newly visible elements
        const hiddenNowVisible = document.querySelectorAll(
            '[style*="display: block"], [style*="display: flex"], [style*="visibility: visible"]'
        );
        
        for (const element of hiddenNowVisible) {
            if (!this.#processedNodes.has(element)) {
                this.#mutationQueue.add(element);
            }
        }
    }
    
    #setupIframeObserver() {
        // Watch for iframe creation
        this.#iframeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === 'IFRAME') {
                        this.#monitorIframeContent(node);
                    }
                }
            }
        });
        
        this.#iframeObserver.observe(document.body, { childList: true, subtree: true });
        
        // Monitor existing iframes
        document.querySelectorAll('iframe').forEach(iframe => {
            this.#monitorIframeContent(iframe);
        });
    }
    
    #monitorIframeContent(iframe) {
        try {
            // Wait for iframe to load
            iframe.addEventListener('load', () => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) {
                        const observer = new MutationObserver((mutations) => {
                            this.#handleMutations(mutations);
                        });
                        
                        observer.observe(iframeDoc.documentElement, 
                            BulletproofForumObserver.#CONFIG.iframeObserver);
                        
                        // Store for cleanup
                        iframe.dataset.observerId = Date.now();
                        this.#shadowObservers.set(iframe.dataset.observerId, observer);
                        
                        // Scan existing iframe content
                        this.#scanNodeTree(iframeDoc.body);
                    }
                } catch (e) {
                    console.warn('Cannot monitor iframe due to CORS:', e);
                }
            }, { once: true });
        } catch (e) {
            // CORS restrictions
        }
    }
    
    #setupShadowDOMObserver() {
        // Override attachShadow to monitor shadow DOM
        const originalAttachShadow = Element.prototype.attachShadow;
        
        Element.prototype.attachShadow = function(options) {
            const shadowRoot = originalAttachShadow.call(this, options);
            
            // Monitor shadow DOM mutations
            const observer = new MutationObserver((mutations) => {
                this.#handleMutations(mutations);
            });
            
            observer.observe(shadowRoot, BulletproofForumObserver.#CONFIG.observer);
            
            // Store for cleanup
            const observerId = 'shadow_' + Date.now();
            shadowRoot.dataset.observerId = observerId;
            this.#shadowObservers.set(observerId, observer);
            
            // Scan existing shadow content
            queueMicrotask(() => {
                this.#scanNodeTree(shadowRoot);
            });
            
            return shadowRoot;
        };
        
        // Restore on cleanup
        this.#originalAttachShadow = originalAttachShadow;
    }
    
    #monitorDynamicScripts() {
        // Override document.createElement to catch script elements
        const originalCreateElement = document.createElement.bind(document);
        
        document.createElement = function(tagName, options) {
            const element = originalCreateElement(tagName, options);
            
            if (tagName.toLowerCase() === 'script') {
                // Monitor script execution
                const originalSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
                
                if (originalSrc && originalSrc.set) {
                    Object.defineProperty(element, 'src', {
                        set: function(value) {
                            originalSrc.set.call(this, value);
                            // Schedule a check after script loads
                            element.addEventListener('load', () => {
                                setTimeout(() => this.#forceFullRescan(), 100);
                            }, { once: true });
                        },
                        get: originalSrc.get
                    });
                }
                
                if (originalInnerHTML && originalInnerHTML.set) {
                    Object.defineProperty(element, 'innerHTML', {
                        set: function(value) {
                            originalInnerHTML.set.call(this, value);
                            // Immediate check for inline scripts
                            queueMicrotask(() => this.#forceFullRescan());
                        },
                        get: originalInnerHTML.get
                    });
                }
            }
            
            return element;
        }.bind(this);
        
        this.#originalCreateElement = originalCreateElement;
    }
    
    #hookDOMMethods() {
        // Hook DOM manipulation methods as fallback
        const methodsToHook = [
            'appendChild',
            'insertBefore',
            'replaceChild',
            'removeChild',
            'insertAdjacentElement',
            'insertAdjacentHTML',
            'insertAdjacentText'
        ];
        
        for (const methodName of methodsToHook) {
            const originalMethod = Node.prototype[methodName];
            
            if (originalMethod) {
                Node.prototype[methodName] = function(...args) {
                    const result = originalMethod.apply(this, args);
                    
                    // Schedule mutation detection
                    if (this.isConnected) {
                        queueMicrotask(() => {
                            const event = new CustomEvent('dommethodcalled', {
                                detail: { method: methodName, args: args }
                            });
                            document.dispatchEvent(event);
                        });
                    }
                    
                    return result;
                };
                
                // Store for cleanup
                this[`#original${methodName}`] = originalMethod;
            }
        }
        
        // Listen for these events
        document.addEventListener('dommethodcalled', () => {
            this.#forceImmediateRescan();
        }, { passive: true });
    }
    
    #forceImmediateRescan() {
        // Clear any pending processing
        if (this.#scheduledFrame) {
            cancelAnimationFrame(this.#scheduledFrame);
            this.#scheduledFrame = null;
        }
        
        // Immediate rescan
        this.#processAllQueues();
        
        // Quick scan for new content
        queueMicrotask(() => {
            this.#quickRescan();
        });
    }
    
    #quickRescan() {
        // Check common dynamic containers
        const dynamicContainers = [
            '.posts-container',
            '.comments-section',
            '.dynamic-content',
            '[data-content]',
            '.ajax-container'
        ];
        
        for (const selector of dynamicContainers) {
            const containers = document.querySelectorAll(selector);
            for (const container of containers) {
                this.#scanNodeTree(container);
            }
        }
    }
    
    async #processAllQueues() {
        if (this.#processingQueue.size > 0) return;
        
        // Move all pending nodes to processing queue
        this.#processingQueue = new Set(this.#mutationQueue);
        this.#mutationQueue.clear();
        
        const startTime = performance.now();
        
        try {
            // Process in chunks to avoid blocking
            const nodes = Array.from(this.#processingQueue);
            const chunkSize = 25;
            
            for (let i = 0; i < nodes.length; i += chunkSize) {
                const chunk = nodes.slice(i, i + chunkSize);
                
                // Process chunk
                await this.#processNodeChunk(chunk);
                
                // Yield to main thread if taking too long
                if (performance.now() - startTime > 
                    BulletproofForumObserver.#CONFIG.performance.maxProcessingTime) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            this.#metrics.processedMutations += this.#processingQueue.size;
        } catch (error) {
            console.error('Queue processing error:', error);
            this.#metrics.missedMutations += this.#processingQueue.size;
        } finally {
            this.#processingQueue.clear();
        }
    }
    
    async #processNodeChunk(nodes) {
        const promises = nodes.map(async (node) => {
            if (!node || !node.isConnected || this.#processedNodes.has(node)) {
                return;
            }
            
            try {
                // Execute all matching callbacks
                await this.#executeNodeCallbacks(node);
                this.#processedNodes.add(node);
                
                // Mark as processed for debugging
                if (node.dataset) {
                    node.dataset.observerProcessed = Date.now().toString();
                }
            } catch (error) {
                console.warn('Node processing failed:', error);
            }
        });
        
        await Promise.allSettled(promises);
    }
    
    #executeNodeCallbacks(node) {
        const matchingCallbacks = [];
        
        for (const callback of this.#callbacks.values()) {
            // Check if callback applies to this node
            if (this.#callbackMatchesNode(callback, node)) {
                matchingCallbacks.push(callback);
            }
        }
        
        if (matchingCallbacks.length === 0) return;
        
        // Execute callbacks with different priorities
        const priorityGroups = {
            immediate: [],
            high: [],
            normal: [],
            low: []
        };
        
        for (const callback of matchingCallbacks) {
            const priority = callback.priority || 'normal';
            priorityGroups[priority].push(callback);
        }
        
        // Execute immediate first
        return Promise.allSettled(
            priorityGroups.immediate.map(cb => cb.fn(node))
        ).then(() => {
            // Schedule others
            ['high', 'normal', 'low'].forEach(priority => {
                if (priorityGroups[priority].length > 0) {
                    const delay = { high: 0, normal: 10, low: 100 }[priority];
                    setTimeout(() => {
                        priorityGroups[priority].forEach(cb => {
                            try {
                                cb.fn(node);
                            } catch (e) {
                                console.error('Callback error:', e);
                            }
                        });
                    }, delay);
                }
            });
        });
    }
    
    #callbackMatchesNode(callback, node) {
        // Page type check
        if (callback.pageTypes && callback.pageTypes.length) {
            const pageState = this.#detectPageState();
            const matchesPage = callback.pageTypes.some(type => 
                pageState[`is${type.charAt(0).toUpperCase() + type.slice(1)}`]
            );
            if (!matchesPage) return false;
        }
        
        // Selector check
        if (callback.selector) {
            if (!node.matches(callback.selector) && 
                !node.querySelector(callback.selector)) {
                return false;
            }
        }
        
        return true;
    }
    
    #deepScanExistingContent() {
        console.time('DeepScan');
        
        // Use TreeWalker for comprehensive scanning
        const treeWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    // Skip already processed nodes
                    if (this.#processedNodes.has(node)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip hidden nodes initially
                    const style = window.getComputedStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return NodeFilter.FILTER_SKIP;
                    }
                    
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        const nodesToProcess = [];
        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            nodesToProcess.push(currentNode);
            
            // Process in chunks to avoid blocking
            if (nodesToProcess.length >= 100) {
                this.#mutationQueue = new Set([...this.#mutationQueue, ...nodesToProcess]);
                nodesToProcess.length = 0;
                
                // Yield to main thread
                setTimeout(() => {}, 0);
            }
        }
        
        // Process remaining nodes
        if (nodesToProcess.length > 0) {
            this.#mutationQueue = new Set([...this.#mutationQueue, ...nodesToProcess]);
        }
        
        // Also scan text nodes in interactive elements
        const textWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    return parent && this.#isInteractiveElement(parent) ? 
                        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );
        
        while ((currentNode = textWalker.nextNode())) {
            if (currentNode.parentElement) {
                this.#mutationQueue.add(currentNode.parentElement);
            }
        }
        
        console.timeEnd('DeepScan');
        this.#initialScanComplete = true;
        console.log('✅ Deep scan complete');
        
        // Schedule immediate processing
        this.#forceImmediateRescan();
    }
    
    #scanNodeTree(root) {
        if (!root) return;
        
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );
        
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            if (!this.#processedNodes.has(node)) {
                nodes.push(node);
            }
        }
        
        if (nodes.length > 0) {
            this.#mutationQueue = new Set([...this.#mutationQueue, ...nodes]);
            this.#forceImmediateRescan();
        }
    }
    
    #setupPeriodicRescan() {
        // Force periodic rescans to catch missed content
        setInterval(() => {
            if (performance.now() - this.#metrics.lastRescanTime > 10000) {
                this.#metrics.lastRescanTime = performance.now();
                this.#quickRescan();
                
                // Full rescan every 5 minutes
                if (this.#metrics.lastRescanTime % 300000 < 10000) {
                    this.#deepScanExistingContent();
                }
            }
        }, 5000);
    }
    
    // Keep existing #detectPageState, #pause, #resume, #handleVisibilityChange methods
    // from the previous version (they're already good)
    
    // ... [Include all the other methods from previous version] ...
    
    // Enhanced public API methods
    register(settings) {
        const id = settings.id || `cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        
        const callback = {
            id,
            fn: settings.callback,
            priority: settings.priority || 'normal',
            selector: settings.selector,
            pageTypes: settings.pageTypes,
            capturePhase: settings.capturePhase || false,
            immediate: settings.immediate === true,
            retryOnFail: settings.retryOnFail !== false,
            maxRetries: settings.maxRetries || 3
        };
        
        this.#callbacks.set(id, callback);
        
        // Immediate execution for existing matching nodes
        if (this.#initialScanComplete && callback.selector) {
            const matchingNodes = document.querySelectorAll(callback.selector);
            matchingNodes.forEach(node => {
                if (!this.#processedNodes.has(node)) {
                    this.#mutationQueue.add(node);
                }
            });
            this.#forceImmediateRescan();
        }
        
        return id;
    }
    
    // Enhanced destroy to clean up all hooks
    destroy() {
        // Restore original methods
        if (this.#originalAttachShadow) {
            Element.prototype.attachShadow = this.#originalAttachShadow;
        }
        
        if (this.#originalCreateElement) {
            document.createElement = this.#originalCreateElement;
        }
        
        // Restore DOM methods
        const methods = [
            'appendChild', 'insertBefore', 'replaceChild', 'removeChild',
            'insertAdjacentElement', 'insertAdjacentHTML', 'insertAdjacentText'
        ];
        
        methods.forEach(method => {
            const original = this[`#original${method}`];
            if (original) {
                Node.prototype[method] = original;
            }
        });
        
        // Clean up all observers
        if (this.#rafObserver) {
            cancelAnimationFrame(this.#rafObserver);
            this.#rafObserver = null;
        }
        
        if (this.#iframeObserver) {
            this.#iframeObserver.disconnect();
            this.#iframeObserver = null;
        }
        
        if (this.#observer) {
            this.#observer.disconnect();
            this.#observer = null;
        }
        
        // Clean up shadow DOM observers
        this.#shadowObservers.forEach(observer => observer.disconnect());
        this.#shadowObservers.clear();
        
        // Clear intervals
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        // Clear all data
        this.#callbacks.clear();
        this.#pendingCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#mutationQueue.clear();
        this.#processingQueue.clear();
        
        console.log('🔄 Bulletproof Observer completely destroyed');
    }
}

// Initialize
if (!globalThis.forumObserver) {
    // ... [Initialization code similar to before] ...
}
