'use strict';

class ForumCoreObserver {
    #observer = null;
    #shadowObserver = null;
    #resizeObserver = null;
    #intersectionObserver = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #observedShadows = new WeakSet();
    #observedIframes = new WeakSet();
    #cleanupIntervalId = null;
    #fontCheckTimer = null;
    
    #callbacks = new Map();
    #debouncedCallbacks = new Map();
    #pageState = this.#detectPageState();
    
    // Script readiness tracking
    #scriptsReady = {
        weserv: false,
        dimensionExtractor: false,
        avatar: false,
        postModernizer: false
    };
    
    static #CONFIG = {
        observer: {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'data-*', 'width', 'height', 'src']
        },
        performance: {
            maxProcessingTime: 16,
            mutationBatchSize: 50,
            debounceThreshold: 100,
            idleCallbackTimeout: 2000,
            searchPageBatchSize: 10,
            resizeObserverThrottle: 100
        },
        memory: {
            maxProcessedNodes: 10000,
            cleanupInterval: 30000,
            nodeTTL: 300000
        },
        selectors: {
            mediaElements: 'img, iframe, video, lite-youtube, lite-vimeo, .media-wrapper, .iframe-wrapper',
            textElements: '.post-content, .post-text, .message, .content',
            lazyElements: '.lazy, [loading="lazy"], [data-src]',
            shadowContainers: '*'
        }
    };
    
    #mutationMetrics = {
        totalMutations: 0,
        processedMutations: 0,
        averageProcessingTime: 0,
        lastMutationTime: 0,
        shadowRootsFound: 0,
        iframesObserved: 0,
        resizeEvents: 0
    };
    
    constructor() {
        this.#init();
        this.#setupThemeListener();
        this.#setupScriptCoordination();
        this.#setupEnhancedObservers();
        this.#interceptStyleChanges();
        this.#monitorFontLoading();
        this.#observeShadowDOM();
        this.#observeIframes();
        this.#monitorDynamicScripts();
        this.#setupMediaQueryListeners();
        this.#monitorPerformance();
    }
    
    #init() {
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        this.#observer.observe(document.documentElement, ForumCoreObserver.#CONFIG.observer);
        
        // Also observe the document itself for completeness
        if (document.documentElement !== document) {
            this.#observer.observe(document, ForumCoreObserver.#CONFIG.observer);
        }
        
        this.#scanExistingContent();
        this.#setupCleanup();
        
        document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this), { 
            passive: true, 
            capture: true 
        });
        
        // Catch DOMContentLoaded for late additions
        document.addEventListener('DOMContentLoaded', () => {
            queueMicrotask(() => this.#scanExistingContent());
        });
        
        // Catch load events for iframes and images
        window.addEventListener('load', () => {
            queueMicrotask(() => this.#processLoadedResources());
        }, { passive: true });
        
        console.log('🔍 Enhanced ForumCoreObserver initialized (GLOBAL - bulletproof mode)');
    }
    
    #setupEnhancedObservers() {
        // ResizeObserver for element size changes
        this.#resizeObserver = new ResizeObserver((entries) => {
            this.#mutationMetrics.resizeEvents += entries.length;
            
            // Throttle resize processing
            if (this.#resizeTimeout) clearTimeout(this.#resizeTimeout);
            
            this.#resizeTimeout = setTimeout(() => {
                entries.forEach(entry => {
                    const element = entry.target;
                    
                    // Only reprocess if dimensions actually changed meaningfully
                    const width = Math.round(entry.contentRect.width);
                    const height = Math.round(entry.contentRect.height);
                    
                    if (width > 0 && height > 0) {
                        const oldWidth = element._lastProcessedWidth;
                        const oldHeight = element._lastProcessedHeight;
                        
                        // Skip if dimensions haven't changed much (avoid loops)
                        if (oldWidth && oldHeight && 
                            Math.abs(width - oldWidth) < 5 && 
                            Math.abs(height - oldHeight) < 5) {
                            return;
                        }
                        
                        element._lastProcessedWidth = width;
                        element._lastProcessedHeight = height;
                        
                        // Check if element contains media that might need reprocessing
                        if (element.matches(ForumCoreObserver.#CONFIG.selectors.mediaElements) ||
                            element.querySelector(ForumCoreObserver.#CONFIG.selectors.mediaElements)) {
                            queueMicrotask(() => this.#processNode(element));
                        }
                    }
                });
            }, ForumCoreObserver.#CONFIG.performance.resizeObserverThrottle);
        });
        
        // IntersectionObserver for lazy-loaded content
        this.#intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    
                    // Remove from observer once visible
                    this.#intersectionObserver.unobserve(element);
                    
                    // Process if not already processed
                    if (!this.#processedNodes.has(element)) {
                        queueMicrotask(() => this.#processNode(element));
                    }
                    
                    // Also process any media inside
                    if (element.querySelector) {
                        const mediaElements = element.querySelectorAll(
                            ForumCoreObserver.#CONFIG.selectors.mediaElements
                        );
                        mediaElements.forEach(media => {
                            if (!this.#processedNodes.has(media)) {
                                queueMicrotask(() => this.#processNode(media));
                            }
                        });
                    }
                }
            });
        }, { 
            rootMargin: '100px', // Start loading 100px before visibility
            threshold: 0.01 
        });
    }
    
    #observeShadowDOM() {
        const observeShadowRoot = (host, shadowRoot) => {
            if (this.#observedShadows.has(shadowRoot)) return;
            
            this.#observedShadows.add(shadowRoot);
            this.#mutationMetrics.shadowRootsFound++;
            
            const shadowObserver = new MutationObserver((mutations) => {
                // Reuse main mutation handler
                this.#handleMutations(mutations.map(m => ({
                    ...m,
                    target: m.target,
                    type: m.type,
                    addedNodes: m.addedNodes,
                    removedNodes: m.removedNodes,
                    attributeName: m.attributeName,
                    oldValue: m.oldValue
                })));
            });
            
            shadowObserver.observe(shadowRoot, ForumCoreObserver.#CONFIG.observer);
            
            // Process existing shadow DOM content
            queueMicrotask(() => {
                this.#processNode(shadowRoot);
                shadowRoot.querySelectorAll('*').forEach(el => {
                    this.#processNode(el);
                });
            });
            
            // Recursively observe nested shadow roots
            shadowRoot.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    observeShadowRoot(el, el.shadowRoot);
                }
            });
        };
        
        // Initial shadow DOM scan
        const scanForShadowRoots = (root) => {
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    observeShadowRoot(el, el.shadowRoot);
                }
            });
        };
        
        scanForShadowRoots(document);
        
        // Observer for new shadow hosts
        const shadowHostObserver = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.shadowRoot) {
                            observeShadowRoot(node, node.shadowRoot);
                        }
                        scanForShadowRoots(node);
                    }
                });
            });
        });
        
        shadowHostObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
    
    #observeIframes() {
        const observeIframe = (iframe) => {
            if (this.#observedIframes.has(iframe)) return;
            
            try {
                // Check if same-origin
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                
                if (iframeDoc && iframeDoc !== document) {
                    this.#observedIframes.add(iframe);
                    this.#mutationMetrics.iframesObserved++;
                    
                    const iframeObserver = new MutationObserver((mutations) => {
                        // Transform mutations to include iframe reference
                        const enhancedMutations = mutations.map(m => ({
                            ...m,
                            target: m.target,
                            iframeSource: iframe
                        }));
                        this.#handleMutations(enhancedMutations);
                    });
                    
                    iframeObserver.observe(iframeDoc.documentElement, ForumCoreObserver.#CONFIG.observer);
                    
                    // Process existing iframe content
                    queueMicrotask(() => {
                        this.#processNode(iframeDoc.documentElement);
                    });
                    
                    // Observe iframe size changes
                    if (this.#resizeObserver) {
                        this.#resizeObserver.observe(iframe);
                    }
                }
            } catch (e) {
                // Cross-origin iframe - can't observe directly
                // But we can observe the iframe element itself
                if (this.#resizeObserver) {
                    this.#resizeObserver.observe(iframe);
                }
                
                // Watch for load events which might indicate content changes
                iframe.addEventListener('load', () => {
                    try {
                        // Try again after load (might become same-origin)
                        if (iframe.contentDocument) {
                            observeIframe(iframe);
                        }
                    } catch (e) {
                        // Still cross-origin, ignore
                    }
                    
                    // Even if cross-origin, we can observe the iframe element
                    queueMicrotask(() => this.#processNode(iframe));
                }, { once: true, passive: true });
            }
        };
        
        // Initial iframe scan
        document.querySelectorAll('iframe').forEach(observeIframe);
        
        // Observer for new iframes
        const iframeObserver = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.tagName === 'IFRAME') {
                        observeIframe(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('iframe').forEach(observeIframe);
                    }
                });
            });
        });
        
        iframeObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
    
    #interceptStyleChanges() {
        // Guard against multiple intercepts
        if (window.__styleIntercepted) return;
        window.__styleIntercepted = true;
        
        try {
            // Intercept CSSStyleDeclaration methods
            const styleProto = CSSStyleDeclaration.prototype;
            
            if (!styleProto.__isIntercepted) {
                const originalSetProperty = styleProto.setProperty;
                const originalRemoveProperty = styleProto.removeProperty;
                
                styleProto.setProperty = function(property, value, priority) {
                    const element = this._element;
                    const oldValue = this[property];
                    const result = originalSetProperty.call(this, property, value, priority);
                    
                    if (element && oldValue !== value && element.isConnected) {
                        // Throttle style change processing
                        if (!element._styleTimeout) {
                            element._styleTimeout = setTimeout(() => {
                                element._styleTimeout = null;
                                
                                // Only process if style change affects layout
                                const layoutProps = ['width', 'height', 'display', 'position', 'top', 'left'];
                                if (layoutProps.includes(property)) {
                                    queueMicrotask(() => this.#processNode(element));
                                }
                            }, 50);
                        }
                    }
                    
                    return result;
                };
                
                styleProto.removeProperty = function(property) {
                    const element = this._element;
                    const oldValue = this[property];
                    const result = originalRemoveProperty.call(this, property);
                    
                    if (element && oldValue !== undefined && element.isConnected) {
                        const layoutProps = ['width', 'height', 'display', 'position', 'top', 'left'];
                        if (layoutProps.includes(property)) {
                            queueMicrotask(() => this.#processNode(element));
                        }
                    }
                    
                    return result;
                };
                
                styleProto.__isIntercepted = true;
            }
            
            // Track element references in CSSStyleDeclaration
            const originalGetComputedStyle = window.getComputedStyle;
            
            if (!window.__getComputedStyleIntercepted) {
                window.getComputedStyle = function(element, pseudoElt) {
                    const style = originalGetComputedStyle.call(this, element, pseudoElt);
                    if (element && element.nodeType === Node.ELEMENT_NODE) {
                        style._element = element;
                    }
                    return style;
                };
                window.__getComputedStyleIntercepted = true;
            }
            
        } catch (e) {
            console.warn('Style interception failed (non-critical):', e);
        }
    }
    
    #monitorFontLoading() {
        if (!document.fonts) return;
        
        const processFontDependentElements = () => {
            queueMicrotask(() => {
                // Text-heavy elements that might shift after font load
                document.querySelectorAll(
                    ForumCoreObserver.#CONFIG.selectors.textElements
                ).forEach(el => {
                    if (el.isConnected && !this.#processedNodes.has(el)) {
                        this.#processNode(el);
                    }
                });
            });
        };
        
        // Fonts already loaded?
        if (document.fonts.status === 'loaded') {
            processFontDependentElements();
        }
        
        // Listen for font loading
        document.fonts.ready.then(processFontDependentElements);
        
        document.fonts.addEventListener('loadingdone', processFontDependentElements);
        
        // Periodic check for custom fonts
        this.#fontCheckTimer = setInterval(() => {
            if (document.fonts.status === 'loaded') {
                processFontDependentElements();
            }
        }, 5000);
    }
    
    #monitorDynamicScripts() {
        // Intercept script creation to catch dynamically added scripts
        const originalCreateElement = document.createElement;
        
        document.createElement = function(tagName, options) {
            const element = originalCreateElement.call(this, tagName, options);
            
            if (tagName.toLowerCase() === 'script') {
                // Wrap script execution to catch after load
                const originalSetAttribute = element.setAttribute;
                
                element.setAttribute = function(name, value) {
                    if (name === 'src') {
                        // Script with src - observe after load
                        const loadHandler = () => {
                            queueMicrotask(() => {
                                // Script loaded - may have modified DOM
                                this.#scanExistingContent();
                            });
                            element.removeEventListener('load', loadHandler);
                        };
                        element.addEventListener('load', loadHandler, { once: true, passive: true });
                    }
                    return originalSetAttribute.call(this, name, value);
                };
            }
            
            return element;
        }.bind(this);
    }
    
    #setupMediaQueryListeners() {
        // Watch for responsive design changes
        const breakpoints = [
            '(max-width: 480px)',
            '(max-width: 768px)',
            '(max-width: 1024px)',
            '(orientation: portrait)',
            '(orientation: landscape)'
        ];
        
        breakpoints.forEach(query => {
            const mql = window.matchMedia(query);
            
            const handler = (e) => {
                // Media query changed - reprocess responsive elements
                queueMicrotask(() => {
                    document.querySelectorAll(
                        '.responsive, [class*="col-"], .row, .container, img, iframe, video'
                    ).forEach(el => {
                        if (el.isConnected) {
                            this.#processNode(el);
                        }
                    });
                });
            };
            
            mql.addEventListener('change', handler, { passive: true });
            
            // Initial check
            if (mql.matches) {
                handler(mql);
            }
        });
    }
    
    #monitorPerformance() {
        // Use PerformanceObserver to detect layout shifts
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                const layoutShiftObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    let hadSignificantShift = false;
                    
                    entries.forEach(entry => {
                        // Check if layout shift was significant (>0.1)
                        if (entry.value > 0.1) {
                            hadSignificantShift = true;
                        }
                    });
                    
                    if (hadSignificantShift) {
                        // Layout shifted - reprocess visible elements
                        queueMicrotask(() => {
                            document.querySelectorAll(
                                ForumCoreObserver.#CONFIG.selectors.mediaElements
                            ).forEach(el => {
                                if (el.isConnected && this.#isElementInViewport(el)) {
                                    this.#processNode(el);
                                }
                            });
                        });
                    }
                });
                
                layoutShiftObserver.observe({ type: 'layout-shift', buffered: true });
            } catch (e) {
                // LayoutShift not supported
            }
        }
    }
    
    #isElementInViewport(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }
    
    #processLoadedResources() {
        // Process images that loaded after page load
        document.querySelectorAll('img:not([data-processed])').forEach(img => {
            if (img.complete && img.naturalWidth) {
                this.#processNode(img);
                img.setAttribute('data-processed', 'true');
            }
        });
        
        // Process iframes that loaded
        document.querySelectorAll('iframe:not([data-processed])').forEach(iframe => {
            this.#processNode(iframe);
            iframe.setAttribute('data-processed', 'true');
        });
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
            
            // Check if all are ready
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        // Listen for Dimension Extractor ready
        window.addEventListener('dimension-extractor-ready', (e) => {
            this.#scriptsReady.dimensionExtractor = true;
            console.log('📐 Dimension extractor ready', e.detail || '');
            
            // Check if all are ready
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        // Listen for Avatar system ready
        window.addEventListener('forum-avatars-ready', (e) => {
            this.#scriptsReady.avatar = true;
            console.log('👤 Avatar system ready', e.detail || '');
            
            // Check if all are ready
            this.#checkAllScriptsReady();
        }, { once: true, passive: true });
        
        // Listen for Post Modernizer ready
        window.addEventListener('post-modernizer-ready', (e) => {
            this.#scriptsReady.postModernizer = true;
            console.log('📝 Post Modernizer ready', e.detail || '');
            
            // Check if all are ready
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
                
                if (!this.#scriptsReady.dimensionExtractor && window.mediaDimensionExtractor) {
                    this.#scriptsReady.dimensionExtractor = true;
                    window.dispatchEvent(new CustomEvent('dimension-extractor-ready', {
                        detail: { source: 'fallback' }
                    }));
                }
                
                if (!this.#scriptsReady.avatar && window.ForumAvatars) {
                    this.#scriptsReady.avatar = true;
                    window.dispatchEvent(new CustomEvent('forum-avatars-ready', {
                        detail: { source: 'fallback' }
                    }));
                }
                
                if (!this.#scriptsReady.postModernizer && window.postModernizer) {
                    this.#scriptsReady.postModernizer = true;
                    window.dispatchEvent(new CustomEvent('post-modernizer-ready', {
                        detail: { source: 'fallback' }
                    }));
                }
            }, 1000);
        }, { once: true, passive: true });
    }
    
    #checkAllScriptsReady() {
        const allReady = Object.values(this.#scriptsReady).every(v => v === true);
        
        if (allReady) {
            console.log('✅ All forum scripts ready and coordinated');
            
            // Dispatch global ready event
            window.dispatchEvent(new CustomEvent('all-forum-scripts-ready', {
                detail: { timestamp: Date.now() }
            }));
            
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
        
        // Skip if marked as our own mutation
        if (target.dataset && target.dataset.observerOrigin === 'forum-script') {
            return false;
        }
        
        // Skip hidden elements
        if (target.nodeType === Node.ELEMENT_NODE) {
            try {
                var style = window.getComputedStyle(target);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
            } catch (e) {
                // Ignore - element might be detached
            }
        }
        
        // Always process theme changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            return true;
        }
        
        // Process character data in important elements
        if (mutation.type === 'characterData') {
            var parent = target.parentElement;
            return parent ? this.#shouldObserveTextChanges(parent) : false;
        }
        
        // Process style changes that might affect layout
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            var oldValue = mutation.oldValue || '';
            var newValue = target.getAttribute('style') || '';
            return this.#styleChangeAffectsDOM(oldValue, newValue);
        }
        
        // Process src changes for media
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'src' || mutation.attributeName === 'data-src')) {
            const tagName = target.tagName;
            if (tagName === 'IMG' || tagName === 'IFRAME' || tagName === 'VIDEO' || tagName === 'SOURCE') {
                return true;
            }
        }
        
        // Process dimension changes
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'width' || mutation.attributeName === 'height')) {
            return true;
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
                    // Process added nodes
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.#collectAllElements(node, affectedNodes);
                            
                            // Set up observers for new elements
                            if (node.tagName === 'IFRAME') {
                                this.#observeIframes(node);
                            }
                            if (node.shadowRoot) {
                                this.#observeShadowDOM(node);
                            }
                            
                            // Observe media elements for resize
                            if (node.matches(ForumCoreObserver.#CONFIG.selectors.mediaElements)) {
                                this.#resizeObserver?.observe(node);
                            }
                            
                            // Observe lazy elements for intersection
                            if (node.matches(ForumCoreObserver.#CONFIG.selectors.lazyElements)) {
                                this.#intersectionObserver?.observe(node);
                            }
                        }
                    }
                    
                    // Process removed nodes (cleanup)
                    for (var j = 0; j < mutation.removedNodes.length; j++) {
                        var node = mutation.removedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Clean up observers
                            this.#resizeObserver?.unobserve(node);
                            this.#intersectionObserver?.unobserve(node);
                            
                            // Remove from processed set to allow reprocessing if re-added
                            this.#processedNodes.delete(node);
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
                    
                    // Handle src changes for media
                    if (mutation.attributeName === 'src' || mutation.attributeName === 'data-src') {
                        const target = mutation.target;
                        if (target.tagName === 'IMG' || target.tagName === 'IFRAME') {
                            // Re-observe iframe after src change
                            if (target.tagName === 'IFRAME') {
                                this.#observedIframes.delete(target);
                                this.#observeIframes(target);
                            }
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
            if (node && !this.#processedNodes.has(node) && node.isConnected) {
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
        
        // Also collect from shadow DOM if present
        if (root.shadowRoot) {
            this.#collectAllElements(root.shadowRoot, collection);
        }
        
        var children = root.children;
        for (var i = 0; i < children.length; i++) {
            this.#collectAllElements(children[i], collection);
        }
    }
    
    async #processNode(node) {
        if (!node || !node.isConnected || this.#processedNodes.has(node)) return;
        
        // Check if node or its ancestors are hidden
        try {
            let hidden = false;
            let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            
            while (element) {
                const style = window.getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    hidden = true;
                    break;
                }
                element = element.parentElement;
            }
            
            if (hidden) return;
        } catch (e) {
            // Ignore - element might be detached
        }
        
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
            
            // Check page types if specified
            if (callback.pageTypes && callback.pageTypes.length > 0) {
                const bodyId = document.body.id;
                const pageType = bodyId === 'search' ? 'search' :
                                bodyId === 'send' ? 'send' :
                                bodyId === 'blog' ? 'blog' :
                                bodyId === 'topic' ? 'topic' : 'other';
                
                if (!callback.pageTypes.includes(pageType)) {
                    continue;
                }
            }
            
            if (callback.selector) {
                try {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches(callback.selector)) {
                            matching.push(callback);
                        } else {
                            // Check if node contains matching elements
                            const matches = node.querySelectorAll(callback.selector);
                            if (matches.length > 0) {
                                matching.push(callback);
                            }
                        }
                    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                        const matches = node.querySelectorAll(callback.selector);
                        if (matches.length > 0) {
                            matching.push(callback);
                        }
                    }
                } catch (e) {
                    // Invalid selector, skip
                }
            } else {
                // No selector means always match
                matching.push(callback);
            }
        }
        
        return matching;
    }
    
    async #executeCallbacks(callbacks, node) {
        var promises = [];
        
        for (var i = 0; i < callbacks.length; i++) {
            var callback = callbacks[i];
            promises.push((async function() {
                try {
                    // Mark as our own mutation to avoid loops
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        node.dataset.observerOrigin = 'forum-script';
                    }
                    
                    if (callback.dependencies && callback.dependencies.includes('theme')) {
                        await callback.fn(node, this.#pageState.currentTheme);
                    } else {
                        await callback.fn(node);
                    }
                    
                    // Clean up marker
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        delete node.dataset.observerOrigin;
                    }
                } catch (error) {
                    console.error('Callback ' + callback.id + ' failed:', error);
                    
                    // Retry logic for failed callbacks
                    if (callback.retryCount < (callback.maxRetries || 3)) {
                        callback.retryCount++;
                        setTimeout(() => {
                            this.#executeCallbacks([callback], node);
                        }, 100 * Math.pow(2, callback.retryCount));
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
            'img', 'iframe', 'video', 'lite-youtube', 'lite-vimeo'
        ];
        
        var previewSelectors = [
            '#preview', '#ajaxObject', '.preview', '.Item.preview', 
            '[id*="preview"]', '.preview-content', '.post-preview'
        ];
        
        var allSelectors = forumSelectors.concat(previewSelectors);
        
        // Process in batches to avoid blocking
        const processBatch = (startIndex) => {
            const batchSize = 50;
            const endIndex = Math.min(startIndex + batchSize, allSelectors.length);
            
            for (var i = startIndex; i < endIndex; i++) {
                var selector = allSelectors[i];
                try {
                    var nodes = document.querySelectorAll(selector);
                    for (var j = 0; j < nodes.length; j++) {
                        var node = nodes[j];
                        if (!this.#processedNodes.has(node) && node.isConnected) {
                            // Queue for processing, don't await
                            this.#processNode(node);
                            
                            // Set up observers
                            if (node.tagName === 'IFRAME') {
                                this.#observeIframes(node);
                            }
                            if (node.shadowRoot) {
                                this.#observeShadowDOM(node);
                            }
                            if (node.matches(ForumCoreObserver.#CONFIG.selectors.mediaElements)) {
                                this.#resizeObserver?.observe(node);
                            }
                            if (node.matches(ForumCoreObserver.#CONFIG.selectors.lazyElements)) {
                                this.#intersectionObserver?.observe(node);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore selector errors
                }
            }
            
            if (endIndex < allSelectors.length) {
                setTimeout(() => processBatch(endIndex), 10);
            } else {
                this.#initialScanComplete = true;
                console.log('✅ Initial content scan complete (GLOBAL mode)');
                
                // Scan shadow DOM after initial scan
                this.#scanShadowDOM();
                
                // Scan iframes after initial scan
                this.#scanIframes();
            }
        };
        
        processBatch(0);
    }
    
    #scanShadowDOM() {
        document.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                this.#observeShadowDOM(el);
            }
        });
    }
    
    #scanIframes() {
        document.querySelectorAll('iframe').forEach(iframe => {
            this.#observeIframes(iframe);
        });
    }
    
    #setupCleanup() {
        this.#cleanupIntervalId = setInterval(function() {
            // Clean up old processed nodes (WeakSet will handle itself, but we can trigger GC)
            if (typeof globalThis.gc === 'function') {
                globalThis.gc();
            }
            
            // Clean up mutation metrics
            const now = Date.now();
            if (now - this.#mutationMetrics.lastMutationTime > 60000) {
                // No mutations for a minute, reset metrics
                this.#mutationMetrics.averageProcessingTime = 0;
            }
            
            // Check memory usage
            if (this.#processedNodes.size > ForumCoreObserver.#CONFIG.memory.maxProcessedNodes) {
                console.warn('Processed nodes approaching limit: ' + this.#processedNodes.size);
                
                // Force garbage collection if possible
                if (typeof globalThis.gc === 'function') {
                    globalThis.gc();
                }
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
        
        if (this.#resizeObserver) {
            this.#resizeObserver.disconnect();
        }
        
        if (this.#intersectionObserver) {
            this.#intersectionObserver.disconnect();
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
        
        if (document.documentElement !== document) {
            this.#observer.observe(document, ForumCoreObserver.#CONFIG.observer);
        }
        
        // Reconnect resize observer
        if (this.#resizeObserver) {
            document.querySelectorAll(ForumCoreObserver.#CONFIG.selectors.mediaElements).forEach(el => {
                this.#resizeObserver.observe(el);
            });
        }
        
        // Reconnect intersection observer
        if (this.#intersectionObserver) {
            document.querySelectorAll(ForumCoreObserver.#CONFIG.selectors.lazyElements).forEach(el => {
                this.#intersectionObserver.observe(el);
            });
        }
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
            maxRetries: settings.maxRetries || 3,
            createdAt: performance.now()
        };
        
        this.#callbacks.set(id, callback);
        console.log('📝 Registered GLOBAL callback: ' + id + ' (priority: ' + callback.priority + ')');
        
        // Process existing nodes if initial scan is complete
        if (this.#initialScanComplete && callback.selector) {
            var nodes = document.querySelectorAll(callback.selector);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (!this.#processedNodes.has(node) && node.isConnected) {
                    this.#processNode(node);
                }
            }
            
            // Also check shadow DOM
            document.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    var shadowNodes = el.shadowRoot.querySelectorAll(callback.selector);
                    shadowNodes.forEach(node => {
                        if (!this.#processedNodes.has(node) && node.isConnected) {
                            this.#processNode(node);
                        }
                    });
                }
            });
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
            this.#scanShadowDOM();
            this.#scanIframes();
            return;
        }
        
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!this.#processedNodes.has(node) && node.isConnected) {
                this.#processNode(node);
            }
        }
        
        // Also scan shadow DOM
        document.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                var shadowNodes = el.shadowRoot.querySelectorAll(selector);
                shadowNodes.forEach(node => {
                    if (!this.#processedNodes.has(node) && node.isConnected) {
                        this.#processNode(node);
                    }
                });
            }
        });
    }
    
    forceReprocessElement(element) {
        if (!element) return;
        
        // Remove from processed set
        this.#processedNodes.delete(element);
        
        // Reprocess
        this.#processNode(element);
        
        // Reprocess children
        if (element.querySelectorAll) {
            element.querySelectorAll('*').forEach(child => {
                this.#processedNodes.delete(child);
                this.#processNode(child);
            });
        }
    }
    
    updateThemeOnElements(theme) {
        this.#rescanThemeSensitiveElements(theme);
    }
    
    getStats() {
        return {
            totalMutations: this.#mutationMetrics.totalMutations,
            processedMutations: this.#mutationMetrics.processedMutations,
            averageProcessingTime: this.#mutationMetrics.averageProcessingTime.toFixed(2) + 'ms',
            lastMutationTime: new Date(this.#mutationMetrics.lastMutationTime).toISOString(),
            registeredCallbacks: this.#callbacks.size,
            debouncedCallbacks: this.#debouncedCallbacks.size,
            pendingTimeouts: this.#debounceTimeouts.size,
            processedNodes: this.#processedNodes.size,
            pageState: this.#pageState,
            isProcessing: this.#isProcessing,
            queueLength: this.#mutationQueue.length,
            scriptsReady: this.#scriptsReady,
            shadowRootsFound: this.#mutationMetrics.shadowRootsFound,
            iframesObserved: this.#mutationMetrics.iframesObserved,
            resizeEvents: this.#mutationMetrics.resizeEvents,
            currentTheme: this.#pageState.currentTheme,
            themeMode: this.#pageState.themeMode,
            themeDependentCallbacks: Array.from(this.#callbacks.values()).filter(c => 
                c.dependencies && c.dependencies.includes('theme')
            ).length
        };
    }
    
    getScriptsStatus() {
        return { ...this.#scriptsReady };
    }
    
    waitForScripts(scriptNames, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const allReady = scriptNames.every(name => this.#scriptsReady[name]);
                if (allReady) {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                    resolve();
                }
            }, 100);
            
            const timeoutId = setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('Timeout waiting for scripts: ' + scriptNames.join(', ')));
            }, timeout);
        });
    }
    
    destroy() {
        this.#pause();
        
        if (this.#cleanupIntervalId) {
            clearInterval(this.#cleanupIntervalId);
        }
        
        if (this.#fontCheckTimer) {
            clearInterval(this.#fontCheckTimer);
        }
        
        this.#callbacks.clear();
        this.#debouncedCallbacks.clear();
        this.#processedNodes = new WeakSet();
        this.#observedShadows = new WeakSet();
        this.#observedIframes = new WeakSet();
        this.#mutationQueue.length = 0;
        this.#debounceTimeouts.clear();
        
        document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
        
        console.log('🔄 Enhanced ForumCoreObserver destroyed');
    }
    
    static create() {
        return new ForumCoreObserver();
    }
}

// Initialize globally
if (!globalThis.forumObserver) {
    try {
        globalThis.forumObserver = ForumCoreObserver.create();
        
        // Helper functions for easy script registration
        globalThis.registerForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.register(settings) : null;
        };
        
        globalThis.registerDebouncedForumScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerDebounced(settings) : null;
        };
        
        globalThis.registerThemeAwareScript = function(settings) {
            return globalThis.forumObserver ? globalThis.forumObserver.registerThemeAware(settings) : null;
        };
        
        // Cleanup on page hide
        globalThis.addEventListener('pagehide', function() {
            if (globalThis.forumObserver) {
                globalThis.forumObserver.destroy();
            }
        }, { once: true });
        
        console.log('🚀 Enhanced ForumCoreObserver ready (BULLETPROOF MODE)');
        
    } catch (error) {
        console.error('Failed to initialize Enhanced ForumCoreObserver:', error);
        
        // Fallback proxy
        globalThis.forumObserver = new Proxy({}, {
            get: function(target, prop) {
                var methods = ['register', 'registerDebounced', 'registerThemeAware', 'unregister', 
                              'forceScan', 'forceReprocessElement', 'updateThemeOnElements', 
                              'getStats', 'getScriptsStatus', 'waitForScripts', 'destroy'];
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

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ForumCoreObserver };
}
