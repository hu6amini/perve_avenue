$('.slick_carousel').slick({
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 3820,
    speed: 800,                  // slightly longer, smoother transition
    fade: true,                  // hero look
    cssEase: 'ease-in-out',
    dots: true,
    infinite: true,
    lazyLoad: 'ondemand',
    pauseOnFocus: false,
    pauseOnHover: false,         // keep it brisk unless slides are interactive
    waitForAnimate: false,       // allow rapid clicks (better for hero)
    prevArrow: '<button class="slick-prev"><i class="fa-regular fa-chevron-left"></i></button>',
    nextArrow: '<button class="slick-next"><i class="fa-regular fa-chevron-right"></i></button>',
    responsive: [
      {
        breakpoint: 768,
        settings: {
          fade: false,           // fallback to slide on mobile if fade is janky
          centerMode: false,
          arrows: false
        }
      }
    ]
});
