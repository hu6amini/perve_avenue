// Enhanced Post Transformation and Modernization System with HTML Structure Fix 
// Now includes support for body#search posts
// DOMContentLoaded-free version for flexible loading
class PostModernizer { 
 #postModernizerId = null; 
 #activeStateObserverId = null; 
 #debouncedObserverId = null; 
 #cleanupObserverId = null; 
 #searchPostObserverId = null;
 #retryTimeoutId = null;
 #maxRetries = 10;
 #retryCount = 0;
 
 constructor() { 
 this.#initWithRetry();
 } 
 
 #initWithRetry() {
 // Clear any existing retry timeout
 if (this.#retryTimeoutId) {
 clearTimeout(this.#retryTimeoutId);
 this.#retryTimeoutId = null;
 }
 
 // Check if observer is available
 if (!globalThis.forumObserver) {
 if (this.#retryCount < this.#maxRetries) {
 this.#retryCount++;
 const delay = Math.min(100 * Math.pow(1.5, this.#retryCount - 1), 2000);
 console.log(`Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`);
 
 this.#retryTimeoutId = setTimeout(() => {
 this.#initWithRetry();
 }, delay);
 } else {
 console.error('Failed to initialize Post Modernizer: Forum Observer not available after maximum retries');
 }
 return;
 }
 
 // Reset retry counter on successful dependency check
 this.#retryCount = 0;
 
 // Proceed with initialization
 this.#init();
 }
 
 #init() { 
 try {
 this.#transformPostElements(); 
 this.#enhanceReputationSystem(); 
 this.#setupObserverCallbacks(); 
 this.#setupActiveStateObserver(); 
 this.#setupSearchPostObserver();
 
 console.log('✅ Post Modernizer with HTML Structure Fix and Search Post Support initialized'); 
 } catch (error) {
 console.error('Post Modernizer initialization failed:', error);
 
 // Fallback: retry initialization after a short delay
 if (this.#retryCount < this.#maxRetries) {
 this.#retryCount++;
 const delay = 100 * Math.pow(2, this.#retryCount - 1);
 console.log(`Initialization failed, retrying in ${delay}ms...`);
 
 setTimeout(() => {
 this.#initWithRetry();
 }, delay);
 }
 }
 } 
 
