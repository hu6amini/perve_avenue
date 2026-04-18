// core/forum-enhancer.js
(function() {
    'use strict';

    const ENHANCER_CONFIG = {
        name: 'Forum Enhancer',
        version: '1.1.0',
        debug: false,                    // set to true for verbose logs
        wrapperId: 'modern-forum-wrapper',
        hideOriginal: true,
        modules: {
            posts: true
        }
    };

    const modules = [];
    const moduleStatus = new Map();

    function log(msg, type = 'info') {
        if (!ENHANCER_CONFIG.debug && type !== 'error') return;
        const prefix = `[ForumEnhancer ${ENHANCER_CONFIG.version}]`;
        if (type === 'error') console.error(prefix, msg);
        else if (type === 'warn') console.warn(prefix, msg);
        else console.log(prefix, msg);
    }

    function registerModule(name, module, dependencies = []) {
        modules.push({ name, module, dependencies, initialized: false, enabled: ENHANCER_CONFIG.modules[name] !== false });
        if (ENHANCER_CONFIG.debug) log(`Registered module: ${name}`);
    }

    function checkDependencies(module) {
        return !module.dependencies.length || module.dependencies.every(dep => {
            const found = modules.find(m => m.name === dep);
            return found && found.initialized;
        });
    }

    function initializeModule(module) {
        if (module.initialized || !module.enabled) return false;
        if (!checkDependencies(module)) return false;

        try {
            if (typeof module.module.initialize === 'function') {
                module.module.initialize();
                module.initialized = true;
                moduleStatus.set(module.name, { status: 'initialized', ts: Date.now() });
                log(`✓ Initialized: ${module.name}`);
                return true;
            }
        } catch (err) {
            log(`Failed to initialize ${module.name}: ${err.message}`, 'error');
            moduleStatus.set(module.name, { status: 'failed', error: err.message });
        }
        return false;
    }

    async function initializeAllModules() {
        log('Starting module initialization...');
        let changed = true;
        let attempts = 0;
        const maxAttempts = 15;

        while (changed && attempts < maxAttempts) {
            changed = false;
            for (const mod of modules) {
                if (!mod.initialized && mod.enabled && checkDependencies(mod)) {
                    if (initializeModule(mod)) changed = true;
                }
            }
            attempts++;
        }

        const initialized = modules.filter(m => m.initialized).length;
        log(`${initialized}/${modules.length} modules initialized`);
        return initialized;
    }

    function createModernWrapper() {
        let wrapper = document.getElementById(ENHANCER_CONFIG.wrapperId);
        if (wrapper) return wrapper;

        wrapper = document.createElement('div');
        wrapper.id = ENHANCER_CONFIG.wrapperId;
        wrapper.className = 'modern-forum-wrapper';
        document.body.insertBefore(wrapper, document.body.firstChild);

        const postsContainer = document.createElement('div');
        postsContainer.id = 'modern-posts-container';
        postsContainer.className = 'modern-posts-container';
        wrapper.appendChild(postsContainer);

        log('Modern wrapper created');
        return wrapper;
    }

    function injectModernCSS() {
        if (document.getElementById('forum-modern-css')) return;

        const style = document.createElement('style');
        style.id = 'forum-modern-css';
        style.textContent = `
            body.forum-modernized .topic .List,
            body.forum-modernized .topic .mainbg,
            body.forum-modernized .post:not(.post-card),
            body.forum-modernized .forum-header,
            body.forum-modernized .forum-footer,
            body.forum-modernized .signature,
            body.forum-modernized .edit { 
                display: none !important; 
            }

            #modern-forum-wrapper { 
                display: block !important; 
                min-height: 100vh;
            }

            .modern-posts-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 1rem;
            }

            /* Modern card base styles - expand as needed */
            .post-card {
                background: var(--card-bg, #fff);
                border-radius: 12px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.08);
                margin-bottom: 1.5rem;
                padding: 1.25rem;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .post-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.12);
            }

            @media (max-width: 768px) {
                .post-card { margin-bottom: 1rem; padding: 1rem; }
            }
        `;
        document.head.appendChild(style);
        log('Modern CSS injected');
    }

    function hideOriginalContent() {
        document.body.classList.add('forum-modernized');
        log('Legacy UI hidden via body class + CSS');
    }

    function waitForForumObserver() {
        return new Promise(resolve => {
            if (globalThis.forumObserver) {
                resolve(globalThis.forumObserver);
                return;
            }
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (globalThis.forumObserver || attempts > 60) {
                    clearInterval(interval);
                    resolve(globalThis.forumObserver || null);
                }
            }, 80);
        });
    }

    async function initialize() {
        log('========================================');
        log(`${ENHANCER_CONFIG.name} v${ENHANCER_CONFIG.version} starting`);
        log('========================================');

        await new Promise(r => {
            if (document.readyState !== 'loading') r();
            else document.addEventListener('DOMContentLoaded', r);
        });

        createModernWrapper();
        injectModernCSS();
        if (ENHANCER_CONFIG.hideOriginal) hideOriginalContent();

        const observer = await waitForForumObserver();
        log(observer ? 'ForumCoreObserver ready' : 'Running without observer (dynamic updates limited)', observer ? 'info' : 'warn');

        // Register modules
        if (typeof ForumPostsModule !== 'undefined') {
            registerModule('posts', ForumPostsModule);
        }

        await initializeAllModules();

        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.trigger('forum:enhancer:ready', {
                version: ENHANCER_CONFIG.version,
                observer: !!observer
            });
        }

        log('Forum Enhancer is now fully operational ✓');
    }

    // Public API
    window.ForumEnhancer = {
        version: ENHANCER_CONFIG.version,
        enableDebug: () => { ENHANCER_CONFIG.debug = true; log('Debug enabled'); },
        disableDebug: () => { ENHANCER_CONFIG.debug = false; },
        reinitialize: () => initializeAllModules(),
        getWrapper: () => document.getElementById(ENHANCER_CONFIG.wrapperId),
        getPostsContainer: () => document.getElementById('modern-posts-container')
    };

    // Auto-start
    initialize().catch(err => log(`Fatal init error: ${err.message}`, 'error'));

})();
