// modules/slick-carousel.js
// Forum Modernizer – Slick Carousel Module
// Initialises hero carousels with modern settings

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
        prevArrow: '<button class="slick-prev"><i class="fa-regular fa-chevron-left"></i></button>',
        nextArrow: '<button class="slick-next"><i class="fa-regular fa-chevron-right"></i></button>',
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
