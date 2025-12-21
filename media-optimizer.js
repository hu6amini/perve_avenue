!function(){
  // CRITICAL: Set as high priority
  if(document.currentScript)document.currentScript.setAttribute('data-priority','highest');
  
  // 1. INTERCEPT SOURCE SETTING (Most important!)
  var attrCache={};
  var elProto=Element.prototype;
  var setAttr=elProto.setAttribute;
  var getAttr=elProto.getAttribute;
  
  // Track elements that might get src before attributes
  var pendingSrc={};
  
  // Override setAttribute to catch src setting
  elProto.setAttribute=function(name,value){
    if(name==='src'||name==='srcset'){
      var tag=this.tagName;
      if(tag==='IMG'||tag==='IFRAME'){
        // Check if attributes are set
        if(!this.getAttribute('loading')&&tag==='IMG'&&!this.getAttribute('decoding')){
          // Attributes NOT set yet - set them NOW
          this.loading='lazy';
          if(tag==='IMG')this.decoding='async';
          
          // Log if debugging
          if(window.debugMediaOptimizer){
            console.log('⚠️ Intercepted src before attributes:',{
              element:tag,
              src:value,
              hadLoading:!!this.getAttribute('loading'),
              hadDecoding:!!this.getAttribute('decoding')
            });
          }
        }
      }
    }
    return setAttr.call(this,name,value);
  };
  
  // Also override property setting (img.src = '...')
  var imgProto=HTMLImageElement&&HTMLImageElement.prototype;
  var iframeProto=HTMLIFrameElement&&HTMLIFrameElement.prototype;
  
  function interceptSrcProperty(proto){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,'src');
    if(desc&&desc.set){
      var origSet=desc.set;
      Object.defineProperty(proto,'src',{
        set:function(value){
          if(!this.getAttribute('loading')&&this.tagName==='IMG'&&!this.getAttribute('decoding')){
            this.loading='lazy';
            if(this.tagName==='IMG')this.decoding='async';
          }
          return origSet.call(this,value);
        },
        get:desc.get,
        configurable:true
      });
    }
  }
  interceptSrcProperty(imgProto);
  interceptSrcProperty(iframeProto);
  
  // 2. OVERRIDE ELEMENT CREATION (your existing code)
  var ce=document.createElement,imgC=window.Image;
  document.createElement=function(t){
    var e=ce.call(document,t);
    if(e.tagName==='IMG'||e.tagName==='IFRAME'){
      // Set IMMEDIATELY on creation
      e.loading='lazy';
      e.tagName==='IMG'&&(e.decoding='async');
    }
    return e;
  };
  
  // 3. OVERRIDE Image CONSTRUCTOR
  if(imgC){
    window.Image=function(){
      var i=new imgC();
      i.loading='lazy';
      i.decoding='async';
      return i;
    };
    window.Image.prototype=imgC.prototype;
  }
  
  // 4. PROCESS EXISTING - use requestAnimationFrame for earliest possible
  function processExisting(){
    requestAnimationFrame(function(){
      var els=document.querySelectorAll('img:not([loading]),iframe:not([loading]),img:not([decoding])');
      for(var i=0;i<els.length;i++){
        var el=els[i];
        el.loading='lazy';
        el.tagName==='IMG'&&!el.decoding&&(el.decoding='async');
      }
    });
  }
  
  // 5. START AS EARLY AS POSSIBLE
  if(document.readyState==='loading'){
    // Use readystatechange instead of DOMContentLoaded (faster)
    document.addEventListener('readystatechange',function(){
      if(document.readyState==='interactive'||document.readyState==='complete'){
        processExisting();
      }
    });
    // Also run immediately in case we missed it
    setTimeout(processExisting,0);
  }else{
    processExisting();
  }
  
  // 6. MUTATION OBSERVER with priority handling
  var mo=new MutationObserver(function(muts){
    // Process in next microtask for speed
    Promise.resolve().then(function(){
      for(var i=0;i<muts.length;i++){
        for(var j=0;j<muts[i].addedNodes.length;j++){
          var node=muts[i].addedNodes[j];
          if(node.nodeType===1){
            // Process node itself
            if(node.tagName==='IMG'||node.tagName==='IFRAME'){
              node.loading='lazy';
              node.tagName==='IMG'&&(node.decoding='async');
            }
            // Process children
            if(node.querySelectorAll){
              var children=node.querySelectorAll('img,iframe');
              for(var k=0;k<children.length;k++){
                var child=children[k];
                child.loading='lazy';
                child.tagName==='IMG'&&(child.decoding='async');
              }
            }
          }
        }
      }
    });
  });
  
  // Start observing as soon as body exists
  function startObserving(){
    if(document.body){
      mo.observe(document.body,{childList:true,subtree:true});
    }else{
      setTimeout(startObserving,10);
    }
  }
  startObserving();
  
  // 7. DEBUG MODE (optional)
  window.debugMediaOptimizer=function(){
    console.log('=== MEDIA OPTIMIZER DEBUG ===');
    console.log('Script execution time:',performance.now().toFixed(2)+'ms');
    console.log('Document readyState:',document.readyState);
    
    // Test creation
    var testImg=document.createElement('img');
    console.log('Test image loading:',testImg.getAttribute('loading'));
    console.log('Test image decoding:',testImg.getAttribute('decoding'));
    
    // Test Image constructor
    var testImg2=new Image();
    console.log('new Image() loading:',testImg2.getAttribute('loading'));
    console.log('new Image() decoding:',testImg2.getAttribute('decoding'));
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
