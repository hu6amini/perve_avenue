// Complete updated transformation script with MutationObserver
(function() {
    // Store original posts data
    const originalPostsData = new Map();
    
    // Function to extract post data (same as before, but we'll keep it here)
    function extractPostData(originalPostElement) {
        const $post = $(originalPostElement);
        const postId = $post.attr('id').replace('ee', '');
        
        // Extract username
        const username = $post.find('.nick a').first().text().trim();
        
        // Extract avatar
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url');
        }
        
        // Extract user group/role
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadge = isAdmin ? 'admin' : 'developer';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-code';
        const roleLabel = groupText || 'Member';
        
        // Extract post count
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        
        // Extract reputation
        let reputation = $post.find('.u_reputation dd a').text().trim();
        reputation = reputation.replace('+', '');
        
        // Extract status (Online/Offline)
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        // Extract title/rank
        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }
        
        // Extract post content
        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature').remove();
        postContent.find('.edit').remove();
        const contentHtml = postContent.html() || '';
        
        // Extract signature
        const signatureHtml = $post.find('.signature').html() || '';
        
        // Extract edit info
        let editInfo = '';
        const editText = $post.find('.edit').text().trim();
        if (editText) {
            editInfo = editText.replace('Edited by', 'Edited');
        }
        
        // Extract reactions/likes
        let likes = 0;
        let hasLikes = false;
        const pointsSpan = $post.find('.points');
        if (pointsSpan.find('.points_pos').length) {
            const likeText = pointsSpan.find('.points_pos').text();
            likes = parseInt(likeText) || 0;
            hasLikes = likes > 0;
        }
        
        // Extract custom emoji reactions
        let customReactions = [];
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            const count = $(this).data('count') || 1;
            if (count > 0) {
                customReactions.push({ emoji: '😆', count: count });
            }
        });
        
        // Extract IP address
        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            ipAddress = ipAddress.substring(0, ipAddress.lastIndexOf('.')) + '.xxx';
        }
        
        // Extract post number (position in thread)
        const postNumber = $post.index() + 1;
        
        // Extract timestamp
        let timestamp = $post.find('.when').attr('title') || '';
        let timeAgo = '';
        if (timestamp) {
            const postDate = new Date(timestamp);
            const now = new Date();
            const diffMonths = (now.getFullYear() - postDate.getFullYear()) * 12 + (now.getMonth() - postDate.getMonth());
            if (diffMonths >= 1) {
                timeAgo = `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
            } else {
                const diffDays = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
                if (diffDays >= 1) {
                    timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                } else {
                    const diffHours = Math.floor((now - postDate) / (1000 * 60 * 60));
                    timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                }
            }
        }
        
        return {
            postId, username, avatarUrl, roleBadge, roleIcon, roleLabel,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, hasLikes, customReactions,
            ipAddress, postNumber, timeAgo
        };
    }
    
    // Function to generate the new HTML
    function generateModernPost(data) {
        const reactionsHtml = data.hasLikes || data.customReactions.length > 0
            ? `
              <button class="reaction-btn" aria-label="Like this post" data-action="like" data-pid="${data.postId}">
                  <i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>
                  ${data.likes > 0 ? `<span class="reaction-count" aria-label="${data.likes} likes">${data.likes}</span>` : ''}
              </button>
              ${data.customReactions.map(r => `
                  <button class="reaction-btn" aria-label="Laugh reaction" data-action="react" data-pid="${data.postId}">
                      <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" alt="laughing face emoji" class="reaction-emoji-img" width="16" height="16">
                      <span class="reaction-count" aria-label="${r.count} reactions">${r.count}</span>
                  </button>
              `).join('')}
            `
            : `
              <button class="reaction-btn" aria-label="Like this post" data-action="like" data-pid="${data.postId}">
                  <i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>
              </button>
              <button class="reaction-btn" aria-label="Add reaction" data-action="react" data-pid="${data.postId}">
                  <i class="fa-regular fa-face-smile" aria-hidden="true"></i>
              </button>
            `;
        
        return `
            <article class="post-card" data-post-id="${data.postId}" data-original-id="ee${data.postId}" aria-labelledby="post${data.postId}-title">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge">
                            <i class="fas fa-hashtag" aria-hidden="true"></i>${data.postNumber}
                        </div>
                        <div class="post-timestamp">
                            <time datetime="${new Date().toISOString()}">${data.timeAgo || 'Recently'}</time>
                        </div>
                    </div>
                    <div class="action-buttons-group">
                        <button class="action-icon" title="Quote" aria-label="Quote post" data-action="quote" data-pid="${data.postId}">
                            <i class="fa-regular fa-quote-left" aria-hidden="true"></i>
                        </button>
                        <button class="action-icon" title="Edit" aria-label="Edit post" data-action="edit" data-pid="${data.postId}">
                            <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                        </button>
                        <button class="action-icon" title="Share" aria-label="Share post" data-action="share" data-pid="${data.postId}">
                            <i class="fa-regular fa-share-nodes" aria-hidden="true"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" aria-label="Report post" data-action="report" data-pid="${data.postId}">
                            <i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" aria-label="Delete post" data-action="delete" data-pid="${data.postId}">
                            <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <div class="user-area">
                    <div class="avatar-modern">
                        <img class="avatar-circle" src="${data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username)}" 
                             alt="Avatar of ${escapeHtml(data.username)}" width="70" height="70" loading="lazy">
                    </div>
                    <div class="user-details">
                        <div class="username-row">
                            <span class="username" id="post${data.postId}-title">${escapeHtml(data.username)}</span>
                        </div>
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadge}">
                                <i class="fas ${data.roleIcon}" aria-hidden="true"></i> ${escapeHtml(data.roleLabel)}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill"><i class="fa-regular fa-${data.userTitle === 'Famous' ? 'fire' : 'medal'}" aria-hidden="true"></i> ${escapeHtml(data.userTitle)}</span>
                            <span class="stat-pill"><i class="fa-regular fa-comments" aria-hidden="true"></i> ${data.postCount} posts</span>
                            <span class="stat-pill"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ${data.reputation > 0 ? '+' : ''}${data.reputation} rep</span>
                            <span class="stat-pill"><i class="fa-regular fa-circle" style="color: ${data.isOnline ? '#10B981' : '#6B7280'};" aria-hidden="true"></i> ${data.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>
                <div class="post-body">
                    <div class="post-text-content">
                        ${data.contentHtml}
                        ${data.editInfo ? `<div class="edit-indicator"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ${escapeHtml(data.editInfo)}</div>` : ''}
                    </div>
                    ${data.signatureHtml ? `
                        <div class="signature-modern">
                            ${data.signatureHtml}
                        </div>
                    ` : ''}
                </div>
                <div class="post-footer-modern">
                    <div class="reaction-cluster">
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `
                        <div class="ip-info">
                            <i class="fa-regular fa-globe" aria-hidden="true"></i> IP: ${data.ipAddress}
                        </div>
                    ` : ''}
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
    
    // Global function to trigger report modal (this will be called by our button)
    window.triggerReportModal = function(postId) {
        // Find the original report button
        const originalReportBtn = $(`#ee${postId} .report_button`);
        if (originalReportBtn.length && originalReportBtn[0]) {
            // Clone the click event handling
            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            originalReportBtn[0].dispatchEvent(clickEvent);
            
            // Also handle if there's an onclick attribute
            const onclickAttr = originalReportBtn.attr('onclick');
            if (onclickAttr) {
                eval(onclickAttr);
            }
        } else {
            console.warn(`Report button not found for post ${postId}`);
            // Fallback: try to find any report button with this data-pid
            const fallbackBtn = $(`.report_button[data-pid="${postId}"]`);
            if (fallbackBtn.length) {
                fallbackBtn.click();
            }
        }
    };
    
    // Improved event handler attachment with delegation and mutation awareness
    function attachModernEventHandlers() {
        // Use event delegation for dynamically created elements
        $(document).off('click.modern', '.action-icon[data-action="quote"]')
                   .on('click.modern', '.action-icon[data-action="quote"]', function() {
            const pid = $(this).data('pid');
            const originalPost = $(`#ee${pid}`);
            if (originalPost.length) {
                const quoteLink = originalPost.find('a[href*="CODE=02"]').attr('href');
                if (quoteLink) window.location.href = quoteLink;
            }
        });
        
        $(document).off('click.modern', '.action-icon[data-action="edit"]')
                   .on('click.modern', '.action-icon[data-action="edit"]', function() {
            const pid = $(this).data('pid');
            const originalPost = $(`#ee${pid}`);
            if (originalPost.length) {
                const editLink = originalPost.find('a[href*="CODE=08"]').attr('href');
                if (editLink) window.location.href = editLink;
            }
        });
        
        $(document).off('click.modern', '.action-icon[data-action="delete"]')
                   .on('click.modern', '.action-icon[data-action="delete"]', function() {
            if (confirm('Are you sure you want to delete this post?')) {
                const pid = $(this).data('pid');
                if (typeof delete_post === 'function') {
                    delete_post(pid);
                }
            }
        });
        
        // Enhanced report handler that properly triggers the modal
        $(document).off('click.modern', '.action-icon[data-action="report"]')
                   .on('click.modern', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            console.log('Report button clicked for post:', pid);
            
            // Method 1: Try to use our global function
            if (typeof window.triggerReportModal === 'function') {
                window.triggerReportModal(pid);
            }
            
            // Method 2: Directly find and click the original button
            const originalBtn = $(`#ee${pid} .report_button`);
            if (originalBtn.length) {
                originalBtn.click();
            } else {
                // Method 3: Try to find by data-pid attribute anywhere in the document
                const reportBtnByPid = $(`.report_button[data-pid="${pid}"]`);
                if (reportBtnByPid.length) {
                    reportBtnByPid.click();
                } else {
                    console.error(`Could not find report button for post ${pid}`);
                    alert('Report function temporarily unavailable. Please refresh the page and try again.');
                }
            }
        });
        
        $(document).off('click.modern', '.action-icon[data-action="share"]')
                   .on('click.modern', '.action-icon[data-action="share"]', function() {
            const pid = $(this).data('pid');
            const postUrl = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(postUrl);
            // Optional: Show a temporary notification
            showToast('Link copied to clipboard!');
        });
        
        // Reaction handlers
        $(document).off('click.modern', '.reaction-btn[data-action="like"]')
                   .on('click.modern', '.reaction-btn[data-action="like"]', function() {
            const $card = $(this).closest('.post-card');
            const postId = $card.data('post-id');
            const originalPost = $(`#ee${postId}`);
            
            if (originalPost.length) {
                const likeLink = originalPost.find('.points_up');
                if (likeLink.length && likeLink.attr('onclick')) {
                    const onclickAttr = likeLink.attr('onclick');
                    eval(onclickAttr);
                } else if (likeLink.length) {
                    likeLink.click();
                }
            }
        });
        
        $(document).off('click.modern', '.reaction-btn[data-action="react"]')
                   .on('click.modern', '.reaction-btn[data-action="react"]', function() {
            // Handle custom emoji reactions if needed
            console.log('Reaction button clicked');
        });
    }
    
    // Toast notification helper
    function showToast(message) {
        const toast = $('<div class="modern-toast">' + message + '</div>');
        $('body').append(toast);
        toast.css({
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: '#333',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '8px',
            zIndex: '10000',
            animation: 'fadeInOut 2s ease'
        });
        setTimeout(() => toast.remove(), 2000);
    }
    
    // MutationObserver to watch for dynamically loaded report buttons
    function setupReportButtonObserver() {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    // Check for newly added report buttons
                    $(mutation.addedNodes).each(function() {
                        const $node = $(this);
                        if ($node.is('.report_button') || $node.find('.report_button').length) {
                            const reportBtns = $node.is('.report_button') ? $node : $node.find('.report_button');
                            reportBtns.each(function() {
                                const pid = $(this).data('pid');
                                console.log('New report button detected for post:', pid);
                                
                                // Ensure the modern report button for this post has the correct handler
                                const modernReportBtn = $(`.action-icon[data-action="report"][data-pid="${pid}"]`);
                                if (modernReportBtn.length) {
                                    // Refresh the click handler (just in case)
                                    modernReportBtn.off('click.modern').on('click.modern', function(e) {
                                        e.preventDefault();
                                        const reportPid = $(this).data('pid');
                                        const originalBtn = $(`.report_button[data-pid="${reportPid}"]`);
                                        if (originalBtn.length) originalBtn.click();
                                    });
                                }
                            });
                        }
                    });
                }
            });
        });
        
        // Start observing the document body for added nodes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        return observer;
    }
    
    // Function to transform to modern view
    function transformToModernView() {
        // Show loading indicator
        $('#posts-container').addClass('htmx-request');
        
        setTimeout(() => {
            // Hide all original .post elements and create modern versions
            $('.post').each(function() {
                const $original = $(this);
                const postId = $original.attr('id');
                
                // Store original if not already stored
                if (!originalPostsData.has(postId)) {
                    originalPostsData.set(postId, $original[0].outerHTML);
                }
                
                // Hide original
                $original.css('display', 'none');
                
                // Check if modern version already exists
                if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                    // Extract data and create modern version
                    const postData = extractPostData($original);
                    const modernHtml = generateModernPost(postData);
                    
                    // Insert after the hidden original
                    $original.after(modernHtml);
                } else {
                    // Show existing modern version
                    $(`.post-card[data-original-id="${postId}"]`).show();
                }
            });
            
            $('#posts-container').removeClass('htmx-request');
            
            // Attach all event handlers
            attachModernEventHandlers();
            
            // Store current view state
            localStorage.setItem('forumViewMode', 'modern');
        }, 100);
    }
    
    // Function to revert to original view
    function revertToOriginalView() {
        $('.post-card').remove();
        $('.post').show();
        localStorage.setItem('forumViewMode', 'original');
    }
    
    // Initialize when document is ready
    $(document).ready(function() {
        // Add a container wrapper if not present
        if (!$('#posts-container').length) {
            const $postsParent = $('.post').first().parent();
            if ($postsParent.length) {
                $postsParent.wrapInner('<div id="posts-container"></div>');
            }
        }
        
        // Add toggle buttons if not already present
        if ($('#modernViewBtn').length === 0) {
            const toggleHtml = `
                <div style="margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: center;">
                    <button id="modernViewBtn" class="reaction-btn" style="background: #2563eb; color: white; border: none; padding: 8px 16px;">
                        <i class="fas fa-magic"></i> Modern View
                    </button>
                    <button id="originalViewBtn" class="reaction-btn" style="padding: 8px 16px;">
                        <i class="fas fa-history"></i> Original View
                    </button>
                    <span id="viewStatus" style="font-size: 12px; color: #666;"></span>
                </div>
            `;
            $('#posts-container').before(toggleHtml);
        }
        
        // Attach toggle events
        $('#modernViewBtn').off('click').on('click', transformToModernView);
        $('#originalViewBtn').off('click').on('click', revertToOriginalView);
        
        // Setup MutationObserver for report buttons
        const reportObserver = setupReportButtonObserver();
        
        // Check for saved view preference
        const savedView = localStorage.getItem('forumViewMode');
        if (savedView === 'modern') {
            setTimeout(transformToModernView, 500);
            $('#viewStatus').text('Modern view active');
        } else {
            $('#viewStatus').text('Original view active');
        }
        
        console.log('Forum Modernizer initialized with report button support');
    });
})();




