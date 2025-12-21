(() => {
  'use strict';
  
  // ========== CONFIGURATION ==========
  const LAZY = 'lazy';
  const ASYNC_DECODING = 'async';
  
  // ========== HELPER FUNCTIONS ==========
  const shouldOptimize = (element) => 
    element && (element.tagName === 'IMG' || element.tagName === 'IFRAME');
  
  const needsLoading = (element) => 
    !element.hasAttribute('loading') || element.getAttribute('loading') === '';
  
  const needsDecoding = (element) => 
    element.tagName === 'IMG' && (!element.hasAttribute('decoding') || element.getAttribute('decoding') === '');
  
  const optimizeElement = (element) => {
    if (!shouldOptimize(element)) return element;
    
    if (needsLoading(element)) {
      element.setAttribute('loading', LAZY);
    }
    
    if (needsDecoding(element)) {
      element.setAttribute('decoding', ASYNC_DECODING);
    }
    
    return element;
  };
  
  // ========== OVERRIDE SETATTRIBUTE ==========
  const originalSetAttribute = Element.prototype.setAttribute;
  
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'srcset') && shouldOptimize(this)) {
      optimizeElement(this);
    }
    return originalSetAttribute.call(this, name, value);
  };
  
  // ========== OVERRIDE SRC PROPERTY ==========
  const interceptProperty = (proto, prop) => {
    if (!proto) return;
    
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (descriptor && descriptor.set) {
      Object.defineProperty(proto, prop, {
        set: function(value) {
          optimizeElement(this);
          descriptor.set.call(this, value);
        },
        get: descriptor.get,
        configurable: true
      });
    }
  };
  
  interceptProperty(HTMLImageElement && HTMLImageElement.prototype, 'src');
  interceptProperty(HTMLIFrameElement && HTMLIFrameElement.prototype, 'src');
  
  // ========== OVERRIDE CREATELEMENT ==========
  const originalCreateElement = document.createElement;
  
  document.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    return optimizeElement(element);
  };
  
  // ========== OVERRIDE IMAGE CONSTRUCTOR ==========
  const OriginalImage = window.Image;
  
  if (OriginalImage) {
    window.Image = function(width, height) {
      const img = new OriginalImage(width, height);
      img.setAttribute('loading', LAZY);
      img.setAttribute('decoding', ASYNC_DECODING);
      return img;
    };
    
    window.Image.prototype = OriginalImage.prototype;
  }
  
  // ========== PROCESS EXISTING ELEMENTS ==========
  const processExisting = () => {
    const selectors = [
      'img:not([loading]), img[loading=""]',
      'iframe:not([loading]), iframe[loading=""]',
      'img:not([decoding]), img[decoding=""]'
    ];
    
    const elements = document.querySelectorAll(selectors.join(', '));
    for (let i = 0; i < elements.length; i++) {
      optimizeElement(elements[i]);
    }
  };
  
  // ========== MUTATION OBSERVER ==========
  const observer = new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i++) {
      const mutation = mutations[i];
      if (mutation.type !== 'childList') continue;
      
      for (let j = 0; j < mutation.addedNodes.length; j++) {
        const node = mutation.addedNodes[j];
        if (node.nodeType !== 1) continue;
        
        optimizeElement(node);
        
        if (node.querySelectorAll) {
          const children = node.querySelectorAll('img, iframe');
          for (let k = 0; k < children.length; k++) {
            optimizeElement(children[k]);
          }
        }
      }
    }
  });
  
  // ========== INITIALIZATION ==========
  const init = () => {
    // Process existing elements
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', processExisting);
    } else {
      processExisting();
    }
    
    // Start observing
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    } else {
      // Wait for body to exist
      const bodyObserver = new MutationObserver(function(_, obs) {
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
          obs.disconnect();
        }
      });
      
      bodyObserver.observe(document.documentElement, {
        childList: true
      });
    }
    
    // Write console report after initialization
    setTimeout(function() {
      console.log('Media Optimizer initialized');
      
      // Test creation methods
      const testImg1 = document.createElement('img');
      console.log('createElement: loading=' + testImg1.getAttribute('loading') + ', decoding=' + testImg1.getAttribute('decoding'));
      
      if (window.Image) {
        const testImg2 = new Image();
        console.log('imageConstructor: loading=' + testImg2.getAttribute('loading') + ', decoding=' + testImg2.getAttribute('decoding'));
      }
      
      // Count existing images
      const images = document.querySelectorAll('img');
      let lazyCount = 0;
      let asyncCount = 0;
      
      for (let i = 0; i < images.length; i++) {
        if (images[i].getAttribute('loading') === LAZY) lazyCount++;
        if (images[i].getAttribute('decoding') === ASYNC_DECODING) asyncCount++;
      }
      
      console.log('Existing images: ' + lazyCount + '/' + images.length + ' lazy, ' + asyncCount + '/' + images.length + ' async');
      
      // Visual indicator
      if (images.length > 0) {
        const badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4CAF50;color:white;padding:8px 12px;border-radius:4px;font-family:sans-serif;font-size:11px;z-index:9999;opacity:0.9;';
        badge.innerHTML = '✓ Media Optimized';
        document.body.appendChild(badge);
        setTimeout(function() { badge.remove(); }, 3000);
      }
    }, 100);
  };
  
  // ========== START ==========
  if (typeof Promise !== 'undefined') {
    Promise.resolve().then(init);
  } else {
    setTimeout(init, 0);
  }
})();
