!function(){
  'use strict';
  
  // ========== MAIN OPTIMIZER ==========
  if(document.currentScript)document.currentScript.setAttribute('data-priority','highest');
  
  // Helper to process a single element
  function optimizeElement(el){
    if(el.tagName==='IMG'||el.tagName==='IFRAME'){
      if(!el.loading||el.loading===''){
        el.loading='lazy';
      }
      if(el.tagName==='IMG'&&(!el.decoding||el.decoding==='')){
        el.decoding='async';
      }
    }
    return el;
  }
  
  // Create a CLEAN document fragment parser (no overrides)
  var cleanDoc;
  try {
    // Try to use a detached iframe for clean parsing
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.documentElement.appendChild(iframe);
    cleanDoc = iframe.contentDocument || iframe.contentWindow.document;
    document.documentElement.removeChild(iframe);
  } catch(e) {
    // Fallback: create element with original methods
    cleanDoc = {
      createElement: function(tag) {
        return document.createElement.call(document, tag);
      }
    };
  }
  
  // 1. INTERCEPT innerHTML/outerHTML - FIXED to avoid recursion
  function interceptInnerHTML(proto){
    if(!proto)return;
    
    var innerDesc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    if(innerDesc && innerDesc.set){
      var originalSet = innerDesc.set;
      Object.defineProperty(proto, 'innerHTML', {
        set: function(html){
          // Use a temporary element WITHOUT our overrides
          var temp;
          if(cleanDoc.createElement){
            temp = cleanDoc.createElement('div');
          } else {
            // Ultra-safe fallback: create element using document's original method
            temp = document.createElement('div');
          }
          
          // Temporarily remove our setter to avoid recursion
          var tempSetter = Object.getOwnPropertyDescriptor(temp.__proto__, 'innerHTML').set;
          Object.defineProperty(temp, 'innerHTML', {
            set: function(h) {
              // Use original setter for the temp div
              var original = Object.getOwnPropertyDescriptor(this.__proto__, 'innerHTML').set;
              return original.call(this, h);
            },
            get: Object.getOwnPropertyDescriptor(temp.__proto__, 'innerHTML').get
          });
          
          // Parse the HTML
          temp.innerHTML = html;
          
          // Optimize img/iframe elements in the parsed content
          var imgs = temp.querySelectorAll('img, iframe');
          for(var i = 0; i < imgs.length; i++){
            optimizeElement(imgs[i]);
          }
          
          // Call original setter with optimized HTML
          return originalSet.call(this, temp.innerHTML);
        },
        get: innerDesc.get,
        configurable: true
      });
    }
    
    // Also intercept insertAdjacentHTML - SIMPLIFIED version
    var origInsertAdjacentHTML = proto.insertAdjacentHTML;
    if(origInsertAdjacentHTML){
      proto.insertAdjacentHTML = function(position, html){
        // Create a clean temporary container
        var temp = document.createElement('div');
        
        // Use a try-catch to avoid any recursion issues
        try {
          // Temporarily remove our innerHTML setter for this element
          var innerDesc = Object.getOwnPropertyDescriptor(temp.__proto__, 'innerHTML');
          if(innerDesc && innerDesc.set){
            var tempSetter = innerDesc.set;
            Object.defineProperty(temp, 'innerHTML', {
              set: tempSetter,
              get: innerDesc.get,
              configurable: true
            });
          }
          
          temp.innerHTML = html;
          
          // Optimize
          var imgs = temp.querySelectorAll('img, iframe');
          for(var i = 0; i < imgs.length; i++){
            optimizeElement(imgs[i]);
          }
          
          // Use original method
          return origInsertAdjacentHTML.call(this, position, temp.innerHTML);
        } catch(e) {
          // If anything goes wrong, use original without optimization
          console.warn('Media Optimizer: insertAdjacentHTML interception failed, using fallback');
          return origInsertAdjacentHTML.call(this, position, html);
        }
      };
    }
  }
  
  // Apply interceptions carefully
  setTimeout(function(){
    try {
      interceptInnerHTML(Element.prototype);
      if(window.HTMLElement){
        interceptInnerHTML(HTMLElement.prototype);
      }
    } catch(e){
      console.warn('Media Optimizer: innerHTML interception failed', e);
    }
  }, 0);
  
  // 2. INTERCEPT SOURCE SETTING
  var elProto = Element.prototype;
  var originalSetAttribute = elProto.setAttribute;
  
  elProto.setAttribute = function(name, value){
    var tag = this.tagName;
    if((name === 'src' || name === 'srcset') && (tag === 'IMG' || tag === 'IFRAME')){
      if(!this.loading || this.loading === ''){
        this.loading = 'lazy';
      }
      if(tag === 'IMG' && (!this.decoding || this.decoding === '')){
        this.decoding = 'async';
      }
    }
    return originalSetAttribute.call(this, name, value);
  };
  
  // 3. OVERRIDE ELEMENT CREATION
  var originalCreateElement = document.createElement;
  var originalImage = window.Image;
  
  document.createElement = function(tagName){
    var el = originalCreateElement.call(document, tagName);
    return optimizeElement(el);
  };
  
  // 4. OVERRIDE Image CONSTRUCTOR
  if(originalImage){
    window.Image = function(){
      var img = new originalImage();
      img.loading = 'lazy';
      img.decoding = 'async';
      return img;
    };
    window.Image.prototype = originalImage.prototype;
  }
  
  // 5. PROCESS EXISTING ELEMENTS
  function processExisting(){
    try {
      var imgs = document.querySelectorAll('img:not([loading]), iframe:not([loading]), img:not([decoding])');
      for(var i = 0; i < imgs.length; i++){
        optimizeElement(imgs[i]);
      }
    } catch(e){
      console.warn('Media Optimizer: processExisting failed', e);
    }
  }
  
  // 6. START IMMEDIATELY (with error handling)
  function safeInit(){
    try {
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', processExisting);
        setTimeout(processExisting, 100); // Small delay to avoid conflicts
      } else {
        setTimeout(processExisting, 0);
      }
    } catch(e){
      console.warn('Media Optimizer: init failed', e);
    }
  }
  
  safeInit();
  
  // 7. MUTATION OBSERVER (simplified, safe)
  var observer;
  try {
    observer = new MutationObserver(function(mutations){
      for(var i = 0; i < mutations.length; i++){
        var mutation = mutations[i];
        if(mutation.type === 'childList' && mutation.addedNodes.length > 0){
          for(var j = 0; j < mutation.addedNodes.length; j++){
            var node = mutation.addedNodes[j];
            if(node.nodeType === 1){
              try {
                optimizeElement(node);
                
                // Also optimize children
                if(node.querySelectorAll){
                  var children = node.querySelectorAll('img, iframe');
                  for(var k = 0; k < children.length; k++){
                    optimizeElement(children[k]);
                  }
                }
              } catch(e){
                // Silently continue
              }
            }
          }
        }
      }
    });
    
    function startObserver(){
      if(document.body){
        observer.observe(document.body, {childList: true, subtree: true});
      } else {
        setTimeout(startObserver, 50);
      }
    }
    
    setTimeout(startObserver, 200); // Start with delay to avoid conflicts
  } catch(e){
    console.warn('Media Optimizer: MutationObserver failed', e);
  }
  
  // Debug function - safe
  window.debugMediaOptimizer = function(){
    console.log('=== MEDIA OPTIMIZER (SAFE MODE) ===');
    
    // Test basic functionality
    try {
      var test1 = document.createElement('img');
      console.log('createElement img: loading=' + test1.loading);
      
      var test2 = new Image();
      console.log('new Image(): loading=' + test2.loading);
      
      // Test innerHTML carefully
      var div = document.createElement('div');
      var html = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
      
      // Use try-catch for innerHTML test
      try {
        div.innerHTML = html;
        var test3 = div.querySelector('img');
        console.log('innerHTML img: loading=' + (test3 ? test3.loading : 'null'));
      } catch(e){
        console.log('innerHTML test skipped (safe mode)');
      }
    } catch(e){
      console.log('Debug tests failed:', e);
    }
  };
  
}();



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