 #setupObserverCallbacks() { 
 // Register immediate callback for cleanup 
 this.#cleanupObserverId = globalThis.forumObserver.register({ 
 id: 'post-modernizer-cleanup', 
 callback: (node) => this.#handleCleanupTasks(node), 
 selector: '.bullet_delete, .mini_buttons.points.Sub', 
 priority: 'critical' 
 }); 
 
 // Register debounced callback for post transformation (regular posts)
 this.#debouncedObserverId = globalThis.forumObserver.registerDebounced({ 
 id: 'post-modernizer-transform', 
 callback: (node) => this.#handlePostTransformation(node), 
 selector: '.post, .st-emoji, .title2.bottom, div[align="center"]:has(.quote_top)', 
 delay: 100, 
 priority: 'normal',
 pageTypes: ['topic', 'blog'] // Only for topic and blog pages
 }); 
 } 
 
 #setupSearchPostObserver() {
 // Special observer for search posts
 this.#searchPostObserverId = globalThis.forumObserver.register({
 id: 'post-modernizer-search-posts',
 callback: (node) => this.#handleSearchPostTransformation(node),
 selector: 'body#search .post, body#search li.post',
 priority: 'high',
 pageTypes: ['search'] // Only for search pages
 });
 }
 
 #setupActiveStateObserver() { 
 // Register callback for active state updates 
 this.#activeStateObserverId = globalThis.forumObserver.register({ 
 id: 'post-modernizer-active-states', 
 callback: (node) => this.#handleActiveStateMutations(node), 
 selector: '.st-emoji-container, .mini_buttons.points.Sub .points', 
 priority: 'normal' 
 }); 
 
 // Check initial active states 
 this.#checkInitialActiveStates(); 
 } 
 
 #checkInitialActiveStates() { 
 const emojiContainers = document.querySelectorAll('.st-emoji-container'); 
 emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container)); 
 
 const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points'); 
 pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container)); 
 } 
 
 #handleActiveStateMutations(node) { 
 if (!node) return; 
 
 let hasEmojiChanges = false; 
 let hasPointsChanges = false; 
 
 if (node.matches('.st-emoji-container') || node.querySelector('.st-emoji-container')) { 
 hasEmojiChanges = true; 
 } 
 
 if (node.matches('.points') || node.querySelector('.points em')) { 
 hasPointsChanges = true; 
 } 
 
 if (node.matches('.st-emoji-counter') || 
 (node.textContent?.trim() && !isNaN(node.textContent.trim()) && node.textContent.trim() !== '0')) { 
 hasEmojiChanges = true; 
 } 
 
 if (hasEmojiChanges) { 
 this.#updateAllEmojiActiveStates(); 
 } 
 
 if (hasPointsChanges) { 
 this.#updateAllPointsActiveStates(); 
 } 
 } 
 
 #updateAllEmojiActiveStates() { 
 const emojiContainers = document.querySelectorAll('.st-emoji-container'); 
 emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container)); 
 } 
 
 #updateAllPointsActiveStates() { 
 const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points'); 
 pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container)); 
 } 
 
 #updateEmojiContainerActiveState(emojiContainer) { 
 if (!emojiContainer) return; 
 
 const emojiCounter = emojiContainer.querySelector('.st-emoji-counter'); 
 const hasCount = emojiCounter && ( 
 (emojiCounter.dataset?.count && emojiCounter.dataset.count !== '0') || 
 (emojiCounter.textContent?.trim() && emojiCounter.textContent.trim() !== '0' && 
 !isNaN(emojiCounter.textContent.trim())) 
 ); 
 
 emojiContainer.classList.toggle('active', !!hasCount); 
 } 
 
 #updatePointsContainerActiveState(pointsContainer) { 
 if (!pointsContainer) return; 
 
 const hasEm = pointsContainer.querySelector('em'); 
 pointsContainer.classList.toggle('active', !!hasEm); 
 } 
 
 #handleCleanupTasks(node) { 
 if (!node) return; 
 
 const needsCleanup = node.matches('.bullet_delete') || 
 node.textContent?.includes('&nbsp;') || 
 /^\s*$/.test(node.textContent || ''); 
 
 if (needsCleanup) { 
 this.#cleanupAllMiniButtons(); 
 } 
 } 
 
 #handlePostTransformation(node) { 
 if (!node) return; 
 
 const needsTransformation = node.matches('.post') || 
 node.querySelector('.post') || 
 node.querySelector('.st-emoji') || 
 node.querySelector('.title2.bottom') || 
 node.querySelector('div[align="center"]:has(.quote_top)'); 
 
 if (needsTransformation) { 
 this.#transformPostElements(); 
 } 
 } 
 
 #handleSearchPostTransformation(node) {
 if (!node) return;
 
 const needsTransformation = node.matches('body#search .post') ||
 node.matches('body#search li.post') ||
 node.querySelector('body#search .post') ||
 node.querySelector('body#search li.post');
 
 if (needsTransformation) {
 this.#transformSearchPostElements();
 }
 }
 
 #cleanupAllMiniButtons() { 
 const miniButtons = document.querySelectorAll('.mini_buttons.points.Sub'); 
 miniButtons.forEach(buttons => this.#cleanupMiniButtons(buttons)); 
 } 
 
 #transformPostElements() { 
 const posts = document.querySelectorAll('body#topic .post:not(.post-modernized), body#blog .post:not(.post-modernized)'); 
 const urlParams = new URLSearchParams(window.location.search); 
 const startOffset = parseInt(urlParams.get('st') ?? '0'); 
 
 posts.forEach((post, index) => { 
 if (post.closest('body#search')) return; // Skip search posts, handled separately
 
 post.classList.add('post-modernized'); 
 
 const title2Top = post.querySelector('.title2.top'); 
 const miniButtons = title2Top?.querySelector('.mini_buttons.points.Sub'); 
 const stEmoji = title2Top?.querySelector('.st-emoji.st-emoji-rep.st-emoji-post'); 
 
 const postHeader = document.createElement('div'); 
 postHeader.className = 'post-header'; 
 
 const userInfo = document.createElement('div'); 
 userInfo.className = 'user-info'; 
 
 const postContent = document.createElement('div'); 
 postContent.className = 'post-content'; 
 
 const postFooter = document.createElement('div'); 
 postFooter.className = 'post-footer'; 
 
 const postNumber = document.createElement('span'); 
 postNumber.className = 'post-number'; 
 postNumber.textContent = '#' + (startOffset + index + 1); 
 postHeader.appendChild(postNumber); 
 
 let nickElement = null; 
 let groupValue = ''; 
 
 if (title2Top) { 
 const tdWrapper = title2Top.closest('td.left.Item'); 
 nickElement = title2Top.querySelector('.nick'); 
 
 if (tdWrapper) { 
 const title2TopClone = title2Top.cloneNode(true); 
 title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove(); 
 title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove(); 
 title2TopClone.querySelector('.left.Item')?.remove(); 
 this.#removeBreakAndNbsp(title2TopClone); 
 postHeader.appendChild(title2TopClone); 
 tdWrapper.remove(); 
 } else { 
 const title2TopClone = title2Top.cloneNode(true); 
 title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove(); 
 title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove(); 
 title2TopClone.querySelector('.left.Item')?.remove(); 
 this.#removeBreakAndNbsp(title2TopClone); 
 postHeader.appendChild(title2TopClone); 
 } 
 } 
 
 const centerElements = post.querySelectorAll('tr.center'); 
 centerElements.forEach(centerElement => { 
 const leftSection = centerElement.querySelector('.left.Item'); 
 const rightSection = centerElement.querySelector('.right.Item'); 
 
 if (leftSection) { 
 const details = leftSection.querySelector('.details'); 
 const avatar = leftSection.querySelector('.avatar'); 
 
 if (details && avatar) { 
 const groupDd = details.querySelector('dl.u_group dd'); 
 groupValue = groupDd?.textContent?.trim() ?? ''; 
 
 userInfo.appendChild(avatar.cloneNode(true)); 
 
 const detailsClone = details.cloneNode(true); 
 detailsClone.querySelector('.avatar')?.remove(); 
 
 if (nickElement) { 
 const nickClone = nickElement.cloneNode(true); 
 detailsClone.insertBefore(nickClone, detailsClone.firstChild); 
 
 if (groupValue) { 
 const badge = document.createElement('div'); 
 badge.className = 'badge'; 
 badge.textContent = groupValue; 
 nickClone.parentNode.insertBefore(badge, nickClone.nextSibling); 
 } 
 } 
 
 detailsClone.querySelector('span.u_title')?.remove(); 
 
 let rankHTML = ''; 
 const pWithURank = detailsClone.querySelector('p'); 
 if (pWithURank?.querySelector('span.u_rank')) { 
 rankHTML = pWithURank.querySelector('span.u_rank')?.innerHTML ?? ''; 
 pWithURank.remove(); 
 } 
 
 detailsClone.querySelector('br.br_status')?.remove(); 
 
 const userStats = document.createElement('div'); 
 userStats.className = 'user-stats'; 
 
 const originalDetails = details.cloneNode(true); 
 
 if (rankHTML) { 
 const rankStat = document.createElement('div'); 
 rankStat.className = 'stat rank'; 
 rankStat.innerHTML = rankHTML; 
 userStats.appendChild(rankStat); 
 } 
 
 const postsDd = originalDetails.querySelector('dl.u_posts dd'); 
 if (postsDd) { 
 const postsStat = this.#createStatElement('fa-regular fa-comments', postsDd.textContent.trim(), 'posts'); 
 userStats.appendChild(postsStat); 
 } 
 
 const reputationDd = originalDetails.querySelector('dl.u_reputation dd'); 
 if (reputationDd) { 
 const reputationStat = this.#createStatElement('fa-regular fa-thumbs-up', reputationDd.textContent.trim(), 'reputation'); 
 userStats.appendChild(reputationStat); 
 } 
 
 const statusDl = originalDetails.querySelector('dl.u_status'); 
 if (statusDl) { 
 const statusDd = statusDl.querySelector('dd'); 
 const statusValue = statusDd?.textContent?.trim() ?? ''; 
 const isOnline = statusValue.toLowerCase().includes('online'); 
 const originalStatusIcon = statusDl.querySelector('dd i'); 
 
 let statusIconHTML = ''; 
 if (originalStatusIcon) { 
 statusIconHTML = originalStatusIcon.outerHTML; 
 if (statusIconHTML.includes('<i ') && !statusIconHTML.includes('aria-hidden')) { 
 statusIconHTML = statusIconHTML.replace('<i ', '<i aria-hidden="true" '); 
 } 
 } else { 
 statusIconHTML = '<i class="fa-regular fa-circle-user" aria-hidden="true"></i>'; 
 } 
 
 const statusStat = document.createElement('div'); 
 statusStat.className = 'stat status' + (isOnline ? ' online' : ''); 
 statusStat.innerHTML = statusIconHTML + '<span>' + statusValue + '</span>'; 
 userStats.appendChild(statusStat); 
 } 
 
 detailsClone.querySelectorAll('dl').forEach(dl => dl.remove()); 
 
 if (userStats.children.length > 0) { 
 detailsClone.appendChild(userStats); 
 } 
 
 userInfo.appendChild(detailsClone); 
 } else { 
 userInfo.appendChild(leftSection.cloneNode(true)); 
 } 
 } 
 
 if (rightSection) { 
 const contentWrapper = document.createElement('div'); 
 contentWrapper.className = 'post-main-content'; 
 
 const rightSectionClone = rightSection.cloneNode(true); 
 this.#removeBottomBorderAndBr(rightSectionClone); 
 this.#preserveMediaDimensions(rightSectionClone); 
 
 contentWrapper.appendChild(rightSectionClone); 
 this.#cleanupPostContentStructure(contentWrapper); 
 postContent.appendChild(contentWrapper); 
 this.#modernizeQuotes(contentWrapper); 
 } 
 }); 
 
 const title2Bottom = post.querySelector('.title2.bottom'); 
 if (title2Bottom) { 
 this.#addReputationToFooter(miniButtons, stEmoji, postFooter); 
 this.#modernizeBottomElements(title2Bottom, postFooter); 
 title2Bottom.remove(); 
 } else { 
 this.#addReputationToFooter(miniButtons, stEmoji, postFooter); 
 } 
 
 post.innerHTML = ''; 
 post.appendChild(postHeader); 
 post.appendChild(userInfo); 
 post.appendChild(postContent); 
 post.appendChild(postFooter); 
 
 this.#convertMiniButtonsToButtons(post); 
 this.#addShareButton(post); 
 this.#cleanupPostContent(post); 
 }); 
 } 
 
 #transformSearchPostElements() {
 const posts = document.querySelectorAll('body#search .post:not(.post-modernized), body#search li.post:not(.post-modernized)');
 
 posts.forEach((post, index) => {
 post.classList.add('post-modernized', 'search-post');
 
 // Extract data from search post structure
 const title2Top = post.querySelector('.title2.top');
 const pointsElement = post.querySelector('.points');
 
 // FIX: Extract content from the correct location in search posts
 let contentHTML = '';
 const colorTable = post.querySelector('table.color');
 
 if (colorTable) {
 // Get all tds from the color table
 const tds = colorTable.querySelectorAll('td');
 tds.forEach(td => {
 if (td.innerHTML && td.innerHTML.trim() !== '') {
 // Remove empty TDs
 if (!td.innerHTML.trim() || td.innerHTML.trim() === '<br>') {
 return;
 }
 contentHTML += td.outerHTML;
 }
 });
 }
 
 // Also try other selectors as fallback
 if (!contentHTML) {
 const contentElement = post.querySelector('td.Item table.color td') || 
 post.querySelector('td.Item td') || 
 post.querySelector('.color td') ||
 post.querySelector('td[align]');
 
 if (contentElement && contentElement.innerHTML && contentElement.innerHTML.trim() !== '') {
 contentHTML = contentElement.outerHTML;
 }
 }
 
 const editElement = post.querySelector('span.edit');
 const rtSub = post.querySelector('.rt.Sub');
 
 // Create modern post structure
 const postHeader = document.createElement('div');
 postHeader.className = 'post-header';
 
 const postContent = document.createElement('div');
 postContent.className = 'post-content search-post-content';
 
 const postFooter = document.createElement('div');
 postFooter.className = 'post-footer search-post-footer';
 
 // Post number (for search, we can use index)
 const postNumber = document.createElement('span');
 postNumber.className = 'post-number';
 postNumber.textContent = '#' + (index + 1);
 postHeader.appendChild(postNumber);
 
 // Process title2.top for header
 if (title2Top) {
 const title2TopClone = title2Top.cloneNode(true);
 
 // FIX: Remove the points element from the title2.top clone
 const pointsInTitle = title2TopClone.querySelector('.points');
 if (pointsInTitle) {
 pointsInTitle.remove();
 }
 
 // Extract location info from rt.Sub
 if (rtSub) {
 const topicLink = rtSub.querySelector('a[href*="?t="]');
 const forumLink = rtSub.querySelector('a[href*="?f="]');
 
 if (topicLink || forumLink) {
 const locationDiv = document.createElement('div');
 locationDiv.className = 'post-location';
 
 if (topicLink) {
 const topicSpan = document.createElement('span');
 topicSpan.className = 'topic-link';
 topicSpan.innerHTML = '<i class="fa-regular fa-file-lines"></i> ' + topicLink.textContent;
 locationDiv.appendChild(topicSpan);
 }
 
 if (forumLink) {
 const forumSpan = document.createElement('span');
 forumSpan.className = 'forum-link';
 forumSpan.innerHTML = '<i class="fa-regular fa-folder"></i> ' + forumLink.textContent;
 if (topicLink) {
 locationDiv.appendChild(document.createTextNode(' - '));
 }
 locationDiv.appendChild(forumSpan);
 }
 
 title2TopClone.appendChild(locationDiv);
 }
 
 // Remove original rt.Sub
 title2TopClone.querySelector('.rt.Sub')?.remove();
 }
 
 // Clean up
 this.#removeBreakAndNbsp(title2TopClone);
 title2TopClone.querySelector('.Break.Sub')?.remove();
 
 // FIX: Extract just the divs from the TD, not the entire table structure
 const tdWrapper = title2TopClone.querySelector('td.Item.Justify');
 if (tdWrapper) {
 const divs = tdWrapper.querySelectorAll('div');
 divs.forEach(div => {
 postHeader.appendChild(div.cloneNode(true));
 });
 tdWrapper.remove();
 } else {
 postHeader.appendChild(title2TopClone);
 }
 }
 
 // Process content
 if (contentHTML) {
 const contentWrapper = document.createElement('div');
 contentWrapper.className = 'post-main-content';
 
 // Use the HTML we extracted from the color table
 const tempDiv = document.createElement('div');
 tempDiv.innerHTML = contentHTML;
 const contentClone = tempDiv;
 
 this.#preserveMediaDimensions(contentClone);
 
 // Process text content
 const walker = document.createTreeWalker(contentClone, NodeFilter.SHOW_TEXT, null, false);
 const textNodes = [];
 let node;
 
 while (node = walker.nextNode()) {
 if (node.textContent.trim() !== '') {
 textNodes.push(node);
 }
 }
 
 // Highlight search terms if available
 const urlParams = new URLSearchParams(window.location.search);
 const searchQuery = urlParams.get('q');
 if (searchQuery) {
 textNodes.forEach(textNode => {
 const text = textNode.textContent;
 const searchRegex = new RegExp(`(${this.#escapeRegex(searchQuery)})`, 'gi');
 const highlightedText = text.replace(searchRegex, '<mark class="search-highlight">$1</mark>');
 
 if (highlightedText !== text) {
 const span = document.createElement('span');
 span.innerHTML = highlightedText;
 textNode.parentNode.replaceChild(span, textNode);
 }
 });
 }
 
 contentWrapper.appendChild(contentClone);
 this.#cleanupSearchPostContent(contentWrapper);
 postContent.appendChild(contentWrapper);
 
 // Handle edit span
 if (editElement) {
 editElement.classList.add('post-edit');
 const timeMatch = editElement.textContent.match(/Edited by .+? - (.+)/);
 if (timeMatch) {
 editElement.innerHTML = '<i class="fa-regular fa-pen-to-square"></i> Edited on <time>' + this.#escapeHtml(timeMatch[1]) + '</time>';
 }
 }
 }
 
 // Create reputation footer for search posts
 const postFooterActions = document.createElement('div');
 postFooterActions.className = 'post-actions';
 
 // FIX: Check if points element exists and has content
 let pointsFooter;
 if (pointsElement && pointsElement.innerHTML.trim() !== '') {
 const pointsClone = pointsElement.cloneNode(true);
 pointsFooter = pointsClone;
 } else {
 // Create empty points element for consistency
 pointsFooter = document.createElement('div');
 pointsFooter.className = 'points';
 const pointsLink = document.createElement('a');
 pointsLink.href = '#';
 pointsLink.innerHTML = '<em class="points_pos">0</em>';
 pointsFooter.appendChild(pointsLink);
 }
 
 postFooterActions.appendChild(pointsFooter);
 postFooter.appendChild(postFooterActions);
 
 // Add share button
 const shareContainer = document.createElement('div');
 shareContainer.className = 'modern-bottom-actions';
 
 const shareButton = document.createElement('button');
 shareButton.className = 'btn btn-icon btn-share';
 shareButton.setAttribute('data-action', 'share');
 shareButton.setAttribute('title', 'Share this post');
 shareButton.setAttribute('type', 'button');
 shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';
 
 shareButton.addEventListener('click', () => this.#handleShareSearchPost(post));
 
 shareContainer.appendChild(shareButton);
 postFooter.appendChild(shareContainer);
 
 // FIX: Better way to replace post content while preserving structure
 const newPost = document.createElement('div');
 newPost.className = 'post post-modernized search-post';
 newPost.id = post.id;
 
 // Copy all data attributes
 Array.from(post.attributes).forEach(attr => {
 if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
 // Skip these, we handle them separately
 } else {
 newPost.setAttribute(attr.name, attr.value);
 }
 });
 
 // Copy data attributes
 Array.from(post.attributes).forEach(attr => {
 if (attr.name.startsWith('data-')) {
 newPost.setAttribute(attr.name, attr.value);
 }
 });
 
 // Copy post classes (except the ones we add)
 const originalClasses = post.className.split(' ').filter(cls => 
 !cls.includes('post-modernized') && !cls.includes('search-post')
 );
 newPost.className = [...originalClasses, 'post', 'post-modernized', 'search-post'].join(' ');
 
 newPost.appendChild(postHeader);
 newPost.appendChild(postContent);
 newPost.appendChild(postFooter);
 
 post.parentNode.replaceChild(newPost, post);
 
 // Update points active state
 this.#updatePointsContainerActiveState(pointsFooter);
 });
 }
 
 #cleanupSearchPostContent(contentWrapper) {
 // Remove empty tables and unnecessary elements
 contentWrapper.querySelectorAll('table, tbody, tr, td').forEach(el => {
 if (el.tagName === 'TD' && el.children.length === 0 && el.textContent.trim() === '') {
 el.remove();
 } else if (el.tagName === 'TABLE' || el.tagName === 'TBODY' || el.tagName === 'TR') {
 const parent = el.parentNode;
 if (parent) {
 while (el.firstChild) {
 parent.insertBefore(el.firstChild, el);
 }
 el.remove();
 }
 }
 });
 
 // Clean up line breaks
 contentWrapper.querySelectorAll('br').forEach(br => {
 const prevSibling = br.previousElementSibling;
 const nextSibling = br.nextElementSibling;
 
 if (prevSibling && nextSibling) {
 const prevIsText = prevSibling.nodeType === Node.ELEMENT_NODE && 
 (prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'P' || prevSibling.tagName === 'DIV');
 const nextIsText = nextSibling.nodeType === Node.ELEMENT_NODE && 
 (nextSibling.tagName === 'SPAN' || nextSibling.tagName === 'P' || nextSibling.tagName === 'DIV');
 
 if (prevIsText && nextIsText) {
 prevSibling.classList.add('paragraph-end');
 br.remove();
 } else {
 br.style.cssText = 'margin:0;padding:0;display:block;content:\'\';height:0.75em;margin-bottom:0.25em';
 }
 } else {
 br.remove();
 }
 });
 
 // Remove multiple consecutive line breaks
 const textElements = contentWrapper.querySelectorAll('span, p, div');
 let lastWasParagraphEnd = false;
 
 textElements.forEach(el => {
 if (el.classList.contains('paragraph-end')) {
 if (lastWasParagraphEnd) {
 el.classList.remove('paragraph-end');
 } else {
 lastWasParagraphEnd = true;
 }
 } else {
 lastWasParagraphEnd = false;
 }
 });
 
 // FIX: Handle quotes in search posts
 contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => {
 if (container.classList.contains('quote-modernized')) return;
 
 this.#transformQuote(container);
 container.classList.add('quote-modernized');
 });
 }
 
 #escapeRegex(string) {
 return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 }
 
 #handleShareSearchPost(post) {
 let postLink = null;
 
 // Try to find post link in the header
 const postLinkElement = post.querySelector('.post-header a[href*="#entry"]');
 if (postLinkElement) {
 postLink = postLinkElement.href;
 }
 
 // If not found, try to construct from post ID
 if (!postLink) {
 const postIdMatch = post.id.match(/\d+/);
 if (postIdMatch) {
 const postId = postIdMatch[0];
 // Search posts might not have topic context in the DOM
 // We can try to get it from the location info
 const topicLink = post.querySelector('.topic-link');
 if (topicLink) {
 const topicMatch = topicLink.textContent.match(/t=(\d+)/);
 if (topicMatch) {
 postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId;
 }
 }
 }
 }
 
 if (postLink) {
 this.#copyToClipboard(postLink);
 } else {
 this.#showNotification('Could not find post link', 'error');
 }
 }
 
 #removeInvalidTableStructure(element) { 
 // Remove td.right.Item elements 
 element.querySelectorAll('td.right.Item').forEach(td => { 
 while (td.firstChild) { 
 td.parentNode.insertBefore(td.firstChild, td); 
 } 
 td.remove(); 
 }); 
 
 // Remove empty tables 
 element.querySelectorAll('table.color:empty').forEach(table => table.remove()); 
 } 
 
 #cleanupPostContentStructure(contentElement) { 
 // Remove td elements directly inside post-main-content 
 contentElement.querySelectorAll('.post-main-content > td').forEach(td => { 
 while (td.firstChild) { 
 contentElement.appendChild(td.firstChild); 
 } 
 td.remove(); 
 }); 
 
 // Remove all other TDs 
 contentElement.querySelectorAll('td').forEach(td => { 
 const parent = td.parentNode; 
 if (parent) { 
 while (td.firstChild) { 
 parent.insertBefore(td.firstChild, td); 
 } 
 td.remove(); 
 } 
 }); 
 
 // Remove TRs 
 contentElement.querySelectorAll('tr').forEach(tr => { 
 const parent = tr.parentNode; 
 if (parent) { 
 while (tr.firstChild) { 
 parent.insertBefore(tr.firstChild, tr); 
 } 
 tr.remove(); 
 } 
 }); 
 
 // Remove TBODYs 
 contentElement.querySelectorAll('tbody').forEach(tbody => { 
 const parent = tbody.parentNode; 
 if (parent) { 
 while (tbody.firstChild) { 
 parent.insertBefore(tbody.firstChild, tbody); 
 } 
 tbody.remove(); 
 } 
 }); 
 
 // Remove TABLEs 
 contentElement.querySelectorAll('table').forEach(table => { 
 const parent = table.parentNode; 
 if (parent) { 
 while (table.firstChild) { 
 parent.insertBefore(table.firstChild, table); 
 } 
 table.remove(); 
 } 
 }); 
 
 this.#cleanEmptyElements(contentElement); 
 this.#processTextAndLineBreaks(contentElement); 
 this.#cleanupEditSpans(contentElement); 
 this.#processSignature(contentElement); 
 this.#cleanInvalidAttributes(contentElement); 
 } 
 
 #cleanEmptyElements(element) { 
 element.querySelectorAll(':empty').forEach(emptyEl => { 
 if (!['IMG', 'BR', 'HR', 'INPUT', 'META', 'LINK'].includes(emptyEl.tagName)) { 
 emptyEl.remove(); 
 } 
 }); 
 
 const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false); 
 const nodesToRemove = []; 
 let node; 
 
 while (node = walker.nextNode()) { 
 if (node.textContent.trim() === '') { 
 nodesToRemove.push(node); 
 } 
 } 
 
 nodesToRemove.forEach(node => node.parentNode?.removeChild(node)); 
 } 
 
 #cleanInvalidAttributes(element) { 
 element.querySelectorAll('[width]').forEach(el => { 
 if (!['IMG', 'IFRAME', 'VIDEO', 'CANVAS', 'TABLE', 'TD', 'TH'].includes(el.tagName)) { 
 el.removeAttribute('width'); 
 } 
 }); 
 
 element.querySelectorAll('[cellpadding], [cellspacing]').forEach(el => { 
 if (el.tagName !== 'TABLE') { 
 el.removeAttribute('cellpadding'); 
 el.removeAttribute('cellspacing'); 
 } 
 }); 
 } 
 
 #processTextAndLineBreaks(element) { 
 const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false); 
 const textNodes = []; 
 let node; 
 
 while (node = walker.nextNode()) { 
 if (node.textContent.trim() !== '') { 
 textNodes.push(node); 
 } 
 } 
 
 textNodes.forEach(textNode => { 
 if (textNode.parentNode && !textNode.parentNode.classList?.contains('post-text')) { 
 const span = document.createElement('span'); 
 span.className = 'post-text'; 
 span.textContent = textNode.textContent; 
 textNode.parentNode.replaceChild(span, textNode); 
 } 
 }); 
 
 element.querySelectorAll('br').forEach(br => { 
 const prevSibling = br.previousElementSibling; 
 const nextSibling = br.nextElementSibling; 
 
 if (prevSibling && nextSibling) { 
 const prevIsPostText = prevSibling.classList?.contains('post-text'); 
 const nextIsPostText = nextSibling.classList?.contains('post-text'); 
 
 if (prevIsPostText && nextIsPostText) { 
 prevSibling.classList.add('paragraph-end'); 
 br.remove(); 
 } else { 
 br.style.cssText = 'margin:0;padding:0;display:block;content:\'\';height:0.75em;margin-bottom:0.25em'; 
 } 
 } else { 
 br.remove(); 
 } 
 }); 
 
 const postTextElements = element.querySelectorAll('.post-text'); 
 for (let i = 0; i < postTextElements.length - 1; i++) { 
 const current = postTextElements[i]; 
 const next = postTextElements[i + 1]; 
 
 let nodeBetween = current.nextSibling; 
 let onlyWhitespace = true; 
 
 while (nodeBetween && nodeBetween !== next) { 
 if (nodeBetween.nodeType === Node.TEXT_NODE && nodeBetween.textContent.trim() !== '') { 
 onlyWhitespace = false; 
 break; 
 } 
 nodeBetween = nodeBetween.nextSibling; 
 } 
 
 if (onlyWhitespace) { 
 current.classList.add('paragraph-end'); 
 } 
 } 
 } 
 
 #cleanupEditSpans(element) { 
 element.querySelectorAll('span.edit').forEach(span => { 
 span.classList.add('post-edit'); 
 const timeMatch = span.textContent.match(/Edited by .+? - (.+)/); 
 if (timeMatch) { 
 span.innerHTML = '<i class="fa-regular fa-pen-to-square"></i> Edited on <time>' + this.#escapeHtml(timeMatch[1]) + '</time>'; 
 } 
 }); 
 } 
 
 #processSignature(element) { 
 element.querySelectorAll('.signature').forEach(sig => { 
 sig.classList.add('post-signature'); 
 sig.previousElementSibling?.tagName === 'BR' && sig.previousElementSibling.remove(); 
 }); 
 } 
 
 #modernizeQuotes(contentWrapper) { 
 contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => { 
 if (container.classList.contains('quote-modernized')) return; 
 
 this.#transformQuote(container); 
 container.classList.add('quote-modernized'); 
 }); 
 } 
 
 #transformQuote(container) { 
 const quoteTop = container.querySelector('.quote_top'); 
 const quoteContent = container.querySelector('.quote'); 
 
 if (!quoteTop || !quoteContent) return; 
 
 const quoteText = quoteTop.textContent.trim(); 
 const match = quoteText.match(/QUOTE\s*\(([^@]+)\s*@/); 
 const author = match ? match[1].trim() : 'Unknown'; 
 const quoteLink = quoteTop.querySelector('a'); 
 const linkHref = quoteLink?.href ?? '#'; 
 const isLongContent = this.#isLongContent(quoteContent); 
 
 const modernQuote = document.createElement('div'); 
 modernQuote.className = 'modern-quote' + (isLongContent ? ' long-quote' : ''); 
 
 let html = '<div class="quote-header">' + 
 '<div class="quote-meta">' + 
 '<div class="quote-icon">' + 
 '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' + 
 '</div>' + 
 '<div class="quote-info">' + 
 '<span class="quote-author">' + this.#escapeHtml(author) + ' <span class="quote-said">said:</span></span>' + 
 '</div>' + 
 '</div>' + 
 '<a href="' + this.#escapeHtml(linkHref) + '" class="quote-link" title="Go to post">' + 
 '<i class="fa-regular fa-chevron-up" aria-hidden="true"></i>' + 
 '</a>' + 
 '</div>'; 
 
 html += '<div class="quote-content' + (isLongContent ? ' collapsible-content' : '') + '">' + 
 this.#preserveMediaDimensionsInHTML(quoteContent.innerHTML) + 
 '</div>'; 
 
 if (isLongContent) { 
 html += '<button class="quote-expand-btn" type="button" aria-label="Show full quote">' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 'Show more' + 
 '</button>'; 
 } 
 
 modernQuote.innerHTML = html; 
 container.replaceWith(modernQuote); 
 
 if (isLongContent) { 
 this.#addQuoteEventListeners(modernQuote); 
 } 
 } 
 
 #isLongContent(contentElement) { 
 const clone = contentElement.cloneNode(true); 
 const textLength = clone.textContent.trim().length; 
 const mediaElements = clone.querySelectorAll('img, iframe, video, object, embed'); 
 const mediaCount = mediaElements.length; 
 const totalElements = clone.querySelectorAll('*').length; 
 
 let contentScore = 0; 
 
 if (textLength > 800) contentScore += 3; 
 else if (textLength > 500) contentScore += 2; 
 else if (textLength > 300) contentScore += 1; 
 
 if (mediaCount >= 3) contentScore += 3; 
 else if (mediaCount >= 2) contentScore += 2; 
 else if (mediaCount >= 1) contentScore += 1; 
 
 if (totalElements > 20) contentScore += 2; 
 else if (totalElements > 10) contentScore += 1; 
 
 const hasIframeOrVideo = clone.querySelector('iframe, video'); 
 if (hasIframeOrVideo) contentScore += 3; 
 
 const images = clone.querySelectorAll('img'); 
 if (images.length >= 2) { 
 let totalPixelArea = 0; 
 images.forEach(img => { 
 const width = parseInt(img.getAttribute('width')) || 0; 
 const height = parseInt(img.getAttribute('height')) || 0; 
 totalPixelArea += width * height; 
 }); 
 if (totalPixelArea > 500000) contentScore += 2; 
 } 
 
 return contentScore >= 4; 
 } 
 
 #preserveMediaDimensionsInHTML(html) { 
 const tempDiv = document.createElement('div'); 
 tempDiv.innerHTML = html; 
 this.#preserveMediaDimensions(tempDiv); 
 return tempDiv.innerHTML; 
 } 
 
 #preserveMediaDimensions(element) { 
 element.querySelectorAll('img').forEach(img => { 
 const originalWidth = img.getAttribute('width'); 
 const originalHeight = img.getAttribute('height'); 
 
 if (originalWidth && originalHeight) { 
 img.setAttribute('width', originalWidth); 
 img.setAttribute('height', originalHeight); 
 img.style.width = originalWidth + 'px'; 
 img.style.height = originalHeight + 'px'; 
 } else if (!img.hasAttribute('loading')) { 
 img.setAttribute('loading', 'lazy'); 
 } 
 
 if (!img.hasAttribute('alt')) { 
 img.setAttribute('alt', 'Image'); 
 } 
 }); 
 
 element.querySelectorAll('iframe').forEach(iframe => { 
 const originalWidth = iframe.getAttribute('width'); 
 const originalHeight = iframe.getAttribute('height'); 
 
 if (originalWidth && originalHeight) { 
 iframe.setAttribute('width', originalWidth); 
 iframe.setAttribute('height', originalHeight); 
 iframe.style.width = originalWidth + 'px'; 
 iframe.style.height = originalHeight + 'px'; 
 } else { 
 iframe.setAttribute('width', '560'); 
 iframe.setAttribute('height', '315'); 
 } 
 
 if (!iframe.hasAttribute('title')) { 
 iframe.setAttribute('title', 'Embedded content'); 
 } 
 
 if (!iframe.hasAttribute('loading')) { 
 iframe.setAttribute('loading', 'lazy'); 
 } 
 }); 
 
 element.querySelectorAll('video').forEach(video => { 
 const originalWidth = video.getAttribute('width'); 
 const originalHeight = video.getAttribute('height'); 
 
 if (originalWidth && originalHeight) { 
 video.setAttribute('width', originalWidth); 
 video.setAttribute('height', originalHeight); 
 video.style.width = originalWidth + 'px'; 
 video.style.height = originalHeight + 'px'; 
 } 
 
 if (!video.hasAttribute('controls')) { 
 video.setAttribute('controls', ''); 
 } 
 }); 
 } 
 
 #addQuoteEventListeners(quoteElement) { 
 const expandBtn = quoteElement.querySelector('.quote-expand-btn'); 
 const quoteContent = quoteElement.querySelector('.quote-content.collapsible-content'); 
 
 if (expandBtn && quoteContent) { 
 expandBtn.addEventListener('click', () => { 
 quoteContent.style.maxHeight = quoteContent.scrollHeight + 'px'; 
 expandBtn.style.display = 'none'; 
 setTimeout(() => { 
 quoteContent.style.maxHeight = 'none'; 
 }, 300); 
 }); 
 } 
 } 
 
 #addReputationToFooter(miniButtons, stEmoji, postFooter) { 
 if (miniButtons || stEmoji) { 
 const postActions = document.createElement('div'); 
 postActions.className = 'post-actions'; 
 
 if (miniButtons) { 
 this.#cleanupMiniButtons(miniButtons); 
 this.#setInitialPointsState(miniButtons); 
 const pointsContainer = miniButtons.querySelector('.points'); 
 if (pointsContainer) { 
 this.#updatePointsContainerActiveState(pointsContainer); 
 } 
 postActions.appendChild(miniButtons); 
 } 
 
 if (stEmoji) { 
 const emojiContainer = stEmoji.querySelector('.st-emoji-container'); 
 if (emojiContainer) { 
 this.#updateEmojiContainerActiveState(emojiContainer); 
 } 
 postActions.appendChild(stEmoji); 
 } 
 
 postFooter.insertBefore(postActions, postFooter.firstChild); 
 } 
 } 
 
 #modernizeBottomElements(title2Bottom, postFooter) { 
 title2Bottom.querySelectorAll('.rt.Sub').forEach(rtSub => { 
 const label = rtSub.querySelector('label'); 
 const checkbox = rtSub.querySelector('input[type="checkbox"]'); 
 const ipAddress = rtSub.querySelector('.ip_address'); 
 
 const modernContainer = document.createElement('div'); 
 modernContainer.className = 'modern-bottom-actions'; 
 
 let html = ''; 
 
 if (label && checkbox && !ipAddress) { 
 html = this.#createModernMultiquote(label, checkbox); 
 } else if (ipAddress && checkbox) { 
 html = this.#createModernModeratorView(ipAddress, checkbox, label); 
 } else if (ipAddress) { 
 html = this.#createModernIPAddress(ipAddress); 
 } else if (checkbox) { 
 html = this.#createBasicMultiquote(checkbox); 
 } else if (label) { 
 html = this.#createLabelOnly(label); 
 } 
 
 if (html) { 
 modernContainer.innerHTML = html; 
 postFooter.appendChild(modernContainer); 
 } 
 }); 
 } 
 
 #removeBreakAndNbsp(element) { 
 element.querySelectorAll('.Break.Sub').forEach(el => el.remove()); 
 
 // Also remove any &nbsp; entities
 const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
 const nodesToRemove = [];
 let node;
 
 while (node = walker.nextNode()) {
 if (node.textContent.includes('&nbsp;') || node.textContent.trim() === '') {
 nodesToRemove.push(node);
 }
 }
 
 nodesToRemove.forEach(node => {
 if (node.parentNode) {
 node.parentNode.removeChild(node);
 }
 });
 } 
 
 #removeBottomBorderAndBr(element) { 
 element.querySelectorAll('.bottomborder').forEach(bottomBorder => { 
 bottomBorder.remove(); 
 bottomBorder.nextElementSibling?.tagName === 'BR' && bottomBorder.nextElementSibling.remove(); 
 }); 
 } 
 
 #cleanupPostContent(post) { 
 post.querySelectorAll('.bottomborder').forEach(bottomBorder => { 
 bottomBorder.parentNode?.removeChild(bottomBorder); 
 bottomBorder.nextElementSibling?.tagName === 'BR' && 
 bottomBorder.parentNode?.removeChild(bottomBorder.nextElementSibling); 
 }); 
 } 
 
 #createStatElement(iconClass, value, additionalClass) { 
 const statDiv = document.createElement('div'); 
 statDiv.className = 'stat ' + additionalClass; 
 
 const icon = document.createElement('i'); 
 icon.className = iconClass; 
 icon.setAttribute('aria-hidden', 'true'); 
 
 const span = document.createElement('span'); 
 span.textContent = value; 
 
 statDiv.appendChild(icon); 
 statDiv.appendChild(span); 
 
 return statDiv; 
 } 
 
 #cleanupMiniButtons(miniButtons) { 
 const walker = document.createTreeWalker(miniButtons, NodeFilter.SHOW_TEXT, null, false); 
 const nodesToRemove = []; 
 let node; 
 
 while (node = walker.nextNode()) { 
 if (node.textContent.trim() === '' || node.textContent.includes('&nbsp;') || /^\s*$/.test(node.textContent)) { 
 nodesToRemove.push(node); 
 } 
 } 
 
 nodesToRemove.forEach(node => node.parentNode?.removeChild(node)); 
 
 Array.from(miniButtons.childNodes).forEach(child => { 
 if (child.nodeType === Node.TEXT_NODE && 
 (child.textContent.trim() === '' || child.textContent.includes('&nbsp;'))) { 
 miniButtons.removeChild(child); 
 } 
 }); 
 } 
 
 #setInitialPointsState(miniButtons) { 
 const pointsContainer = miniButtons.querySelector('.points'); 
 if (!pointsContainer) return; 
 
 const pointsPos = pointsContainer.querySelector('.points_pos'); 
 const pointsNeg = pointsContainer.querySelector('.points_neg'); 
 const pointsUp = pointsContainer.querySelector('.points_up'); 
 const pointsDown = pointsContainer.querySelector('.points_down'); 
 const bulletDelete = pointsContainer.querySelector('.bullet_delete'); 
 
 if (bulletDelete) { 
 if (pointsPos) { 
 pointsUp?.classList.add('active'); 
 pointsDown?.classList.remove('active'); 
 } else if (pointsNeg) { 
 const pointsUpIcon = pointsUp?.querySelector('i'); 
 const pointsDownIcon = pointsDown?.querySelector('i'); 
 
 if (pointsUpIcon?.classList.contains('fa-thumbs-down')) { 
 pointsUp?.classList.add('active'); 
 } 
 if (pointsDownIcon?.classList.contains('fa-thumbs-down')) { 
 pointsDown?.classList.add('active'); 
 } 
 
 if (pointsUp?.classList.contains('active')) { 
 pointsDown?.classList.remove('active'); 
 } else if (pointsDown?.classList.contains('active')) { 
 pointsUp?.classList.remove('active'); 
 } 
 } 
 } 
 } 
 
 #createModernMultiquote(label, checkbox) { 
 const labelText = label.textContent.replace('multiquote »', '').trim(); 
 const originalOnClick = label.getAttribute('onclick') ?? ''; 
 
 let html = '<div class="multiquote-control">' + 
 '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' + 
 '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' + 
 '</button>' + 
 '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>'; 
 
 if (checkbox) { 
 html += '<div class="user-checkbox-container">' + 
 checkbox.outerHTML + 
 '</div>'; 
 } 
 
 html += '</div>'; 
 return html; 
 } 
 
 #createBasicMultiquote(checkbox) { 
 const postId = checkbox.id.replace('p', ''); 
 const originalOnClick = "document.getElementById('" + checkbox.id + "').checked=!document.getElementById('" + checkbox.id + "').checked;post('" + postId + "')"; 
 
 return '<div class="multiquote-control">' + 
 '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' + 
 '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' + 
 '</button>' + 
 '<label class="multiquote-label">Quote +</label>' + 
 '<div class="user-checkbox-container">' + 
 checkbox.outerHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #createLabelOnly(label) { 
 const labelText = label.textContent.replace('multiquote »', '').trim(); 
 const originalOnClick = label.getAttribute('onclick') ?? ''; 
 
 return '<div class="multiquote-control">' + 
 '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' + 
 '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' + 
 '</button>' + 
 '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>' + 
 '</div>'; 
 } 
 
 #createModernModeratorView(ipAddress, checkbox, label) { 
 const ipLink = ipAddress.querySelector('a'); 
 const ipTextElement = ipAddress.querySelector('dd'); 
 const ipText = ipTextElement?.textContent ?? ''; 
 
 let originalOnClick = ''; 
 let labelText = 'Quote +'; 
 
 if (label) { 
 originalOnClick = label.getAttribute('onclick') ?? ''; 
 labelText = label.textContent.replace('multiquote »', '').trim() || 'Quote +'; 
 } else { 
 const postId = checkbox.id.replace('p', ''); 
 originalOnClick = "document.getElementById('" + checkbox.id + "').checked=!document.getElementById('" + checkbox.id + "').checked;post('" + postId + "')"; 
 } 
 
 let html = '<div class="moderator-controls">' + 
 '<div class="multiquote-control">' + 
 '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' + 
 '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' + 
 '</button>' + 
 '<label class="multiquote-label">' + this.#escapeHtml(labelText) + '</label>' + 
 '</div>' + 
 '<div class="ip-address-control">' + 
 '<span class="ip-label">IP:</span>' + 
 '<span class="ip-value">'; 
 
 if (ipLink) { 
 html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link">' + this.#escapeHtml(ipText) + '</a>'; 
 } else { 
 html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>'; 
 } 
 
 html += '</span></div>' + 
 '<div class="mod-checkbox-container">' + 
 checkbox.outerHTML + 
 '</div></div>'; 
 
 return html; 
 } 
 
 #createModernIPAddress(ipAddress) { 
 const ipLink = ipAddress.querySelector('a'); 
 const ipTextElement = ipAddress.querySelector('dd'); 
 const ipText = ipTextElement?.textContent ?? ''; 
 
 let html = '<div class="ip-address-control">' + 
 '<span class="ip-label">IP:</span>' + 
 '<span class="ip-value">'; 
 
 if (ipLink) { 
 html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link">' + this.#escapeHtml(ipText) + '</a>'; 
 } else { 
 html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>'; 
 } 
 
 html += '</span></div>'; 
 return html; 
 } 
 
 #convertMiniButtonsToButtons(post) { 
 const miniButtonsContainer = post.querySelector('.mini_buttons.rt.Sub'); 
 if (!miniButtonsContainer) return; 
 
 miniButtonsContainer.querySelectorAll('.mini_buttons.rt.Sub a').forEach(link => { 
 const href = link.getAttribute('href'); 
 
 if (href?.startsWith('javascript:')) { 
 const jsCode = href.replace('javascript:', ''); 
 if (jsCode.includes('delete_post')) { 
 const button = document.createElement('button'); 
 button.className = 'btn btn-icon btn-delete'; 
 button.setAttribute('data-action', 'delete'); 
 button.setAttribute('onclick', jsCode); 
 button.setAttribute('title', 'Delete'); 
 button.setAttribute('type', 'button'); 
 
 let buttonHTML = link.innerHTML; 
 buttonHTML = buttonHTML.replace(/<i(?![^>]*aria-hidden)/g, '<i aria-hidden="true" '); 
 button.innerHTML = buttonHTML; 
 
 link.parentNode.replaceChild(button, link); 
 } 
 } else if (href?.includes('CODE=08')) { 
 link.classList.add('btn', 'btn-icon', 'btn-edit'); 
 link.setAttribute('data-action', 'edit'); 
 link.setAttribute('title', 'Edit'); 
 
 const icon = link.querySelector('i'); 
 icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true'); 
 } else if (href?.includes('CODE=02')) { 
 link.classList.add('btn', 'btn-icon', 'btn-quote'); 
 link.setAttribute('data-action', 'quote'); 
 link.setAttribute('title', 'Quote'); 
 link.getAttribute('rel') && link.setAttribute('rel', link.getAttribute('rel')); 
 
 const icon = link.querySelector('i'); 
 icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true'); 
 } else if (href) { 
 link.classList.add('btn', 'btn-icon'); 
 link.querySelectorAll('i').forEach(icon => { 
 !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true'); 
 }); 
 } 
 }); 
 
 this.#reorderPostButtons(miniButtonsContainer); 
 } 
 
 #addShareButton(post) { 
 const miniButtonsContainer = post.querySelector('.post-header .mini_buttons.rt.Sub'); 
 if (!miniButtonsContainer || miniButtonsContainer.querySelector('.btn-share')) return; 
 
 const shareButton = document.createElement('button'); 
 shareButton.className = 'btn btn-icon btn-share'; 
 shareButton.setAttribute('data-action', 'share'); 
 shareButton.setAttribute('title', 'Share this post'); 
 shareButton.setAttribute('type', 'button'); 
 shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>'; 
 
 const deleteButton = miniButtonsContainer.querySelector('.btn-delete, [data-action="delete"]'); 
 if (deleteButton) { 
 miniButtonsContainer.insertBefore(shareButton, deleteButton); 
 } else { 
 miniButtonsContainer.insertBefore(shareButton, miniButtonsContainer.firstChild); 
 } 
 
 shareButton.addEventListener('click', () => this.#handleSharePost(post)); 
 } 
 
 #reorderPostButtons(container) { 
 const elements = Array.from(container.children); 
 const order = ['share', 'quote', 'edit', 'delete']; 
 
 elements.sort((a, b) => { 
 const getAction = (element) => { 
 const dataAction = element.getAttribute('data-action'); 
 if (dataAction && order.includes(dataAction)) return dataAction; 
 
 if (element.classList.contains('btn-share')) return 'share'; 
 if (element.classList.contains('btn-quote')) return 'quote'; 
 if (element.classList.contains('btn-edit')) return 'edit'; 
 if (element.classList.contains('btn-delete')) return 'delete'; 
 
 if (element.href) { 
 if (element.href.includes('CODE=02')) return 'quote'; 
 if (element.href.includes('CODE=08')) return 'edit'; 
 } 
 
 if (element.onclick?.toString().includes('delete_post')) return 'delete'; 
 
 return 'other'; 
 }; 
 
 const actionA = getAction(a); 
 const actionB = getAction(b); 
 const indexA = order.indexOf(actionA); 
 const indexB = order.indexOf(actionB); 
 
 if (indexA !== -1 && indexB !== -1) return indexA - indexB; 
 if (indexA !== -1) return -1; 
 if (indexB !== -1) return 1; 
 return 0; 
 }); 
 
 container.innerHTML = ''; 
 elements.forEach(el => container.appendChild(el)); 
 } 
 
 #handleSharePost(post) { 
 let postLink = null; 
 
 const timestampLink = post.querySelector('.post-header .lt.Sub a[href*="#entry"]'); 
 if (timestampLink) { 
 postLink = timestampLink.href; 
 } 
 
 if (!postLink) { 
 const timeLink = post.querySelector('.post-header time[class*="when"]'); 
 if (timeLink?.closest('a')) { 
 postLink = timeLink.closest('a').href; 
 } 
 } 
 
 if (!postLink) { 
 const postIdMatch = post.id.match(/\d+/); 
 if (postIdMatch) { 
 const postId = postIdMatch[0]; 
 const topicMatch = window.location.href.match(/t=(\d+)/); 
 if (topicMatch) { 
 postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId; 
 } 
 } 
 } 
 
 if (postLink) { 
 this.#copyToClipboard(postLink); 
 } else { 
 this.#showNotification('Could not find post link', 'error'); 
 } 
 } 
 
 #copyToClipboard(text) { 
 if (navigator.clipboard?.writeText) { 
 navigator.clipboard.writeText(text).then(() => { 
 this.#showNotification('Link copied to clipboard!', 'success'); 
 }).catch(() => { 
 this.#fallbackCopy(text); 
 }); 
 } else { 
 this.#fallbackCopy(text); 
 } 
 } 
 
 #fallbackCopy(text) { 
 const textArea = document.createElement('textarea'); 
 textArea.value = text; 
 textArea.style.cssText = 'position:fixed;opacity:0'; 
 document.body.appendChild(textArea); 
 textArea.focus(); 
 textArea.select(); 
 
 try { 
 if (document.execCommand('copy')) { 
 this.#showNotification('Link copied to clipboard!', 'success'); 
 } else { 
 this.#showNotification('Failed to copy link', 'error'); 
 } 
 } catch { 
 this.#showNotification('Failed to copy link', 'error'); 
 } finally { 
 document.body.removeChild(textArea); 
 } 
 } 
 
 #showNotification(message, type) { 
 document.querySelector('.share-notification')?.remove(); 
 
 const notification = document.createElement('div'); 
 notification.className = 'share-notification share-notification-' + type; 
 
 notification.style.cssText = 
 'position:fixed;' + 
 'top:20px;' + 
 'right:20px;' + 
 'padding:12px 20px;' + 
 'border-radius:var(--radius);' + 
 'background:' + (type === 'success' ? 'var(--success-color)' : 'var(--danger-color)') + ';' + 
 'color:white;' + 
 'font-weight:500;' + 
 'box-shadow:var(--shadow-lg);' + 
 'z-index:9;' + 
 'display:flex;' + 
 'align-items:center;' + 
 'gap:10px;' + 
 'animation:slideIn 0.3s ease-out;' + 
 'max-width:300px;'; 
 
 const icon = type === 'success' 
 ? '<i class="fa-regular fa-check-circle" aria-hidden="true"></i>' 
 : '<i class="fa-regular fa-exclamation-circle" aria-hidden="true"></i>'; 
 
 notification.innerHTML = icon + '<span>' + message + '</span>'; 
 document.body.appendChild(notification); 
 
 setTimeout(() => { 
 if (notification.parentNode) { 
 notification.style.animation = 'slideOut 0.3s ease-out'; 
 setTimeout(() => notification.parentNode?.removeChild(notification), 300); 
 } 
 }, 3000); 
 
 if (!document.querySelector('#share-notification-styles')) { 
 const style = document.createElement('style'); 
 style.id = 'share-notification-styles'; 
 style.textContent = 
 '@keyframes slideIn{from{transform:translateX(100%);opacity:0;}to{transform:translateX(0);opacity:1;}}' + 
 '@keyframes slideOut{from{transform:translateX(0);opacity:1;}to{transform:translateX(100%);opacity:0;}}'; 
 document.head.appendChild(style); 
 } 
 } 
 
 #enhanceReputationSystem() { 
 document.addEventListener('click', (e) => { 
 const pointsUp = e.target.closest('.points_up'); 
 const pointsDown = e.target.closest('.points_down'); 
 const emojiPreview = e.target.closest('.st-emoji-preview'); 
 
 if (pointsUp || pointsDown) { 
 const pointsContainer = (pointsUp || pointsDown).closest('.points'); 
 const bulletDelete = pointsContainer?.querySelector('.bullet_delete'); 
 
 if (bulletDelete && bulletDelete.onclick && 
 (pointsContainer.querySelector('.points_pos') || 
 pointsContainer.querySelector('.points_neg'))) { 
 bulletDelete.onclick(); 
 e.preventDefault(); 
 e.stopPropagation(); 
 return; 
 } 
 
 if (pointsUp) { 
 pointsContainer?.querySelector('.points_down')?.classList.remove('active'); 
 pointsUp.classList.add('active'); 
 } 
 
 if (pointsDown) { 
 pointsContainer?.querySelector('.points_up')?.classList.remove('active'); 
 pointsDown.classList.add('active'); 
 } 
 } 
 
 if (emojiPreview) { 
 emojiPreview.closest('.st-emoji-container')?.classList.toggle('active'); 
 } 
 }); 
 } 
 
 #escapeHtml(unsafe) { 
 if (typeof unsafe !== 'string') return unsafe; 
 return unsafe 
 .replace(/&/g, '&amp;') 
 .replace(/</g, '&lt;') 
 .replace(/>/g, '&gt;') 
 .replace(/"/g, '&quot;') 
 .replace(/'/g, '&#039;'); 
 } 
 
destroy() { 
 const ids = [this.#postModernizerId, this.#activeStateObserverId,
 this.#debouncedObserverId, this.#cleanupObserverId, this.#searchPostObserverId]; 
 
 ids.forEach(id => id && globalThis.forumObserver?.unregister(id)); 
 
 // Clear retry timeout
 if (this.#retryTimeoutId) {
 clearTimeout(this.#retryTimeoutId);
 this.#retryTimeoutId = null;
 }
 
 console.log('Post Modernizer destroyed'); 
 } 
} 
 
// Modern initialization without DOMContentLoaded
(function initPostModernizer() {
 // Check if script is loaded before DOM is ready
 const init = () => {
 try {
 // Create instance - it will handle its own initialization with retry logic
 globalThis.postModernizer = new PostModernizer();
 } catch (error) {
 console.error('Failed to create Post Modernizer instance:', error);
 
 // Fallback: try again after a short delay
 setTimeout(() => {
 if (!globalThis.postModernizer) {
 try {
 globalThis.postModernizer = new PostModernizer();
 } catch (retryError) {
 console.error('Post Modernizer failed on retry:', retryError);
 }
 }
 }, 100);
 }
 };
 
 // If document is already ready, initialize immediately
 if (document.readyState !== 'loading') {
 // Use queueMicrotask to ensure other scripts have loaded
 queueMicrotask(init);
 } else {
 // If still loading, wait for DOM to be ready but also start immediately
 // This allows the script to work even if loaded late
 init();
 }
})();
 
// Cleanup on page hide
globalThis.addEventListener('pagehide', () => {
 if (globalThis.postModernizer && typeof globalThis.postModernizer.destroy === 'function') {
 globalThis.postModernizer.destroy();
 }
});
