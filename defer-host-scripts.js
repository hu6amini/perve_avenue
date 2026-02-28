// ===== DEFER HOST SCRIPTS =====
// Place this script FIRST in the <head>, before any other scripts
(function() {
    'use strict';
    
    // Configuration
    var DEFER_CONFIG = {
        // Scripts to defer (by URL pattern)
        patterns: [
            'modal.js',
            'jq.js', 
            'jqt.js',
            'hb.js',
            'handlebars',
            'adsbygoogle.js',
            'script-loader' // Defer the main host loader too
        ],
        
        // Delay before loading deferred scripts (ms)
        delay: 3000,
        
        // Enable debug logging
        debug: true
    };
    
    // Store original DOM methods
    var originalAppendChild = Element.prototype.appendChild;
    var originalInsertBefore = Element.prototype.insertBefore;
    var originalSetAttribute = Element.prototype.setAttribute;
    
    // Queue for deferred scripts
    var deferredScripts = [];
    
    // Logging
    function log() {
        if (DEFER_CONFIG.debug) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('🔧 [DeferScript]');
            console.log.apply(console, args);
        }
    }
    
    // Check if script should be deferred
    function shouldDefer(script) {
        if (!script.src) return false;
        
        var url = script.src.toLowerCase();
        var patterns = DEFER_CONFIG.patterns;
        var i;
        
        for (i = 0; i < patterns.length; i++) {
            if (url.indexOf(patterns[i].toLowerCase()) !== -1) {
                return true;
            }
        }
        return false;
    }
    
    // Load all deferred scripts after page load
    function loadDeferredScripts() {
        if (deferredScripts.length === 0) return;
        
        log('Loading ' + deferredScripts.length + ' deferred scripts...');
        
        window.addEventListener('load', function() {
            setTimeout(function() {
                var i, src, script;
                
                for (i = 0; i < deferredScripts.length; i++) {
                    src = deferredScripts[i];
                    script = document.createElement('script');
                    script.src = src;
                    script.async = true;
                    script.defer = true;
                    script.setAttribute('data-deferred', 'true');
                    document.body.appendChild(script);
                    
                    var filename = src.split('/').pop();
                    log('Loaded deferred:', filename);
                }
            }, DEFER_CONFIG.delay);
        });
    }
    
    // Override appendChild
    Element.prototype.appendChild = function(newNode) {
        // Check if this is a script being added to head
        if (this === document.head && 
            newNode.tagName === 'SCRIPT' && 
            shouldDefer(newNode)) {
            
            var src = newNode.src;
            var filename = src.split('/').pop();
            log('🛑 Deferring script:', filename);
            
            // Queue it instead of appending
            deferredScripts.push(src);
            
            // Return something that won't break the caller
            return newNode;
        }
        
        // Normal behavior for everything else
        return originalAppendChild.call(this, newNode);
    };
    
    // Override insertBefore similarly
    Element.prototype.insertBefore = function(newNode, referenceNode) {
        if (this === document.head && 
            newNode.tagName === 'SCRIPT' && 
            shouldDefer(newNode)) {
            
            var src = newNode.src;
            var filename = src.split('/').pop();
            log('🛑 Deferring script (insertBefore):', filename);
            
            deferredScripts.push(src);
            return newNode;
        }
        
        return originalInsertBefore.call(this, newNode, referenceNode);
    };
    
    // Override setAttribute to catch dynamically added scripts
    Element.prototype.setAttribute = function(name, value) {
        // If this is a script element and they're setting src
        if (this.tagName === 'SCRIPT' && name === 'src' && this.parentNode === document.head) {
            if (shouldDefer(this)) {
                var filename = value.split('/').pop();
                log('🛑 Deferring script (setAttribute):', filename);
                deferredScripts.push(value);
                return; // Don't actually set the src
            }
        }
        
        return originalSetAttribute.call(this, name, value);
    };
    
    // Process existing scripts immediately
    function processExistingScripts() {
        var scripts = document.querySelectorAll('script[src]');
        var i, script, src, filename;
        
        for (i = 0; i < scripts.length; i++) {
            script = scripts[i];
            
            if (script.parentNode === document.head && shouldDefer(script)) {
                src = script.src;
                filename = src.split('/').pop();
                script.remove(); // Remove from DOM
                deferredScripts.push(src);
                log('🛑 Removed existing script:', filename);
            }
        }
    }
    
    // Initialize
    processExistingScripts();
    loadDeferredScripts();
    log('Defer script initialized');
})();
