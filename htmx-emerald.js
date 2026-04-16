// Function to check which action buttons should be shown based on original post content
function getAvailableActions($originalPost) {
    const actions = {
        quote: false,
        edit: false,
        share: true,  // Always available
        report: false,
        delete: false
    };
    
    // Check for Quote button (usually always present for non-locked posts)
    if ($originalPost.find('a[href*="CODE=02"]').length > 0) {
        actions.quote = true;
    }
    
    // Check for Edit button (only visible to post author and moderators/admins)
    if ($originalPost.find('a[href*="CODE=08"]').length > 0) {
        actions.edit = true;
    }
    
    // Check for Report button (may be loaded dynamically, but we'll handle it)
    // We'll set report to true if the structure exists or will exist
    if ($originalPost.find('.report_button').length > 0 || 
        $originalPost.find('[data-pid]').filter(function() {
            return $(this).hasClass('report_button') || $(this).find('span:contains("Report")').length;
        }).length > 0) {
        actions.report = true;
    } else {
        // Report button might load later, so we'll check periodically
        actions.report = true; // Assume it will be available
    }
    
    // Check for Delete button (only visible to post author and moderators/admins)
    if ($originalPost.find('a[href*="javascript:delete_post"]').length > 0 ||
        $originalPost.find('a:contains("Delete")').length > 0) {
        actions.delete = true;
    }
    
    return actions;
}

// Function to generate action buttons HTML based on available actions
function generateActionButtons(postId, availableActions) {
    const buttons = [];
    
    // Quote button (always show if available)
    if (availableActions.quote) {
        buttons.push(`
            <button class="action-icon" title="Quote" aria-label="Quote post" data-action="quote" data-pid="${postId}">
                <i class="fa-regular fa-quote-left" aria-hidden="true"></i>
            </button>
        `);
    }
    
    // Edit button
    if (availableActions.edit) {
        buttons.push(`
            <button class="action-icon" title="Edit" aria-label="Edit post" data-action="edit" data-pid="${postId}">
                <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
            </button>
        `);
    }
    
    // Share button (always present)
    buttons.push(`
        <button class="action-icon" title="Share" aria-label="Share post" data-action="share" data-pid="${postId}">
            <i class="fa-regular fa-share-nodes" aria-hidden="true"></i>
        </button>
    `);
    
    // Report button (if available)
    if (availableActions.report) {
        buttons.push(`
            <button class="action-icon report-action" title="Report" aria-label="Report post" data-action="report" data-pid="${postId}">
                <i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>
            </button>
        `);
    }
    
    // Delete button
    if (availableActions.delete) {
        buttons.push(`
            <button class="action-icon delete-action" title="Delete" aria-label="Delete post" data-action="delete" data-pid="${postId}">
                <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
            </button>
        `);
    }
    
    return buttons.join('');
}

// Enhanced extractPostData function with permission checking
function extractPostData(originalPostElement) {
    const $post = $(originalPostElement);
    const postId = $post.attr('id').replace('ee', '');
    
    // Get available actions for this specific user and post
    const availableActions = getAvailableActions($post);
    
    // Store the actions in the post data
    const postData = {
        postId: postId,
        username: $post.find('.nick a').first().text().trim(),
        avatarUrl: getAvatarUrl($post),
        roleBadge: getRoleBadge($post),
        roleIcon: getRoleIcon($post),
        roleLabel: getRoleLabel($post),
        postCount: $post.find('.u_posts dd a').text().trim() || '0',
        reputation: getReputation($post),
        isOnline: isUserOnline($post),
        userTitle: getUserTitle($post),
        contentHtml: getContentHtml($post),
        signatureHtml: $post.find('.signature').html() || '',
        editInfo: getEditInfo($post),
        likes: getLikesCount($post),
        hasLikes: hasLikes($post),
        customReactions: getCustomReactions($post),
        ipAddress: getIpAddress($post),
        postNumber: $post.index() + 1,
        timeAgo: getTimeAgo($post),
        availableActions: availableActions  // Add the actions to the data
    };
    
    return postData;
}

// Helper functions for cleaner code
function getAvatarUrl($post) {
    let avatarUrl = $post.find('.avatar img').attr('src');
    if (avatarUrl && avatarUrl.includes('weserv.nl')) {
        const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
        avatarUrl = urlParams.get('url');
    }
    return avatarUrl;
}

function getRoleBadge($post) {
    const groupText = $post.find('.u_group dd').text().trim();
    return groupText === 'Administrator' ? 'admin' : 'developer';
}

function getRoleIcon($post) {
    const groupText = $post.find('.u_group dd').text().trim();
    return groupText === 'Administrator' ? 'fa-crown' : 'fa-code';
}

function getRoleLabel($post) {
    return $post.find('.u_group dd').text().trim() || 'Member';
}

function getReputation($post) {
    let reputation = $post.find('.u_reputation dd a').text().trim();
    return reputation.replace('+', '');
}

function isUserOnline($post) {
    const statusTitle = $post.find('.u_status').attr('title') || '';
    return statusTitle.toLowerCase().includes('online');
}

function getUserTitle($post) {
    let userTitle = $post.find('.u_title').text().trim();
    if (userTitle === 'Member') {
        const stars = $post.find('.u_rank i.fa-star').length;
        if (stars === 3) userTitle = 'Famous';
        else if (stars === 2) userTitle = 'Senior';
        else if (stars === 1) userTitle = 'Junior';
    }
    return userTitle;
}

function getContentHtml($post) {
    const postContent = $post.find('.right.Item table.color').clone();
    postContent.find('.signature').remove();
    postContent.find('.edit').remove();
    return postContent.html() || '';
}

