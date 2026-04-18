// core/dom-utils.js
// DOM manipulation utilities for Forum Enhancer
var ForumDOMUtils = (function() {
    'use strict';
    // ============================================================================
    // ELEMENT SELECTION
    // ============================================================================
    function getElement(selector) {
        if (!selector) return null;
        return document.querySelector(selector);
    }
    function getAllElements(selector) {
        if (!selector) return [];
        return document.querySelectorAll(selector);
    }
    function getElementById(id) {
        if (!id) return null;
        return document.getElementById(id);
    }
    function getElementsByClass(className) {
        if (!className) return [];
        return document.getElementsByClassName(className);
    }
    // ============================================================================
    // CLASS MANIPULATION
    // ============================================================================
    function addClass(element, className) {
        if (element && element.classList && className) {
            var classes = className.split(' ');
            for (var i = 0; i < classes.length; i++) {
                if (classes[i]) {
                    element.classList.add(classes[i]);
                }
            }
        }
    }
    function removeClass(element, className) {
        if (element && element.classList && className) {
            var classes = className.split(' ');
            for (var i = 0; i < classes.length; i++) {
                if (classes[i]) {
                    element.classList.remove(classes[i]);
                }
            }
        }
    }
    function hasClass(element, className) {
        if (element && element.classList && className) {
            return element.classList.contains(className);
        }
        return false;
    }
    function toggleClass(element, className) {
        if (element && element.classList && className) {
            element.classList.toggle(className);
        }
    }
    // ============================================================================
    // STYLE MANIPULATION
    // ============================================================================
    function setStyle(element, property, value) {
        if (element && element.style && property) {
            element.style[property] = value;
        }
    }
    function getStyle(element, property) {
        if (element && window.getComputedStyle && property) {
            return window.getComputedStyle(element)[property];
        }
        return null;
    }
    function setStyles(element, styles) {
        if (element && element.style && styles) {
            for (var key in styles) {
                if (styles.hasOwnProperty(key)) {
                    element.style[key] = styles[key];
                }
            }
        }
    }
    function hideElement(element) {
        if (element) {
            element.style.display = 'none';
        }
    }
    function showElement(element, displayType) {
        if (element) {
            element.style.display = displayType || '';
        }
    }
    function isVisible(element) {
        if (!element) return false;
        return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }
    // ============================================================================
    // ATTRIBUTE MANIPULATION
    // ============================================================================
    function setAttribute(element, attribute, value) {
        if (element && attribute) {
            element.setAttribute(attribute, value);
        }
    }
    function getAttribute(element, attribute) {
        if (element && attribute) {
            return element.getAttribute(attribute);
        }
        return null;
    }
    function removeAttribute(element, attribute) {
        if (element && attribute) {
            element.removeAttribute(attribute);
        }
    }
    function hasAttribute(element, attribute) {
        if (element && attribute) {
            return element.hasAttribute(attribute);
        }
        return false;
    }
    function setDataAttribute(element, key, value) {
        if (element && key) {
            element.dataset[key] = value;
        }
    }
    function getDataAttribute(element, key) {
        if (element && key && element.dataset) {
            return element.dataset[key];
        }
        return null;
    }
    // ============================================================================
    // ELEMENT CREATION & MANIPULATION
    // ============================================================================
    function createElement(tagName, className, attributes, innerHtml) {
        var el = document.createElement(tagName);
       
        if (className) {
            el.className = className;
        }
       
        if (attributes) {
            for (var key in attributes) {
                if (attributes.hasOwnProperty(key)) {
                    el.setAttribute(key, attributes[key]);
                }
            }
        }
       
        if (innerHtml) {
            el.innerHTML = innerHtml;
        }
       
        return el;
    }
    function createDiv(className, attributes, innerHtml) {
        return createElement('div', className, attributes, innerHtml);
    }
    function createSpan(className, attributes, innerHtml) {
        return createElement('span', className, attributes, innerHtml);
    }
    function insertAfter(newNode, referenceNode) {
        if (newNode && referenceNode && referenceNode.parentNode) {
            referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
        }
    }
    function insertBefore(newNode, referenceNode) {
        if (newNode && referenceNode && referenceNode.parentNode) {
            referenceNode.parentNode.insertBefore(newNode, referenceNode);
        }
    }
    function appendChild(parent, child) {
        if (parent && child) {
            parent.appendChild(child);
        }
    }
    function prependChild(parent, child) {
        if (parent && child) {
            parent.insertBefore(child, parent.firstChild);
        }
    }
    function removeElement(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }
    function emptyElement(element) {
        if (element) {
            element.innerHTML = '';
        }
    }
    // ============================================================================
    // CONTENT MANIPULATION
    // ============================================================================
    function getHtml(element) {
        if (element) {
            return element.innerHTML;
        }
        return '';
    }
    function setHtml(element, html) {
        if (element) {
            element.innerHTML = html;
        }
    }
    function getText(element) {
        if (element) {
            return element.textContent;
        }
        return '';
    }
    function setText(element, text) {
        if (element) {
            element.textContent = text;
        }
    }
    // ============================================================================
    // HTML ESCAPING
    // ============================================================================
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    function unescapeHtml(html) {
        if (!html) return '';
        var div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent;
    }
    // ============================================================================
    // SCROLL & POSITION
    // ============================================================================
    function isElementInViewport(element, offset) {
        if (!element) return false;
       
        var rect = element.getBoundingClientRect();
        var buffer = offset || 0;
       
        return (
            rect.top >= -buffer &&
            rect.left >= -buffer &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + buffer &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth) + buffer
        );
    }
    function scrollToElement(element, behavior) {
        if (element) {
            element.scrollIntoView({
                behavior: behavior || 'smooth',
                block: 'start'
            });
        }
    }
    function getElementPosition(element) {
        if (!element) return { top: 0, left: 0 };
       
        var rect = element.getBoundingClientRect();
        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
       
        return {
            top: rect.top + scrollTop,
            left: rect.left + scrollLeft,
            width: rect.width,
            height: rect.height
        };
    }
    // ============================================================================
    // PARENT / CHILD TRAVERSAL
    // ============================================================================
    function closest(element, selector) {
        if (element && element.closest) {
            return element.closest(selector);
        }
       
        // Fallback for older browsers
        var current = element;
        while (current && current !== document.body) {
            if (current.matches && current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
    function getParents(element, selector) {
        var parents = [];
        var current = element;
       
        while (current && current !== document.body) {
            if (!selector || (current.matches && current.matches(selector))) {
                parents.push(current);
            }
            current = current.parentElement;
        }
       
        return parents;
    }
    function getChildren(element, selector) {
        if (!element) return [];
       
        var children = Array.from(element.children);
       
        if (selector) {
            return children.filter(function(child) {
                return child.matches && child.matches(selector);
            });
        }
       
        return children;
    }
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    function on(element, event, callback, useCapture) {
        if (element && event && callback) {
            element.addEventListener(event, callback, useCapture || false);
        }
    }
    function off(element, event, callback) {
        if (element && event && callback) {
            element.removeEventListener(event, callback);
        }
    }
    function once(element, event, callback, useCapture) {
        var wrapper = function(e) {
            callback(e);
            off(element, event, wrapper);
        };
        on(element, event, wrapper, useCapture);
    }
    // ============================================================================
    // DELEGATION
    // ============================================================================
    function delegate(parent, selector, event, callback) {
        function handler(e) {
            var target = e.target;
            var matched = closest(target, selector);
           
            if (matched && parent.contains(matched)) {
                callback.call(matched, e);
            }
        }
       
        on(parent, event, handler);
        return handler;
    }
    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        // Selection
        getElement: getElement,
        getAllElements: getAllElements,
        getElementById: getElementById,
        getElementsByClass: getElementsByClass,
       
        // Class manipulation
        addClass: addClass,
        removeClass: removeClass,
        hasClass: hasClass,
        toggleClass: toggleClass,
       
        // Style manipulation
        setStyle: setStyle,
        getStyle: getStyle,
        setStyles: setStyles,
        hideElement: hideElement,
        showElement: showElement,
        isVisible: isVisible,
       
        // Attribute manipulation
        setAttribute: setAttribute,
        getAttribute: getAttribute,
        removeAttribute: removeAttribute,
        hasAttribute: hasAttribute,
        setDataAttribute: setDataAttribute,
        getDataAttribute: getDataAttribute,
       
        // Element creation
        createElement: createElement,
        createDiv: createDiv,
        createSpan: createSpan,
       
        // DOM manipulation
        insertAfter: insertAfter,
        insertBefore: insertBefore,
        appendChild: appendChild,
        prependChild: prependChild,
        removeElement: removeElement,
        emptyElement: emptyElement,
       
        // Content
        getHtml: getHtml,
        setHtml: setHtml,
        getText: getText,
        setText: setText,
       
        // HTML escaping
        escapeHtml: escapeHtml,
        unescapeHtml: unescapeHtml,
       
        // Scroll & position
        isElementInViewport: isElementInViewport,
        scrollToElement: scrollToElement,
        getElementPosition: getElementPosition,
       
        // Traversal
        closest: closest,
        getParents: getParents,
        getChildren: getChildren,
       
        // Events
        on: on,
        off: off,
        once: once,
        delegate: delegate
    };
   
})();
