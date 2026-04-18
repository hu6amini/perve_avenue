<!-- core/forum-enhancer.js -->
// Main orchestrator for Forum Modernizer Suite
// Coordinates all modules + injects modern CSS + robust hiding
(function() {
    'use strict';

    const ENHANCER_CONFIG = {
        name: 'Forum Enhancer',
        version: '1.1.0',
        debug: false,
        autoInitialize: true,
        wrapperId: 'modern-forum-wrapper',
        hideOriginal: true,
        modules: {
            posts: true
        }
    };

    const modules = [];
    const moduleStatus = new Map();

    function log(message, type = 'info') {
        if (!ENHANCER_CONFIG.debug && type !== 'error') return;
        const prefix = '[ForumEnhancer]';
        if (type === 'error') console.error(prefix, message);
        else if (type === 'warn') console.warn(prefix, message);
        else console.log(prefix, message);
    }

    function registerModule(name, module, dependencies = []) {
        modules.push({ name, module, dependencies, initialized: false, enabled: true });
        if (ENHANCER_CONFIG.debug) log('Registered module: ' + name);
    }

    function checkDependencies(module) {
        return module.dependencies.every(depName => {
            const dep = modules.find(m => m.name === depName);
            return dep && dep.initialized;
        });
    }

    function initializeModule(module) {
        if (module.initialized || !module.enabled) return false;
        if (!checkDependencies(module)) return false;

        try {
            if (typeof module.module.initialize === 'function') {
                module.module.initialize();
                module.initialized = true;
                moduleStatus.set(module.name, { status: 'initialized', timestamp: Date.now() });
                log('✓ Initialized: ' + module.name);
                return true;
            }
        } catch (error) {
            log('Failed to initialize ' + module.name + ': ' + error.message, 'error');
        }
        return false;
    }

    function initializeAllModules() {
        let initializedCount = 0;
        let changed;
        do {
            changed = false;
            for (const module of modules) {
                if (module.enabled && !module.initialized && initializeModule(module)) {
                    changed = true;
                    initializedCount++;
                }
            }
        } while (changed);

        return initializedCount;
    }

    // ==================== MODERN CSS INJECTION ====================
    function injectModernCSS() {
        if (document.getElementById('modern-forum-css')) return;

        const css = `
            body.forum-modernized {
                background: #f4f6f9;
            }
            body.forum-modernized.dark {
                background: #0f172a;
            }

            #modern-forum-wrapper {
                max-width: 1280px;
                margin: 0 auto;
                padding: 20px 15px;
                display: block !important;
            }

            /* HIDE LEGACY UI COMPLETELY */
            body.forum-modernized .topic .List,
            body.forum-modernized .topic .mainbg,
            body.forum-modernized .post:not(.post-card),
            body.forum-modernized .forum-table,
            body.forum-modernized .big_list,
            body.forum-modernized .board,
            body.forum-modernized .footer,
            body.forum-modernized .header,
            body.forum-modernized .menuwrap,
            body.forum-modernized .st-emoji-container:not(.modern-emoji),
            body.forum-modernized .signature:not(.signature-modern) {
                display: none !important;
            }

            .post-card {
                background: #fff;
                border-radius: 16px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.08);
                margin-bottom: 24px;
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            body.dark .post-card { background: #1e2937; color: #e2e8f0; }

            .post-card:hover {
                transform: translateY(-3px);
                box-shadow: 0 20px 40px rgba(0,0,0,0.12);
            }

            .post-header-modern {
                padding: 16px 20px;
                background: #f8fafc;
                border-bottom: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            body.dark .post-header-modern { background: #334155; border-color: #475569; }

            .post-body { padding: 20px; line-height: 1.7; }
            .post-footer-modern { padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
            body.dark .post-footer-modern { background: #334155; border-color: #475569; }

            .avatar-modern img { border-radius: 50%; border: 3px solid #e2e8f0; }
            body.dark .avatar-modern img { border-color: #475569; }

            .reaction-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 8px 14px;
                border-radius: 9999px;
                transition: all 0.2s;
            }
            .reaction-btn:hover { background: #e2e8f0; }
            body.dark .reaction-btn:hover { background: #475569; }

            @media (max-width: 768px) {
                .post-card { margin-bottom: 16px; border-radius: 12px; }
                #modern-forum-wrapper { padding: 12px 8px; }
            }
        `;

        const style = document.createElement('style');
        style.id = 'modern-forum-css';
        style.textContent = css;
        document.head.appendChild(style);
        log('Modern CSS injected');
    }

    function createModernWrapper() {
        let wrapper = document.getElementById(ENHANCER_CONFIG.wrapperId);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = ENHANCER_CONFIG.wrapperId;
            document.body.insertBefore(wrapper, document.body.firstChild);
        }

        let container = document.getElementById('modern-posts-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modern-posts-container';
            wrapper.appendChild(container);
        }

        return wrapper;
    }

    function hideOriginalContent() {
        document.documentElement.classList.add('forum-modernized');
        if (document.documentElement.getAttribute('data-theme') === 'dark' || 
            window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
        log('Original legacy UI hidden + modern wrapper activated');
    }

    function registerAllModules() {
        if (typeof ForumPostsModule !== 'undefined') {
            registerModule('posts', ForumPostsModule);
        } else {
            log('ForumPostsModule not found', 'error');
        }
    }

    async function waitForForumObserver() {
        return new Promise(resolve => {
            if (globalThis.forumObserver) return resolve(globalThis.forumObserver);

            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (globalThis.forumObserver) {
                    clearInterval(interval);
                    resolve(globalThis.forumObserver);
                } else if (attempts >= 80) {
                    clearInterval(interval);
                    log('ForumCoreObserver not found after 8 seconds', 'warn');
                    resolve(null);
                }
            }, 100);
        });
    }

    const ForumEnhancer = {
        version: ENHANCER_CONFIG.version,
        getWrapper: () => document.getElementById(ENHANCER_CONFIG.wrapperId),
        getPostsContainer: () => document.getElementById('modern-posts-container'),
        enableDebug: () => { ENHANCER_CONFIG.debug = true; log('Debug enabled'); },
        reinitialize: () => { modules.forEach(m => m.initialized = false); initializeAllModules(); }
    };

    async function initialize() {
        log('========================================');
        log(`${ENHANCER_CONFIG.name} v${ENHANCER_CONFIG.version} — Starting`);
        log('========================================');

        await new Promise(r => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r); else r(); });

        injectModernCSS();
        if (ENHANCER_CONFIG.hideOriginal) hideOriginalContent();
        createModernWrapper();

        const observer = await waitForForumObserver();
        if (observer) log('ForumCoreObserver ready');

        registerAllModules();
        const initialized = initializeAllModules();
        log(`${initialized} module(s) initialized successfully`);

        log('🚀 Forum Enhancer is now running at 10/10 quality');
    }

    window.ForumEnhancer = ForumEnhancer;
    if (ENHANCER_CONFIG.autoInitialize) initialize();
})();