// This function hides original posts and shows modern ones
function transformToModernView() {
  // Show loading indicator
  $('#posts-container').addClass('htmx-request');
  
  setTimeout(() => {
    // Hide all original .post elements
    $('.post').each(function() {
      const $original = $(this);
      const postId = $original.attr('id');
      
      // Store original if not already stored
      if (!$original.data('original-html')) {
        $original.data('original-html', $original[0].outerHTML);
      }
      
      // Hide original
      $original.css('display', 'none');
      
      // Check if modern version already exists
      if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
        // Extract data and create modern version
        const postData = extractPostData($original);
        const modernHtml = generateModernPost(postData);
        
        // Insert after the hidden original
        $original.after(modernHtml);
      } else {
        // Show existing modern version
        $(`.post-card[data-original-id="${postId}"]`).show();
      }
    });
    
    $('#posts-container').removeClass('htmx-request');
    
    // Attach event handlers to new buttons
    attachModernEventHandlers();
  }, 100);
}

// Function to revert to original view
function revertToOriginalView() {
  $('.post-card').remove();
  $('.post').show();
}

// Attach handlers to modern UI buttons
function attachModernEventHandlers() {
  // Quote buttons
  $('.action-icon[data-action="quote"]').off('click').on('click', function() {
    const pid = $(this).data('pid');
    // Find original post and trigger its quote functionality
    const originalPost = $(`#ee${pid}`);
    if (originalPost.length) {
      const quoteLink = originalPost.find('a[href*="CODE=02"]').attr('href');
      if (quoteLink) window.location.href = quoteLink;
    }
  });
  
  // Edit buttons
  $('.action-icon[data-action="edit"]').off('click').on('click', function() {
    const pid = $(this).data('pid');
    const originalPost = $(`#ee${pid}`);
    if (originalPost.length) {
      const editLink = originalPost.find('a[href*="CODE=08"]').attr('href');
      if (editLink) window.location.href = editLink;
    }
  });
  
  // Delete buttons
  $('.action-icon[data-action="delete"]').off('click').on('click', function() {
    if (confirm('Are you sure you want to delete this post?')) {
      const pid = $(this).data('pid');
      if (typeof delete_post === 'function') {
        delete_post(pid);
      }
    }
  });
  
  // Report buttons
  $('.action-icon[data-action="report"]').off('click').on('click', function() {
    const pid = $(this).data('pid');
    const reportBtn = $(`#ee${pid} .report_button`);
    if (reportBtn.length && typeof reportBtn.click === 'function') {
      reportBtn.click();
    }
  });
  
  // Share buttons
  $('.action-icon[data-action="share"]').off('click').on('click', function() {
    const pid = $(this).data('pid');
    const postUrl = window.location.href.split('#')[0] + `#entry${pid}`;
    navigator.clipboard.writeText(postUrl);
    // Optional: Show a toast notification
    alert('Link copied to clipboard!');
  });
  
  // Reaction buttons
  $('.reaction-btn').off('click').on('click', function() {
    const $card = $(this).closest('.post-card');
    const postId = $card.data('post-id');
    const originalPost = $(`#ee${postId}`);
    
    if (originalPost.length) {
      const likeLink = originalPost.find('.points_up');
      if (likeLink.length && likeLink.attr('onclick')) {
        const onclickAttr = likeLink.attr('onclick');
        eval(onclickAttr);
      }
    }
  });
}

// Initialize when document is ready
$(document).ready(function() {
  // Add a container wrapper if not present
  if (!$('#posts-container').length) {
    $('.post').first().parent().wrapInner('<div id="posts-container"></div>');
  }
  
  // Add toggle button
  const toggleHtml = `
    <div style="margin-bottom: 1rem; display: flex; gap: 0.5rem;">
      <button id="modernViewBtn" class="reaction-btn" style="background: #2563eb; color: white; border: none;">
        <i class="fas fa-magic"></i> Modern View
      </button>
      <button id="originalViewBtn" class="reaction-btn">
        <i class="fas fa-history"></i> Original View
      </button>
    </div>
  `;
  
  $('#posts-container').before(toggleHtml);
  
  // Attach toggle events
  $('#modernViewBtn').on('click', transformToModernView);
  $('#originalViewBtn').on('click', revertToOriginalView);
});
