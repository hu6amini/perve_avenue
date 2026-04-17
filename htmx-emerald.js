
// Complete frontend transformation script using htmx for the swap
(function() {
    // Store original HTML
    let originalHtml = null;
    let modernHtml = null;
    
    // Function to extract post data (same as before)
    function extractPostData($post) {
        const postId = $post.attr('id').replace('ee', '');
        const username = $post.find('.nick a').first().text().trim();
        
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url');
        }
        
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadge = isAdmin ? 'admin' : 'developer';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-code';
        
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        
        let reputation = $post.find('.u_reputation dd a').text().trim();
        reputation = reputation.replace('+', '');
        
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }
        
        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature').remove();
        postContent.find('.edit').remove();
        const contentHtml = postContent.html() || '';
        
        const signatureHtml = $post.find('.signature').html() || '';
        
        let editInfo = '';
        const editText = $post.find('.edit').text().trim();
        if (editText) {
            editInfo = editText.replace('Edited by', 'Edited');
        }
        
        let likes = 0;
        let hasLikes = false;
        const pointsSpan = $post.find('.points');
        if (pointsSpan.find('.points_pos').length) {
            const likeText = pointsSpan.find('.points_pos').text();
            likes = parseInt(likeText) || 0;
            hasLikes = likes > 0;
        }
        
        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            ipAddress = ipAddress.substring(0, ipAddress.lastIndexOf('.')) + '.xxx';
        }
        
        const postNumber = $post.index() + 1;
        
        let timestamp = $post.find('.when').attr('title') || '';
        let timeAgo = '';
        if (timestamp) {
            const postDate = new Date(timestamp);
            const now = new Date();
            const diffDays = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 1) {
                timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            } else {
                const diffHours = Math.floor((now - postDate) / (1000 * 60 * 60));
                timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            }
        }
        
        return { postId, username, avatarUrl, roleBadge, roleIcon, groupText, postCount, 
                 reputation, isOnline, userTitle, contentHtml, signatureHtml, editInfo, 
                 likes, hasLikes, ipAddress, postNumber, timeAgo };
    }
    
    // Function to generate modern HTML
    function generateModernPost(data) {
        const reactionsHtml = data.hasLikes || data.likes > 0
            ? `<button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                   <i class="fa-regular fa-thumbs-up"></i>
                   <span class="reaction-count">${data.likes}</span>
               </button>
               <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                   <i class="fa-regular fa-face-smile"></i>
               </button>`
            : `<button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                   <i class="fa-regular fa-thumbs-up"></i>
               </button>
               <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                   <i class="fa-regular fa-face-smile"></i>
               </button>`;
        
        return `
            <article class="post-card" data-post-id="${data.postId}" data-original-id="ee${data.postId}">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge">
                            <i class="fas fa-hashtag"></i>${data.postNumber}
                        </div>
                        <div class="post-timestamp">
                            <time>${data.timeAgo || 'Recently'}</time>
                        </div>
                    </div>
                    <div class="action-buttons-group">
                        <button class="action-icon" title="Quote" data-action="quote" data-pid="${data.postId}">
                            <i class="fa-regular fa-quote-left"></i>
                        </button>
                        <button class="action-icon" title="Edit" data-action="edit" data-pid="${data.postId}">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon" title="Share" data-action="share" data-pid="${data.postId}">
                            <i class="fa-regular fa-share-nodes"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" data-action="report" data-pid="${data.postId}">
                            <i class="fa-regular fa-circle-exclamation"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" data-action="delete" data-pid="${data.postId}">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div class="user-area">
                    <div class="avatar-modern">
                        <img class="avatar-circle" src="${data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username)}" 
                             alt="${data.username}" width="70" height="70" loading="lazy">
                    </div>
                    <div class="user-details">
                        <div class="username-row">
                            <span class="username">${escapeHtml(data.username)}</span>
                        </div>
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadge}">
                                <i class="fas ${data.roleIcon}"></i> ${escapeHtml(data.groupText)}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill"><i class="fa-regular fa-${data.userTitle === 'Famous' ? 'fire' : 'medal'}"></i> ${data.userTitle}</span>
                            <span class="stat-pill"><i class="fa-regular fa-comments"></i> ${data.postCount} posts</span>
                            <span class="stat-pill"><i class="fa-regular fa-thumbs-up"></i> ${data.reputation > 0 ? '+' : ''}${data.reputation} rep</span>
                            <span class="stat-pill"><i class="fa-regular fa-circle" style="color: ${data.isOnline ? '#10B981' : '#6B7280'}"></i> ${data.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>
                <div class="post-body">
                    <div class="post-text-content">
                        ${data.contentHtml}
                        ${data.editInfo ? `<div class="edit-indicator"><i class="fa-regular fa-pen-to-square"></i> ${escapeHtml(data.editInfo)}</div>` : ''}
                    </div>
                    ${data.signatureHtml ? `<div class="signature-modern">${data.signatureHtml}</div>` : ''}
                </div>
                <div class="post-footer-modern">
                    <div class="reaction-cluster">
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </article>
        `;
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Function to switch to modern view
    function switchToModernView() {
        const $container = $('#posts-container');
        const $posts = $container.find('.post');
        
        if ($posts.length === 0) return;
        
        // Store original HTML if not already stored
        if (!originalHtml) {
            originalHtml = $container.html();
        }
        
        // Build modern HTML
        let modernHtmlString = '';
        $posts.each(function() {
            const postData = extractPostData($(this));
            modernHtmlString += generateModernPost(postData);
        });
        
        // Use htmx to swap the content (demonstrating htmx capability)
        if (typeof htmx !== 'undefined') {
            // Create a temporary div with the new content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = modernHtmlString;
            
            // Use htmx's internal swap function
            htmx.swap($container[0], modernHtmlString, {
                swapStyle: 'innerHTML',
                settle: true
            });
        } else {
            // Fallback to jQuery
            $container.html(modernHtmlString);
        }
        
        // Re-attach event handlers
        attachEventHandlers();
        
        // Update button states
        $('#modern-view-btn').addClass('active');
        $('#classic-view-btn').removeClass('active');
        
        // Save preference
        localStorage.setItem('forumView', 'modern');
    }
    
    // Function to switch to classic view
    function switchToClassicView() {
        if (originalHtml) {
            const $container = $('#posts-container');
            
            // Use htmx to swap back
            if (typeof htmx !== 'undefined') {
                htmx.swap($container[0], originalHtml, {
                    swapStyle: 'innerHTML',
                    settle: true
                });
            } else {
                $container.html(originalHtml);
            }
            
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
            localStorage.setItem('forumView', 'classic');
        }
    }
    
    // Attach event handlers for modern buttons
    function attachEventHandlers() {
        // Quote
        $('.action-icon[data-action="quote"]').off('click').on('click', function() {
            const pid = $(this).data('pid');
            const originalPost = $(`#ee${pid}`);
            const quoteLink = originalPost.find('a[href*="CODE=02"]').attr('href');
            if (quoteLink) window.location.href = quoteLink;
        });
        
        // Edit
        $('.action-icon[data-action="edit"]').off('click').on('click', function() {
            const pid = $(this).data('pid');
            const originalPost = $(`#ee${pid}`);
            const editLink = originalPost.find('a[href*="CODE=08"]').attr('href');
            if (editLink) window.location.href = editLink;
        });
        
        // Delete
        $('.action-icon[data-action="delete"]').off('click').on('click', function() {
            if (confirm('Are you sure you want to delete this post?')) {
                const pid = $(this).data('pid');
                if (typeof delete_post === 'function') {
                    delete_post(pid);
                }
            }
        });
        
        // Report
        $('.action-icon[data-action="report"]').off('click').on('click', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const originalBtn = $(`#ee${pid} .report_button`);
            if (originalBtn.length) {
                originalBtn.click();
            } else {
                const fallbackBtn = $(`.report_button[data-pid="${pid}"]`);
                if (fallbackBtn.length) fallbackBtn.click();
            }
        });
        
        // Share
        $('.action-icon[data-action="share"]').off('click').on('click', function() {
            const pid = $(this).data('pid');
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url);
            alert('Link copied!');
        });
        
        // Like
        $('.reaction-btn[data-action="like"]').off('click').on('click', function() {
            const pid = $(this).data('pid');
            const originalPost = $(`#ee${pid}`);
            const likeLink = originalPost.find('.points_up');
            if (likeLink.length && likeLink.attr('onclick')) {
                const onclickAttr = likeLink.attr('onclick');
                eval(onclickAttr);
            }
        });
    }
    
    // Initialize when document is ready
    $(document).ready(function() {
        // Wrap posts in container if not already
        if ($('#posts-container').length === 0) {
            $('.post').first().parent().wrapInner('<div id="posts-container"></div>');
        }
        
        // Add view buttons if not present
        if ($('#modern-view-btn').length === 0) {
            $('.view-controls').remove();
            $('.post').first().before(`
                <div class="view-controls">
                    <button id="modern-view-btn" class="view-btn">
                        <i class="fas fa-magic"></i> Modern View
                    </button>
                    <button id="classic-view-btn" class="view-btn active">
                        <i class="fas fa-history"></i> Classic View
                    </button>
                </div>
            `);
        }
        
        // Attach button events
        $('#modern-view-btn').off('click').on('click', switchToModernView);
        $('#classic-view-btn').off('click').on('click', switchToClassicView);
        
        // Check saved preference
        const savedView = localStorage.getItem('forumView');
        if (savedView === 'modern') {
            setTimeout(switchToModernView, 100);
        }
    });
})();
