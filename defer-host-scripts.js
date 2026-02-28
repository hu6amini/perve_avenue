// ===== DEFER HOST SCRIPTS v3 - WITH CSS/JS INTERCEPTION =====
(function() {
    'use strict';
    
    var DEFER_CONFIG = {
        // Patterns for scripts to defer
        scriptPatterns: [
            'jquery.modal/modal.js',
            'jquery.scrollbar/jquery.scrollbar.js',
            'jquery.timeago/jquery.timeago.en.js',
            'popperjs/popper.js',
            'tippyjs/tippy.js',
            'notifications/plugin_v3.js'
        ],
        
        // Patterns for stylesheets to load asynchronously
        cssPatterns: [
            'jquery.modal/modal.css',
            'jquery.scrollbar/jquery.scrollbar.macosx.css',
            'tippyjs/css/theme+animation.css',
            'notifications/desktop.css'
        ],
        
        // Critical CSS that should load immediately (if any)
        criticalCssPatterns: [
            // Add any CSS that's needed above-the-fold
            // 'some-critical-pattern.css'
        ],
        
        // Delay before loading non-critical CSS (ms)
        cssDelay: 100,
        
        // Delay before loading deferred scripts (ms)
        scriptDelay: 2000,
        
        debug: true
    };
    
    var deferredScripts = [];
    var deferredStyles = [];
    
    function log() {
        if (DEFER_CONFIG.debug) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('🔧 [DeferScript v3]');
            console.log.apply(console, args);
        }
    }
    
    function shouldDeferScript(src) {
        if (!src) return false;
        var url = src.toLowerCase();
        return DEFER_CONFIG.scriptPatterns.some(pattern => 
            url.indexOf(pattern.toLowerCase()) !== -1
        );
    }
    
    function shouldDeferCss(href) {
        if (!href) return false;
        var url = href.toLowerCase();
        
        // Check if it's critical (load immediately)
        var isCritical = DEFER_CONFIG.criticalCssPatterns.some(pattern => 
            url.indexOf(pattern.toLowerCase()) !== -1
        );
        if (isCritical) return false;
        
        // Check if it should be deferred
        return DEFER_CONFIG.cssPatterns.some(pattern => 
            url.indexOf(pattern.toLowerCase()) !== -1
        );
    }
    
    // Store original methods
    var originalCreateElement = document.createElement;
    var originalAppendChild = Node.prototype.appendChild;
    var originalInsertBefore = Node.prototype.insertBefore;
    var originalSetAttribute = Element.prototype.setAttribute;
    
    // Override for stylesheet handling
    function handleStylesheet(element, href) {
        if (shouldDeferCss(href)) {
            log('📄 Deferring CSS:', href.split('/').pop());
            
            // Convert to preload + onload stylesheet
            var preload = document.createElement('link');
            preload.rel = 'preload';
            preload.as = 'style';
            preload.href = href;
            document.head.appendChild(preload);
            
            // Store for later loading
            deferredStyles.push({
                href: href,
                element: element
            });
            
            return true; // Blocked
        }
        return false; // Allow
    }
    
    // Override document.createElement
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(document, tagName, options);
        
        if (tagName.toLowerCase() === 'script') {
            // Intercept src setter
            var descriptor = Object.getOwnPropertyDescriptor(element, 'src');
            if (descriptor && descriptor.set) {
                Object.defineProperty(element, 'src', {
                    set: function(value) {
                        if (shouldDeferScript(value)) {
                            log('🛑 Blocked script src:', value.split('/').pop());
                            deferredScripts.push(value);
                            return;
                        }
                        descriptor.set.call(this, value);
                    },
                    get: descriptor.get,
                    configurable: true
                });
            }
        }
        
        if (tagName.toLowerCase() === 'link') {
            // Intercept href setter for stylesheets
            var hrefDescriptor = Object.getOwnPropertyDescriptor(element, 'href');
            if (hrefDescriptor && hrefDescriptor.set) {
                Object.defineProperty(element, 'href', {
                    set: function(value) {
                        if (element.rel === 'stylesheet' && handleStylesheet(element, value)) {
                            return; // Blocked
                        }
                        hrefDescriptor.set.call(this, value);
                    },
                    get: hrefDescriptor.get,
                    configurable: true
                });
            }
            
            // Intercept rel setter to catch when it becomes stylesheet
            var relDescriptor = Object.getOwnPropertyDescriptor(element, 'rel');
            if (relDescriptor && relDescriptor.set) {
                Object.defineProperty(element, 'rel', {
                    set: function(value) {
                        if (value === 'stylesheet' && element.href && handleStylesheet(element, element.href)) {
                            return; // Blocked
                        }
                        relDescriptor.set.call(this, value);
                    },
                    get: relDescriptor.get,
                    configurable: true
                });
            }
        }
        
        return element;
    };
    
    // Override appendChild
    Node.prototype.appendChild = function(newNode) {
        // Handle script elements
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src) {
            if (shouldDeferScript(newNode.src)) {
                var src = newNode.src;
                log('🛑 Blocked appendChild script:', src.split('/').pop());
                deferredScripts.push(src);
                return newNode;
            }
        }
        
        // Handle link/stylesheet elements
        if (newNode && newNode.tagName === 'LINK' && newNode.rel === 'stylesheet' && newNode.href) {
            if (handleStylesheet(newNode, newNode.href)) {
                return newNode; // Blocked
            }
        }
        
        return originalAppendChild.call(this, newNode);
    };
    
    // Override insertBefore
    Node.prototype.insertBefore = function(newNode, referenceNode) {
        // Handle script elements
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src) {
            if (shouldDeferScript(newNode.src)) {
                var src = newNode.src;
                log('🛑 Blocked insertBefore script:', src.split('/').pop());
                deferredScripts.push(src);
                return newNode;
            }
        }
        
        // Handle link/stylesheet elements
        if (newNode && newNode.tagName === 'LINK' && newNode.rel === 'stylesheet' && newNode.href) {
            if (handleStylesheet(newNode, newNode.href)) {
                return newNode; // Blocked
            }
        }
        
        return originalInsertBefore.call(this, newNode, referenceNode);
    };
    
    // Load deferred CSS with media="print" trick
    function loadDeferredCSS() {
        if (deferredStyles.length === 0) return;
        
        log('Loading ' + deferredStyles.length + ' deferred CSS files...');
        
        deferredStyles.forEach(function(item) {
            setTimeout(function() {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = item.href;
                link.media = 'print';
                link.onload = function() {
                    this.media = 'all';
                    log('✅ Loaded deferred CSS:', item.href.split('/').pop());
                };
                document.head.appendChild(link);
            }, DEFER_CONFIG.cssDelay);
        });
    }
    
    // Load deferred scripts after page load
    function loadDeferredScripts() {
        if (deferredScripts.length === 0) return;
        
        log('Loading ' + deferredScripts.length + ' deferred scripts...');
        var loaded = {};
        
        deferredScripts.forEach(function(src) {
            if (loaded[src]) return;
            loaded[src] = true;
            
            setTimeout(function() {
                var script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.defer = true;
                script.setAttribute('data-deferred', 'true');
                document.body.appendChild(script);
                log('✅ Loaded deferred script:', src.split('/').pop());
            }, DEFER_CONFIG.scriptDelay);
        });
    }
    
    // Load CSS as soon as possible after initial render
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            // Load CSS at DOMContentLoaded (after HTML parsing)
            loadDeferredCSS();
        });
    } else {
        loadDeferredCSS();
    }
    
    // Load scripts after full page load
    window.addEventListener('load', function() {
        loadDeferredScripts();
    });
    
    log('Defer script v3 initialized');
    log('Script patterns:', DEFER_CONFIG.scriptPatterns);
    log('CSS patterns:', DEFER_CONFIG.cssPatterns);
})();
