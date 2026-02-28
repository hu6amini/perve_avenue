// Add this to your dynamic_loader.js after the existing code
(function() {
    'use strict';
    
    // Resources we want to make non-blocking
    const TARGET_RESOURCES = {
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
        return TARGET_RESOURCES.scripts.some(pattern => src.includes(pattern));
    }
    
    function isTargetStylesheet(href) {
        return TARGET_RESOURCES.stylesheets.some(pattern => href.includes(pattern));
    }
    
    // Create observer
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                // Handle script tags
                if (node.tagName === 'SCRIPT' && node.src && isTargetScript(node.src)) {
                    console.log('🎯 Found target script:', node.src.split('/').pop());
                    
                    // Create a new async/defer script
                    const newScript = document.createElement('script');
                    newScript.src = node.src;
                    newScript.async = true;
                    newScript.defer = true;
                    newScript.setAttribute('data-original', 'true');
                    
                    // Replace the original
                    node.parentNode.replaceChild(newScript, node);
                }
                
                // Handle link tags (CSS)
                if (node.tagName === 'LINK' && node.rel === 'stylesheet' && 
                    node.href && isTargetStylesheet(node.href)) {
                    console.log('🎯 Found target stylesheet:', node.href.split('/').pop());
                    
                    // Method 1: Set media="print" then onload set to "all"
                    node.media = 'print';
                    node.onload = () => { node.media = 'all'; };
                    
                    // Alternative Method 2: If you want to be more aggressive, use preload approach
                    // But this is cleaner for existing nodes
                }
            });
            
            // Also check for script tags that might have been added via innerHTML
            if (mutation.target.nodeType === 1) {
                const scripts = mutation.target.querySelectorAll('script[src]');
                scripts.forEach((script) => {
                    if (!script.hasAttribute('data-processed') && isTargetScript(script.src)) {
                        script.setAttribute('data-processed', 'true');
                        const newScript = document.createElement('script');
                        newScript.src = script.src;
                        newScript.async = true;
                        newScript.defer = true;
                        newScript.setAttribute('data-processed', 'true');
                        script.parentNode.replaceChild(newScript, script);
                    }
                });
                
                const styles = mutation.target.querySelectorAll('link[rel="stylesheet"]');
                styles.forEach((style) => {
                    if (!style.hasAttribute('data-processed') && isTargetStylesheet(style.href)) {
                        style.setAttribute('data-processed', 'true');
                        style.media = 'print';
                        style.onload = () => { style.media = 'all'; };
                    }
                });
            }
        });
    });
    
    // Start observing
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
    });
    
    console.log('🔍 Resource observer started - watching for forum scripts and styles');
})();
