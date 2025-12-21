(function() {
    'use strict';
    
    // Configuration
    var lazyAttributes = {
        loading: 'lazy',
        decoding: 'async'
    };
    
    // ========== OVERRIDE ELEMENT CREATION ==========
    
    // Store original methods
    var originalCreateElement = document.createElement;
    var originalImage = window.Image;
    
    // Override createElement to process img and iframe elements immediately
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(document, tagName, options);
        
        // Process img and iframe elements as soon as they're created
        var tagLower = tagName.toLowerCase();
        if (tagLower === 'img') {
            if (!element.hasAttribute('loading') || element.getAttribute('loading') === '') {
                element.setAttribute('loading', lazyAttributes.loading);
            }
            if (!element.hasAttribute('decoding') || element.getAttribute('decoding') === '') {
                element.setAttribute('decoding', lazyAttributes.decoding);
            }
        } else if (tagLower === 'iframe') {
            if (!element.hasAttribute('loading') || element.getAttribute('loading') === '') {
                element.setAttribute('loading', lazyAttributes.loading);
            }
        }
        
        return element;
    };
    
    // Override Image constructor
    if (originalImage) {
        window.Image = function(width, height) {
            var img = new originalImage(width, height);
            
            // Set attributes on Image objects (which are HTMLImageElement instances)
            if (!img.hasAttribute('loading') || img.getAttribute('loading') === '') {
                img.setAttribute('loading', lazyAttributes.loading);
            }
            if (!img.hasAttribute('decoding') || img.getAttribute('decoding') === '') {
                img.setAttribute('decoding', lazyAttributes.decoding);
            }
            
            return img;
        };
        
        // Copy prototype and static properties
        window.Image.prototype = originalImage.prototype;
        try {
            Object.setPrototypeOf(window.Image, originalImage);
        } catch (e) {
            // Fallback for older browsers
            for (var prop in originalImage) {
                if (originalImage.hasOwnProperty(prop)) {
                    window.Image[prop] = originalImage[prop];
                }
            }
        }
    }
    
    // ========== PROCESS EXISTING ELEMENTS ==========
    
    // Selectors for elements to process
    var selectors = ['img:not([loading]), img[loading=""]', 'iframe:not([loading]), iframe[loading=""]'];
    
    // Process individual element
    function processElement(element) {
        var tagName = element.tagName;
        if (tagName === 'IMG') {
            // Set both loading and decoding for images
            if (!element.hasAttribute('loading') || element.getAttribute('loading') === '') {
                element.setAttribute('loading', lazyAttributes.loading);
            }
            if (!element.hasAttribute('decoding') || element.getAttribute('decoding') === '') {
                element.setAttribute('decoding', lazyAttributes.decoding);
            }
        } else if (tagName === 'IFRAME') {
            // Set only loading for iframes
            if (!element.hasAttribute('loading') || element.getAttribute('loading') === '') {
                element.setAttribute('loading', lazyAttributes.loading);
            }
        }
    }
    
    // Process multiple elements
    function processElements(elements) {
        for (var i = 0; i < elements.length; i++) {
            processElement(elements[i]);
        }
    }
    
    // Process existing elements on page load
    function processExistingElements() {
        // Process elements missing loading attribute
        var query = selectors.join(', ');
        var elementsMissingLoading = document.querySelectorAll(query);
        processElements(elementsMissingLoading);
        
        // Process images missing decoding attribute (even if they have loading)
        var imagesMissingDecoding = document.querySelectorAll('img:not([decoding]), img[decoding=""]');
        for (var i = 0; i < imagesMissingDecoding.length; i++) {
            var img = imagesMissingDecoding[i];
            if (!img.hasAttribute('decoding') || img.getAttribute('decoding') === '') {
                img.setAttribute('decoding', lazyAttributes.decoding);
            }
        }
    }
    
    // ========== MUTATION OBSERVER ==========
    
    // MutationObserver callback
    function mutationCallback(mutationsList) {
        for (var i = 0; i < mutationsList.length; i++) {
            var mutation = mutationsList[i];
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                var elementsToProcess = [];
                
                for (var j = 0; j < mutation.addedNodes.length; j++) {
                    var node = mutation.addedNodes[j];
                    if (node.nodeType === 1) { // Element node
                        var nodeName = node.nodeName;
                        
                        // Check if the node itself matches our selectors
                        if ((nodeName === 'IMG' && (!node.hasAttribute('loading') || node.getAttribute('loading') === '')) ||
                            (nodeName === 'IFRAME' && (!node.hasAttribute('loading') || node.getAttribute('loading') === ''))) {
                            elementsToProcess.push(node);
                        }
                        
                        // Check for images missing decoding
                        if (nodeName === 'IMG' && (!node.hasAttribute('decoding') || node.getAttribute('decoding') === '')) {
                            if (!elementsToProcess.includes(node)) {
                                elementsToProcess.push(node);
                            }
                        }
                        
                        // Check for child elements
                        if (node.querySelectorAll) {
                            // Elements missing loading
                            var childElements = node.querySelectorAll(selectors.join(', '));
                            for (var k = 0; k < childElements.length; k++) {
                                if (!elementsToProcess.includes(childElements[k])) {
                                    elementsToProcess.push(childElements[k]);
                                }
                            }
                            
                            // Images missing decoding
                            var childImages = node.querySelectorAll('img:not([decoding]), img[decoding=""]');
                            for (var k = 0; k < childImages.length; k++) {
                                if (!elementsToProcess.includes(childImages[k])) {
                                    elementsToProcess.push(childImages[k]);
                                }
                            }
                        }
                    }
                }
                
                if (elementsToProcess.length > 0) {
                    processElements(elementsToProcess);
                }
            }
        }
    }
    
    // Initialize mutation observer
    function initObserver() {
        if (typeof MutationObserver === 'undefined') return null;
        
        var observer = new MutationObserver(mutationCallback);
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        return observer;
    }
    
    // ========== INITIALIZATION ==========
    
    // Initialize the script
    function init() {
        // Process existing elements
        processExistingElements();
        
        // Start observing for new elements
        initObserver();
    }
    
    // Start initialization as early as possible
    if (document.body) {
        init();
    } else {
        // If body doesn't exist yet, wait for it
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            // DOMContentLoaded already fired, use a fallback
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                setTimeout(init, 0);
            } else {
                document.addEventListener('DOMContentLoaded', init);
            }
        }
    }
    
    // Also process when body becomes available
    if (!document.body) {
        var bodyObserver = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.type === 'childList') {
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        if (mutation.addedNodes[j].nodeName === 'BODY') {
                            bodyObserver.disconnect();
                            init();
                            break;
                        }
                    }
                }
            }
        });
        
        bodyObserver.observe(document.documentElement, {
            childList: true
        });
    }
})();
