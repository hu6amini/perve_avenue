!function(){
  'use strict';
  
  // Store original methods (faster access)
  var doc=document, win=window;
  var origCreate=doc.createElement, origImage=win.Image;
  var origSetAttr=Element.prototype.setAttribute;
  
  // Optimize single element (cached values)
  function optimize(el){
    if(!el||!el.tagName)return el;
    
    var tag=el.tagName, loading=el.loading, decoding=el.decoding;
    
    if(tag==='IMG'||tag==='IFRAME'){
      if(!loading){
        el.loading='lazy';
      }
      if(tag==='IMG'&&!decoding){
        el.decoding='async';
      }
    }
    return el;
  }
  
  // ========== INTERCEPT SOURCE SETTING ==========
  
  // Override setAttribute (optimized)
  Element.prototype.setAttribute=function(name,value){
    // Check for src/srcset first (fast path)
    if(name.charAt(0)==='s'&&(name==='src'||name==='srcset')){
      var tag=this.tagName;
      if(tag==='IMG'||tag==='IFRAME'){
        var loading=this.loading, decoding=this.decoding;
        if(!loading){
          this.loading='lazy';
        }
        if(tag==='IMG'&&!decoding){
          this.decoding='async';
        }
      }
    }
    return origSetAttr.call(this,name,value);
  };
  
  // Intercept .src property (optimized)
  function interceptSrc(proto){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,'src');
    if(desc&&desc.set){
      Object.defineProperty(proto,'src',{
        set:function(value){
          var tag=this.tagName;
          if(tag==='IMG'||tag==='IFRAME'){
            if(!this.loading)this.loading='lazy';
            if(tag==='IMG'&&!this.decoding)this.decoding='async';
          }
          desc.set.call(this,value);
        },
        get:desc.get,
        configurable:true
      });
    }
  }
  interceptSrc(HTMLImageElement&&HTMLImageElement.prototype);
  interceptSrc(HTMLIFrameElement&&HTMLIFrameElement.prototype);
  
  // ========== OVERRIDE CREATION ==========
  
  // Override createElement (optimized)
  doc.createElement=function(tagName){
    var el=origCreate.call(doc,tagName);
    return optimize(el);
  };
  
  // Override Image constructor (optimized)
  if(origImage){
    win.Image=function(){
      var img=new origImage();
      img.loading='lazy';
      img.decoding='async';
      return img;
    };
    win.Image.prototype=origImage.prototype;
  }
  
  // ========== PROCESS EXISTING ==========
  
  function processExisting(){
    // Single query, filter in loop (more efficient)
    var els=doc.querySelectorAll('img, iframe');
    for(var i=0,len=els.length;i<len;i++){
      optimize(els[i]);
    }
  }
  
  // ========== INITIALIZATION ==========
  
  // Fast initialization
  if(doc.readyState==='loading'){
    // Single event listener
    var onReady=function(){
      processExisting();
      doc.removeEventListener('DOMContentLoaded',onReady);
    };
    doc.addEventListener('DOMContentLoaded',onReady);
  }else{
    // Use microtask for immediate execution
    Promise.resolve().then(processExisting);
  }
  
  // ========== MUTATION OBSERVER ==========
  
  // Optimized observer
  var observer=new MutationObserver(function(mutations){
    // Process in batch (faster than microtask for many mutations)
    for(var i=0,len=mutations.length;i<len;i++){
      var nodes=mutations[i].addedNodes;
      for(var j=0,nodesLen=nodes.length;j<nodesLen;j++){
        var node=nodes[j];
        if(node.nodeType===1){
          optimize(node);
          // Process children if needed
          var tag=node.tagName;
          if(tag==='DIV'||tag==='SPAN'||tag==='P'){
            var children=node.querySelectorAll('img, iframe');
            for(var k=0,childrenLen=children.length;k<childrenLen;k++){
              optimize(children[k]);
            }
          }
        }
      }
    }
  });
  
  // Start observing
  function startObserving(){
    var body=doc.body;
    if(body){
      observer.observe(body,{childList:true,subtree:true});
    }else{
      setTimeout(startObserving,9); // ~1 frame at 120fps
    }
  }
  setTimeout(startObserving,0);
  
  // ========== DEBUG ==========
  
  win.debugMediaOptimizer=function(){
    console.log('Media Optimizer v2.0 (Optimized)');
    
    // Performance test
    var start=performance.now();
    var test1=doc.createElement('img');
    var test2=new win.Image();
    var end=performance.now();
    
    console.log('Perf:',(end-start).toFixed(2)+'ms');
    console.log('Tests:',{
      createElement:{loading:test1.loading,decoding:test1.decoding},
      newImage:{loading:test2.loading,decoding:test2.decoding}
    });
    
    // Stats
    var imgs=doc.querySelectorAll('img');
    var lazy=0,asyncDec=0;
    for(var i=0,len=imgs.length;i<len;i++){
      if(imgs[i].loading==='lazy')lazy++;
      if(imgs[i].decoding==='async')asyncDec++;
    }
    console.log('Coverage:',lazy+'/'+imgs.length+' lazy ('+
      Math.round((lazy/imgs.length)*100)+'%), '+
      asyncDec+'/'+imgs.length+' async');
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
