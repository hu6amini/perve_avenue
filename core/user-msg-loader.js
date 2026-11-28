"use strict";

const __loadedScriptUrls = (window.__loadedScriptUrls = window.__loadedScriptUrls || new Set());

// Wait for DOM to be ready before checking body id
function whenBodyReady(callback) {
    if (document.body) {
        callback();
    } else {
        document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
    }
}

whenBodyReady(() => {
    const allowedIds = ['msg', 'user'];
    if (!document.body || !allowedIds.includes(document.body.id)) {
        console.debug('[Boot] Skipped – not a msg/user page (body id:', document.body?.id, ')');
        return;
    }

    const IS_MSG_PAGE = document.body.id === 'msg';

    // ============================================================================
    // CONDITIONAL PRELOADS (Bypasses ForumCommunity attribute mangling)
    // ============================================================================
    const url = window.location.href;
    const IS_COMPOSE_SECTION = IS_MSG_PAGE &&
        url.indexOf('CODE=01') === -1 &&
        url.indexOf('CODE=02') === -1;

    if (IS_COMPOSE_SECTION) {
        const messengerLink = document.createElement('link');
        messengerLink.rel = 'preload';
        messengerLink.as = 'script';
        messengerLink.href = 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@881f66345403c55640095746a1c632c24930955f/modules/messenger.min.js';
        messengerLink.crossOrigin = 'anonymous';
        document.head.appendChild(messengerLink);

        [
            'https://esm.sh/@tiptap/core@2.5.2',
            'https://esm.sh/@tiptap/starter-kit@2.5.2',
            'https://esm.sh/@tiptap/extension-placeholder@2.5.2',
            'https://esm.sh/@tiptap/extension-underline@2.5.2',
            'https://esm.sh/@tiptap/extension-image@2.5.2',
            'https://esm.sh/@tiptap/extension-link@2.5.2',
            'https://esm.sh/@tiptap/extension-mention@2.5.2',
            'https://esm.sh/@tiptap/extension-code-block-lowlight@2.5.2',
            'https://esm.sh/@tiptap/extension-character-count@2.5.2',
            'https://esm.sh/@tiptap/extension-typography@2.5.2',
            'https://esm.sh/prosemirror-state@1.4.3',
            'https://esm.sh/prosemirror-view@1.33.0',
            'https://esm.sh/lowlight@3'
        ].forEach(href => {
            const link = document.createElement('link');
            link.rel = 'modulepreload';
            link.href = href;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        });
    }

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    const CONTENT_PAGE_IDS = Object.freeze(['topic', 'send', 'search', 'blog']);

    const STYLESHEETS = Object.freeze([
        "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.css"
    ]);

    // ============================================================================
    // 1. STYLESHEETS (global – no lightgallery)
    // ============================================================================
    STYLESHEETS.forEach(url => {
        const n = document.createElement("link");
        Object.assign(n, { rel: "preload", as: "style", href: url });
        const t = document.createElement("link");
        Object.assign(t, { rel: "stylesheet", href: url, media: "print" });
        t.onload = () => { t.media = "all"; };
        document.head.append(n, t);
    });

    // ============================================================================
    // 2. SCRIPT LOADER ENGINE
    // ============================================================================
    function loadScript(src, isModule = false) {
        if (__loadedScriptUrls.has(src)) {
            return Promise.resolve();
        }
        __loadedScriptUrls.add(src);

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;

            const fileName = src.split('/').pop()
                               .replace(/\.min\.(js|css)$/, '.$1')
                               .replace(/\.(js|css)$/, '');

            if (isModule || fileName === 'media-optimizer') {
                script.type = 'module';
            }

            script.async = true;
            script.crossOrigin = "anonymous";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function loadScriptsSequentially(sources) {
        for (const src of sources) {
            await loadScript(src);
        }
    }

    // ============================================================================
    // 3. UTILITY: schedule work during idle time
    // ============================================================================
    function scheduleWork(callback, timeout = 0) {
        if (window.requestIdleCallback) {
            requestIdleCallback(callback, { timeout });
        } else {
            setTimeout(callback, Math.max(0, timeout / 2));
        }
    }

    // ============================================================================
    // 4. LCP HELPERS
    // ============================================================================
    function injectCriticalCSS() {
        const style = document.createElement('style');
        style.textContent = `
            /* Ensure first carousel slide is visible before Slick initialises */
            .slick_carousel .slick-slide:first-child,
            .slick_carousel .slick-slide[data-slick-index="0"] {
                opacity: 1 !important;
            }
        `;
        document.head.appendChild(style);
    }

    function preloadLCPImage() {
        const heroImg = document.querySelector('.slick_carousel .slick-slide:first-child img');
        if (heroImg && heroImg.src) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = heroImg.src;
            link.fetchPriority = 'high';
            document.head.appendChild(link);
        }
    }

    // ============================================================================
    // 5. CONDITIONAL LIGHTGALLERY LOADING (only on content pages)
    // ============================================================================
    function injectStylesheet(url) {
        const preload = document.createElement("link");
        Object.assign(preload, { rel: "preload", as: "style", href: url });
        const link = document.createElement("link");
        Object.assign(link, { rel: "stylesheet", href: url, media: "print" });
        link.onload = () => { link.media = "all"; };
        document.head.append(preload, link);
    }

    async function loadLightGallery() {
        const LIGHTGALLERY_CSS = [
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b1f4e12ce14b0a52bcaef8d222bd2700a8f45f80/lightgallery@2.7.1/lightgallery.min.css",
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.css",
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c5a5f520f3985fb7ef4d90892360aba8bf55a2c0/lightgallery@2.7.1/lg-thumbnail.min.css",
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b6a816af149a4736f9ee02135f35997b7c03eb4d/lightgallery@2.7.1/lg-fullscreen.min.css",
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d4e08c60945a1d195666f212ada2df73eced5447/lightgallery@2.7.1/lg-share.min.css",
            "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c64ef501230b0ff4e87c4be912ba83686da2a8e6/lightgallery@2.7.1/lg-autoplay.min.css"
        ];

        LIGHTGALLERY_CSS.forEach(url => injectStylesheet(url));

        const results = await Promise.allSettled([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243547e38cee67f93610cf59391795e8380c/lightgallery@2.7.1/lightgallery.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b199e98bff31d5d7d4cf359f779edc7a09ac2086/lightgallery@2.7.1/lg-thumbnail.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8b2d601281752a66afad3bd04a7a084365b9d2a4/lightgallery@2.7.1/lg-fullscreen.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@42de4d63b84c47559296db9d026f39970d8f77c7/lightgallery@2.7.1/lg-share.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7e3cfe5755e6520972b53e8f0563d0b88771e5a/lightgallery@2.7.1/lg-autoplay.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c98180cb5d0223215fbcce99520b806470836e40/lightgallery@2.7.1/lg-hash.min.js")
        ]);

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.warn('[Boot] Some lightgallery modules failed to load:', failed);
        }
    }

    // ============================================================================
    // 6. PHASED EXECUTION (NO TIPTAP – messenger loads it via import)
    // ============================================================================
    async function bootSystem() {
        try {
            const startTime = performance.now();

            // Set language only on allowed pages
            document.documentElement.lang = "en";

            // PHASE A: Foundation (Popper + API cache before tippy, media optimizer & event bus)
            //
            // - popper: required by tippy and top-menu. Critical — throw on failure.
            // - api-cache: required by media-optimizer (this phase) and
            //   media-dimensions (Phase D below). Non-critical — both
            //   modules fall back if ForumApiCache is absent.
            const phaseAStart = performance.now();
            const prereqs = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@3be65c0183dcaa87a666bb3ef93bd78a1cd9c11e/modules/api-cache.js")
            ]);
            if (prereqs[0].status === 'rejected') {
                throw new Error('[Boot] Popper failed to load — critical');
            }
            if (prereqs[1].status === 'rejected') {
                console.warn('[Boot] api-cache failed to load — media preload/seeding disabled:', prereqs[1].reason);
            }

            const resultsA = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/npm/tippy.js@6.3.7/dist/tippy-bundle.umd.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b177014ac23bee306542326aef1c41c1a528b5e3/media-optimizer.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1977fabb5553b0f825fa92671a03b2ae26c67702/core/event-bus.min.js")
            ]);
            const failedA = resultsA.filter(r => r.status === 'rejected');
            if (failedA.length > 0) {
                console.error('[Boot] Phase A failures – system may not function correctly:', failedA);
            }
            console.debug(`[Boot] Phase A completed in ${(performance.now() - phaseAStart).toFixed(2)}ms`);

            // Fire-and-forget nav once Popper & Tippy are available
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f8fb43141d2723645232a6fbec6f4593151cecd3/modules/top-menu.js")
                .catch(err => console.warn('[Boot] Top menu failed:', err));

            injectCriticalCSS();
            preloadLCPImage();

            // PHASE B: Visual core (Slick, DOM utils, Forum Observer, Theme)
            const phaseBStart = performance.now();
            const resultsB = await Promise.allSettled([
                loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9681242beef6f3a2e2e4c8de461c2e6eeabec26a/core/dom-utils.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@70efe7c7bca10a5093093841f67994aef3b76819/forum_core_observer.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f026ad7f7daaf1eeb12eb4b6bcb46fe9f2d6d2cd/modules/theme.min.js")
            ]);
            const failedB = resultsB.filter(r => r.status === 'rejected');
            if (failedB.length > 0) {
                console.warn('[Boot] Phase B had failures:', failedB);
            }
            console.debug(`[Boot] Phase B completed in ${(performance.now() - phaseBStart).toFixed(2)}ms`);

            // PHASE C: Third-party libs + carousel + messenger.
            const phaseCStart = performance.now();
            const resultsC = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9cdcc6c87d99bfce1f64f07fb1523b8b28f5a516/modules/lite-embed.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@aa4b053757399bdc7d19ad6e9ae0892b30922b2c/modules/slick-carousel.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@552eb9e1da84bc49e112b5808dd5ac3c879f3e2e/modules/messenger.min.js")
            ]);
            const failedC = resultsC.filter(r => r.status === 'rejected');
            if (failedC.length > 0) {
                console.warn('[Boot] Phase C had failures:', failedC);
            }
            console.debug(`[Boot] Phase C completed in ${(performance.now() - phaseCStart).toFixed(2)}ms`);

            if (window.SlickCarouselModule && typeof window.SlickCarouselModule.initialize === 'function') {
                window.SlickCarouselModule.initialize();
                console.debug('[Boot] Slick carousel initialized');
            }

            // PHASE D: Enhancement modules.
            const phaseDStart = performance.now();
            const resultsD = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7fd0dfe7297bcf6f2534f9a8b3398b909994cc3/modules/media-dimensions.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@98832ef61e13d85bcbb47f0a8c12a6c948de4eb2/modules/breadcrumbs.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e47e4580f2127e02f42122349868a623b1f115d5/modules/twemoji.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6ebe425d4b87ea16bd652506dbff2638329f0512/modules/boards.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6c011e6d20041b78de0124c376e617dcec7f4352/modules/posts.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6a84d4d102192c98c13f4d6b2f1df381396de33e/modules/modals.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@4b6c36ab3cde44f79c3ddb4f7dfbeed8b98a83b6/modules/quote-queue.min.js")
            ]);
            const failedD = resultsD.filter(r => r.status === 'rejected');
            if (failedD.length > 0) {
                console.warn('[Boot] Phase D had failures:', failedD);
            }
            console.debug(`[Boot] Phase D completed in ${(performance.now() - phaseDStart).toFixed(2)}ms`);

            // PHASE E: Orchestrator.
            const phaseEStart = performance.now();
            try {
                await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8134bdecd2bffe15f91715fab655d57fb52a23df/core/forum-enhancer.min.js");
                console.debug(`[Boot] Phase E completed in ${(performance.now() - phaseEStart).toFixed(2)}ms`);
                console.log('[Boot] System Fully Enhanced');
            } catch (err) {
                console.warn('[Boot] Forum enhancer failed to load:', err);
            }

            // LAZY LOAD: Social widgets (Twitter/Instagram) when they become visible
            const tweetEl = document.querySelector('.twitter-tweet, .twitter-timeline, [data-twitter]');
            if (tweetEl) {
                const tweetObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const s = document.createElement('script');
                            s.src = 'https://platform.twitter.com/widgets.js';
                            s.async = true;
                            document.head.appendChild(s);
                            tweetObserver.disconnect();
                            console.debug('[Boot] Twitter widgets loaded');
                        }
                    });
                }, { rootMargin: '200px' });
                tweetObserver.observe(tweetEl);
            }

            const instagramEl = document.querySelector('.instagram-media, .instagram-embed, [data-instagram]');
            if (instagramEl) {
                const instagramObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const s = document.createElement("script");
                            s.src = "https://platform.instagram.com/en_US/embeds.js";
                            s.async = true;
                            document.head.appendChild(s);
                            instagramObserver.disconnect();
                            console.debug('[Boot] Instagram embeds loaded');
                        }
                    });
                }, { rootMargin: '200px' });
                instagramObserver.observe(instagramEl);
            }

            const checkAndLoadLightGallery = () => {
                const id = document.body?.id;
                if (CONTENT_PAGE_IDS.includes(id)) {
                    loadLightGallery().catch(err => console.error('[Boot] LightGallery failed:', err));
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkAndLoadLightGallery, { once: true });
            } else {
                checkAndLoadLightGallery();
            }

            console.log(`[Boot] System initialization completed in ${(performance.now() - startTime).toFixed(2)}ms`);
        } catch (err) {
            console.error('[Boot] Critical failure:', err);
        }
    }

    bootSystem();
});