function getEditInfo($post) {
    let editInfo = '';
    const editText = $post.find('.edit').text().trim();
    if (editText) {
        editInfo = editText.replace('Edited by', 'Edited');
    }
    return editInfo;
}

function getLikesCount($post) {
    const pointsSpan = $post.find('.points');
    if (pointsSpan.find('.points_pos').length) {
        const likeText = pointsSpan.find('.points_pos').text();
        return parseInt(likeText) || 0;
    }
    return 0;
}

function hasLikes($post) {
    return $post.find('.points .points_pos').length > 0;
}

function getCustomReactions($post) {
    const reactions = [];
    $post.find('.st-emoji-post .st-emoji-counter').each(function() {
        const count = $(this).data('count') || 1;
        if (count > 0) {
            reactions.push({ emoji: '😆', count: count });
        }
    });
    return reactions;
}

function getIpAddress($post) {
    let ipAddress = $post.find('.ip_address dd a').text().trim();
    if (ipAddress) {
        ipAddress = ipAddress.substring(0, ipAddress.lastIndexOf('.')) + '.xxx';
    }
    return ipAddress;
}

function getTimeAgo($post) {
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
    return timeAgo;
}

// Updated generateModernPost function with permission-aware buttons
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
                    ${generateActionButtons(data.postId, data.availableActions)}
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

// Enhanced event handler with permission checks
function attachModernEventHandlers() {
    // Quote button (only if exists)
    $(document).off('click.modern', '.action-icon[data-action="quote"]')
               .on('click.modern', '.action-icon[data-action="quote"]', function() {
        const pid = $(this).data('pid');
        const originalPost = $(`#ee${pid}`);
        if (originalPost.length) {
            const quoteLink = originalPost.find('a[href*="CODE=02"]').attr('href');
            if (quoteLink) window.location.href = quoteLink;
            else showToast('Quote function not available for this post');
        }
    });
    
    // Edit button (only if exists in original)
    $(document).off('click.modern', '.action-icon[data-action="edit"]')
               .on('click.modern', '.action-icon[data-action="edit"]', function() {
        const pid = $(this).data('pid');
        const originalPost = $(`#ee${pid}`);
        if (originalPost.length) {
            const editLink = originalPost.find('a[href*="CODE=08"]').attr('href');
            if (editLink) window.location.href = editLink;
            else showToast('Edit function not available for this post');
        }
    });
    
    // Delete button (only if exists in original)
    $(document).off('click.modern', '.action-icon[data-action="delete"]')
               .on('click.modern', '.action-icon[data-action="delete"]', function() {
        const pid = $(this).data('pid');
        const originalPost = $(`#ee${pid}`);
        if (originalPost.length && originalPost.find('a[href*="javascript:delete_post"]').length) {
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof delete_post === 'function') {
                    delete_post(pid);
                }
            }
        } else {
            showToast('Delete function not available for this post');
        }
    });
    
    // Report button (handle dynamic loading)
    $(document).off('click.modern', '.action-icon[data-action="report"]')
               .on('click.modern', '.action-icon[data-action="report"]', function(e) {
        e.preventDefault();
        const pid = $(this).data('pid');
        
        // Check if report button exists or will exist
        const originalBtn = $(`#ee${pid} .report_button`);
        if (originalBtn.length) {
            originalBtn.click();
        } else {
            // Wait for report button to load (for dynamic content)
            showToast('Loading report function...');
            const checkInterval = setInterval(() => {
                const loadedBtn = $(`.report_button[data-pid="${pid}"]`);
                if (loadedBtn.length) {
                    clearInterval(checkInterval);
                    loadedBtn.click();
                }
            }, 100);
            
            // Timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!$(`.report_button[data-pid="${pid}"]`).length) {
                    showToast('Report function unavailable. Please refresh the page.');
                }
            }, 5000);
        }
    });
    
    // Share button (always available)
    $(document).off('click.modern', '.action-icon[data-action="share"]')
               .on('click.modern', '.action-icon[data-action="share"]', function() {
        const pid = $(this).data('pid');
        const postUrl = window.location.href.split('#')[0] + `#entry${pid}`;
        navigator.clipboard.writeText(postUrl);
        showToast('Link copied to clipboard!');
    });
    
    // Reaction handlers (only if original has like functionality)
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
            } else {
                showToast('Like function not available for this post');
            }
        }
    });
}

// Helper function to show toast messages
function showToast(message, duration = 3000) {
    const toast = $(`<div class="modern-toast">${message}</div>`);
    $('body').append(toast);
    toast.css({
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        background: '#333',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '8px',
        zIndex: '100000',
        animation: 'fadeInOut 0.3s ease'
    });
    setTimeout(() => {
        toast.fadeOut(300, () => toast.remove());
    }, duration);
}

// Update the transformToModernView function to use the enhanced extraction
function transformToModernView() {
    $('#posts-container').addClass('htmx-request');
    
    setTimeout(() => {
        $('.post').each(function() {
            const $original = $(this);
            const postId = $original.attr('id');
            
            if (!originalPostsData.has(postId)) {
                originalPostsData.set(postId, $original[0].outerHTML);
            }
            
            $original.css('display', 'none');
            
            if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                const postData = extractPostData($original);
                const modernHtml = generateModernPost(postData);
                $original.after(modernHtml);
            } else {
                $(`.post-card[data-original-id="${postId}"]`).show();
            }
        });
        
        $('#posts-container').removeClass('htmx-request');
        attachModernEventHandlers();
        localStorage.setItem('forumViewMode', 'modern');
        
        // Log which actions were available for debugging
        $('.post-card').each(function() {
            const $card = $(this);
            const postId = $card.data('post-id');
            const buttons = $card.find('.action-icon').map(function() {
                return $(this).data('action');
            }).get();
            console.log(`Post ${postId} available actions:`, buttons);
        });
    }, 100);
}



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
