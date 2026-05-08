// core/event-bus.js
// Central event communication between modules

var ForumEventBus = (function() {
    'use strict';

    // ===== USER TIMING: mark start =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('event-bus-start');
    }
    // ====================================
   
    var events = {};
    var debug = false;
   
    function on(eventName, callback) {
        if (!events[eventName]) {
            events[eventName] = [];
        }
        events[eventName].push(callback);
        if (debug) console.log('[EventBus] Registered:', eventName);
    }
   
    function off(eventName, callback) {
        if (!events[eventName]) return;
       
        if (!callback) {
            delete events[eventName];
            if (debug) console.log('[EventBus] Removed all:', eventName);
            return;
        }
       
        var index = events[eventName].indexOf(callback);
        if (index !== -1) {
            events[eventName].splice(index, 1);
            if (debug) console.log('[EventBus] Removed one from:', eventName);
        }
    }
   
    function trigger(eventName, data) {
        if (!events[eventName]) return [];
       
        var results = [];
        for (var i = 0; i < events[eventName].length; i++) {
            try {
                var result = events[eventName][i](data);
                results.push(result);
            } catch(e) {
                console.error('[EventBus] Error in ' + eventName + ' handler:', e);
            }
        }
       
        if (debug) console.log('[EventBus] Triggered:', eventName, data);
        return results;
    }
   
    function once(eventName, callback) {
        var wrapper = function(data) {
            callback(data);
            off(eventName, wrapper);
        };
        on(eventName, wrapper);
    }
   
    function enableDebug() {
        debug = true;
        console.log('[EventBus] Debug mode enabled');
    }
   
    function disableDebug() {
        debug = false;
    }
   
    function clear() {
        events = {};
        if (debug) console.log('[EventBus] All events cleared');
    }
   
    return {
        on: on,
        off: off,
        trigger: trigger,
        once: once,
        enableDebug: enableDebug,
        disableDebug: disableDebug,
        clear: clear
    };
})();

// Signal that event-bus is ready
if (typeof window !== 'undefined') {
    // ===== USER TIMING: mark end & measure =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('event-bus-end');
        try {
            performance.measure('event-bus-load-time', 'event-bus-start', 'event-bus-end');
        } catch (e) {
            // Ignore if marks are missing
        }
    }
    // ===========================================

    window.dispatchEvent(new CustomEvent('event-bus-ready'));
}
