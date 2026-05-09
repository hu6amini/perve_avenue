const processScript = (el) => {
    if (el.tagName === "SCRIPT" && el.src) {
        // Check if it's already optimized
        const isAsync = el.hasAttribute('async');
        const isDefer = el.hasAttribute('defer');
        const isModule = el.type === 'module';
        const isAlreadyTrapped = el.type === 'text/plain';

        // Trap it if it's a standard, render-blocking script
        if (!isAsync && !isDefer && !isModule && !isAlreadyTrapped) {
            el.type = "text/plain";
            el.dataset.original = el.src;
            
            // Log it so we can see the "offenders"
            logBuffer += "\n- Standardized: " + el.src.split('/').pop().split('?')[0];
            
            // Wipe content to prevent internal execution if it's a wrapper
            el.textContent = ""; 
        }
    }
};
