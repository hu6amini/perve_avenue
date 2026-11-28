"use strict";

document.documentElement.lang = "en";

// ============================================================================
// SHARED DEDUPE REGISTRY
//
// All URLs loaded through loadScript() are registered here. The Set is
// attached to `window` so that `boot-loader.js`'s releaseAssets() can
// also consult it as a defence-in-depth check.
//
// Every script element created below is given `async = true` so that
// boot-loader.js's trap condition
//     (!el.hasAttribute("async") && !el.hasAttribute("defer"))
// fails and the element is left alone. Dynamic scripts are force-async
// per spec, so this attribute is semantically a no-op for execution;
// its only effect is to bypass the trap.
// ============================================================================
const __loadedScriptUrls = (window.__loadedScriptUrls = window.__loadedScriptUrls || new Set());

function whenBodyReady(callback) {
    if (document.body) {
        callback();
    } else {
        document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
    }
}

whenBodyReady(() => {
    // ========================================================================
    // PAGE GUARD
    //
    // user-msg-loader.js owns msg/user pages and loads the same core scripts
    // (forum_core_observer, media-dimensions, breadcrumbs, boards, posts,
    // modals, quote-queue, twemoji, forum-enhancer, ...). Without this guard
    // both loaders execute on msg/user pages, evaluating every module twice
    // and throwing "Identifier 'X' has already been declared" for each
    // lexical declaration.
    // ========================================================================
    if (document.body && (document.body.id === 'msg' || document.body.id === 'user')) {
        console.debug('[Boot] dynamic-loader skipping — user-msg-loader handles this page');
        return;
    }

    // ========================================================================
    // PAGE GATES
    //
    // Every conditional script in this file reads its gate from here so the
    // rules are visible in one place. `PAGE_ID` is the <body> id.
    //
    //   mediaContent : topic / send / blog / msg / search
    //                  → lightgallery, lite-embed, posts
    //   editor       : topic / blog / send
    //                  → editor-module
    //   topicAndBlog : topic / blog
    //                  → similar-topics
    //   topicOnly    : topic
    //                  → quote-queue, report
    //
    // Note: this file never runs on `msg` (see guard above), so `msg` in
    // mediaContent is only meaningful once user-msg-loader.js is updated
    // to match.
    // ========================================================================
    const PAGE_ID = (document.body && document.body.id) || '';
    const PAGE_GATES = Object.freeze({
        mediaContent: ['topic', 'send', 'blog', 'msg', 'search'],
        editor:       ['topic', 'blog', 'send'],
        topicAndBlog: ['topic', 'blog'],
        topicOnly:    ['topic']
    });
    const onPage = (gates) => gates.includes(PAGE_ID);

    // ========================================================================
    // CONSTANTS
    // ========================================================================
    const STYLESHEETS = Object.freeze([
        "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.css"
    ]);

    const IDLE_TIMEOUT_SLICK = 500;
    const IDLE_TIMEOUT_ENHANCEMENTS = 800;

    // ========================================================================
    // 1. STYLESHEETS (global – no lightgallery)
    // ========================================================================
    STYLESHEETS.forEach(url => {
        const n = document.createElement("link");
        Object.assign(n, { rel: "preload", as: "style", href: url });
        const t = document.createElement("link");
        Object.assign(t, { rel: "stylesheet", href: url, media: "print" });
        t.onload = () => { t.media = "all"; };
        document.head.append(n, t);
    });

    // ========================================================================
    // 2. SCRIPT LOADER ENGINE
    //
    // Notes on loading semantics:
    //  - Scripts inserted via document.createElement are always executed
    //    as soon as they are available (equivalent to `async`); the
    //    `defer` attribute is ignored by the spec for such scripts.
    //  - Execution order across the phases below is preserved by awaiting
    //    the Promise returned by loadScript, which resolves on `onload`.
    //  - `crossOrigin = "anonymous"` matches the <link rel="preload">
    //    hints the boot loader creates for the foundation scripts, so the
    //    fetch is reused instead of performed twice.
    // ========================================================================
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

    // ========================================================================
    // 3. UTILITY: schedule work during idle time
    // ========================================================================
    function scheduleWork(callback, timeout = 0) {
        if (window.requestIdleCallback) {
            requestIdleCallback(callback, { timeout });
        } else {
            setTimeout(callback, Math.max(0, timeout / 2));
        }
    }

    // ========================================================================
    // 4. LCP HELPERS
    // ========================================================================
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

    // ========================================================================
    // 5. CONDITIONAL LIGHTGALLERY LOADING
    //    Gated on PAGE_GATES.mediaContent
    // ========================================================================
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

    // ========================================================================
    // 6. PHASED EXECUTION
    // ========================================================================
    async function bootSystem() {
        try {
            const startTime = performance.now();

            // PHASE A: Foundation (Popper + Tippy before top-menu, media optimizer & event bus)
            const phaseAStart = performance.now();
            await loadScript("https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js");
            const resultsA = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/npm/tippy.js@6.3.7/dist/tippy-bundle.umd.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9e04af41beaed68bef4eb46f6409596868f5877f/media-optimizer.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1977fabb5553b0f825fa92671a03b2ae26c67702/core/event-bus.min.js")
            ]);
            const failedA = resultsA.filter(r => r.status === 'rejected');
            if (failedA.length > 0) {
                console.error('[Boot] Phase A failures – system may not function correctly:', failedA);
            }
            console.debug(`[Boot] Phase A completed in ${(performance.now() - phaseAStart).toFixed(2)}ms`);

            // Fire-and-forget nav once Popper & Tippy are available
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@4d8db2868f97de11984acabd2ad4facf40642d0a/modules/top-menu.js")
                .catch(err => console.warn('[Boot] Top menu failed:', err));

            injectCriticalCSS();
            preloadLCPImage();

            // PHASE B: Visual core (Slick, DOM utils, Forum Observer, theme)
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

            // PHASE C: Third-party libraries.
            // twemoji lib always; lite-embed only on media content pages.
            const phaseCTasks = [
                loadScript("https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js")
            ];
            if (onPage(PAGE_GATES.mediaContent)) {
                phaseCTasks.push(
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9cdcc6c87d99bfce1f64f07fb1523b8b28f5a516/modules/lite-embed.min.js")
                );
            }
            const phaseCStart = performance.now();
            const resultsC = await Promise.allSettled(phaseCTasks);
            const failedC = resultsC.filter(r => r.status === 'rejected');
            if (failedC.length > 0) {
                console.warn('[Boot] Phase C had failures:', failedC);
            }
            console.debug(`[Boot] Phase C completed in ${(performance.now() - phaseCStart).toFixed(2)}ms`);

            // PHASE D: Essential module – carousel handling
            const phaseDStart = performance.now();
            try {
                await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@aa4b053757399bdc7d19ad6e9ae0892b30922b2c/modules/slick-carousel.min.js");
                console.debug(`[Boot] Phase D completed in ${(performance.now() - phaseDStart).toFixed(2)}ms`);
            } catch (err) {
                console.error('[Boot] Phase D critical failure:', err);
            }

            // Initialise Slick carousel after a short idle delay
            const initSlick = () => {
                if (window.SlickCarouselModule && typeof window.SlickCarouselModule.initialize === 'function') {
                    window.SlickCarouselModule.initialize();
                    console.debug('[Boot] Slick carousel initialized');
                }
            };
            scheduleWork(initSlick, IDLE_TIMEOUT_SLICK);

            // ============================================================
            // IDLE LOAD: remaining enhancement modules.
            // Unconditional modules first; page-gated modules pushed onto
            // the same batch so they still resolve in parallel.
            // ============================================================
            const loadEnhancements = async () => {
                const enhStart = performance.now();

                const enhTasks = [
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7fd0dfe7297bcf6f2534f9a8b3398b909994cc3/modules/media-dimensions.min.js"),
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8327d3e44bf70f2b0541e15eb6bc783c76af9913/modules/breadcrumbs.min.js"),
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e47e4580f2127e02f42122349868a623b1f115d5/modules/twemoji.min.js"),
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@7ff3fff75dfe269a166cd374fb3cbe9abfb58acd/modules/boards.min.js"),
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6a84d4d102192c98c13f4d6b2f1df381396de33e/modules/modals.min.js"),
                    loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@02eeb0013286d890512c1f5feb957eed9219ed0d/modules/modern-chat.min.js")
                ];

                if (onPage(PAGE_GATES.mediaContent)) {
                    enhTasks.push(
                        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9e7be5d157a28b96ddfb27497c8e6a11baaf1767/modules/posts.min.js")
                    );
                }

                if (onPage(PAGE_GATES.editor)) {
                    enhTasks.push(
                        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@2f926f6ecf1b9c93cf8068a9154f3d085519b70a/modules/editor-module.min.js")
                    );
                }

                if (onPage(PAGE_GATES.topicOnly)) {
                    enhTasks.push(
                        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@4b6c36ab3cde44f79c3ddb4f7dfbeed8b98a83b6/modules/quote-queue.min.js"),
                        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f9795272564a920b5d282749729e6a03ab727603/modules/report.min.js")
                    );
                }

                if (onPage(PAGE_GATES.topicAndBlog)) {
                    enhTasks.push(
                        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c265d1b599b303bf77d85a6d1c84cbd168f9bc1f/modules/similar-topics.min.js")
                    );
                }

                const results = await Promise.allSettled(enhTasks);
                const failed = results.filter(r => r.status === 'rejected');
                if (failed.length > 0) {
                    console.warn('[Boot] Enhancement load had failures:', failed);
                }
                console.debug(`[Boot] Enhancements loaded in ${(performance.now() - enhStart).toFixed(2)}ms (${enhTasks.length} module(s))`);

                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@0eb381cb6757ee78d778cdc320c3747f777eb463/core/forum-enhancer.min.js")
                    .then(() => console.log('[Boot] System Fully Enhanced'))
                    .catch(err => console.warn('[Boot] Forum enhancer failed to load:', err));
            };

            scheduleWork(loadEnhancements, IDLE_TIMEOUT_ENHANCEMENTS);

            // LightGallery — media content pages only.
            const checkAndLoadLightGallery = () => {
                if (onPage(PAGE_GATES.mediaContent)) {
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
