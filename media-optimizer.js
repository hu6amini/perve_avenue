(() => {
  'use strict';
  
  // ========== CONFIGURATION ==========
  const LAZY = 'lazy';
  const ASYNC_DECODING = 'async';
  
  // ========== PERFORMANCE MONITORING ==========
  let monitoredElements = [];
  let successCount = 0;
  let totalMonitored = 0;
  
  // Store original addEventListener to monitor load events
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  
  EventTarget.prototype.addEventListener = function(type, handler, options) {
    // Monitor load events on images/iframes
    if ((type === 'load' || type === 'error') && shouldOptimize(this)) {
      totalMonitored++;
      const element = this;
      const startTime = performance.now();
      const initialLoading = element.getAttribute('loading');
      const initialDecoding = element.getAttribute('decoding');
      
      // Store monitoring data
      const monitorData = {
        element: element.tagName,
        src: element.src || element.getAttribute('src') || '[no-src]',
        initialLoading: initialLoading,
        initialDecoding: initialDecoding,
        startTime: startTime,
        loadEventAttached: true
      };
      
      monitoredElements.push(monitorData);
      
      // Check if attributes are already set
      if (initialLoading === LAZY && 
          (element.tagName !== 'IMG' || initialDecoding === ASYNC_DECODING)) {
        successCount++;
        monitorData.success = true;
        monitorData.timing = 'before';
      } else {
        monitorData.success = false;
      }
      
      // Override handler to check final state
      const wrappedHandler = function(e) {
        const finalLoading = element.getAttribute('loading');
        const finalDecoding = element.getAttribute('decoding');
        const loadTime = performance.now();
        
        monitorData.finalLoading = finalLoading;
        monitorData.finalDecoding = finalDecoding;
        monitorData.loadTime = loadTime;
        monitorData.loaded = true;
        
        if (!monitorData.success && finalLoading === LAZY && 
            (element.tagName !== 'IMG' || finalDecoding === ASYNC_DECODING)) {
          successCount++;
          monitorData.success = true;
          monitorData.timing = 'during';
        }
        
        // Call original handler
        if (handler && typeof handler === 'function') {
          handler.call(this, e);
        }
      };
      
      return originalAddEventListener.call(this, type, wrappedHandler, options);
    }
    
    return originalAddEventListener.call(this, type, handler, options);
  };
  
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
  
  // ========== REPORTING FUNCTION ==========
  const generateReport = () => {
    console.log('=== MEDIA OPTIMIZER REPORT ===');
    
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
    
    // Load timing analysis
    console.log('Total elements monitored: ' + totalMonitored);
    
    if (totalMonitored > 0) {
      const successRate = Math.round((successCount / totalMonitored) * 100);
      console.log('Successfully optimized before load: ' + successCount + '/' + totalMonitored + ' (' + successRate + '%)');
      
      if (successCount === totalMonitored) {
        console.log('✅ All attributes set BEFORE element load');
      } else {
        console.log('⚠️ ' + (totalMonitored - successCount) + ' elements loaded before optimization');
        
        // Show details for failed ones
        for (let i = 0; i < monitoredElements.length; i++) {
          const item = monitoredElements[i];
          if (!item.success || item.timing === 'during') {
            console.warn('Late optimization #' + i + ': ' + item.element + ' - ' + item.src);
          }
        }
      }
    } else {
      console.log('No load events monitored (static page or no new images)');
    }
    
    console.log('=== REPORT COMPLETE ===');
  };
  
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
    
    // Generate initial report after page load
    window.addEventListener('load', function() {
      setTimeout(generateReport, 1000);
    });
    
    // Also report after 5 seconds for dynamically loaded content
    setTimeout(generateReport, 5000);
  };
  
  // ========== START ==========
  if (typeof Promise !== 'undefined') {
    Promise.resolve().then(init);
  } else {
    setTimeout(init, 0);
  }
})();
