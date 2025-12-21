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
    if (descriptor?.set) {
      Object.defineProperty(proto, prop, {
        set(value) {
          optimizeElement(this);
          descriptor.set.call(this, value);
        },
        get: descriptor.get,
        configurable: true
      });
    }
  };
  
  interceptProperty(HTMLImageElement?.prototype, 'src');
  interceptProperty(HTMLIFrameElement?.prototype, 'src');
  
  // ========== OVERRIDE CREATELEMENT ==========
  const originalCreateElement = document.createElement;
  
  document.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    return optimizeElement(element);
  };
  
  // ========== OVERRIDE IMAGE CONSTRUCTOR ==========
  const OriginalImage = window.Image;
  
  if (OriginalImage) {
    window.Image = class extends OriginalImage {
      constructor(width, height) {
        super(width, height);
        this.setAttribute('loading', LAZY);
        this.setAttribute('decoding', ASYNC_DECODING);
      }
    };
    
    // Ensure prototype chain is maintained
    Object.setPrototypeOf(window.Image, OriginalImage);
  }
  
  // ========== PROCESS EXISTING ELEMENTS ==========
  const processExisting = () => {
    const selectors = [
      'img:not([loading]), img[loading=""]',
      'iframe:not([loading]), iframe[loading=""]',
      'img:not([decoding]), img[decoding=""]'
    ];
    
    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach(optimizeElement);
  };
  
  // ========== MUTATION OBSERVER ==========
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // Not an element node
        
        optimizeElement(node);
        
        if (node.querySelectorAll) {
          const children = node.querySelectorAll('img, iframe');
          children.forEach(optimizeElement);
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
      const bodyObserver = new MutationObserver((_, obs) => {
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
  };
  
  // ========== DEBUG UTILITIES ==========
  Object.defineProperty(window, 'debugMediaOptimizer', {
    value: () => {
      console.group('📊 Media Optimizer Debug');
      console.log('Execution time:', performance.now().toFixed(2), 'ms');
      console.log('Ready state:', document.readyState);
      console.log('Observer:', observer ? 'Active' : 'Inactive');
      
      // Test cases
      const tests = [
        { name: 'createElement', element: document.createElement('img') },
        { name: 'Image constructor', element: window.Image && new Image() },
        { name: 'iframe', element: document.createElement('iframe') }
      ];
      
      for (const test of tests) {
        if (test.element) {
          console.log(test.name, '→', {
            loading: test.element.getAttribute('loading'),
            decoding: test.element.getAttribute('decoding')
          });
        }
      }
      
      // Stats
      const images = document.querySelectorAll('img');
      const iframes = document.querySelectorAll('iframe');
      const optimizedImages = Array.from(images).filter(img => 
        img.getAttribute('loading') === LAZY
      ).length;
      const asyncImages = Array.from(images).filter(img => 
        img.getAttribute('decoding') === ASYNC_DECODING
      ).length;
      
      console.log('📈 Statistics:');
      console.log(`Images: ${optimizedImages}/${images.length} lazy (${Math.round(optimizedImages/images.length*100)}%)`);
      console.log(`Images: ${asyncImages}/${images.length} async decoding (${Math.round(asyncImages/images.length*100)}%)`);
      console.log(`Iframes: ${iframes.length} total`);
      
      console.groupEnd();
    },
    writable: false,
    configurable: true
  });
  
  // ========== START ==========
  // Use microtask for initialization
  Promise.resolve().then(init);
  
  // Fallback for older browsers
  if (typeof Promise === 'undefined') {
    setTimeout(init, 0);
  }
})();




!function(){
  // Monitor image/iframe loading
  var loadLog = [];
  
  // Override addEventListener for load/error events
  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, handler, options){
    if((type==='load'||type==='error') && (this.tagName==='IMG'||this.tagName==='IFRAME')){
      var start=Date.now();
      var src=this.src||this.getAttribute('src')||'[no-src]';
      var attrs={
        loading:this.getAttribute('loading'),
        decoding:this.getAttribute('decoding')
      };
      
      loadLog.push({
        element:this.tagName,
        src:src,
        attrs:attrs,
        eventAdded:start,
        attributesSet:start,
        willLoad:!this.complete
      });
      
      // Check if already loaded (happens fast)
      setTimeout(function(){
        if(!this.complete){
          loadLog[loadLog.length-1].attributesSet=Date.now();
          loadLog[loadLog.length-1].attrsAtLoad={
            loading:this.getAttribute('loading'),
            decoding:this.getAttribute('decoding')
          };
        }
      }.bind(this),0);
    }
    return origAdd.call(this,type,handler,options);
  };
  
  // Log results after page load
  window.addEventListener('load',function(){
    setTimeout(function(){
      console.log('=== LOAD TIMING ANALYSIS ===');
      console.log('Total elements monitored: '+loadLog.length);
      
      var lateCount=0;
      loadLog.forEach(function(item,idx){
        if(item.attrsAtLoad&&(!item.attrsAtLoad.loading||item.attrsAtLoad.loading!=='lazy')){
          console.warn('Late attribute #'+idx+':',item);
          lateCount++;
        }
      });
      
      if(lateCount===0){
        console.log('✅ All attributes set BEFORE element load');
      }else{
        console.warn('⚠️ '+lateCount+' elements had late attribute setting');
      }
    },1000);
  });
}();
