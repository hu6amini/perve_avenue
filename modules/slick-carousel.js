// modules/slick-carousel.js
// Forum Modernizer – Slick Carousel Module
// Initialises hero carousels with modern settings
// ADDED: inert management to fix ARIA "aria-hidden focusable descendants" warning

var SlickCarouselModule = (function(Utils, EventBus) {
    'use strict';

    // Modern, full-featured configuration (matches your latest settings)
    var DEFAULT_SETTINGS = {
        slidesToShow: 1,
        slidesToScroll: 1,
        autoplay: true,
        autoplaySpeed: 3820,
        speed: 800,
        fade: true,
        cssEase: 'ease-in-out',
        dots: true,
        infinite: true,
        pauseOnFocus: false,
        pauseOnHover: false,
        waitForAnimate: false,
        prevArrow: '<button class="slick-prev" aria-label="Previous slide"><i class="fa-regular fa-angle-left" aria-hidden="true"></i></button>',
        nextArrow: '<button class="slick-next" aria-label="Next slide"><i class="fa-regular fa-angle-right" aria-hidden="true"></i></button>',
        responsive: [
            {
                breakpoint: 768,
                settings: {
                    fade: false,
                    centerMode: false,
                    arrows: false
                }
            }
        ]
    };

    // Internal state
    var isInitialised = false;
    var carousels = [];

    /**
     * Apply inert to non-active slides for accessibility
     * @param {jQuery} $el - The carousel container element
     */
    function manageInert($el) {
        $el.find('.slick-slide').each(function() {
            var $slide = jQuery(this);
            // Only the active slide should be interactive
            if ($slide.hasClass('slick-active')) {
                $slide.removeAttr('inert');
            } else {
                $slide.attr('inert', '');
            }
        });
    }

    /**
     * Initialise all carousels currently in the DOM
     */
    function initialise() {
        if (isInitialised) return;

        // Ensure jQuery and Slick are available
        if (typeof jQuery === 'undefined' || typeof jQuery.fn.slick !== 'function') {
            // Retry later – the script may have loaded lazily
            setTimeout(initialise, 200);
            return;
        }

        var $carousels = jQuery('.slick_carousel');
        if ($carousels.length === 0) {
            isInitialised = true;
            return;
        }

        $carousels.each(function() {
            var $el = jQuery(this);
            // Don't re-initialise already slicked elements
            if ($el.hasClass('slick-initialized')) return;

            $el.slick(DEFAULT_SETTINGS);
            carousels.push($el);

            // ── ARIA fix: apply inert to hidden slides ──
            // init event: after first render
            $el.on('init', function() {
                setTimeout(function() { manageInert($el); }, 0);
            });
            // afterChange event: when a new slide becomes active
            $el.on('afterChange', function() {
                setTimeout(function() { manageInert($el); }, 0);
            });
            // reInit event: responsive breakpoint changes
            $el.on('reInit', function() {
                setTimeout(function() { manageInert($el); }, 50);
            });
        });

        isInitialised = true;

        if (EventBus) {
            EventBus.trigger('slick:ready', { count: carousels.length });
        }

        console.log('[SlickModule] Initialised ' + carousels.length + ' carousel(s)');
    }

    /**
     * Re-initialise (e.g. after a theme change or dynamic content)
     */
    function refresh() {
        // Destroy existing instances first
        carousels.forEach(function($el) {
            if ($el.hasClass('slick-initialized')) {
                $el.slick('unslick');
            }
        });
        carousels = [];
        isInitialised = false;
        initialise();
    }

    // Public API
    return {
        initialize: initialise,
        refresh: refresh
    };

})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);

// Signal readiness
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('slick-module-ready'));
}
