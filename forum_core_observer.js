'use strict';

class ForumCoreObserver {
    #observer = null;
    #iframeObservers = null;
    #shadowObservers = null;
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
            styleMutationThrottle: 16,
            maxContinuousProcessing: 100
        },
        memory: {
            maxProcessedNodes: 10000,
            cleanupInterval: 30000,
            nodeTTL: 300000,
            maxCallbackRetries: 3
        },
        priorities: {
            childList: 1,
            attributes: 2,
            characterData: 3
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
        this.#iframeObservers = new WeakMap();
        this.#shadowObservers = new WeakMap();
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
    
    // ===== EDITOR DETECTION HELPER =====
    #isInEditor(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        
        try {
            // Check if element or any parent is in wysiwyg editor
            if (element.closest) {
                return !!(
                    element.closest('.tiptap') ||
                    element.closest('.ProseMirror') ||
                    element.closest('[contenteditable="true"]') ||
                    element.closest('[role="textbox"]')
                );
            }
            
            // Fallback for older browsers
            let parent = element;
            while (parent && parent !== document.body) {
                if (parent.classList && (
                    parent.classList.contains('tiptap') ||
                    parent.classList.contains('ProseMirror')
                )) {
                    return true;
                }
                if (parent.getAttribute && parent.getAttribute('contenteditable') === 'true') {
                    return true;
                }
                parent = parent.parentElement;
            }
            return false;
        } catch(e) {
            return false;
        }
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
            
            this.#observeStyleChanges();
            
            this.#log('ForumCoreObserver initialized (GLOBAL - enhanced mode)');
        } catch (error) {
            this.#error('Failed to initialize:', error);
            this.#scheduleReset();
        }
    }
    
    #setupErrorHandling() {
        window.addEventListener('error', (event) => {
            if (event.error && event.error.message && event.error.message.includes('ForumObserver')) {
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
        if ('performance' in window && 'memory' in performance) {
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
                        if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'STYLE' || node.tagName === 'LINK')) {
                            this.#handleNewStyles(node);
                        }
                    });
                }
            });
        });
        
        if (document.head) {
            styleObserver.observe(document.head, {
                childList: true,
                subtree: true
            });
        } else {
            const headCheck = setInterval(() => {
                if (document.head) {
                    clearInterval(headCheck);
                    styleObserver.observe(document.head, {
                        childList: true,
                        subtree: true
                    });
                }
            }, 50);
        }
    }
    
    #handleNewStyles(styleNode) {
        setTimeout(() => {
            const affectedSelectors = this.#extractSelectorsFromStyles(styleNode);
            affectedSelectors.forEach(selector => {
                try {
                    document.querySelectorAll(selector).forEach(el => {
                        if (!this.#processedNodes.has(el) && !this.#isInEditor(el)) {
                            this.#processNode(el);
                        }
                    });
                } catch (e) {
                    // Ignore invalid selectors
                }
            });
        }, 100);
    }
    
    #extractSelectorsFromStyles(styleNode) {
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
            // CORS or other issues - silently ignore
        }
        return selectors;
    }
    
    #setupIframeObservation() {
        document.addEventListener('load', (e) => {
            if (e.target && e.target.tagName === 'IFRAME') {
                this.#observeIframe(e.target);
            }
        }, true);
        
        if (document.querySelectorAll) {
            document.querySelectorAll('iframe').forEach(iframe => this.#observeIframe(iframe));
        }
    }
    
    #observeIframe(iframe) {
        try {
            if (!iframe || !iframe.contentDocument) {
                return;
            }
            
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc && iframeDoc.documentElement) {
                const iframeObserver = new MutationObserver((mutations) => {
                    this.#handleIframeMutations(mutations, iframe);
                });
                iframeObserver.observe(iframeDoc.documentElement, 
                    ForumCoreObserver.#CONFIG.observer);
                
                if (!this.#iframeObservers) {
                    this.#iframeObservers = new WeakMap();
                }
                
                this.#iframeObservers.set(iframe, iframeObserver);
                
                this.#scanIframeContent(iframeDoc);
            }
        } catch (e) {
            this.#log('Cannot observe cross-origin iframe');
        }
    }
    
    #scanIframeContent(doc) {
        if (!doc || !doc.querySelectorAll) return;
        
        const elements = doc.querySelectorAll('*');
        elements.forEach(el => {
            if (!this.#processedNodes.has(el) && !this.#isInEditor(el)) {
                this.#processNode(el);
            }
        });
    }
    
    #handleIframeMutations(mutations, iframe) {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node && node.nodeType === Node.ELEMENT_NODE) {
                        const affectedNodes = new Set();
                        this.#collectAllElements(node, affectedNodes);
                        affectedNodes.forEach(el => {
                            if (el && !this.#processedNodes.has(el) && !this.#isInEditor(el)) {
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
                    if (!this.#processedNodes.has(entry.target) && !this.#isInEditor(entry.target)) {
                        this.#processNode(entry.target);
                    }
                    this.#intersectionObserver.unobserve(entry.target);
                }
            });
        }, { 
            rootMargin: '200px',
            threshold: 0.01 
        });
        
        this.#observeLazyElements();
    }
    
    #observeLazyElements() {
        const lazySelectors = [
            '.lazy', '.lazy-load', '[data-src]', '[loading="lazy"]',
            '.post', '.content', '.article', '.preview'
        ];
        
        lazySelectors.forEach(selector => {
            try {
                if (document.querySelectorAll) {
                    document.querySelectorAll(selector).forEach(el => {
                        if (el && !this.#processedNodes.has(el) && !this.#isInEditor(el)) {
                            this.#intersectionObserver.observe(el);
                        }
                    });
                }
            } catch (e) {
                // Ignore invalid selectors
            }
        });
    }
    
    #setupResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            this.#resizeObserver = new ResizeObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                        if (!this.#processedNodes.has(entry.target) && !this.#isInEditor(entry.target)) {
                            this.#processNode(entry.target);
                        }
                    }
                });
            });
            
            const containerSelectors = [
                '.post-content', '.expandable', '.collapsible',
                '.dropdown-content', '.modal-content'
            ];
            
            containerSelectors.forEach(selector => {
                try {
                    if (document.querySelectorAll) {
                        document.querySelectorAll(selector).forEach(el => {
                            if (el && this.#resizeObserver) {
                                this.#resizeObserver.observe(el);
                            }
                        });
                    }
                } catch (e) {
                    // Ignore invalid selectors
                }
            });
        }
    }
    
    #setupAnimationObserver() {
        if (typeof AnimationObserver !== 'undefined') {
            this.#animationObserver = new AnimationObserver((animations) => {
                animations.forEach(animation => {
                    const target = animation.effect ? animation.effect.target : null;
                    if (target && !this.#processedNodes.has(target) && !this.#isInEditor(target)) {
                        this.#processNode(target);
                    }
                });
            });
        } else {
            document.addEventListener('animationstart', (e) => {
                if (e.target && !this.#processedNodes.has(e.target) && !this.#isInEditor(e.target)) {
                    this.#processNode(e.target);
                }
            }, true);
            
            document.addEventListener('transitionstart', (e) => {
                if (e.target && !this.#processedNodes.has(e.target) && !this.#isInEditor(e.target)) {
                    this.#processNode(e.target);
                }
            }, true);
        }
    }
    
    #handleLoadEvents(e) {
        const target = e.target;
        if (target && target.nodeType === Node.ELEMENT_NODE) {
            if (target.tagName === 'IMG' || target.tagName === 'VIDEO' || 
                target.tagName === 'IFRAME' || target.tagName === 'SCRIPT') {
                if (!this.#processedNodes.has(target) && !this.#isInEditor(target)) {
                    this.#processNode(target);
                }
            }
        }
    }
    
    #setupScriptCoordination() {
        window.addEventListener('weserv-ready', (e) => {
            this.#scriptsReady.weserv = true;
            this.#log('Weserv ready event received', e.detail || '');
            
            if (globalThis.mediaDimensionExtractor && typeof globalThis.mediaDimensionExtractor.refresh === 'function') {
                queueMicrotask(() => {
                    globalThis.mediaDimensionExtractor.refresh();
                });
            }
            
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        window.addEventListener('dimension-extractor-ready', (e) => {
            this.#scriptsReady.dimensionExtractor = true;
            this.#log('Dimension extractor ready', e.detail || '');
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
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
            
            if (globalThis.mediaDimensionExtractor && typeof globalThis.mediaDimensionExtractor.forceReprocessElement === 'function') {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(() => {
                        const unprocessed = document.querySelectorAll('img:not([width])');
                        if (unprocessed.length) {
                            this.#log(`Processing ${unprocessed.length} missed images`);
                            unprocessed.forEach(img => {
                                if (img && !this.#isInEditor(img)) {
                                    globalThis.mediaDimensionExtractor.forceReprocessElement(img);
                                }
                            });
                        }
                    }, { timeout: 1000 });
                } else {
                    setTimeout(() => {
                        const unprocessed = document.querySelectorAll('img:not([width])');
                        if (unprocessed.length) {
                            this.#log(`Processing ${unprocessed.length} missed images`);
                            unprocessed.forEach(img => {
                                if (img && !this.#isInEditor(img)) {
                                    globalThis.mediaDimensionExtractor.forceReprocessElement(img);
                                }
                            });
                        }
                    }, 100);
                }
            }
        }
    }
    
    #detectPageState() {
        const pathname = window.location.pathname || '';
        const className = document.body ? document.body.className : '';
        const theme = document.documentElement ? document.documentElement.dataset?.theme : null;
        const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
        
        const selectors = {
            forum: '.board, .big_list',
            topic: '.modern-topic-title, .post',
            blog: '#blog, .article',
            profile: '.modern-profile, .profile',
            search: '#search.posts, body#search',
            modernized: '.post-modernized'
        };
        
        const pageChecks = {};
        for (const key in selectors) {
            if (selectors.hasOwnProperty(key)) {
                try {
                    pageChecks[key] = document.querySelector(selectors[key]) || null;
                } catch (e) {
                    pageChecks[key] = null;
                }
            }
        }
        
        return {
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            hasModernizedPosts: !!pageChecks.modernized,
            hasModernizedQuotes: !!(document && document.querySelector('.modern-quote')),
            hasModernizedProfile: !!(document && document.querySelector('.modern-profile')),
            hasModernizedNavigation: !!(document && document.querySelector('.modern-nav')),
            currentTheme: theme || (prefersDark ? 'dark' : 'light'),
            themeMode: theme ? 'manual' : 'auto',
            isDarkMode: theme === 'dark' || (!theme && prefersDark),
            isLightMode: theme === 'light' || (!theme && !prefersDark),
            isLoggedIn: !!(document && document.querySelector('.menuwrap .avatar')),
            isMobile: window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : false,
            isSendPage: !!(document && (document.body && document.body.id === 'send' || className.includes('send'))),
            hasPreview: !!(document && document.querySelector('#preview, #ajaxObject, .preview, .Item.preview'))
        };
    }
    
    #setupThemeListener() {
        window.addEventListener('themechange', (e) => {
            const { theme } = e.detail || { theme: 'light' };
            this.#log(`Theme change detected: ${theme}`);
            this.#pageState = this.#detectPageState();
            this.#notifyThemeDependentCallbacks(theme);
            this.#rescanThemeSensitiveElements(theme);
            this.#updateThemeAttributes(theme);
        }, { passive: true });
        
        if (window.matchMedia) {
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
    }
    
    #notifyThemeDependentCallbacks(newTheme) {
        const themeDependentCallbacks = Array.from(this.#callbacks.values()).filter(callback => {
            return callback && callback.dependencies && (
                callback.dependencies.includes('theme') ||
                callback.dependencies.includes('theme-change') ||
                callback.dependencies.includes('data-theme')
            );
        });
        
        if (themeDependentCallbacks.length) {
            themeDependentCallbacks.forEach(callback => {
                try {
                    if (callback && typeof callback.fn === 'function') {
                        callback.fn(document.documentElement, newTheme);
                    }
                } catch (error) {
                    this.#error(`Theme callback ${callback ? callback.id : 'unknown'} failed:`, error);
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
        
        const processElements = () => {
            themeSensitiveSelectors.forEach(selector => {
                try {
                    if (document.querySelectorAll) {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            if (element && !this.#isInEditor(element)) {
                                this.#processedNodes.delete(element);
                                this.#processNode(element);
                            }
                        });
                    }
                } catch (e) {
                    // Ignore invalid selectors
                }
            });
        };
        
        if ('requestIdleCallback' in window) {
            requestIdleCallback(processElements, { timeout: 500 });
        } else {
            setTimeout(processElements, 100);
        }
    }
    
    #updateThemeAttributes(theme) {
        const elementsToUpdate = [
            '.cs-fui.st-emoji-pop', '.st-emoji-container', 
            '.post-modernized', '.post.preview'
        ];
        
        elementsToUpdate.forEach(selector => {
            try {
                if (document.querySelectorAll) {
                    document.querySelectorAll(selector).forEach(el => {
                        if (el && !this.#isInEditor(el)) {
                            el.setAttribute('data-theme', theme);
                        }
                    });
                }
            } catch (e) {
                // Ignore invalid selectors
            }
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
                if (this.#observer) {
                    this.#observer.disconnect();
                }
                this.#observer = new MutationObserver(this.#handleMutationsWithRetry.bind(this));
                this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
                this.#errorCount = 0;
            }
        }
    }
    
    #handleMutations(mutations) {
        // Filter out editor mutations FIRST
        const filteredMutations = [];
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            const target = mutation.target;
            
            // Skip editor content completely
            if (target && target.nodeType === Node.ELEMENT_NODE) {
                if (this.#isInEditor(target)) {
                    continue;
                }
            } else if (target && target.parentElement) {
                if (this.#isInEditor(target.parentElement)) {
                    continue;
                }
            }
            
            filteredMutations.push(mutation);
        }
        
        // Process only non-editor mutations
        if (filteredMutations.length === 0) return;
        
        this.#mutationMetrics.totalMutations += filteredMutations.length;
        this.#mutationMetrics.lastMutationTime = Date.now();
        
        const startTime = performance.now();
        
        for (let i = 0; i < filteredMutations.length; i++) {
            const mutation = filteredMutations[i];
            
            if (!mutation || !mutation.target) continue;
            
            if (mutation.target && mutation.target.dataset && mutation.target.dataset.observerOrigin === 'forum-script') {
                continue;
            }
            
            if (this.#shouldProcessMutation(mutation)) {
                const priority = this.#getMutationPriority(mutation);
                if (priority && this.#priorityQueue[priority]) {
                    this.#priorityQueue[priority].push(mutation);
                }
            }
            
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
        if (!mutation || !mutation.type) return 'medium';
        
        const basePriority = ForumCoreObserver.#CONFIG.priorities[mutation.type] || 2;
        
        if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'src' || mutation.attributeName === 'href') {
                return 'high';
            }
            if (mutation.attributeName === 'class' && 
                mutation.target && mutation.target.classList && mutation.target.classList.contains('lazy')) {
                return 'high';
            }
        }
        
        if (mutation.type === 'childList' && 
            mutation.addedNodes && mutation.addedNodes.length > 10) {
            return 'medium';
        }
        
        return basePriority === 1 ? 'high' : basePriority === 2 ? 'medium' : 'low';
    }
    
    #shouldProcessMutation(mutation) {
        const target = mutation.target;
        
        if (!target) return false;
        
        // Skip mutations from our own scripts
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip hidden elements
        if (target.nodeType === Node.ELEMENT_NODE) {
            try {
                const style = window.getComputedStyle(target);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    if (mutation.type === 'attributes' && 
                        (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
                        return true;
                    }
                    return false;
                }
            } catch (e) {
                return true;
            }
        }
        
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            return true;
        }
        
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const now = Date.now();
            if (now - this.#lastStyleMutation < ForumCoreObserver.#CONFIG.performance.styleMutationThrottle) {
                return false;
            }
            this.#lastStyleMutation = now;
            
            const oldValue = mutation.oldValue || '';
            const newValue = target.getAttribute ? target.getAttribute('style') || '' : '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        if (mutation.type === 'characterData') {
            const parent = target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        return true;
    }
    
    #shouldObserveTextChanges(element) {
        if (!element || !element.tagName) return false;
        
        const tagName = element.tagName.toLowerCase();
        
        if (tagName === 'a' || tagName === 'button' || tagName === 'input' || 
            tagName === 'textarea' || tagName === 'select') {
            return true;
        }
        
        const classList = element.classList;
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
        const visibilityProps = ['display', 'visibility', 'opacity', 'position', 'width', 'height'];
        const oldProps = this.#parseStyleString(oldStyle);
        const newProps = this.#parseStyleString(newStyle);
        
        for (let i = 0; i < visibilityProps.length; i++) {
            const prop = visibilityProps[i];
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
        
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const colonIndex = pair.indexOf(':');
            if (colonIndex > -1) {
                const key = pair.substring(0, colonIndex).trim();
                const value = pair.substring(colonIndex + 1).trim();
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
        let startTime = performance.now();
        
        try {
            const priorities = ['high', 'medium', 'low'];
            
            for (const priority of priorities) {
                const queue = this.#priorityQueue[priority];
                
                while (queue && queue.length) {
                    const batchSize = Math.min(
                        priority === 'high' ? 25 : 
                        priority === 'medium' ? 50 : 100,
                        queue.length
                    );
                    
                    const batch = queue.splice(0, batchSize);
                    await this.#processMutationBatch(batch, priority);
                    
                    const totalQueue = (this.#priorityQueue.high ? this.#priorityQueue.high.length : 0) + 
                                      (this.#priorityQueue.medium ? this.#priorityQueue.medium.length : 0) + 
                                      (this.#priorityQueue.low ? this.#priorityQueue.low.length : 0);
                    this.#mutationMetrics.queueHighWatermark = Math.max(
                        this.#mutationMetrics.queueHighWatermark, 
                        totalQueue
                    );
                    
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
            
            const processingTime = performance.now() - startTime;
            this.#mutationMetrics.averageProcessingTime = 
                this.#mutationMetrics.averageProcessingTime * 0.9 + processingTime * 0.1;
        }
    }
    
    async #processMutationBatch(mutations, priority) {
        const affectedNodes = new Set();
        
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            
            if (!mutation || !mutation.target) continue;
            
            switch (mutation.type) {
                case 'childList':
                    if (mutation.addedNodes) {
                        for (let j = 0; j < mutation.addedNodes.length; j++) {
                            const node = mutation.addedNodes[j];
                            if (node && node.nodeType === Node.ELEMENT_NODE && !this.#isInEditor(node)) {
                                this.#collectAllElements(node, affectedNodes);
                                
                                if (node.shadowRoot) {
                                    this.#collectAllElements(node.shadowRoot, affectedNodes);
                                    this.#observeShadowRoot(node.shadowRoot, node);
                                }
                            }
                        }
                    }
                    
                    if (mutation.removedNodes) {
                        for (let j = 0; j < mutation.removedNodes.length; j++) {
                            const node = mutation.removedNodes[j];
                            if (node && node.nodeType === Node.ELEMENT_NODE) {
                                this.#cleanupRemovedNode(node);
                            }
                        }
                    }
                    break;
                    
                case 'attributes':
                    if (mutation.target && !this.#isInEditor(mutation.target)) {
                        affectedNodes.add(mutation.target);
                        
                        if (mutation.attributeName === 'data-theme') {
                            this.#pageState = this.#detectPageState();
                            const theme = mutation.target.getAttribute ? mutation.target.getAttribute('data-theme') : null;
                            if (theme) {
                                this.#notifyThemeDependentCallbacks(theme);
                            }
                        }
                        
                        if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                            try {
                                const style = window.getComputedStyle(mutation.target);
                                if (style.display !== 'none' && style.visibility !== 'hidden') {
                                    affectedNodes.add(mutation.target);
                                }
                            } catch (e) {
                                // Ignore style computation errors
                            }
                        }
                    }
                    break;
                    
                case 'characterData':
                    if (mutation.target) {
                        const parent = mutation.target.parentElement;
                        if (parent && !this.#isInEditor(parent)) {
                            affectedNodes.add(parent);
                        }
                    }
                    break;
            }
        }
        
        const nodeArray = Array.from(affectedNodes);
        const nodesToProcess = [];
        
        for (let k = 0; k < nodeArray.length; k++) {
            const node = nodeArray[k];
            if (node && !this.#processedNodes.has(node)) {
                nodesToProcess.push(node);
                this.#nodeTimestamps.set(node, Date.now());
            }
        }
        
        if (!nodesToProcess.length) return;
        
        this.#mutationMetrics.totalNodesProcessed += nodesToProcess.length;
        
        const CONCURRENCY_LIMIT = priority === 'high' ? 8 : priority === 'medium' ? 4 : 2;
        const chunks = [];
        
        for (let l = 0; l < nodesToProcess.length; l += CONCURRENCY_LIMIT) {
            chunks.push(nodesToProcess.slice(l, l + CONCURRENCY_LIMIT));
        }
        
        for (let m = 0; m < chunks.length; m++) {
            const chunk = chunks[m];
            const promises = [];
            
            for (let n = 0; n < chunk.length; n++) {
                promises.push(this.#processNode(chunk[n]));
            }
            
            await Promise.allSettled(promises);
        }
    }
    
    #observeShadowRoot(shadowRoot, host) {
        if (!shadowRoot || !host) return;
        
        if (this.#shadowObservers && this.#shadowObservers.has(host)) return;
        
        const shadowObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node && node.nodeType === Node.ELEMENT_NODE && !this.#isInEditor(node)) {
                            const affectedNodes = new Set();
                            this.#collectAllElements(node, affectedNodes);
                            affectedNodes.forEach(el => {
                                if (el && !this.#processedNodes.has(el)) {
                                    this.#processNode(el);
                                }
                            });
                        }
                    });
                }
            });
        });
        
        shadowObserver.observe(shadowRoot, ForumCoreObserver.#CONFIG.observer);
        
        if (!this.#shadowObservers) {
            this.#shadowObservers = new WeakMap();
        }
        
        this.#shadowObservers.set(host, shadowObserver);
    }
    
    #cleanupRemovedNode(node) {
        if (!node) return;
        
        this.#processedNodes.delete(node);
        this.#nodeTimestamps.delete(node);
        
        if (this.#shadowObservers && this.#shadowObservers.has(node)) {
            const observer = this.#shadowObservers.get(node);
            if (observer && typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
            this.#shadowObservers.delete(node);
        }
        
        if (this.#iframeObservers && this.#iframeObservers.has(node)) {
            const observer = this.#iframeObservers.get(node);
            if (observer && typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
            this.#iframeObservers.delete(node);
        }
        
        if (this.#intersectionObserver && typeof this.#intersectionObserver.unobserve === 'function') {
            this.#intersectionObserver.unobserve(node);
        }
        
        if (this.#resizeObserver && typeof this.#resizeObserver.unobserve === 'function') {
            this.#resizeObserver.unobserve(node);
        }
    }
    
    #collectAllElements(root, collection) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        
        collection.add(root);
        
        if (root.shadowRoot) {
            this.#collectAllElements(root.shadowRoot, collection);
        }
        
        if (root.children) {
            const children = root.children;
            for (let i = 0; i < children.length; i++) {
                this.#collectAllElements(children[i], collection);
            }
        }
    }
    
    async #processNode(node) {
        if (!node || this.#processedNodes.has(node)) return;
        
        // Skip editor content completely
        if (this.#isInEditor(node)) {
            return;
        }
        
        const matchingCallbacks = this.#getMatchingCallbacks(node);
        if (!matchingCallbacks || !matchingCallbacks.length) return;
        
        const priorityGroups = {
            critical: [],
            high: [],
            normal: [],
            low: []
        };
        
        for (let i = 0; i < matchingCallbacks.length; i++) {
            const callback = matchingCallbacks[i];
            if (!callback) continue;
            
            let priority = callback.priority || 'normal';
            
            if (!priorityGroups[priority]) {
                priority = 'normal';
            }
            
            if (callback.retryCount > (callback.maxRetries || ForumCoreObserver.#CONFIG.memory.maxCallbackRetries)) {
                continue;
            }
            
            priorityGroups[priority].push(callback);
        }
        
        const priorities = ['critical', 'high', 'normal', 'low'];
        for (let j = 0; j < priorities.length; j++) {
            const priority = priorities[j];
            const callbacks = priorityGroups[priority];
            
            if (!callbacks || !callbacks.length) continue;
            
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
        if (!node) return [];
        
        const matching = [];
        const callbackValues = Array.from(this.#callbacks.values());
        
        for (let i = 0; i < callbackValues.length; i++) {
            const callback = callbackValues[i];
            if (!callback) continue;
            
            if (callback.pageTypes && !this.#matchesPageType(callback.pageTypes)) {
                continue;
            }
            
            if (callback.selector) {
                try {
                    if (!node.matches || !node.querySelector) continue;
                    if (!node.matches(callback.selector) && !node.querySelector(callback.selector)) {
                        continue;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            matching.push(callback);
        }
        
        return matching;
    }
    
    #matchesPageType(pageTypes) {
        if (!pageTypes || !Array.isArray(pageTypes)) return true;
        
        for (let i = 0; i < pageTypes.length; i++) {
            const type = pageTypes[i];
            if (!type) continue;
            const key = 'is' + type.charAt(0).toUpperCase() + type.slice(1);
            if (this.#pageState[key]) {
                return true;
            }
        }
        
        return false;
    }
    
    async #executeCallbacks(callbacks, node) {
        if (!callbacks || !callbacks.length || !node) return;
        
        const promises = [];
        
        for (let i = 0; i < callbacks.length; i++) {
            const callback = callbacks[i];
            if (!callback || typeof callback.fn !== 'function') continue;
            
            promises.push((async () => {
                try {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        node.dataset.observerOrigin = 'forum-script';
                    }
                    
                    if (callback.dependencies && callback.dependencies.includes('theme')) {
                        await callback.fn(node, this.#pageState.currentTheme);
                    } else {
                        await callback.fn(node);
                    }
                    
                    if (callback) {
                        callback.retryCount = 0;
                    }
                    
                } catch (error) {
                    if (callback) {
                        callback.retryCount = (callback.retryCount || 0) + 1;
                    }
                    this.#error('Callback ' + (callback ? callback.id : 'unknown') + ' failed (attempt ' + (callback ? callback.retryCount : '?') + '):', error);
                    
                    if (callback && callback.retryCount <= (callback.maxRetries || ForumCoreObserver.#CONFIG.memory.maxCallbackRetries)) {
                        setTimeout(() => {
                            this.#processNode(node);
                        }, 1000 * callback.retryCount);
                    }
                } finally {
                    if (node && node.nodeType === Node.ELEMENT_NODE) {
                        delete node.dataset.observerOrigin;
                    }
                }
            })());
        }
        
        await Promise.allSettled(promises);
    }
    
    #deferCallbacks(callbacks, node, priority) {
        if (!callbacks || !callbacks.length || !node) return;
        
        const delays = {
            high: 50,
            normal: 100,
            low: 500
        };
        
        const delay = delays[priority] || 100;
        
        if (typeof scheduler !== 'undefined' && scheduler.postTask) {
            scheduler.postTask(() => {
                this.#executeCallbacks(callbacks, node);
            }, { 
                priority: 'user-visible', 
                delay: delay 
            });
        } else if (window.requestIdleCallback) {
            requestIdleCallback(() => {
                this.#executeCallbacks(callbacks, node);
            }, { 
                timeout: delay 
            });
        } else {
            setTimeout(() => {
                this.#executeCallbacks(callbacks, node);
            }, delay);
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
            '.post-actions', '.user-info', '.post-content', '.post-footer',
            '[data-forum-element="true"]'
        ];
        
        const previewSelectors = [
            '#preview', '#ajaxObject', '.preview', '.Item.preview', 
            '[id*="preview"]', '.preview-content', '.post-preview'
        ];
        
        const allSelectors = forumSelectors.concat(previewSelectors);
        
        for (let i = 0; i < allSelectors.length; i++) {
            const selector = allSelectors[i];
            try {
                if (document.querySelectorAll) {
                    const nodes = document.querySelectorAll(selector);
                    for (let j = 0; j < nodes.length; j++) {
                        const node = nodes[j];
                        if (node && !this.#isInEditor(node) && !this.#processedNodes.has(node)) {
                            this.#processNode(node);
                            
                            if (node.shadowRoot) {
                                this.#collectAllElements(node.shadowRoot, new Set());
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore invalid selectors
            }
        }
        
        this.#scanForShadowDOM();
        
        if (document.querySelectorAll) {
            document.querySelectorAll('iframe').forEach(iframe => {
                if (iframe) {
                    this.#observeIframe(iframe);
                }
            });
        }
        
        this.#initialScanComplete = true;
        this.#log('Initial content scan complete (GLOBAL mode)');
    }
    
    #scanForShadowDOM() {
        if (!document.querySelectorAll) return;
        
        const shadowHosts = document.querySelectorAll('*');
        shadowHosts.forEach(host => {
            if (host && host.shadowRoot && !this.#shadowObservers.has(host)) {
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
        
        for (const [node, timestamp] of this.#nodeTimestamps) {
            if (node && (force || now - timestamp > ForumCoreObserver.#CONFIG.memory.nodeTTL)) {
                if (!document.body || !document.body.contains(node)) {
                    this.#processedNodes.delete(node);
                    this.#nodeTimestamps.delete(node);
                    cleanupCount++;
                }
            }
        }
        
        if (cleanupCount > 0) {
            this.#log(`Cleaned up ${cleanupCount} old nodes`);
        }
        
        if (this.#nodeTimestamps.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
            this.#log('Processed nodes approaching limit, clearing cache');
            this.#processedNodes = new WeakSet();
            const newTimestamps = new Map();
            for (const [node, timestamp] of this.#nodeTimestamps) {
                if (node && document.body && document.body.contains(node)) {
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
        if (!this.#observer && !this.#iframeObservers && !this.#shadowObservers) {
            this.#log('Pause called but no observers active');
            return;
        }
        
        if (this.#observer) {
            this.#observer.disconnect();
        }
        
        if (this.#iframeObservers && typeof this.#iframeObservers.forEach === 'function') {
            try {
                this.#iframeObservers.forEach((observer, iframe) => {
                    if (observer && typeof observer.disconnect === 'function') {
                        observer.disconnect();
                    }
                });
            } catch (e) {
                this.#error('Error pausing iframe observers:', e);
            }
        }
        
        if (this.#shadowObservers && typeof this.#shadowObservers.forEach === 'function') {
            try {
                this.#shadowObservers.forEach((observer, host) => {
                    if (observer && typeof observer.disconnect === 'function') {
                        observer.disconnect();
                    }
                });
            } catch (e) {
                this.#error('Error pausing shadow observers:', e);
            }
        }
        
        if (this.#intersectionObserver && typeof this.#intersectionObserver.disconnect === 'function') {
            this.#intersectionObserver.disconnect();
        }
        
        if (this.#resizeObserver && typeof this.#resizeObserver.disconnect === 'function') {
            this.#resizeObserver.disconnect();
        }
        
        const timeoutIds = Array.from(this.#debounceTimeouts.values());
        for (let i = 0; i < timeoutIds.length; i++) {
            clearTimeout(timeoutIds[i]);
        }
        this.#debounceTimeouts.clear();
    }
    
    #resume() {
        if (!this.#observer) {
            this.#observer = new MutationObserver(this.#handleMutationsWithRetry.bind(this));
        }
        
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        
        if (document.querySelectorAll) {
            document.querySelectorAll('iframe').forEach(iframe => {
                if (iframe && (!this.#iframeObservers || !this.#iframeObservers.has(iframe))) {
                    this.#observeIframe(iframe);
                }
            });
        }
        
        this.#scanForShadowDOM();
    }
    
    // ===== PUBLIC API =====
    
    register(settings) {
        if (!settings || typeof settings.callback !== 'function') {
            console.error('[ForumObserver] Invalid registration: missing callback function');
            return null;
        }
        
        const id = settings.id || 'callback_' + Date.now() + '_' + 
            (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2));
        
        const callback = {
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
                if (document.querySelectorAll) {
                    const nodes = document.querySelectorAll(callback.selector);
                    for (let i = 0; i < nodes.length; i++) {
                        const node = nodes[i];
                        if (node && !this.#isInEditor(node) && !this.#processedNodes.has(node)) {
                            this.#processNode(node);
                        }
                    }
                }
            } catch (e) {
                this.#error('Error during initial callback scan:', e);
            }
        }
        
        return id;
    }
    
    registerDebounced(settings) {
        if (!settings || typeof settings.callback !== 'function') return null;
        
        const id = this.register(settings);
        
        this.#debouncedCallbacks.set(id, {
            callback: settings.callback,
            delay: settings.delay || ForumCoreObserver.#CONFIG.performance.debounceThreshold,
            lastRun: 0,
            timeout: null
        });
        
        return id;
    }
    
    registerThemeAware(settings) {
        if (!settings || typeof settings.callback !== 'function') return null;
        
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
        if (!callbackId) return false;
        
        let removed = false;
        
        if (this.#callbacks.has(callbackId)) {
            this.#callbacks.delete(callbackId);
            removed = true;
        }
        
        if (this.#debouncedCallbacks.has(callbackId)) {
            const debounced = this.#debouncedCallbacks.get(callbackId);
            if (debounced && debounced.timeout) {
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
            if (document.querySelectorAll) {
                const nodes = document.querySelectorAll(selector);
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (node && !this.#isInEditor(node) && !this.#processedNodes.has(node)) {
                        this.#processNode(node);
                    }
                }
            }
        } catch (e) {
            this.#error('Error during force scan:', e);
        }
    }
    
    forceReprocess(selector) {
        try {
            if (document.querySelectorAll) {
                const nodes = document.querySelectorAll(selector);
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (node && !this.#isInEditor(node)) {
                        this.#processedNodes.delete(node);
                        this.#processNode(node);
                    }
                }
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
            .filter(([node]) => node && document.body && document.body.contains(node)).length;
        
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
                    c && c.dependencies && c.dependencies.includes('theme')
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
                queueLength: (this.#priorityQueue.high ? this.#priorityQueue.high.length : 0) + 
                             (this.#priorityQueue.medium ? this.#priorityQueue.medium.length : 0) + 
                             (this.#priorityQueue.low ? this.#priorityQueue.low.length : 0),
                queueBreakdown: {
                    high: this.#priorityQueue.high ? this.#priorityQueue.high.length : 0,
                    medium: this.#priorityQueue.medium ? this.#priorityQueue.medium.length : 0,
                    low: this.#priorityQueue.low ? this.#priorityQueue.low.length : 0
                },
                scriptsReady: this.#scriptsReady,
                errorCount: this.#errorCount,
                hasResetScheduled: !!this.#resetTimeout
            },
            memory: {
                iframeObservers: this.#iframeObservers ? this.#iframeObservers.size : 0,
                shadowObservers: this.#shadowObservers ? this.#shadowObservers.size : 0
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
        
        if (this.#intersectionObserver) {
            this.#intersectionObserver.disconnect();
        }
        
        if (this.#resizeObserver) {
            this.#resizeObserver.disconnect();
        }
        
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#nodeTimestamps.clear();
        this.#iframeObservers = new WeakMap();
        this.#shadowObservers = new WeakMap();
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
        const debug = (localStorage && localStorage.getItem('forum-observer-debug') === 'true') || 
                     (window.location && window.location.hash === '#observer-debug');
        
        globalThis.forumObserver = ForumCoreObserver.create(debug);
        
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
        
        if (debug) {
            globalThis.forumObserverDebug = {
                enable: () => {
                    if (localStorage) {
                        localStorage.setItem('forum-observer-debug', 'true');
                        window.location.reload();
                    }
                },
                disable: () => {
                    if (localStorage) {
                        localStorage.removeItem('forum-observer-debug');
                        window.location.reload();
                    }
                },
                stats: () => globalThis.forumObserver?.getStats(),
                reprocess: (selector) => globalThis.forumObserver?.forceReprocess(selector)
            };
            console.log('🔧 ForumObserver debug mode enabled. Use forumObserverDebug object.');
        }
        
        globalThis.addEventListener('pagehide', function() {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.destroy();
                globalThis.forumObserver = null;
            }
        }, { once: true });
        
        console.log('🚀 ForumCoreObserver ready (ENHANCED GLOBAL MODE) with editor skipping');
        
    } catch (error) {
        console.error('Failed to initialize ForumCoreObserver:', error);
        
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
