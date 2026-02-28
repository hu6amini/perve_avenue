// ===== DEFER HOST SCRIPTS v2 - MORE AGGRESSIVE =====
// Place this script FIRST in the <head>, before any other scripts
(function() {
    'use strict';
    
    // Configuration
    var DEFER_CONFIG = {
        patterns: [
            // jQuery and modal
            'jq.js',
            'jqt.js', 
            'modal.js',
            'jquery.modal',
            
            // Handlebars
            'hb.js',
            'handlebars',
            
            // Cloudflare/Turnstile
            'turnstile',
            'challenges.cloudflare.com',
            
            // Google services
            'api.js?render',
            'recaptcha',
            'cse.google.com',
            'google.com/cse',
            
            // Social widgets
            'platform.twitter.com',
            'platform.instagram.com',
            
            // Ads
            'adsbygoogle.js',
            'sportslocalmedia.com',
            'akcelo',
            
            // Forum host specific
            'script-loader',
            'forumfree.net/libs',
            'forumfree.net/internals',
            'popper.js',
            'tippy.js',
            'scrollbar',
            'timeago',
            
            // Your own scripts that should load later
            'instant.page',
            'lite-vimeo',
            'lite-youtube'
        ],
        
        // Delay before loading (ms)
        delay: 4000,
        
        debug: true
    };
    
    // Store original methods
    var originalCreateElement = document.createElement;
    var originalAppendChild = Node.prototype.appendChild;
    var originalInsertBefore = Node.prototype.insertBefore;
    var originalSetAttribute = Element.prototype.setAttribute;
    var originalWrite = document.write;
    
    // Queue for deferred scripts
    var deferredScripts = [];
    
    function log() {
        if (DEFER_CONFIG.debug) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('🔧 [DeferScript v2]');
            console.log.apply(console, args);
        }
    }
    
    function shouldDefer(src) {
        if (!src) return false;
        var url = src.toLowerCase();
        var patterns = DEFER_CONFIG.patterns;
        
        for (var i = 0; i < patterns.length; i++) {
            if (url.indexOf(patterns[i].toLowerCase()) !== -1) {
                return true;
            }
        }
        return false;
    }
    
    // Override document.createElement
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(document, tagName, options);
        
        if (tagName.toLowerCase() === 'script') {
            // Store the original src setter for this element
            var descriptor = Object.getOwnPropertyDescriptor(element, 'src');
            if (descriptor && descriptor.set) {
                Object.defineProperty(element, 'src', {
                    set: function(value) {
                        if (shouldDefer(value)) {
                            log('🛑 Blocked src set:', value.split('/').pop());
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
        return element;
    };
    
    // Override appendChild
    Node.prototype.appendChild = function(newNode) {
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src && shouldDefer(newNode.src)) {
            var src = newNode.src;
            var filename = src.split('/').pop();
            log('🛑 Blocked appendChild:', filename);
            deferredScripts.push(src);
            return newNode;
        }
        return originalAppendChild.call(this, newNode);
    };
    
    // Override insertBefore
    Node.prototype.insertBefore = function(newNode, referenceNode) {
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src && shouldDefer(newNode.src)) {
            var src = newNode.src;
            var filename = src.split('/').pop();
            log('🛑 Blocked insertBefore:', filename);
            deferredScripts.push(src);
            return newNode;
        }
        return originalInsertBefore.call(this, newNode, referenceNode);
    };
    
    // Override setAttribute
    Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'SCRIPT' && name === 'src' && shouldDefer(value)) {
            var filename = value.split('/').pop();
            log('🛑 Blocked setAttribute:', filename);
            deferredScripts.push(value);
            return;
        }
        return originalSetAttribute.call(this, name, value);
    };
    
    // Override document.write
    document.write = function(str) {
        if (typeof str === 'string' && str.indexOf('<script') !== -1) {
            var srcMatch = str.match(/src=["']([^"']+)["']/);
            if (srcMatch && shouldDefer(srcMatch[1])) {
                log('🛑 Blocked document.write script:', srcMatch[1].split('/').pop());
                deferredScripts.push(srcMatch[1]);
                return;
            }
        }
        return originalWrite.call(document, str);
    };
    
    // Load deferred scripts after page load
    window.addEventListener('load', function() {
        setTimeout(function() {
            log('Loading ' + deferredScripts.length + ' deferred scripts...');
            var loaded = {};
            
            deferredScripts.forEach(function(src) {
                if (loaded[src]) return;
                loaded[src] = true;
                
                var script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.defer = true;
                script.setAttribute('data-deferred', 'true');
                document.body.appendChild(script);
                log('Loaded deferred:', src.split('/').pop());
            });
        }, DEFER_CONFIG.delay);
    });
    
    log('Defer script v2 initialized with patterns:', DEFER_CONFIG.patterns.join(', '));
})();
