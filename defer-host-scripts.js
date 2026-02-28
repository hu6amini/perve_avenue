// Add this to your defer-host-scripts.js (or early in dynamic_loader.js)
(function() {
    'use strict';
    
    const TARGET_PATTERNS = {
        scripts: [
            'jquery.modal/modal.js',
            'jquery.scrollbar/jquery.scrollbar.js',
            'jquery.timeago/jquery.timeago.en.js',
            'popperjs/popper.js',
            'tippyjs/tippy.js',
            'notifications/plugin_v3.js'
        ],
        stylesheets: [
            'jquery.modal/modal.css',
            'jquery.scrollbar/jquery.scrollbar.macosx.css',
            'tippyjs/css/theme+animation.css',
            'notifications/desktop.css'
        ]
    };
    
    function isTargetScript(src) {
        return TARGET_PATTERNS.scripts.some(pattern => src.includes(pattern));
    }
    
    function isTargetStylesheet(href) {
        return TARGET_PATTERNS.stylesheets.some(pattern => href.includes(pattern));
    }
    
    // Store the original appendChild
    const originalAppendChild = Node.prototype.appendChild;
    
    // Override it
    Node.prototype.appendChild = function(newNode) {
        // Handle scripts
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src && isTargetScript(newNode.src)) {
            console.log('🎯 Intercepted script:', newNode.src.split('/').pop());
            
            // Create a new async/defer version
            const newScript = document.createElement('script');
            newScript.src = newNode.src;
            newScript.async = true;
            newScript.defer = true;
            
            // Return the new script instead
            return originalAppendChild.call(this, newScript);
        }
        
        // Handle stylesheets
        if (newNode && newNode.tagName === 'LINK' && newNode.rel === 'stylesheet' && 
            newNode.href && isTargetStylesheet(newNode.href)) {
            console.log('🎯 Intercepted stylesheet:', newNode.href.split('/').pop());
            
            // Make it non-blocking
            newNode.media = 'print';
            newNode.onload = () => { newNode.media = 'all'; };
        }
        
        return originalAppendChild.call(this, newNode);
    };
    
    // Also override insertBefore for completeness
    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function(newNode, referenceNode) {
        if (newNode && newNode.tagName === 'SCRIPT' && newNode.src && isTargetScript(newNode.src)) {
            const newScript = document.createElement('script');
            newScript.src = newNode.src;
            newScript.async = true;
            newScript.defer = true;
            return originalInsertBefore.call(this, newScript, referenceNode);
        }
        
        if (newNode && newNode.tagName === 'LINK' && newNode.rel === 'stylesheet' && 
            newNode.href && isTargetStylesheet(newNode.href)) {
            newNode.media = 'print';
            newNode.onload = () => { newNode.media = 'all'; };
        }
        
        return originalInsertBefore.call(this, newNode, referenceNode);
    };
    
    console.log('🛡️ Script/Style interceptor active');
})();
