// ============================================================================
// PATCHED forum_core_observer.js - FIX for document.body null error
// Use this instead of the original if you continue to have issues
// ============================================================================
class ForumCoreObserver {
    #observer = null;
    #mutationQueue = [];
    #isProcessing = false;
    #initialScanComplete = false;
    #debounceTimeouts = new Map();
    #processedNodes = new WeakSet();
    #cleanupIntervalId = null;
    
    // Private fields for better encapsulation
    #callbacks = new Map();           // id -> callback config
    #debouncedCallbacks = new Map();  // id -> debounced config
    #pageState = null; // Will be initialized later
    
    // Configuration with static getters
    static get #OBSERVER_OPTIONS() {
        return {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'id', 'style', 'data-*']
        };
    }
    
    constructor() {
        // Wait for body to exist before initializing
        this.#waitForBody();
    }
    
    #waitForBody() {
        if (document.body) {
            this.#initialize();
        } else {
            // Wait for body to be created
            const observer = new MutationObserver(() => {
                if (document.body) {
                    observer.disconnect();
                    this.#initialize();
                }
            });
            observer.observe(document.documentElement, { childList: true });
            
            // Fallback: Also listen for DOMContentLoaded
            document.addEventListener('DOMContentLoaded', () => {
                observer.disconnect();
                this.#initialize();
            }, { once: true });
        }
    }
    
    #initialize() {
        // Now that body exists, detect page state
        this.#pageState = this.#detectPageState();
        
        // Create observer
        this.#observer = new MutationObserver(this.#handleMutations.bind(this));
        
        // Observe entire document
        this.#observer.observe(document.documentElement, ForumCoreObserver.#OBSERVER_OPTIONS);
        
        // Initial scan
        this.#scanExistingContent();
        
        console.log('🚀 Forum Core Observer initialized successfully');
        console.log('Page state:', this.#pageState);
    }
    
    #detectPageState() {
        const { pathname } = window.location;
        const body = document.body;
        const theme = document.documentElement.dataset?.theme;
        
        // SAFE: Use optional chaining for body access
        const selectors = {
            forum: '.board, .big_list',
            topic: '.modern-topic-title',
            blog: '#blog, .article',
            profile: '.modern-profile',
            search: '#search.posts'
        };
        
        const checks = Object.entries(selectors).map(([key, selector]) => 
            [key, document.querySelector(selector) ?? null]
        );
        
        const pageChecks = Object.fromEntries(checks);
        
        return {
            ...pageChecks,
            isForum: pathname.includes('/f/') || pageChecks.forum,
            isTopic: pathname.includes('/t/') || pageChecks.topic,
            isBlog: pathname.includes('/b/') || pageChecks.blog,
            isProfile: pathname.includes('/user/') || pageChecks.profile,
            isSearch: pathname.includes('/search/') || pageChecks.search,
            isDarkMode: theme === 'dark',
            isLoggedIn: !!(body?.querySelector('.menuwrap .avatar')),
            isMobile: window.matchMedia('(max-width: 768px)').matches,
            pageId: `page_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            bodyClass: body?.className || ''
        };
    }
    
    // ... rest of the class methods remain the same ...
    
    #handleMutations(mutations) {
        // Implementation...
    }
    
    #scanExistingContent() {
        // Implementation...
    }
    
    register(settings) {
        // Implementation...
        return 'callback_id';
    }
    
    static create() {
        return new ForumCoreObserver();
    }
}

// Global initialization
if (!globalThis.forumObserver) {
    try {
        globalThis.forumObserver = ForumCoreObserver.create();
        console.log('🎯 Forum Core Observer ready');
    } catch (error) {
        console.error('Failed to initialize Forum Core Observer:', error);
    }
}
